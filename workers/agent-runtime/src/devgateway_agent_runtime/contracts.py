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
    WAITING_ON_CHILD = "waiting_on_child"
    SYNTHESIZING = "synthesizing"
    SUCCEEDED = "succeeded"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"
    DENIED = "denied"
    # Track 3: durable workflow / approval / review states
    PENDING_APPROVAL = "pending_approval"
    CANCEL_REQUESTED = "cancel_requested"
    MANUAL_REVIEW = "manual_review"


TERMINAL_WORKFLOW_STATES = frozenset(
    {
        WorkflowState.SUCCEEDED,
        WorkflowState.COMPLETED,
        WorkflowState.FAILED,
        WorkflowState.CANCELLED,
        WorkflowState.TIMED_OUT,
        WorkflowState.DENIED,
    }
)

# Paused/waiting states are non-terminal but not actively progressing.
PAUSED_WORKFLOW_STATES = frozenset(
    {WorkflowState.PENDING_APPROVAL, WorkflowState.MANUAL_REVIEW}
)

WORKFLOW_TRANSITIONS: Mapping[WorkflowState, frozenset[WorkflowState]] = {
    WorkflowState.CREATED: frozenset(
        {WorkflowState.QUEUED, WorkflowState.CANCELLED, WorkflowState.FAILED, WorkflowState.CANCEL_REQUESTED}
    ),
    WorkflowState.QUEUED: frozenset(
        {WorkflowState.PLANNING, WorkflowState.CANCELLED, WorkflowState.FAILED,
         WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED}
    ),
    WorkflowState.PLANNING: frozenset(
        {WorkflowState.DELEGATING, WorkflowState.CANCELLED, WorkflowState.FAILED,
         WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED, WorkflowState.MANUAL_REVIEW}
    ),
    WorkflowState.DELEGATING: frozenset(
        {WorkflowState.RUNNING, WorkflowState.CANCELLED, WorkflowState.FAILED,
         WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED, WorkflowState.MANUAL_REVIEW}
    ),
    WorkflowState.RUNNING: frozenset(
        {WorkflowState.WAITING_ON_CHILD, WorkflowState.SYNTHESIZING, WorkflowState.SUCCEEDED, WorkflowState.CANCELLED, WorkflowState.FAILED,
         WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED, WorkflowState.MANUAL_REVIEW}
    ),
    WorkflowState.WAITING_ON_CHILD: frozenset(
        {WorkflowState.RUNNING, WorkflowState.SYNTHESIZING, WorkflowState.CANCELLED, WorkflowState.FAILED, WorkflowState.CANCEL_REQUESTED}
    ),
    WorkflowState.SYNTHESIZING: frozenset(
        {WorkflowState.SUCCEEDED, WorkflowState.COMPLETED, WorkflowState.CANCELLED, WorkflowState.FAILED,
         WorkflowState.PENDING_APPROVAL, WorkflowState.CANCEL_REQUESTED, WorkflowState.MANUAL_REVIEW}
    ),
    # PENDING_APPROVAL: approved → resume running; rejected/withdrawn → cancelled; expired → failed.
    WorkflowState.PENDING_APPROVAL: frozenset(
        {WorkflowState.RUNNING, WorkflowState.CANCELLED, WorkflowState.FAILED, WorkflowState.CANCEL_REQUESTED}
    ),
    # CANCEL_REQUESTED: cleanup finished → cancelled; ambiguous side effect → manual review; cleanup failed → failed.
    WorkflowState.CANCEL_REQUESTED: frozenset(
        {WorkflowState.CANCELLED, WorkflowState.MANUAL_REVIEW, WorkflowState.FAILED}
    ),
    # MANUAL_REVIEW: reviewer resumes → running; reviewer rejects → failed or cancelled.
    WorkflowState.MANUAL_REVIEW: frozenset(
        {WorkflowState.RUNNING, WorkflowState.FAILED, WorkflowState.CANCELLED, WorkflowState.CANCEL_REQUESTED}
    ),
    WorkflowState.SUCCEEDED: frozenset(),
    WorkflowState.COMPLETED: frozenset(),
    WorkflowState.FAILED: frozenset(),
    WorkflowState.CANCELLED: frozenset(),
    WorkflowState.TIMED_OUT: frozenset(),
    WorkflowState.DENIED: frozenset(),
}


