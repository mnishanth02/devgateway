"""Fixture-safe workflow runtime skeleton for DevGateway agent workers."""

from .contracts import (
    DelegationContract,
    ModelRequest,
    ModelResult,
    OutputSchemaContract,
    PersistedWorkflowContext,
    PrimitiveSchemaType,
    ScopeRefs,
    SubAgentExecutionResult,
    SynthesisResult,
    TERMINAL_WORKFLOW_STATES,
    TraceContext,
    ValidationResult,
    Workflow,
    WorkflowEvent,
    WorkflowState,
    WorkflowStep,
    WorkflowTransitionError,
    StepKind,
    StepState,
)
from .dispatcher import BoundedDispatcher, DispatcherPolicy, PollingBackoffPolicy, StepExecutionResult
from .executor import FixtureSubAgentExecutor
from .fixtures import FixtureWorkflowRunner, run_fixture_workflow_smoke
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus
from .leases import Lease, LeasePolicy
from .memory import InMemoryRuntimeRepository
from .model_adapter import (
    FIXTURE_MODEL_ALIASES,
    FIXTURE_POLICY_VERSION,
    FIXTURE_REGISTRY_VERSION,
    FixtureModelGovernance,
    GovernedFixtureModelAdapter,
    ModelPolicyError,
)
from .supervisor import FixtureExecutionPlan, FixtureSupervisor, run_supervisor_execution_fixture
from .validation import validate_structured_output

RUNTIME_VERSION = "0.1.0"

__all__ = [
    "BoundedDispatcher",
    "DelegationContract",
    "DispatcherPolicy",
    "FIXTURE_MODEL_ALIASES",
    "FIXTURE_POLICY_VERSION",
    "FIXTURE_REGISTRY_VERSION",
    "FixtureExecutionPlan",
    "FixtureModelGovernance",
    "FixtureSubAgentExecutor",
    "FixtureSupervisor",
    "FixtureWorkflowRunner",
    "GovernedFixtureModelAdapter",
    "IdempotencyRecord",
    "IdempotencyScope",
    "IdempotencyStatus",
    "InMemoryRuntimeRepository",
    "Lease",
    "LeasePolicy",
    "ModelPolicyError",
    "ModelRequest",
    "ModelResult",
    "OutputSchemaContract",
    "PersistedWorkflowContext",
    "PollingBackoffPolicy",
    "PrimitiveSchemaType",
    "RUNTIME_VERSION",
    "ScopeRefs",
    "StepExecutionResult",
    "StepKind",
    "StepState",
    "SubAgentExecutionResult",
    "SynthesisResult",
    "TERMINAL_WORKFLOW_STATES",
    "TraceContext",
    "ValidationResult",
    "Workflow",
    "WorkflowEvent",
    "WorkflowState",
    "WorkflowStep",
    "WorkflowTransitionError",
    "run_fixture_workflow_smoke",
    "run_supervisor_execution_fixture",
    "validate_structured_output",
]
