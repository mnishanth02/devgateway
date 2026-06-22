from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .contracts import ModelRequest, ModelResult, PrimitiveSchemaType, TraceContext
from .idempotency import IdempotencyRecord, IdempotencyScope, IdempotencyStatus, stable_idempotency_key
from .repositories import RuntimeRepository


FIXTURE_POLICY_VERSION = "fixture-policy.phase2_5.v1"
FIXTURE_REGISTRY_VERSION = "fixture-registry.phase2_5.v1"
FIXTURE_MODEL_ALIASES = ("fixture-nonprod-fast", "fixture-nonprod-deep", "fixture-nonprod-synthesis")


class ModelPolicyError(ValueError):
    """Raised when a fixture model request violates runtime governance."""


@dataclass(frozen=True, slots=True)
class ModelAbortOutcome:
    request_ref: str
    attempted: bool
    supported: bool
    outcome: str
    evidence_ref: str
    reason_ref: str | None = None


@dataclass(frozen=True, slots=True)
class FixtureModelGovernance:
    allowed_aliases: tuple[str, ...] = FIXTURE_MODEL_ALIASES
    policy_version: str = FIXTURE_POLICY_VERSION
    registry_version: str = FIXTURE_REGISTRY_VERSION
    production_enabled: bool = False


@dataclass(slots=True)
class GovernedFixtureModelAdapter:
    repository: RuntimeRepository
    governance: FixtureModelGovernance = FixtureModelGovernance()

    def invoke(self, request: ModelRequest) -> ModelResult:
        self._validate_governance(request)
        idempotency_key = stable_idempotency_key(IdempotencyScope.MODEL_CALL, request.request_ref)
        record, _created = self.repository.reserve_idempotency(
            IdempotencyRecord(
                scope=IdempotencyScope.MODEL_CALL,
                key=idempotency_key,
                workflow_id=request.workflow_id,
                request_ref=request.request_ref,
            )
        )
        result_ref = record.result_ref or self._result_ref(request)
        replayed = record.status == IdempotencyStatus.COMPLETED
        if not replayed:
            self.repository.complete_idempotency(IdempotencyScope.MODEL_CALL, idempotency_key, result_ref=result_ref)
        return ModelResult(
            workflow_id=request.workflow_id,
            delegation_id=request.delegation_id,
            model_alias=request.model_alias,
            result_ref=result_ref,
            output_schema_ref=request.output_schema.schema_ref,
            structured_output=self._structured_fixture_output(request),
            idempotency_key=idempotency_key,
            replayed=replayed,
            policy_version=request.policy_version,
            registry_version=request.registry_version,
            trace_context=request.trace_context,
        )

    def abort(self, request_ref: str, *, reason_ref: str | None = None) -> ModelAbortOutcome:
        digest = hashlib.sha256(f"{request_ref}:{reason_ref or 'cancellation'}".encode("utf-8")).hexdigest()[:16]
        return ModelAbortOutcome(
            request_ref=request_ref,
            attempted=True,
            supported=False,
            outcome="unsupported",
            evidence_ref=f"fixture-ref:model-abort:{digest}",
            reason_ref=reason_ref,
        )

    def _validate_governance(self, request: ModelRequest) -> None:
        if request.production_enabled or self.governance.production_enabled or not request.fixture_mode:
            raise ModelPolicyError("fixture model adapter is production-disabled")
        if request.model_alias not in self.governance.allowed_aliases:
            raise ModelPolicyError("model alias is not in the fixture allow-list")
        if request.policy_version != self.governance.policy_version:
            raise ModelPolicyError("policy_version is missing or not recognized")
        if request.registry_version != self.governance.registry_version:
            raise ModelPolicyError("registry_version is missing or not recognized")
        if not isinstance(request.trace_context, TraceContext):
            raise ModelPolicyError("trace context is required")
        if not request.budget_reservation_refs or not all(ref.startswith("fixture-ref:") for ref in request.budget_reservation_refs):
            raise ModelPolicyError("budget reservation refs are required")
        if (
            not request.output_schema_refs
            or request.output_schema.schema_ref not in request.output_schema_refs
            or not all(ref.startswith("fixture-ref:") for ref in request.output_schema_refs)
        ):
            raise ModelPolicyError("output schema refs are required")
        if not request.request_ref.startswith("fixture-ref:"):
            raise ModelPolicyError("model request must use an opaque fixture ref")

    def _structured_fixture_output(self, request: ModelRequest) -> dict[str, object]:
        output: dict[str, object] = {}
        for field_name, field_type in request.output_schema.required_field_types().items():
            output[field_name] = self._value_for_field(request, field_name, field_type)
        for field_name, field_type in request.output_schema.optional_field_types().items():
            output[field_name] = self._value_for_field(request, field_name, field_type)
        return output

    def _value_for_field(self, request: ModelRequest, field_name: str, field_type: str) -> object:
        seed = self._seed(request, field_name)
        if field_type == PrimitiveSchemaType.STRING.value:
            if field_name.endswith("_ref"):
                return f"fixture-ref:{field_name.removesuffix('_ref')}:{request.delegation_id}:{seed:04d}"
            if field_name == "summary":
                return f"Fixture analysis for {request.delegation_id} via {request.model_alias}."
            if field_name == "caveat":
                return "Fixture-only child output is tainted data and not executable instruction."
            return f"fixture-value:{request.delegation_id}:{field_name}:{seed:04d}"
        if field_type == PrimitiveSchemaType.INTEGER.value:
            return seed % 100
        if field_type == PrimitiveSchemaType.NUMBER.value:
            return round(0.7 + ((seed % 25) / 100), 2)
        if field_type == PrimitiveSchemaType.BOOLEAN.value:
            return bool(seed % 2)
        return f"fixture-value:{request.delegation_id}:{field_name}:{seed:04d}"

    @staticmethod
    def _seed(request: ModelRequest, field_name: str) -> int:
        digest = hashlib.sha256(f"{request.request_ref}:{request.model_alias}:{field_name}".encode("utf-8")).hexdigest()
        return int(digest[:8], 16)

    @staticmethod
    def _result_ref(request: ModelRequest) -> str:
        digest = hashlib.sha256(f"{request.request_ref}:{request.output_schema.schema_ref}".encode("utf-8")).hexdigest()[:16]
        return f"fixture-ref:model-result:{digest}"