class StepKind(str, Enum):
    PLANNING = "planning"
    DELEGATING = "delegating"
    RUNNING = "running"
    SYNTHESIZING = "synthesizing"
    # Track 3: approval gate and manual review steps
    APPROVAL_GATE = "approval_gate"
    APPROVAL = "approval_gate"
    REVIEW = "review"
    MANUAL_REVIEW = "review"


class StepState(str, Enum):
    PENDING = "pending"
    CLAIMED = "claimed"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    # Track 3: paused waiting for approval decision
    PENDING_APPROVAL = "pending_approval"
    AWAITING_APPROVAL = "pending_approval"
    MANUAL_REVIEW = "manual_review"
    # Track 3: explicitly cancelled (distinct from failed)
    CANCELLED = "cancelled"


STEP_TRANSITIONS: Mapping[StepState, frozenset[StepState]] = {
    StepState.PENDING: frozenset(
        {StepState.CLAIMED, StepState.RUNNING, StepState.SKIPPED, StepState.FAILED, StepState.CANCELLED}
    ),
    StepState.CLAIMED: frozenset(
        {StepState.RUNNING, StepState.PENDING, StepState.FAILED, StepState.CANCELLED}
    ),
    StepState.RUNNING: frozenset(
        {
            StepState.COMPLETED,
            StepState.PENDING,
            StepState.FAILED,
            StepState.PENDING_APPROVAL,
            StepState.MANUAL_REVIEW,
            StepState.CANCELLED,
        }
    ),
    # AWAITING_APPROVAL: approved → pending/running (resume); rejected → failed; cancelled → cancelled.
    StepState.PENDING_APPROVAL: frozenset({StepState.PENDING, StepState.RUNNING, StepState.FAILED, StepState.CANCELLED}),
    StepState.MANUAL_REVIEW: frozenset({StepState.RUNNING, StepState.FAILED, StepState.CANCELLED}),
    StepState.COMPLETED: frozenset(),
    StepState.FAILED: frozenset({StepState.PENDING}),
    StepState.SKIPPED: frozenset(),
    StepState.CANCELLED: frozenset(),
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


# ---------------------------------------------------------------------------
# Track 3: failure classification and retry primitives
# ---------------------------------------------------------------------------


class FailureClass(str, Enum):
    """Categorises why a step or workflow failed, driving retry/escalation policy."""

    TRANSIENT_TIMEOUT_BEFORE_ACCEPT = "transient_timeout_before_accept"
    PROVIDER_REQUEST_ID_RETURNED_COMMIT_FAILED = "provider_request_id_returned_commit_failed"
    TOOL_ADAPTER_TRANSIENT = "tool_adapter_transient"
    VALIDATION_FAILURE = "validation_failure"
    BUDGET_DENIAL = "budget_denial"
    POLICY_DENIAL = "policy_denial"
    NON_IDEMPOTENT_UNKNOWN_SIDE_EFFECT = "non_idempotent_unknown_side_effect"
    WORKER_CRASH_ACTIVE_LEASE = "worker_crash_active_lease"


class RetryBackoffType(str, Enum):
    FIXED = "fixed"
    LINEAR = "linear"
    EXPONENTIAL = "exponential"
    EXPONENTIAL_WITH_JITTER = "exponential_with_jitter"


class NonIdempotentFallbackBehavior(str, Enum):
    MANUAL_REVIEW = "manual_review"
    TERMINAL_FAILURE = "terminal_failure"
    REPLAN_WITHIN_BUDGET = "replan_within_budget"


@dataclass(frozen=True, slots=True)
class RetryBackoffPolicy:
    backoff_type: RetryBackoffType = RetryBackoffType.EXPONENTIAL
    initial_delay_seconds: float = 1.0
    max_delay_seconds: float = 60.0
    jitter_fraction: float = 0.0
    multiplier: float = 2.0

    def to_dict(self) -> dict[str, object]:
        return {
            "backoff_type": self.backoff_type.value,
            "initial_delay_seconds": self.initial_delay_seconds,
            "max_delay_seconds": self.max_delay_seconds,
            "jitter_fraction": self.jitter_fraction,
            "multiplier": self.multiplier,
        }


@dataclass(frozen=True, slots=True)
class RetryTimeoutPolicy:
    queue_seconds: float = 0.0
    execution_seconds: float = 0.0
    idle_seconds: float = 0.0
    overall_seconds: float = 0.0

    def to_dict(self) -> dict[str, object]:
        return {
            "queue_seconds": self.queue_seconds,
            "execution_seconds": self.execution_seconds,
            "idle_seconds": self.idle_seconds,
            "overall_seconds": self.overall_seconds,
        }


@dataclass(frozen=True, slots=True)
class RetryFailureClassPolicy:
    failure_class: FailureClass
    retryable: bool
    idempotency_required: bool = True
    non_idempotent_fallback: NonIdempotentFallbackBehavior = NonIdempotentFallbackBehavior.MANUAL_REVIEW

    def to_dict(self) -> dict[str, object]:
        return {
            "failure_class": self.failure_class.value,
            "retryable": self.retryable,
            "idempotency_required": self.idempotency_required,
            "non_idempotent_fallback": self.non_idempotent_fallback.value,
        }


@dataclass(frozen=True, slots=True)
class RetryPolicyRef:
    policy_version: str = "v1"
    policy_decision_ref: str = "runtime-ref:policy-decision:retry-default"
    evaluated_at: datetime = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, object]:
        return {
            "policy_version": self.policy_version,
            "policy_decision_ref": self.policy_decision_ref,
            "evaluated_at": isoformat_utc(self.evaluated_at),
        }


