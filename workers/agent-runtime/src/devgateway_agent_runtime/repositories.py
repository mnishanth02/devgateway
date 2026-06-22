from __future__ import annotations

from datetime import datetime
from typing import Mapping, Protocol, Sequence

from .contracts import (
    ApprovalDecision,
    ApprovalRequest,
    ArtifactLifecycleEvent,
    CancellationAction,
    CancellationRecord,
    ManualReviewItem,
    RetryDecision,
    TraceContext,
    Workflow,
    WorkflowEvent,
    WorkflowOutboxEvent,
    WorkflowState,
    WorkflowStep,
    StepKind,
    StepState,
)
from .idempotency import IdempotencyRecord, IdempotencyScope
from .leases import Lease, LeasePolicy, StepClaim


class WorkflowRepository(Protocol):
    def create_workflow(self, workflow: Workflow) -> Workflow: ...

    def get_workflow(self, workflow_id: str) -> Workflow | None: ...

    def transition_workflow(
        self,
        workflow_id: str,
        target: WorkflowState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        now: datetime | None = None,
    ) -> Workflow: ...

    def append_event(self, event: WorkflowEvent) -> WorkflowEvent: ...

    def list_events(self, workflow_id: str) -> Sequence[WorkflowEvent]: ...


class StepRepository(Protocol):
    def add_step(self, step: WorkflowStep, *, trace_context: TraceContext) -> WorkflowStep: ...

    def get_step(self, step_id: str) -> WorkflowStep | None: ...

    def list_steps(self, workflow_id: str) -> Sequence[WorkflowStep]: ...

    def update_step_state(
        self,
        step_id: str,
        target: StepState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep: ...

    def complete_step(
        self,
        step_id: str,
        *,
        output_ref: str,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep: ...

    def claim_next_step(
        self,
        *,
        owner_id: str,
        lease_policy: LeasePolicy,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
        now: datetime | None = None,
    ) -> StepClaim | None: ...


class LeaseRepository(Protocol):
    def acquire_lease(
        self,
        resource_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None: ...

    def heartbeat_lease(
        self,
        lease_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None: ...

    def release_lease(self, lease_id: str, *, owner_id: str) -> bool: ...

    def recover_stale_leases(self, *, now: datetime | None = None) -> int: ...


class IdempotencyRepository(Protocol):
    def reserve_idempotency(self, record: IdempotencyRecord) -> tuple[IdempotencyRecord, bool]: ...

    def get_idempotency(self, scope: IdempotencyScope, key: str) -> IdempotencyRecord | None: ...

    def complete_idempotency(
        self,
        scope: IdempotencyScope,
        key: str,
        *,
        result_ref: str,
        now: datetime | None = None,
    ) -> IdempotencyRecord: ...


class RuntimeRepository(WorkflowRepository, StepRepository, LeaseRepository, IdempotencyRepository, Protocol):
    """Repository boundary for runtime business logic; SQL belongs only behind this protocol."""


# ---------------------------------------------------------------------------
# Track 3: segregated repository protocols
# These are intentionally separate from RuntimeRepository so the existing
# InMemoryRuntimeRepository is not required to implement them.
# ---------------------------------------------------------------------------


class ApprovalRepository(Protocol):
    """Repository for approval requests and decisions."""

    def create_approval_request(self, request: ApprovalRequest) -> ApprovalRequest: ...

    def get_approval_request(self, approval_id: str) -> ApprovalRequest | None: ...

    def record_approval_decision(self, decision: ApprovalDecision) -> ApprovalDecision: ...

    def list_pending_approvals(self, workflow_id: str) -> Sequence[ApprovalRequest]: ...

    def has_active_approval(self, workflow_id: str) -> bool:
        """Return ``True`` if the workflow has any non-terminal (pending) approval request."""
        ...


class OutboxRepository(Protocol):
    """Transactional outbox for reliable event delivery."""

    def append_outbox_event(self, event: WorkflowOutboxEvent) -> WorkflowOutboxEvent: ...

    def claim_pending_outbox_events(
        self,
        *,
        batch_size: int,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Sequence[tuple[WorkflowOutboxEvent, Lease]]: ...

    def ack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool: ...

    def nack_outbox_event(self, outbox_id: str, *, lease: Lease) -> bool: ...


class CancellationRepository(Protocol):
    """Repository for workflow/step cancellation records."""

    def create_cancellation(self, record: CancellationRecord) -> CancellationRecord: ...

    def get_cancellation(self, cancellation_id: str) -> CancellationRecord | None: ...

    def complete_cancellation(
        self,
        cancellation_id: str,
        *,
        now: datetime | None = None,
    ) -> CancellationRecord: ...

    def has_active_cancellation(self, workflow_id: str, step_id: str | None = None) -> bool:
        """Return ``True`` if the workflow has any non-terminal cancellation request."""
        ...

    def cancel_step(
        self,
        step_id: str,
        *,
        lease: Lease,
        safe_interruptible: bool = False,
        trace_context: TraceContext,
        now: datetime | None = None,
    ) -> CancellationAction:
        """Apply cancellation semantics to a step that holds ``lease``.

        - PENDING or CLAIMED → mark CANCELLED (:attr:`CancellationAction.SKIP`).
        - RUNNING + *safe_interruptible* → mark CANCELLED (:attr:`CancellationAction.CANCEL`).
        - RUNNING + not *safe_interruptible* → mark MANUAL_REVIEW
          (:attr:`CancellationAction.MANUAL_REVIEW`).
        - Already-terminal → no-op (:attr:`CancellationAction.NO_ACTION`).
        """
        ...


class RetryRepository(Protocol):
    """Repository for retry decisions associated with steps."""

    def record_retry_decision(self, decision: RetryDecision) -> RetryDecision: ...

    def get_retry_decisions(self, step_id: str) -> Sequence[RetryDecision]: ...


class ManualReviewRepository(Protocol):
    """Repository for manual review items."""

    def create_review_item(self, item: ManualReviewItem) -> ManualReviewItem: ...

    def get_review_item(self, review_id: str) -> ManualReviewItem | None: ...

    def update_review_item(self, item: ManualReviewItem) -> ManualReviewItem: ...

    def list_pending_reviews(self, workflow_id: str) -> Sequence[ManualReviewItem]: ...


class ArtifactLifecycleRepository(Protocol):
    """Repository for artifact lifecycle events."""

    def append_artifact_lifecycle_event(self, event: ArtifactLifecycleEvent) -> ArtifactLifecycleEvent: ...

    def list_artifact_lifecycle_events(self, artifact_ref: str) -> Sequence[ArtifactLifecycleEvent]: ...
