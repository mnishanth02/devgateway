from __future__ import annotations

from datetime import datetime
from typing import Mapping, Protocol, Sequence

from .contracts import TraceContext, Workflow, WorkflowEvent, WorkflowState, WorkflowStep, StepKind, StepState
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
        now: datetime | None = None,
    ) -> WorkflowStep: ...

    def complete_step(
        self,
        step_id: str,
        *,
        output_ref: str,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
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