@dataclass(frozen=True, slots=True)
class RetryOwnerRef:
    owner_type: str = "service"
    owner_id: str = "agent-runtime"
    project_id: str | None = None
    principal_id: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "owner_type": self.owner_type,
            "owner_id": self.owner_id,
            "project_id": self.project_id,
            "principal_id": self.principal_id,
        }


@dataclass(frozen=True, slots=True, init=False)
class RetryPolicy:
    max_attempts: int
    backoff_policy: RetryBackoffPolicy
    timeout_policy: RetryTimeoutPolicy
    failure_class_policies: tuple[RetryFailureClassPolicy, ...]
    idempotency_required_for_auto_retry: bool
    non_idempotent_fallback: NonIdempotentFallbackBehavior
    policy_ref: RetryPolicyRef
    owner_ref: RetryOwnerRef
    created_at: datetime
    updated_at: datetime

    def __init__(
        self,
        max_attempts: int = 3,
        backoff_policy: RetryBackoffPolicy | Mapping[str, object] | None = None,
        timeout_policy: RetryTimeoutPolicy | Mapping[str, object] | None = None,
        failure_class_policies: tuple[RetryFailureClassPolicy, ...] | None = None,
        idempotency_required_for_auto_retry: bool = True,
        non_idempotent_fallback: NonIdempotentFallbackBehavior | str = NonIdempotentFallbackBehavior.MANUAL_REVIEW,
        policy_ref: RetryPolicyRef | Mapping[str, object] | None = None,
        owner_ref: RetryOwnerRef | Mapping[str, object] | None = None,
        created_at: datetime | None = None,
        updated_at: datetime | None = None,
        *,
        backoff_type: RetryBackoffType | None = None,
        base_delay_seconds: float | None = None,
        max_delay_seconds: float | None = None,
        jitter: bool | None = None,
        eligible_failure_classes: tuple[FailureClass, ...] | None = None,
    ) -> None:
        timestamp = created_at or utc_now()
        effective_backoff = _coerce_retry_backoff_policy(
            backoff_policy,
            backoff_type=backoff_type,
            base_delay_seconds=base_delay_seconds,
            max_delay_seconds=max_delay_seconds,
            jitter=jitter,
        )
        effective_failure_policies = failure_class_policies
        if effective_failure_policies is None:
            classes = eligible_failure_classes or (
                FailureClass.TRANSIENT_TIMEOUT_BEFORE_ACCEPT,
                FailureClass.TOOL_ADAPTER_TRANSIENT,
            )
            fallback = _coerce_non_idempotent_fallback(non_idempotent_fallback)
            effective_failure_policies = tuple(
                RetryFailureClassPolicy(
                    failure_class=failure_class,
                    retryable=True,
                    idempotency_required=idempotency_required_for_auto_retry,
                    non_idempotent_fallback=fallback,
                )
                for failure_class in classes
            )

        object.__setattr__(self, "max_attempts", max_attempts)
        object.__setattr__(self, "backoff_policy", effective_backoff)
        object.__setattr__(self, "timeout_policy", _coerce_retry_timeout_policy(timeout_policy))
        object.__setattr__(self, "failure_class_policies", tuple(effective_failure_policies))
        object.__setattr__(self, "idempotency_required_for_auto_retry", idempotency_required_for_auto_retry)
        object.__setattr__(self, "non_idempotent_fallback", _coerce_non_idempotent_fallback(non_idempotent_fallback))
        object.__setattr__(self, "policy_ref", _coerce_retry_policy_ref(policy_ref))
        object.__setattr__(self, "owner_ref", _coerce_retry_owner_ref(owner_ref))
        object.__setattr__(self, "created_at", timestamp)
        object.__setattr__(self, "updated_at", updated_at or timestamp)

    @property
    def backoff_type(self) -> RetryBackoffType:
        return self.backoff_policy.backoff_type

    @property
    def base_delay_seconds(self) -> float:
        return self.backoff_policy.initial_delay_seconds

    @property
    def max_delay_seconds(self) -> float:
        return self.backoff_policy.max_delay_seconds

    @property
    def jitter(self) -> bool:
        return self.backoff_policy.jitter_fraction > 0

    @property
    def eligible_failure_classes(self) -> tuple[FailureClass, ...]:
        return tuple(policy.failure_class for policy in self.failure_class_policies if policy.retryable)

    def to_dict(self) -> dict[str, object]:
        return {
            "contract_version": "0.1.0",
            "retry_policy_id": f"retry_policy_{self.policy_ref.policy_version}",
            "max_attempts": self.max_attempts,
            "backoff_policy": self.backoff_policy.to_dict(),
            "timeout_policy": self.timeout_policy.to_dict(),
            "failure_class_policies": [policy.to_dict() for policy in self.failure_class_policies],
            "idempotency_required_for_auto_retry": self.idempotency_required_for_auto_retry,
            "non_idempotent_fallback": self.non_idempotent_fallback.value,
            "policy_ref": self.policy_ref.to_dict(),
            "owner_ref": self.owner_ref.to_dict(),
            "created_at": isoformat_utc(self.created_at),
            "updated_at": isoformat_utc(self.updated_at),
        }


