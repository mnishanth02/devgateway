from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Mapping
from uuid import uuid4


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class WorkflowTransitionError(ValueError):
    """Raised when a workflow state transition violates the contract."""


class WorkflowState(str, Enum):
    CREATED = "created"
    QUEUED = "queued"
    PLANNING = "planning"
    DELEGATING = "delegating"
    RUNNING = "running"
    SYNTHESIZING = "synthesizing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_WORKFLOW_STATES = frozenset(
    {WorkflowState.COMPLETED, WorkflowState.FAILED, WorkflowState.CANCELLED}
)

WORKFLOW_TRANSITIONS: Mapping[WorkflowState, frozenset[WorkflowState]] = {
    WorkflowState.CREATED: frozenset({WorkflowState.QUEUED, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.QUEUED: frozenset({WorkflowState.PLANNING, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.PLANNING: frozenset({WorkflowState.DELEGATING, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.DELEGATING: frozenset({WorkflowState.RUNNING, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.RUNNING: frozenset({WorkflowState.SYNTHESIZING, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.SYNTHESIZING: frozenset({WorkflowState.COMPLETED, WorkflowState.CANCELLED, WorkflowState.FAILED}),
    WorkflowState.COMPLETED: frozenset(),
    WorkflowState.FAILED: frozenset(),
    WorkflowState.CANCELLED: frozenset(),
}


class StepKind(str, Enum):
    PLANNING = "planning"
    DELEGATING = "delegating"
    RUNNING = "running"
    SYNTHESIZING = "synthesizing"


class StepState(str, Enum):
    PENDING = "pending"
    CLAIMED = "claimed"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


STEP_TRANSITIONS: Mapping[StepState, frozenset[StepState]] = {
    StepState.PENDING: frozenset({StepState.CLAIMED, StepState.RUNNING, StepState.SKIPPED, StepState.FAILED}),
    StepState.CLAIMED: frozenset({StepState.RUNNING, StepState.PENDING, StepState.FAILED}),
    StepState.RUNNING: frozenset({StepState.COMPLETED, StepState.PENDING, StepState.FAILED}),
    StepState.COMPLETED: frozenset(),
    StepState.FAILED: frozenset({StepState.PENDING}),
    StepState.SKIPPED: frozenset(),
}


@dataclass(frozen=True, slots=True)
class TraceContext:
    trace_id: str
    span_id: str
    parent_span_id: str | None = None
    correlation_id: str | None = None
    baggage_refs: tuple[str, ...] = ()

    @classmethod
    def new(cls, *, correlation_id: str | None = None, baggage_refs: tuple[str, ...] = ()) -> "TraceContext":
        return cls(trace_id=uuid4().hex, span_id=uuid4().hex[:16], correlation_id=correlation_id, baggage_refs=baggage_refs)

    def child(self, *, correlation_id: str | None = None, baggage_refs: tuple[str, ...] | None = None) -> "TraceContext":
        return TraceContext(
            trace_id=self.trace_id,
            span_id=uuid4().hex[:16],
            parent_span_id=self.span_id,
            correlation_id=correlation_id if correlation_id is not None else self.correlation_id,
            baggage_refs=self.baggage_refs if baggage_refs is None else baggage_refs,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "trace_id": self.trace_id,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "correlation_id": self.correlation_id,
            "baggage_refs": list(self.baggage_refs),
        }


@dataclass(frozen=True, slots=True)
class Workflow:
    workflow_id: str
    state: WorkflowState
    idempotency_key: str
    trace_context: TraceContext
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    version: int = 0
    workflow_ref: str = "fixture-ref:workflow"

    def transition_to(self, target: WorkflowState, *, now: datetime | None = None) -> "Workflow":
        if target == self.state:
            return self
        allowed = WORKFLOW_TRANSITIONS[self.state]
        if target not in allowed:
            raise WorkflowTransitionError(f"cannot transition workflow from {self.state.value} to {target.value}")
        timestamp = now or utc_now()
        return replace(self, state=target, updated_at=timestamp, version=self.version + 1)

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "state": self.state.value,
            "idempotency_key": self.idempotency_key,
            "trace_context": self.trace_context.to_dict(),
            "created_at": isoformat_utc(self.created_at),
            "updated_at": isoformat_utc(self.updated_at),
            "version": self.version,
            "workflow_ref": self.workflow_ref,
        }


@dataclass(frozen=True, slots=True)
class WorkflowStep:
    step_id: str
    workflow_id: str
    kind: StepKind
    state: StepState
    input_ref: str
    idempotency_key: str
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    attempt: int = 0
    output_ref: str | None = None

    def transition_to(self, target: StepState, *, now: datetime | None = None) -> "WorkflowStep":
        if target == self.state:
            return self
        allowed = STEP_TRANSITIONS[self.state]
        if target not in allowed:
            raise WorkflowTransitionError(f"cannot transition step from {self.state.value} to {target.value}")
        return replace(self, state=target, updated_at=now or utc_now())

    def with_attempt(self, attempt: int, *, now: datetime | None = None) -> "WorkflowStep":
        return replace(self, attempt=attempt, updated_at=now or utc_now())

    def with_output(self, output_ref: str, *, now: datetime | None = None) -> "WorkflowStep":
        return replace(self, output_ref=output_ref, updated_at=now or utc_now())

    def to_dict(self) -> dict[str, object]:
        return {
            "step_id": self.step_id,
            "workflow_id": self.workflow_id,
            "kind": self.kind.value,
            "state": self.state.value,
            "attempt": self.attempt,
            "input_ref": self.input_ref,
            "output_ref": self.output_ref,
            "idempotency_key": self.idempotency_key,
            "created_at": isoformat_utc(self.created_at),
            "updated_at": isoformat_utc(self.updated_at),
        }


@dataclass(frozen=True, slots=True)
class WorkflowEvent:
    event_id: str
    workflow_id: str
    event_type: str
    trace_context: TraceContext
    occurred_at: datetime = field(default_factory=utc_now)
    state: WorkflowState | None = None
    step_id: str | None = None
    refs: Mapping[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "event_id": self.event_id,
            "workflow_id": self.workflow_id,
            "event_type": self.event_type,
            "state": self.state.value if self.state else None,
            "step_id": self.step_id,
            "refs": dict(self.refs),
            "trace_context": self.trace_context.to_dict(),
            "occurred_at": isoformat_utc(self.occurred_at),
        }


class PrimitiveSchemaType(str, Enum):
    STRING = "string"
    INTEGER = "integer"
    NUMBER = "number"
    BOOLEAN = "boolean"


def primitive_schema_value(value: PrimitiveSchemaType | str) -> str:
    return value.value if isinstance(value, PrimitiveSchemaType) else str(value)


@dataclass(frozen=True, slots=True)
class OutputSchemaContract:
    schema_ref: str
    required_fields: Mapping[str, PrimitiveSchemaType | str]
    optional_fields: Mapping[str, PrimitiveSchemaType | str] = field(default_factory=dict)

    def required_field_types(self) -> dict[str, str]:
        return {field_name: primitive_schema_value(field_type) for field_name, field_type in self.required_fields.items()}

    def optional_field_types(self) -> dict[str, str]:
        return {field_name: primitive_schema_value(field_type) for field_name, field_type in self.optional_fields.items()}

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_ref": self.schema_ref,
            "required_fields": self.required_field_types(),
            "optional_fields": self.optional_field_types(),
        }


@dataclass(frozen=True, slots=True)
class ScopeRefs:
    principal_ref: str
    project_ref: str
    data_class_ref: str
    budget_pool_ref: str
    budget_reservation_refs: tuple[str, ...] = ()
    context_refs: tuple[str, ...] = ()
    tool_refs: tuple[str, ...] = ()
    model_aliases: tuple[str, ...] = ()
    output_schema_refs: tuple[str, ...] = ()
    max_timeout_seconds: int = 0

    def widening_violations(self, child: "ScopeRefs") -> tuple[str, ...]:
        violations: list[str] = []
        for field_name in ("principal_ref", "project_ref", "data_class_ref", "budget_pool_ref"):
            if getattr(self, field_name) != getattr(child, field_name):
                violations.append(field_name)
        subset_fields = (
            "budget_reservation_refs",
            "context_refs",
            "tool_refs",
            "model_aliases",
            "output_schema_refs",
        )
        for field_name in subset_fields:
            parent_values = set(getattr(self, field_name))
            child_values = set(getattr(child, field_name))
            if not child_values:
                violations.append(field_name)
            elif not child_values.issubset(parent_values):
                violations.append(field_name)
        if child.max_timeout_seconds <= 0:
            violations.append("max_timeout_seconds")
        elif self.max_timeout_seconds > 0 and child.max_timeout_seconds > self.max_timeout_seconds:
            violations.append("max_timeout_seconds")
        return tuple(violations)

    def to_dict(self) -> dict[str, object]:
        return {
            "principal_ref": self.principal_ref,
            "project_ref": self.project_ref,
            "data_class_ref": self.data_class_ref,
            "budget_pool_ref": self.budget_pool_ref,
            "budget_reservation_refs": list(self.budget_reservation_refs),
            "context_refs": list(self.context_refs),
            "tool_refs": list(self.tool_refs),
            "model_aliases": list(self.model_aliases),
            "output_schema_refs": list(self.output_schema_refs),
            "max_timeout_seconds": self.max_timeout_seconds,
        }


@dataclass(frozen=True, slots=True)
class PersistedWorkflowContext:
    workflow_id: str
    workflow_ref: str
    context_ref: str
    scope: ScopeRefs
    policy_version: str
    registry_version: str
    trace_context: TraceContext

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "workflow_ref": self.workflow_ref,
            "context_ref": self.context_ref,
            "scope": self.scope.to_dict(),
            "policy_version": self.policy_version,
            "registry_version": self.registry_version,
            "trace_context": self.trace_context.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class DelegationContract:
    workflow_id: str
    delegation_id: str
    delegation_ref: str
    agent_ref: str
    task_ref: str
    context_ref: str
    model_alias: str
    output_schema: OutputSchemaContract
    scope: ScopeRefs
    policy_version: str
    registry_version: str
    trace_context: TraceContext
    timeout_seconds: int = 300
    allowed_context_refs: tuple[str, ...] = ()

    def to_model_request(self) -> "ModelRequest":
        return ModelRequest(
            workflow_id=self.workflow_id,
            delegation_id=self.delegation_id,
            request_ref=f"fixture-ref:model-request:{self.workflow_id}:{self.delegation_id}",
            model_alias=self.model_alias,
            policy_version=self.policy_version,
            registry_version=self.registry_version,
            trace_context=self.trace_context.child(
                baggage_refs=(*self.trace_context.baggage_refs, self.delegation_ref, self.output_schema.schema_ref)
            ),
            budget_reservation_refs=self.scope.budget_reservation_refs,
            output_schema_refs=self.scope.output_schema_refs,
            output_schema=self.output_schema,
            context_ref=self.context_ref,
            task_ref=self.task_ref,
            allowed_context_refs=self.allowed_context_refs,
            timeout_seconds=self.timeout_seconds,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "delegation_id": self.delegation_id,
            "delegation_ref": self.delegation_ref,
            "agent_ref": self.agent_ref,
            "task_ref": self.task_ref,
            "context_ref": self.context_ref,
            "model_alias": self.model_alias,
            "output_schema_ref": self.output_schema.schema_ref,
            "scope": self.scope.to_dict(),
            "policy_version": self.policy_version,
            "registry_version": self.registry_version,
            "trace_context": self.trace_context.to_dict(),
            "timeout_seconds": self.timeout_seconds,
            "allowed_context_refs": list(self.allowed_context_refs),
        }


@dataclass(frozen=True, slots=True)
class ModelRequest:
    workflow_id: str
    delegation_id: str
    request_ref: str
    model_alias: str
    policy_version: str
    registry_version: str
    trace_context: TraceContext
    budget_reservation_refs: tuple[str, ...]
    output_schema_refs: tuple[str, ...]
    output_schema: OutputSchemaContract
    context_ref: str
    task_ref: str
    allowed_context_refs: tuple[str, ...] = ()
    timeout_seconds: int = 300
    fixture_mode: bool = True
    production_enabled: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "delegation_id": self.delegation_id,
            "request_ref": self.request_ref,
            "model_alias": self.model_alias,
            "policy_version": self.policy_version,
            "registry_version": self.registry_version,
            "trace_context": self.trace_context.to_dict(),
            "budget_reservation_refs": list(self.budget_reservation_refs),
            "output_schema_refs": list(self.output_schema_refs),
            "output_schema_ref": self.output_schema.schema_ref,
            "context_ref": self.context_ref,
            "task_ref": self.task_ref,
            "allowed_context_refs": list(self.allowed_context_refs),
            "timeout_seconds": self.timeout_seconds,
            "fixture_mode": self.fixture_mode,
            "production_enabled": self.production_enabled,
        }


@dataclass(frozen=True, slots=True)
class ModelResult:
    workflow_id: str
    delegation_id: str
    model_alias: str
    result_ref: str
    output_schema_ref: str
    structured_output: Mapping[str, object]
    idempotency_key: str
    replayed: bool
    policy_version: str
    registry_version: str
    trace_context: TraceContext

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "delegation_id": self.delegation_id,
            "model_alias": self.model_alias,
            "result_ref": self.result_ref,
            "output_schema_ref": self.output_schema_ref,
            "structured_output": dict(self.structured_output),
            "idempotency_key": self.idempotency_key,
            "replayed": self.replayed,
            "policy_version": self.policy_version,
            "registry_version": self.registry_version,
            "trace_context": self.trace_context.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class ValidationResult:
    valid: bool
    output_schema_ref: str
    evidence_ref: str
    checked_fields: tuple[str, ...] = ()
    failure_code: str | None = None
    failure_path: str | None = None
    expected_type: str | None = None
    actual_type: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "output_schema_ref": self.output_schema_ref,
            "evidence_ref": self.evidence_ref,
            "checked_fields": list(self.checked_fields),
            "failure_code": self.failure_code,
            "failure_path": self.failure_path,
            "expected_type": self.expected_type,
            "actual_type": self.actual_type,
        }


@dataclass(frozen=True, slots=True)
class SubAgentExecutionResult:
    workflow_id: str
    delegation_id: str
    delegation_ref: str
    status: str
    model_alias: str
    model_result_ref: str | None
    validation: ValidationResult
    artifact_ref: str | None
    cost_ref: str | None
    audit_ref: str
    confidence: float | None
    scope_violations: tuple[str, ...] = ()
    validated_output: Mapping[str, object] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "delegation_id": self.delegation_id,
            "delegation_ref": self.delegation_ref,
            "status": self.status,
            "model_alias": self.model_alias,
            "model_result_ref": self.model_result_ref,
            "validation": self.validation.to_dict(),
            "artifact_ref": self.artifact_ref,
            "cost_ref": self.cost_ref,
            "audit_ref": self.audit_ref,
            "confidence": self.confidence,
            "scope_violations": list(self.scope_violations),
            "validated_output": dict(self.validated_output),
        }


@dataclass(frozen=True, slots=True)
class SynthesisResult:
    workflow_id: str
    status: str
    result_ref: str
    provenance_refs: tuple[str, ...]
    confidence: float
    cost_refs: tuple[str, ...]
    artifact_refs: tuple[str, ...]
    audit_refs: tuple[str, ...]
    caveats: tuple[str, ...]
    child_result_refs: tuple[str, ...]
    blocked_reason_ref: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "status": self.status,
            "result_ref": self.result_ref,
            "provenance_refs": list(self.provenance_refs),
            "confidence": self.confidence,
            "cost_refs": list(self.cost_refs),
            "artifact_refs": list(self.artifact_refs),
            "audit_refs": list(self.audit_refs),
            "caveats": list(self.caveats),
            "child_result_refs": list(self.child_result_refs),
            "blocked_reason_ref": self.blocked_reason_ref,
        }
