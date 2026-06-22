from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from threading import RLock
from typing import Mapping, Sequence
from uuid import uuid4

from .contracts import (
    TERMINAL_WORKFLOW_STATES,
    PAUSED_WORKFLOW_STATES,
    TraceContext,
    Workflow,
    WorkflowEvent,
    WorkflowState,
    WorkflowStep,
    StepKind,
    StepState,
    utc_now,
)
from .idempotency import IdempotencyRecord, IdempotencyScope
from .leases import Lease, LeasePolicy, StepClaim


class RepositoryError(RuntimeError):
    """Raised for repository contract violations in local/fixture mode."""


class InMemoryRuntimeRepository:
    """Thread-safe fixture repository that models atomic runtime behavior without SQL."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._workflows: dict[str, Workflow] = {}
        self._steps: dict[str, WorkflowStep] = {}
        self._events: list[WorkflowEvent] = []
        self._leases_by_id: dict[str, Lease] = {}
        self._lease_ids_by_resource: dict[str, str] = {}
        self._idempotency: dict[tuple[IdempotencyScope, str], IdempotencyRecord] = {}

    def create_workflow(self, workflow: Workflow) -> Workflow:
        with self._lock:
            if workflow.workflow_id in self._workflows:
                raise RepositoryError(f"workflow already exists: {workflow.workflow_id}")
            self._workflows[workflow.workflow_id] = workflow
            self._append_event_locked(
                workflow.workflow_id,
                "workflow.created",
                workflow.trace_context,
                state=workflow.state,
                refs={"workflow_ref": workflow.workflow_ref},
                now=workflow.created_at,
            )
            return workflow

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        with self._lock:
            return self._workflows.get(workflow_id)

    def transition_workflow(
        self,
        workflow_id: str,
        target: WorkflowState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        now: datetime | None = None,
    ) -> Workflow:
        with self._lock:
            workflow = self._require_workflow_locked(workflow_id)
            transitioned = workflow.transition_to(target, now=now)
            self._workflows[workflow_id] = transitioned
            self._append_event_locked(
                workflow_id,
                f"workflow.{target.value}",
                trace_context,
                state=target,
                refs=refs,
                now=transitioned.updated_at,
            )
            return transitioned

    def append_event(self, event: WorkflowEvent) -> WorkflowEvent:
        with self._lock:
            if event.workflow_id not in self._workflows:
                raise RepositoryError(f"unknown workflow for event: {event.workflow_id}")
            self._events.append(event)
            return event

    def list_events(self, workflow_id: str) -> tuple[WorkflowEvent, ...]:
        with self._lock:
            return tuple(event for event in self._events if event.workflow_id == workflow_id)

    def add_step(self, step: WorkflowStep, *, trace_context: TraceContext) -> WorkflowStep:
        with self._lock:
            workflow = self._require_workflow_locked(step.workflow_id)
            if workflow.state in TERMINAL_WORKFLOW_STATES:
                raise RepositoryError(f"cannot add step to terminal workflow: {workflow.workflow_id}")
            if step.step_id in self._steps:
                raise RepositoryError(f"step already exists: {step.step_id}")
            self._steps[step.step_id] = step
            self._append_event_locked(
                step.workflow_id,
                "step.created",
                trace_context,
                state=workflow.state,
                step_id=step.step_id,
                refs={"input_ref": step.input_ref, "step_kind_ref": f"fixture-ref:step-kind:{step.kind.value}"},
                now=step.created_at,
            )
            return step

    def get_step(self, step_id: str) -> WorkflowStep | None:
        with self._lock:
            return self._steps.get(step_id)

    def list_steps(self, workflow_id: str) -> tuple[WorkflowStep, ...]:
        with self._lock:
            return tuple(
                sorted(
                    (step for step in self._steps.values() if step.workflow_id == workflow_id),
                    key=lambda step: (step.created_at, step.step_id),
                )
            )

    def update_step_state(
        self,
        step_id: str,
        target: StepState,
        *,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep:
        with self._lock:
            step = self._require_step_locked(step_id)
            updated = step.transition_to(target, now=now)
            self._steps[step_id] = updated
            workflow = self._require_workflow_locked(step.workflow_id)
            self._append_event_locked(
                step.workflow_id,
                f"step.{target.value}",
                trace_context,
                state=workflow.state,
                step_id=step_id,
                refs=refs,
                now=updated.updated_at,
            )
            return updated

    def complete_step(
        self,
        step_id: str,
        *,
        output_ref: str,
        trace_context: TraceContext,
        refs: Mapping[str, str] | None = None,
        lease: Lease | None = None,
        now: datetime | None = None,
    ) -> WorkflowStep:
        with self._lock:
            step = self._require_step_locked(step_id)
            completed = step.transition_to(StepState.COMPLETED, now=now).with_output(output_ref, now=now)
            self._steps[step_id] = completed
            workflow = self._require_workflow_locked(step.workflow_id)
            merged_refs = {"output_ref": output_ref}
            if refs:
                merged_refs.update(refs)
            self._append_event_locked(
                step.workflow_id,
                "step.completed",
                trace_context,
                state=workflow.state,
                step_id=step_id,
                refs=merged_refs,
                now=completed.updated_at,
            )
            return completed

    def claim_next_step(
        self,
        *,
        owner_id: str,
        lease_policy: LeasePolicy,
        workflow_id: str | None = None,
        kinds: Sequence[StepKind] | None = None,
        now: datetime | None = None,
    ) -> StepClaim | None:
        timestamp = now or utc_now()
        allowed_kinds = set(kinds) if kinds is not None else None
        with self._lock:
            self._recover_stale_leases_locked(now=timestamp)
            candidates = sorted(self._steps.values(), key=lambda step: (step.created_at, step.step_id))
            for step in candidates:
                if workflow_id is not None and step.workflow_id != workflow_id:
                    continue
                if allowed_kinds is not None and step.kind not in allowed_kinds:
                    continue
                if step.state != StepState.PENDING:
                    continue
                workflow = self._require_workflow_locked(step.workflow_id)
                if workflow.state in TERMINAL_WORKFLOW_STATES or workflow.state in PAUSED_WORKFLOW_STATES:
                    continue
                resource_id = self._step_resource_id(step.step_id)
                lease = self._acquire_lease_locked(resource_id, owner_id=owner_id, policy=lease_policy, now=timestamp)
                if lease is None:
                    continue
                claimed = step.transition_to(StepState.CLAIMED, now=timestamp).with_attempt(step.attempt + 1, now=timestamp)
                self._steps[step.step_id] = claimed
                self._append_event_locked(
                    step.workflow_id,
                    "step.claimed",
                    workflow.trace_context.child(),
                    state=workflow.state,
                    step_id=step.step_id,
                    refs={"lease_ref": f"fixture-ref:lease:{lease.lease_id}"},
                    now=timestamp,
                )
                return StepClaim(step_id=step.step_id, workflow_id=step.workflow_id, lease=lease)
            return None

    def acquire_lease(
        self,
        resource_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None:
        with self._lock:
            self._recover_stale_leases_locked(now=now)
            return self._acquire_lease_locked(resource_id, owner_id=owner_id, policy=policy, now=now)

    def heartbeat_lease(
        self,
        lease_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None:
        with self._lock:
            lease = self._leases_by_id.get(lease_id)
            if lease is None or lease.owner_id != owner_id or lease.is_expired(now):
                return None
            updated = lease.heartbeat(policy, now=now)
            self._leases_by_id[lease_id] = updated
            return updated

    def release_lease(self, lease_id: str, *, owner_id: str) -> bool:
        with self._lock:
            lease = self._leases_by_id.get(lease_id)
            if lease is None or lease.owner_id != owner_id:
                return False
            self._release_lease_locked(lease)
            return True

    def recover_stale_leases(self, *, now: datetime | None = None) -> int:
        with self._lock:
            return self._recover_stale_leases_locked(now=now)

    def reserve_idempotency(self, record: IdempotencyRecord) -> tuple[IdempotencyRecord, bool]:
        with self._lock:
            existing = self._idempotency.get(record.identity)
            if existing is not None:
                return existing, False
            self._idempotency[record.identity] = record
            return record, True

    def get_idempotency(self, scope: IdempotencyScope, key: str) -> IdempotencyRecord | None:
        with self._lock:
            return self._idempotency.get((scope, key))

    def complete_idempotency(
        self,
        scope: IdempotencyScope,
        key: str,
        *,
        result_ref: str,
        now: datetime | None = None,
    ) -> IdempotencyRecord:
        with self._lock:
            record = self._idempotency.get((scope, key))
            if record is None:
                raise RepositoryError(f"missing idempotency record: {scope.value}:{key}")
            completed = record.complete(result_ref, now=now)
            self._idempotency[(scope, key)] = completed
            return completed

    def list_idempotency_records(self) -> tuple[IdempotencyRecord, ...]:
        with self._lock:
            return tuple(sorted(self._idempotency.values(), key=lambda record: (record.scope.value, record.key)))

    def list_leases(self) -> tuple[Lease, ...]:
        with self._lock:
            return tuple(self._leases_by_id.values())

    def _require_workflow_locked(self, workflow_id: str) -> Workflow:
        workflow = self._workflows.get(workflow_id)
        if workflow is None:
            raise RepositoryError(f"unknown workflow: {workflow_id}")
        return workflow

    def _require_step_locked(self, step_id: str) -> WorkflowStep:
        step = self._steps.get(step_id)
        if step is None:
            raise RepositoryError(f"unknown step: {step_id}")
        return step

    def _append_event_locked(
        self,
        workflow_id: str,
        event_type: str,
        trace_context: TraceContext,
        *,
        state: WorkflowState | None = None,
        step_id: str | None = None,
        refs: Mapping[str, str] | None = None,
        now: datetime | None = None,
    ) -> WorkflowEvent:
        event = WorkflowEvent(
            event_id=f"evt_{uuid4().hex}",
            workflow_id=workflow_id,
            event_type=event_type,
            trace_context=trace_context,
            occurred_at=now or utc_now(),
            state=state,
            step_id=step_id,
            refs=dict(refs or {}),
        )
        self._events.append(event)
        return event

    def _acquire_lease_locked(
        self,
        resource_id: str,
        *,
        owner_id: str,
        policy: LeasePolicy,
        now: datetime | None = None,
    ) -> Lease | None:
        timestamp = now or utc_now()
        current_lease_id = self._lease_ids_by_resource.get(resource_id)
        if current_lease_id is not None:
            current = self._leases_by_id.get(current_lease_id)
            if current is not None and not current.is_expired(timestamp):
                return None
            if current is not None:
                self._release_lease_locked(current)
        lease = Lease(
            resource_id=resource_id,
            owner_id=owner_id,
            acquired_at=timestamp,
            heartbeat_at=timestamp,
            expires_at=policy.expires_at(timestamp),
        )
        self._leases_by_id[lease.lease_id] = lease
        self._lease_ids_by_resource[resource_id] = lease.lease_id
        return lease

    def _release_lease_locked(self, lease: Lease) -> None:
        self._leases_by_id.pop(lease.lease_id, None)
        self._lease_ids_by_resource.pop(lease.resource_id, None)

    def _recover_stale_leases_locked(self, *, now: datetime | None = None) -> int:
        timestamp = now or utc_now()
        expired = [lease for lease in self._leases_by_id.values() if lease.is_expired(timestamp)]
        for lease in expired:
            self._release_lease_locked(lease)
            if lease.resource_id.startswith("step:"):
                step_id = lease.resource_id.removeprefix("step:")
                step = self._steps.get(step_id)
                if step and step.state in {StepState.CLAIMED, StepState.RUNNING}:
                    target_state = StepState.PENDING if step.state == StepState.CLAIMED else StepState.MANUAL_REVIEW
                    recovered = replace(step, state=target_state, updated_at=timestamp)
                    self._steps[step_id] = recovered
                    workflow = self._workflows.get(step.workflow_id)
                    self._append_event_locked(
                        step.workflow_id,
                        "step.lease_stale_recovered",
                        (workflow.trace_context.child() if workflow else TraceContext.new()),
                        state=workflow.state if workflow else None,
                        step_id=step_id,
                        refs={
                            "lease_ref": f"fixture-ref:lease:{lease.lease_id}",
                            "recovery_action_ref": f"fixture-ref:lease-recovery:{target_state.value}",
                            **(
                                {"manual_review_reason_ref": "fixture-ref:failure-class:worker_crash_active_lease"}
                                if target_state == StepState.MANUAL_REVIEW
                                else {}
                            ),
                        },
                        now=timestamp,
                    )
        return len(expired)

    @staticmethod
    def _step_resource_id(step_id: str) -> str:
        return f"step:{step_id}"