def _coerce_retry_backoff_policy(
    value: RetryBackoffPolicy | Mapping[str, object] | None,
    *,
    backoff_type: RetryBackoffType | None,
    base_delay_seconds: float | None,
    max_delay_seconds: float | None,
    jitter: bool | None,
) -> RetryBackoffPolicy:
    if isinstance(value, RetryBackoffPolicy):
        return value
    if value is not None:
        raw_type = value.get("backoff_type", RetryBackoffType.EXPONENTIAL)
        return RetryBackoffPolicy(
            backoff_type=raw_type if isinstance(raw_type, RetryBackoffType) else RetryBackoffType(str(raw_type)),
            initial_delay_seconds=float(value.get("initial_delay_seconds", 1.0)),
            max_delay_seconds=float(value.get("max_delay_seconds", 60.0)),
            jitter_fraction=float(value.get("jitter_fraction", 0.0)),
            multiplier=float(value.get("multiplier", 2.0)),
        )
    return RetryBackoffPolicy(
        backoff_type=backoff_type or RetryBackoffType.EXPONENTIAL,
        initial_delay_seconds=1.0 if base_delay_seconds is None else base_delay_seconds,
        max_delay_seconds=60.0 if max_delay_seconds is None else max_delay_seconds,
        jitter_fraction=0.2 if jitter else 0.0,
    )


def _coerce_retry_timeout_policy(value: RetryTimeoutPolicy | Mapping[str, object] | None) -> RetryTimeoutPolicy:
    if isinstance(value, RetryTimeoutPolicy):
        return value
    if value is None:
        return RetryTimeoutPolicy()
    return RetryTimeoutPolicy(
        queue_seconds=float(value.get("queue_seconds", 0.0)),
        execution_seconds=float(value.get("execution_seconds", 0.0)),
        idle_seconds=float(value.get("idle_seconds", 0.0)),
        overall_seconds=float(value.get("overall_seconds", 0.0)),
    )


def _coerce_non_idempotent_fallback(value: NonIdempotentFallbackBehavior | str) -> NonIdempotentFallbackBehavior:
    return value if isinstance(value, NonIdempotentFallbackBehavior) else NonIdempotentFallbackBehavior(value)


