from __future__ import annotations

import hashlib
from dataclasses import dataclass
from uuid import uuid4

from .contracts import (
    DelegationContract,
    ModelResult,
    ScopeRefs,
    SubAgentExecutionResult,
    TraceContext,
    ValidationResult,
    WorkflowEvent,
)
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus, stable_idempotency_key
from .model_adapter import GovernedFixtureModelAdapter, ModelAbortOutcome, ModelPolicyError
from .repositories import RuntimeRepository
from .validation import validate_structured_output


class CancellationObserved(RuntimeError):
    """Raised when cancellation is observed before more runtime side effects."""


class CancellationCheckError(RuntimeError):
    """Raised when cancellation state cannot be checked fail-closed."""


@dataclass(slots=True)
class FixtureSubAgentExecutor:
    repository: RuntimeRepository
    model_adapter: GovernedFixtureModelAdapter

    def execute(self, delegation: DelegationContract, *, parent_scope: ScopeRefs) -> SubAgentExecutionResult:
        self._check_cancellation(delegation, phase="before_scope_validation")
        scope_violations = self._scope_violations(delegation, parent_scope)
        if scope_violations:
            audit_ref = self._complete_operation(delegation, IdempotencyScope.AUDIT_EVENT, "scope-rejected")
            validation = ValidationResult(
                valid=False,
                output_schema_ref=delegation.output_schema.schema_ref,
                evidence_ref=f"fixture-ref:scope-evidence:{self._digest(delegation.delegation_ref, ','.join(scope_violations))}",
                failure_code="scope_widened",
                failure_path="$.scope",
                expected_type="parent_subset",
                actual_type="widened",
            )
            result = SubAgentExecutionResult(
                workflow_id=delegation.workflow_id,
                delegation_id=delegation.delegation_id,
                delegation_ref=delegation.delegation_ref,
                status="scope_rejected",
                model_alias=delegation.model_alias,
                model_result_ref=None,
                validation=validation,
                artifact_ref=None,
                cost_ref=None,
                audit_ref=audit_ref,
                confidence=None,
                scope_violations=scope_violations,
            )
            self._append_event(delegation, "sub_agent.scope_rejected", result, trace_context=delegation.trace_context.child())
            return result

        try:
            model_result = self._invoke_model(delegation)
        except ModelPolicyError:
            audit_ref = self._complete_operation(delegation, IdempotencyScope.AUDIT_EVENT, "model-policy-rejected")
            validation = ValidationResult(
                valid=False,
                output_schema_ref=delegation.output_schema.schema_ref,
                evidence_ref=f"fixture-ref:model-policy-evidence:{self._digest(delegation.delegation_ref, delegation.model_alias)}",
                failure_code="model_policy_rejected",
                failure_path="$.model_alias",
                expected_type="allowed_fixture_alias",
                actual_type="rejected",
            )
            result = SubAgentExecutionResult(
                workflow_id=delegation.workflow_id,
                delegation_id=delegation.delegation_id,
                delegation_ref=delegation.delegation_ref,
                status="model_policy_rejected",
                model_alias=delegation.model_alias,
                model_result_ref=None,
                validation=validation,
                artifact_ref=None,
                cost_ref=None,
                audit_ref=audit_ref,
                confidence=None,
            )
            self._append_event(delegation, "sub_agent.model_policy_rejected", result, trace_context=delegation.trace_context.child())
            return result

        validation = validate_structured_output(
            model_result.structured_output,
            delegation.output_schema,
            output_ref=model_result.result_ref,
        )
        if not validation.valid:
            cost_ref = self._complete_operation(delegation, IdempotencyScope.COST_EVENT, "model-cost-validation-failed")
            audit_ref = self._complete_operation(delegation, IdempotencyScope.AUDIT_EVENT, "validation-failed")
            result = SubAgentExecutionResult(
                workflow_id=delegation.workflow_id,
                delegation_id=delegation.delegation_id,
                delegation_ref=delegation.delegation_ref,
                status="validation_failed",
                model_alias=delegation.model_alias,
                model_result_ref=model_result.result_ref,
                validation=validation,
                artifact_ref=None,
                cost_ref=cost_ref,
                audit_ref=audit_ref,
                confidence=None,
            )
            self._append_event(delegation, "sub_agent.validation_failed", result, trace_context=model_result.trace_context.child())
            return result

        self._check_cancellation(delegation, phase="before_validated_output_side_effects")
        artifact_ref = self._complete_operation(delegation, IdempotencyScope.ARTIFACT_WRITE, "validated-output")
        cost_ref = self._complete_operation(delegation, IdempotencyScope.COST_EVENT, "model-cost")
        audit_ref = self._complete_operation(delegation, IdempotencyScope.AUDIT_EVENT, "completed")
        confidence = self._confidence(model_result.structured_output.get("confidence"))
        result = SubAgentExecutionResult(
            workflow_id=delegation.workflow_id,
            delegation_id=delegation.delegation_id,
            delegation_ref=delegation.delegation_ref,
            status="completed",
            model_alias=delegation.model_alias,
            model_result_ref=model_result.result_ref,
            validation=validation,
            artifact_ref=artifact_ref,
            cost_ref=cost_ref,
            audit_ref=audit_ref,
            confidence=confidence,
            validated_output=dict(model_result.structured_output),
        )
        self._append_event(delegation, "sub_agent.completed", result, trace_context=model_result.trace_context.child())
        return result

    def _invoke_model(self, delegation: DelegationContract) -> ModelResult:
        request = delegation.to_model_request()
        self._check_cancellation(delegation, phase="before_model_call", abort_request_ref=request.request_ref)
        stream = getattr(self.model_adapter, "invoke_stream", None)
        if callable(stream):
            last_result: ModelResult | None = None
            for chunk in stream(request):
                self._check_cancellation(
                    delegation,
                    phase="between_model_stream_chunks",
                    abort_request_ref=request.request_ref,
                )
                if isinstance(chunk, ModelResult):
                    last_result = chunk
            if last_result is None:
                raise ModelPolicyError("model stream did not produce a terminal result")
            return last_result
        result = self.model_adapter.invoke(request)
        self._check_cancellation(
            delegation,
            phase="after_model_call_before_validation",
            abort_request_ref=request.request_ref,
        )
        return result

    def _scope_violations(self, delegation: DelegationContract, parent_scope: ScopeRefs) -> tuple[str, ...]:
        violations = tuple(parent_scope.widening_violations(delegation.scope))
        explicit_checks: list[str] = []
        allowed_context_refs = set(delegation.allowed_context_refs)
        parent_context_refs = set(parent_scope.context_refs)
        if delegation.context_ref not in allowed_context_refs:
            explicit_checks.append("context_ref")
        if not allowed_context_refs or not allowed_context_refs.issubset(parent_context_refs):
            explicit_checks.append("allowed_context_refs")
        if delegation.timeout_seconds <= 0 or (
            parent_scope.max_timeout_seconds > 0 and delegation.timeout_seconds > parent_scope.max_timeout_seconds
        ):
            explicit_checks.append("timeout_seconds")
        if delegation.model_alias not in delegation.scope.model_aliases:
            explicit_checks.append("model_alias")
        if delegation.output_schema.schema_ref not in delegation.scope.output_schema_refs:
            explicit_checks.append("output_schema")
        return tuple(dict.fromkeys((*violations, *explicit_checks)))

    def _complete_operation(self, delegation: DelegationContract, scope: IdempotencyScope, purpose: str) -> str:
        self._check_cancellation(delegation, phase=f"before_side_effect:{scope.value}:{purpose}")
        request_ref = f"fixture-ref:{scope.value}:request:{delegation.workflow_id}:{delegation.delegation_id}:{purpose}"
        key = stable_idempotency_key(scope, request_ref)
        result_ref = f"fixture-ref:{scope.value}:result:{self._digest(request_ref, key)}"
        record, _created = self.repository.reserve_idempotency(
            IdempotencyRecord(
                scope=scope,
                key=key,
                workflow_id=delegation.workflow_id,
                request_ref=request_ref,
            )
        )
        if record.status == IdempotencyStatus.COMPLETED and record.result_ref is not None:
            return record.result_ref
        self.repository.complete_idempotency(scope, key, result_ref=result_ref)
        return result_ref

    def _append_event(
        self,
        delegation: DelegationContract,
        event_type: str,
        result: SubAgentExecutionResult,
        *,
        trace_context: TraceContext,
    ) -> None:
        refs = {
            "delegation_ref": delegation.delegation_ref,
            "validation_evidence_ref": result.validation.evidence_ref,
            "audit_ref": result.audit_ref,
        }
        if result.model_result_ref:
            refs["model_result_ref"] = result.model_result_ref
        if result.artifact_ref:
            refs["artifact_ref"] = result.artifact_ref
        if result.cost_ref:
            refs["cost_ref"] = result.cost_ref
        self.repository.append_event(
            WorkflowEvent(
                event_id=f"evt_{uuid4().hex}",
                workflow_id=delegation.workflow_id,
                event_type=event_type,
                trace_context=trace_context,
                refs=refs,
            )
        )

    def _check_cancellation(
        self,
        delegation: DelegationContract,
        *,
        phase: str,
        abort_request_ref: str | None = None,
    ) -> None:
        if not hasattr(self.repository, "has_active_cancellation"):
            return
        try:
            active = self.repository.has_active_cancellation(delegation.workflow_id)  # type: ignore[attr-defined]
        except Exception as exc:
            raise CancellationCheckError(
                f"failed to check cancellation for workflow {delegation.workflow_id} at {phase}"
            ) from exc
        if not active:
            return

        outcome = self._attempt_abort(delegation, phase=phase, request_ref=abort_request_ref)
        validation = ValidationResult(
            valid=False,
            output_schema_ref=delegation.output_schema.schema_ref,
            evidence_ref=(outcome.evidence_ref if outcome else f"fixture-ref:cancellation:{delegation.workflow_id}"),
            failure_code="cancellation_observed",
        )
        result = SubAgentExecutionResult(
            workflow_id=delegation.workflow_id,
            delegation_id=delegation.delegation_id,
            delegation_ref=delegation.delegation_ref,
            status="cancelled",
            model_alias=delegation.model_alias,
            model_result_ref=None,
            validation=validation,
            artifact_ref=None,
            cost_ref=None,
            audit_ref=f"fixture-ref:audit:cancellation:{self._digest(delegation.workflow_id, phase)}",
            confidence=None,
        )
        refs_trace = delegation.trace_context.child(baggage_refs=(*delegation.trace_context.baggage_refs, phase))
        self._append_event(delegation, "cancellation_observed", result, trace_context=refs_trace)
        if outcome is not None:
            self.repository.append_event(
                WorkflowEvent(
                    event_id=f"evt_{uuid4().hex}",
                    workflow_id=delegation.workflow_id,
                    event_type="cancellation_observed",
                    trace_context=refs_trace.child(),
                    refs={
                        "phase": phase,
                        "abort_outcome": outcome.outcome,
                        "abort_evidence_ref": outcome.evidence_ref,
                        "abort_supported": str(outcome.supported).lower(),
                    },
                )
            )
        raise CancellationObserved(f"workflow cancellation observed at {phase}")

    def _attempt_abort(
        self,
        delegation: DelegationContract,
        *,
        phase: str,
        request_ref: str | None,
    ) -> ModelAbortOutcome | None:
        if request_ref is None:
            return None
        abort = getattr(self.model_adapter, "abort", None)
        if not callable(abort):
            return None
        reason_ref = f"fixture-ref:cancellation:{delegation.workflow_id}:{phase}"
        try:
            outcome = abort(request_ref, reason_ref=reason_ref)
        except Exception as exc:
            return ModelAbortOutcome(
                request_ref=request_ref,
                attempted=True,
                supported=True,
                outcome="error",
                evidence_ref=f"fixture-ref:model-abort-error:{self._digest(request_ref, phase, exc.__class__.__name__)}",
                reason_ref=reason_ref,
            )
        if isinstance(outcome, ModelAbortOutcome):
            return outcome
        return ModelAbortOutcome(
            request_ref=request_ref,
            attempted=True,
            supported=True,
            outcome=str(outcome),
            evidence_ref=f"fixture-ref:model-abort:{self._digest(request_ref, phase)}",
            reason_ref=reason_ref,
        )

    @staticmethod
    def _confidence(value: object) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return max(0.0, min(1.0, float(value)))

    @staticmethod
    def _digest(*parts: str) -> str:
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()[:16]
