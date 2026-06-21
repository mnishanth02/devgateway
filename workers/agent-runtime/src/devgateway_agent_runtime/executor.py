from __future__ import annotations

import hashlib
from dataclasses import dataclass
from uuid import uuid4

from .contracts import (
    DelegationContract,
    ScopeRefs,
    SubAgentExecutionResult,
    TraceContext,
    ValidationResult,
    WorkflowEvent,
)
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus, stable_idempotency_key
from .model_adapter import GovernedFixtureModelAdapter, ModelPolicyError
from .repositories import RuntimeRepository
from .validation import validate_structured_output


@dataclass(slots=True)
class FixtureSubAgentExecutor:
    repository: RuntimeRepository
    model_adapter: GovernedFixtureModelAdapter

    def execute(self, delegation: DelegationContract, *, parent_scope: ScopeRefs) -> SubAgentExecutionResult:
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
            model_result = self.model_adapter.invoke(delegation.to_model_request())
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

    @staticmethod
    def _confidence(value: object) -> float | None:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        return max(0.0, min(1.0, float(value)))

    @staticmethod
    def _digest(*parts: str) -> str:
        return hashlib.sha256(":".join(parts).encode("utf-8")).hexdigest()[:16]