def _coerce_retry_policy_ref(value: RetryPolicyRef | Mapping[str, object] | None) -> RetryPolicyRef:
    if isinstance(value, RetryPolicyRef):
        return value
    if value is None:
        return RetryPolicyRef()
    evaluated_at = value.get("evaluated_at")
    return RetryPolicyRef(
        policy_version=str(value.get("policy_version", "v1")),
        policy_decision_ref=str(value.get("policy_decision_ref", "runtime-ref:policy-decision:retry-default")),
        evaluated_at=evaluated_at if isinstance(evaluated_at, datetime) else utc_now(),
    )


def _coerce_retry_owner_ref(value: RetryOwnerRef | Mapping[str, object] | None) -> RetryOwnerRef:
    if isinstance(value, RetryOwnerRef):
        return value
    if value is None:
        return RetryOwnerRef()
    project_id = value.get("project_id")
    principal_id = value.get("principal_id")
    return RetryOwnerRef(
        owner_type=str(value.get("owner_type", "service")),
        owner_id=str(value.get("owner_id", "agent-runtime")),
        project_id=str(project_id) if project_id is not None else None,
        principal_id=str(principal_id) if principal_id is not None else None,
    )


@dataclass(frozen=True, slots=True)
class RetryDecision:
    """Records whether a step should be retried after a failure."""

    workflow_id: str
    step_id: str
    attempt: int
    failure_class: FailureClass
    eligible: bool
    delay_seconds: float
    reason_ref: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "workflow_id": self.workflow_id,
            "step_id": self.step_id,
            "attempt": self.attempt,
            "failure_class": self.failure_class.value,
            "eligible": self.eligible,
            "delay_seconds": self.delay_seconds,
            "reason_ref": self.reason_ref,
        }


# ---------------------------------------------------------------------------
# Track 3: cancellation primitives
# ---------------------------------------------------------------------------


class CancellationTarget(str, Enum):
    WORKFLOW = "workflow"
    STEP = "step"


class CancellationPropagationState(str, Enum):
    """Propagation lifecycle of a cancellation request, aligned with DB CHECK constraint.

    Vocabulary matches the ``workflow_cancellation.propagation_state`` column values
    from migration 0003_track_3_durable_workflows.sql.
    """

    REQUESTED = "requested"
    PROPAGATING = "propagating"
    PENDING_MANUAL_REVIEW = "pending_manual_review"
    UNWINDING = "unwinding"
    RELEASING_RESERVATIONS = "releasing_reservations"
    COMPLETED = "completed"
    PARTIALLY_COMPLETED = "partially_completed"
    PARTIALLY_COMPLETED_MANUAL_REVIEW = "partially_completed_manual_review"


class CancellationAction(str, Enum):
    """Outcome of evaluating whether/how to cancel a single workflow step.

    Used by pure helpers in ``cancellation.py`` and returned by
    ``CancellationRepository.cancel_step`` so callers know what happened without
    inspecting raw DB state.
    """

    #: Step was PENDING or CLAIMED – safely skipped and marked CANCELLED.
    SKIP = "skip"
    #: Step was RUNNING and the caller asserted it is safely interruptible – marked CANCELLED.
    CANCEL = "cancel"
    #: Step was RUNNING but the caller could not assert safety – routed to MANUAL_REVIEW.
    MANUAL_REVIEW = "manual_review"
    #: Step was already in a terminal state; no state change was made.
    NO_ACTION = "no_action"


@dataclass(frozen=True, slots=True)
class CancellationRecord:
    cancellation_id: str
    target: CancellationTarget
    workflow_id: str
    requested_at: datetime = field(default_factory=utc_now)
    propagation_state: CancellationPropagationState = CancellationPropagationState.REQUESTED
    step_id: str | None = None
    reason_ref: str | None = None
    requested_by_ref: str | None = None
    idempotency_key: str | None = None
    completed_at: datetime | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "cancellation_id": self.cancellation_id,
            "target": self.target.value,
            "workflow_id": self.workflow_id,
            "step_id": self.step_id,
            "propagation_state": self.propagation_state.value,
            "reason_ref": self.reason_ref,
            "requested_by_ref": self.requested_by_ref,
            "idempotency_key": self.idempotency_key,
            "requested_at": isoformat_utc(self.requested_at),
            "completed_at": isoformat_utc(self.completed_at) if self.completed_at else None,
        }


# ---------------------------------------------------------------------------
# Track 3: approval primitives
# ---------------------------------------------------------------------------


