"""Pure workflow-template metadata helpers for DevGateway agent runtime.

Metadata-only, side-effect-free.  No live DB/provider imports.
Aligned with the shared Track 3 vocabulary for workflow template rollout states.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class WorkflowTemplateRolloutState(str, Enum):
    """Rollout lifecycle states for a workflow template or version.

    Aligned with the shared contract vocabulary (packages/shared-types
    ``workflowTemplateRolloutStates``).

    Progression: DRAFT → EVAL_READY → APPROVED → LIMITED_ROLLOUT →
    PRODUCTION.  DISABLED is a terminal deactivation state reachable from
    any non-production state.
    """

    DRAFT = "draft"
    EVAL_READY = "eval_ready"
    APPROVED = "approved"
    LIMITED_ROLLOUT = "limited_rollout"
    PRODUCTION = "production"
    DISABLED = "disabled"


# ---------------------------------------------------------------------------
# State classification sets
# ---------------------------------------------------------------------------

#: The single state that permits production-tier dispatch.
PRODUCTION_ROLLOUT_STATE: WorkflowTemplateRolloutState = WorkflowTemplateRolloutState.PRODUCTION

#: Terminal deactivation states; cannot be re-activated without explicit governance.
TERMINAL_ROLLOUT_STATES: frozenset[WorkflowTemplateRolloutState] = frozenset(
    {WorkflowTemplateRolloutState.DISABLED}
)

#: Pre-approval states; cannot be dispatched outside explicit eval/non-production contexts.
_PRE_APPROVAL_STATES: frozenset[WorkflowTemplateRolloutState] = frozenset(
    {WorkflowTemplateRolloutState.DRAFT}
)

#: States that allow non-production dispatch (approved governance gate passed).
_DISPATCH_ALLOWED_STATES: frozenset[WorkflowTemplateRolloutState] = frozenset(
    {
        WorkflowTemplateRolloutState.EVAL_READY,
        WorkflowTemplateRolloutState.APPROVED,
        WorkflowTemplateRolloutState.LIMITED_ROLLOUT,
        WorkflowTemplateRolloutState.PRODUCTION,
    }
)


# ---------------------------------------------------------------------------
# Metadata-only dataclasses (opaque refs, no raw values)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TemplateRef:
    """Opaque metadata reference for a workflow template.

    Carries only public identifiers and rollout state — no raw prompt
    bodies, context, tool configurations, model weights, or secret material.
    """

    template_id: str
    rollout_state: WorkflowTemplateRolloutState
    owner_project_ref: str


@dataclass(frozen=True, slots=True)
class TemplateVersionRef:
    """Opaque metadata reference for a workflow template version.

    Versions are **immutable once created**.  ``allowed_model_aliases``,
    ``allowed_tool_bundle_ids``, and ``approval_policy_refs`` are opaque
    identifiers — never raw prompt bodies, tool configurations, or model
    weights.
    """

    template_version_id: str
    template_id: str
    version: str
    rollout_state: WorkflowTemplateRolloutState
    allowed_model_aliases: tuple[str, ...]
    allowed_tool_bundle_ids: tuple[str, ...]
    approval_policy_refs: tuple[str, ...]


# ---------------------------------------------------------------------------
# Pure helper functions
# ---------------------------------------------------------------------------


def is_production_rollout_state(state: WorkflowTemplateRolloutState) -> bool:
    """Return ``True`` only for the ``production`` rollout state.

    Production dispatch is fail-closed: **only** the ``production`` rollout
    state permits production-tier execution.  All other states — including
    ``approved`` and ``limited_rollout`` — are non-production.
    """
    return state is PRODUCTION_ROLLOUT_STATE


def is_rollout_dispatch_allowed(state: WorkflowTemplateRolloutState) -> bool:
    """Return ``True`` if *state* permits template dispatch in any environment.

    ``draft`` is pre-approval and cannot be dispatched. ``disabled`` is
    terminal and cannot be dispatched. ``eval_ready`` is dispatchable for
    fixture/eval validation, while ``approved``, ``limited_rollout``, and
    ``production`` can be dispatched.
    """
    return state in _DISPATCH_ALLOWED_STATES


def is_version_immutable(version_ref: TemplateVersionRef) -> bool:
    """Return ``True`` — workflow template versions are always immutable.

    This is a contract invariant: a :class:`TemplateVersionRef` can never be
    mutated after construction (frozen dataclass).  The function exists as an
    explicit runtime assertion point for callers that need to document and
    test the immutability contract.
    """
    _ = version_ref  # consumed to satisfy linters; invariant is structural
    return True


def assert_version_immutable(version_ref: TemplateVersionRef) -> None:
    """Assert that *version_ref* satisfies the immutability contract.

    Raises :class:`RuntimeError` if the contract is somehow violated (which
    should not happen given the frozen-dataclass invariant, but serves as an
    explicit guard).
    """
    if not is_version_immutable(version_ref):
        raise RuntimeError(
            f"TemplateVersionRef {version_ref.template_version_id!r} violates "
            "the immutability contract."
        )


def rollout_state_allows_production(
    state: WorkflowTemplateRolloutState,
    *,
    production: bool,
) -> bool:
    """Return ``True`` when *state* is compatible with the execution tier.

    When ``production=True``, only the ``production`` rollout state is
    allowed (fail-closed).  When ``production=False``, ``eval_ready``,
    ``approved``, and ``limited_rollout`` are also accepted in addition to
    ``production``. ``draft`` and ``disabled`` are never allowed.
    """
    if not is_rollout_dispatch_allowed(state):
        return False
    if production:
        return is_production_rollout_state(state)
    return True
