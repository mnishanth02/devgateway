"""Crash-safe workflow outbox delivery worker.

The worker owns delivery orchestration only: the repository performs row claims,
lease fencing, ack/nack state transitions, and backoff/dead-letter decisions.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Mapping, Protocol

from .contracts import WorkflowOutboxEvent, utc_now
from .leases import LeasePolicy
from .outbox import (
    DEFAULT_OUTBOX_RETRY_POLICY,
    OUTBOX_DESTINATION_KINDS,
    assert_outbox_destination_kind,
    is_outbox_terminal,
)
from .repositories import OutboxRepository


OutboxConsumer = Callable[[WorkflowOutboxEvent], None]


class OutboxWorkerRepository(OutboxRepository, Protocol):
    """Outbox repository surface needed by the delivery worker."""


@dataclass(frozen=True, slots=True)
class OutboxWorkerPolicy:
    owner_id: str
    batch_size: int = 25
    lease: LeasePolicy = field(default_factory=lambda: LeasePolicy(ttl_seconds=60, heartbeat_seconds=15))


@dataclass(frozen=True, slots=True)
class OutboxDeliveryStats:
    claimed: int = 0
    delivered: int = 0
    retried: int = 0
    dead_lettered: int = 0
    failed_fenced: int = 0


class OutboxDeliveryError(RuntimeError):
    """Raised when an outbox destination cannot be delivered."""


def create_noop_outbox_consumers() -> dict[str, OutboxConsumer]:
    """Return idempotency-safe placeholder consumers for metadata-only testing.

    Production bootstrap should inject real trace/audit/portal/eval consumers.
    """

    def consume(_event: WorkflowOutboxEvent) -> None:
        return None

    return {destination: consume for destination in OUTBOX_DESTINATION_KINDS}


class OutboxWorker:
    def __init__(
        self,
        repository: OutboxWorkerRepository,
        *,
        consumers: Mapping[str, OutboxConsumer] | None = None,
        policy: OutboxWorkerPolicy,
    ) -> None:
        self._repository = repository
        self._policy = policy
        configured = dict(create_noop_outbox_consumers())
        if consumers:
            for destination, consumer in consumers.items():
                assert_outbox_destination_kind(destination)
                configured[destination] = consumer
        self._consumers = configured

    def run_once(self) -> OutboxDeliveryStats:
        claimed = list(
            self._repository.claim_pending_outbox_events(
                batch_size=self._policy.batch_size,
                owner_id=self._policy.owner_id,
                policy=self._policy.lease,
                now=utc_now(),
            )
        )
        delivered = retried = dead_lettered = failed_fenced = 0

        for event, lease in claimed:
            if is_outbox_terminal(event.delivery_state):
                failed_fenced += 1
                continue
            try:
                consumer = self._consumers.get(event.destination_kind)
                if consumer is None:
                    raise OutboxDeliveryError(f"no outbox consumer configured for {event.destination_kind!r}")
                consumer(event)
            except Exception:
                if self._repository.nack_outbox_event(event.outbox_id, lease=lease):
                    if event.attempt_count >= DEFAULT_OUTBOX_RETRY_POLICY.max_attempts:
                        dead_lettered += 1
                    else:
                        retried += 1
                else:
                    failed_fenced += 1
                continue

            if self._repository.ack_outbox_event(event.outbox_id, lease=lease):
                delivered += 1
            else:
                failed_fenced += 1

        return OutboxDeliveryStats(
            claimed=len(claimed),
            delivered=delivered,
            retried=retried,
            dead_lettered=dead_lettered,
            failed_fenced=failed_fenced,
        )

    def backlog_summary(self) -> Mapping[str, object]:
        return self._repository.outbox_backlog_summary(now=utc_now())