class ApprovalRiskTier(str, Enum):
    """Risk classification for an approval request, aligned with DB CHECK constraint.

    Vocabulary matches the ``approval_request.risk_tier`` column values from
    migration 0003_track_3_durable_workflows.sql.
    """

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    SUPERSEDED = "superseded"


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    approval_id: str
    workflow_id: str
    approval_ref: str
    requester_ref: str
    policy_ref: str
    requested_at: datetime = field(default_factory=utc_now)
    step_id: str | None = None
    expires_at: datetime | None = None
    context_ref: str | None = None
    risk_tier: ApprovalRiskTier = ApprovalRiskTier.HIGH

    def to_dict(self) -> dict[str, object]:
        return {
            "approval_id": self.approval_id,
            "workflow_id": self.workflow_id,
            "step_id": self.step_id,
            "approval_ref": self.approval_ref,
            "requester_ref": self.requester_ref,
            "policy_ref": self.policy_ref,
            "risk_tier": self.risk_tier.value,
            "requested_at": isoformat_utc(self.requested_at),
            "expires_at": isoformat_utc(self.expires_at) if self.expires_at else None,
            "context_ref": self.context_ref,
        }


@dataclass(frozen=True, slots=True)
class ApprovalDecision:
    approval_id: str
    workflow_id: str
    decision: ApprovalStatus
    decided_by_ref: str
    decided_at: datetime = field(default_factory=utc_now)
    reason_ref: str | None = None
    evidence_refs: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "approval_id": self.approval_id,
            "workflow_id": self.workflow_id,
            "decision": self.decision.value,
            "decided_by_ref": self.decided_by_ref,
            "decided_at": isoformat_utc(self.decided_at),
            "reason_ref": self.reason_ref,
            "evidence_refs": list(self.evidence_refs),
        }


# ---------------------------------------------------------------------------
# Track 3: transactional outbox event
# ---------------------------------------------------------------------------


class OutboxEventStatus(str, Enum):
    PENDING = "pending"
    DELIVERING = "delivering"
    DELIVERED = "delivered"
    FAILED = "failed"
    DEAD_LETTERED = "dead_lettered"


@dataclass(frozen=True, slots=True)
class WorkflowOutboxEvent:
    """Transactional outbox record published atomically alongside a workflow state change.

    Field vocabulary aligns with the ``workflow_outbox`` DB table:
    - ``source_event_ref``   ↔  ``workflow_event.workflow_event_id`` (opaque text ref)
    - ``destination_kind``   ↔  ``workflow_outbox.destination_kind`` (e.g. ``"webhook_ref"``)
    - ``payload_artifact_ref`` ↔ nullable ref to the payload artifact (stored in metadata)
    - ``delivery_state``     ↔  ``delivery_state`` enum column
    - ``attempt_count``      ↔  ``attempt_count`` column
    - ``next_attempt_at``    ↔  ``next_attempt_at`` column
    - ``last_failure_ref``   ↔  opaque ref describing the last failure (never raw messages)
    - ``enqueued_at``        ↔  ``created_at`` column
    Unique constraint: destination_kind + source_workflow_event_id + idempotency_key.
    """

    outbox_id: str
    workflow_id: str
    source_event_ref: str
    destination_kind: str
    idempotency_key: str
    payload_artifact_ref: str | None = None
    delivery_state: OutboxEventStatus = OutboxEventStatus.PENDING
    attempt_count: int = 0
    next_attempt_at: datetime | None = None
    last_failure_ref: str | None = None
    enqueued_at: datetime = field(default_factory=utc_now)
    delivered_at: datetime | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "outbox_id": self.outbox_id,
            "workflow_id": self.workflow_id,
            "source_event_ref": self.source_event_ref,
            "destination_kind": self.destination_kind,
            "payload_artifact_ref": self.payload_artifact_ref,
            "idempotency_key": self.idempotency_key,
            "delivery_state": self.delivery_state.value,
            "attempt_count": self.attempt_count,
            "next_attempt_at": isoformat_utc(self.next_attempt_at) if self.next_attempt_at else None,
            "last_failure_ref": self.last_failure_ref,
            "enqueued_at": isoformat_utc(self.enqueued_at),
            "delivered_at": isoformat_utc(self.delivered_at) if self.delivered_at else None,
        }


# ---------------------------------------------------------------------------
# Track 3: manual review item
# ---------------------------------------------------------------------------


class ManualReviewStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


@dataclass(frozen=True, slots=True)
class ManualReviewItem:
    review_id: str
    workflow_id: str
    review_ref: str
    status: ManualReviewStatus = ManualReviewStatus.OPEN
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    step_id: str | None = None
    reviewer_ref: str | None = None
    reason_ref: str | None = None
    artifact_refs: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, object]:
        return {
            "review_id": self.review_id,
            "workflow_id": self.workflow_id,
            "step_id": self.step_id,
            "review_ref": self.review_ref,
            "reviewer_ref": self.reviewer_ref,
            "status": self.status.value,
            "reason_ref": self.reason_ref,
            "artifact_refs": list(self.artifact_refs),
            "created_at": isoformat_utc(self.created_at),
            "updated_at": isoformat_utc(self.updated_at),
        }


# ---------------------------------------------------------------------------
# Track 3: artifact lifecycle event
# ---------------------------------------------------------------------------


class ArtifactLifecycleStage(str, Enum):
    CREATED = "created"
    VERIFIED = "verified"
    EXPIRY_SET = "expiry_set"
    RETAINED = "retained"
    LEGAL_HOLD_APPLIED = "legal_hold_applied"
    LEGAL_HOLD_RELEASED = "legal_hold_released"
    REDACTED = "redacted"
    DELETION_SCHEDULED = "deletion_scheduled"
    DELETED = "deleted"
    SIGNED_ACCESS_GRANTED = "signed_access_granted"
    SIGNED_ACCESS_REVOKED = "signed_access_revoked"


@dataclass(frozen=True, slots=True)
class ArtifactLifecycleEvent:
    """Immutable record of a single artifact lifecycle transition.

    Vocabulary aligns with the ``artifact_lifecycle_event`` DB table and the
    shared JSON contract (``ArtifactLifecycleEventRecord``):

    * ``stage``                  ↔  DB ``action`` column (what happened)
    * ``artifact_state``         ↔  DB ``state`` column (resulting artifact state)
    * ``storage_ref``            ↔  DB ``storage_ref`` (opaque ref only; no signed URL)
    * ``checksum_sha256``        ↔  DB ``content_hash`` with ``hash_algorithm='sha256'``
    * ``retention_policy``       ↔  DB ``retention_policy_ref``
    * ``signed_access_eligibility`` ↔ DB ``signed_access_eligible``
    * ``legal_hold``             ↔  DB ``legal_hold_ref`` presence flag
    * ``redacted``               ↔  DB ``redaction_ref`` presence flag
    * ``deletion_scheduled_at``  ↔  DB ``expires_at``
    * ``audit_refs``             ↔  DB ``audit_event_id`` (as opaque ref tuple)
    * ``idempotency``            ↔  DB ``idempotency_key``

    All fields are metadata/ref-only — no raw content, no signed URLs.
    """

    lifecycle_id: str
    artifact_ref: str
    workflow_id: str
    stage: ArtifactLifecycleStage
    occurred_at: datetime = field(default_factory=utc_now)
    # Original optional fields (preserved for backward compatibility)
    policy_ref: str | None = None
    triggered_by_ref: str | None = None
    step_id: str | None = None
    # Aligned vocabulary fields (locked DB / shared-contract vocabulary)
    task_id: str | None = None
    artifact_state: str | None = None
    storage_ref: str | None = None
    checksum_sha256: str | None = None
    retention_policy: str | None = None
    signed_access_eligibility: bool = False
    legal_hold: bool = False
    redacted: bool = False
    deletion_scheduled_at: datetime | None = None
    audit_refs: tuple[str, ...] = ()
    idempotency: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "lifecycle_id": self.lifecycle_id,
            "artifact_ref": self.artifact_ref,
            "workflow_id": self.workflow_id,
            "task_id": self.task_id,
            "step_id": self.step_id,
            "stage": self.stage.value,
            "action": self.stage.value,  # aligned vocabulary alias
            "artifact_state": self.artifact_state,
            "storage_ref": self.storage_ref,
            "checksum_sha256": self.checksum_sha256,
            "retention_policy": self.retention_policy,
            "signed_access_eligibility": self.signed_access_eligibility,
            "legal_hold": self.legal_hold,
            "redacted": self.redacted,
            "deletion_scheduled_at": isoformat_utc(self.deletion_scheduled_at) if self.deletion_scheduled_at else None,
            "audit_refs": list(self.audit_refs),
            "idempotency": self.idempotency,
            "policy_ref": self.policy_ref,
            "triggered_by_ref": self.triggered_by_ref,
            "occurred_at": isoformat_utc(self.occurred_at),
        }
