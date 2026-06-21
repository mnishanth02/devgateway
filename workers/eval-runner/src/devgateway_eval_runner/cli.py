from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from . import RUNNER_VERSION

GATE_CONTRACT_VERSION = "0.1.0"
DEFAULT_DATASET = "evals/datasets/acl-safety.v0.1.json"
DEFAULT_SUITE = "acl_safety"
SEVERITY_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
EXPECTED_OUTCOMES = {"pass", "deny"}
ARTIFACT_REF_KEYS = ("expected_gate_result", "expected_trace_bundle", "expected_audit_event")


class EvalRunnerError(RuntimeError):
    """Raised when the fixture suite cannot be safely evaluated."""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="devgateway-eval-runner",
        description="Fixture-mode eval runner skeleton. It never calls live model providers.",
    )
    parser.add_argument("--repo-root", default=None, help="Repository root. Defaults to auto-detection.")
    parser.add_argument("--dataset", default=DEFAULT_DATASET, help="Dataset JSON path relative to repo root.")
    parser.add_argument("--suite", default=DEFAULT_SUITE, help="Expected eval suite id.")
    parser.add_argument("--provider-mode", default="fixture", choices=["fixture"], help="Only fixture mode is supported.")
    parser.add_argument("--change-id", default="phase-0.7-fixture-smoke", help="Change id to embed in gate result.")
    parser.add_argument("--suite-version", default="0.1.0", help="Eval suite version to embed in gate result.")
    parser.add_argument("--runner-version", default=RUNNER_VERSION, help="Runner version to embed in gate result.")
    parser.add_argument("--format", choices=["json", "pretty"], default="pretty", help="Output format.")
    parser.add_argument("--output", default=None, help="Optional output file path relative to repo root.")
    args = parser.parse_args(argv)

    try:
        repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root()
        result = run_fixture_suite(
            repo_root=repo_root,
            dataset_ref=args.dataset,
            expected_suite=args.suite,
            change_id=args.change_id,
            suite_version=args.suite_version,
            runner_version=args.runner_version,
        )
    except EvalRunnerError as error:
        print(f"eval runner failed closed: {error}", file=sys.stderr)
        return 2

    payload = json.dumps(result, indent=2 if args.format == "pretty" else None, sort_keys=args.format == "pretty")
    if args.output:
        output_path = resolve_repo_path(repo_root, args.output, must_exist=False)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if result["pass"] else 1


def find_repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in [here, *here.parents]:
        if (parent / "pnpm-workspace.yaml").exists() and (parent / "package.json").exists():
            return parent
    raise EvalRunnerError("could not auto-detect repo root")


def run_fixture_suite(
    *,
    repo_root: Path,
    dataset_ref: str,
    expected_suite: str,
    change_id: str,
    suite_version: str,
    runner_version: str,
) -> dict[str, Any]:
    dataset_path = resolve_repo_path(repo_root, dataset_ref)
    dataset = load_json(dataset_path)
    validate_dataset_header(dataset, expected_suite)

    fixture_root = resolve_repo_path(repo_root, dataset["fixture_root"])
    if not fixture_root.is_dir():
        raise EvalRunnerError(f"fixture_root does not exist or is not a directory: {dataset['fixture_root']}")

    case_results: list[dict[str, Any]] = []
    fixture_artifacts: list[dict[str, Any]] = []
    seen_cases: set[str] = set()
    fixture_paths_seen: set[Path] = set()

    for index, case in enumerate(dataset["cases"]):
        case_id = require_string(case, "case_id", f"cases[{index}]")
        if case_id in seen_cases:
            raise EvalRunnerError(f"duplicate case_id in dataset: {case_id}")
        seen_cases.add(case_id)
        validate_case_shape(case, index, dataset)

        fixtures = []
        for ref_index, fixture_ref in enumerate(case["fixture_refs"]):
            fixture_path_ref = require_string(fixture_ref, "path", f"{case_id}.fixture_refs[{ref_index}]")
            if not fixture_path_ref.startswith(dataset["fixture_root"] + "/"):
                raise EvalRunnerError(
                    f"{case_id} fixture ref must stay under dataset fixture_root: {fixture_path_ref}"
                )
            fixture_path = resolve_repo_path(repo_root, fixture_path_ref)
            fixture = load_json(fixture_path)
            validate_fixture(case, fixture, fixture_path_ref)
            fixtures.append(fixture)
            if fixture_path not in fixture_paths_seen:
                fixture_paths_seen.add(fixture_path)
                fixture_artifacts.append(
                    artifact_ref(
                        artifact_id=f"fixture:{case_id}:{fixture_path.name}",
                        uri=fixture_path_ref,
                        artifact_type="eval_fixture",
                        path=fixture_path,
                    )
                )

        case_results.append(execute_case(case, fixtures))

    metrics = build_metrics(case_results, fixture_artifacts)
    thresholds = {
        "min_pass_rate": 1.0,
        "max_failed_cases": 0,
        "max_live_provider_calls": 0,
        "required_fixture_mode": 1,
    }
    gate_pass = (
        metrics["pass_rate"] >= thresholds["min_pass_rate"]
        and metrics["failed_cases"] <= thresholds["max_failed_cases"]
        and metrics["live_provider_calls"] <= thresholds["max_live_provider_calls"]
        and metrics["fixture_mode"] == thresholds["required_fixture_mode"]
    )
    created_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    gate_result_id = stable_gate_id(change_id, dataset["dataset_version"], suite_version, runner_version, case_results)

    artifact_refs = [
        artifact_ref(
            artifact_id=f"dataset:{dataset['dataset_id']}",
            uri=dataset_ref,
            artifact_type="eval_dataset",
            path=dataset_path,
        ),
        {
            "artifact_id": f"case-results:{gate_result_id}",
            "uri": f"memory://fixture-mode/{gate_result_id}/case-results",
            "type": "eval_case_results",
            "sensitivity_label": "internal",
        },
        *fixture_artifacts,
    ]

    return {
        "contract_version": GATE_CONTRACT_VERSION,
        "gate_result_id": gate_result_id,
        "change_id": change_id,
        "dataset_version": dataset["dataset_version"],
        "eval_suite_version": suite_version,
        "runner_version": runner_version,
        "target": {
            "kind": "retrieval_strategy",
            "artifact_version": dataset["dataset_version"],
            "retrieval_strategy_id": f"fixture-mode-{dataset['suite'].replace('_', '-')}",
        },
        "metrics": metrics,
        "thresholds": thresholds,
        "pass": gate_pass,
        "blocking_severity": "none" if gate_pass else highest_failed_severity(case_results),
        "owner_approval_required": False,
        "reviewer": {"principal_id": "fixture-runner-placeholder", "reviewed_at": created_at},
        "approver": {
            "principal_id": "approver-placeholder-not-required",
            "approved_at": created_at,
            "approval_reason": "Fixture-mode smoke result only; no production enablement.",
        },
        "artifact_refs": artifact_refs,
        "audit_event_id": f"audit-placeholder:{gate_result_id}",
        "created_at": created_at,
    }


def validate_dataset_header(dataset: Any, expected_suite: str) -> None:
    if not isinstance(dataset, dict):
        raise EvalRunnerError("dataset must be a JSON object")
    for field in [
        "contract_version",
        "dataset_id",
        "dataset_version",
        "suite",
        "fixture_root",
        "inert_fixture_mode",
        "no_live_external_calls",
        "cases",
    ]:
        if field not in dataset:
            raise EvalRunnerError(f"dataset missing required field: {field}")
    for field in ["contract_version", "dataset_id", "dataset_version", "suite", "fixture_root"]:
        require_string(dataset, field, "dataset")
    if dataset["contract_version"] != GATE_CONTRACT_VERSION:
        raise EvalRunnerError(f"dataset contract_version must be {GATE_CONTRACT_VERSION}")
    if dataset["suite"] != expected_suite:
        raise EvalRunnerError(f"dataset suite {dataset['suite']!r} does not match requested suite {expected_suite!r}")
    if dataset["inert_fixture_mode"] is not True:
        raise EvalRunnerError("dataset must set inert_fixture_mode=true")
    if dataset["no_live_external_calls"] is not True:
        raise EvalRunnerError("dataset must set no_live_external_calls=true")
    validate_non_production_flags(dataset, "dataset", require_explicit=True)
    source_policy = dataset.get("source_data_policy")
    if not isinstance(source_policy, dict):
        raise EvalRunnerError("dataset source_data_policy must be an object")
    if source_policy.get("synthetic_only") is not True:
        raise EvalRunnerError("dataset source_data_policy.synthetic_only must be true")
    if not (source_policy.get("no_live_external_calls") is True or source_policy.get("no_live_github_calls") is True):
        raise EvalRunnerError("dataset source_data_policy must prohibit live external or GitHub calls")
    if not isinstance(dataset["cases"], list) or not dataset["cases"]:
        raise EvalRunnerError("dataset cases must be a non-empty array")


def validate_case_shape(case: dict[str, Any], index: int, dataset: dict[str, Any]) -> None:
    context = f"cases[{index}]"
    if not isinstance(case, dict):
        raise EvalRunnerError(f"{context} must be a JSON object")
    require_string(case, "case_id", context)
    for field in ["severity", "fixture_refs", "expected", "safeguards"]:
        if field not in case:
            raise EvalRunnerError(f"{context} missing required field: {field}")
    if case["severity"] not in SEVERITY_ORDER or case["severity"] == "none":
        raise EvalRunnerError(f"{context} has invalid severity: {case['severity']!r}")
    if not isinstance(case["fixture_refs"], list) or not case["fixture_refs"]:
        raise EvalRunnerError(f"{context} fixture_refs must be a non-empty array")
    for ref_index, fixture_ref in enumerate(case["fixture_refs"]):
        if not isinstance(fixture_ref, dict):
            raise EvalRunnerError(f"{context}.fixture_refs[{ref_index}] must be an object")
        require_string(fixture_ref, "path", f"{context}.fixture_refs[{ref_index}]")
    safeguards = case["safeguards"]
    if not isinstance(safeguards, dict):
        raise EvalRunnerError(f"{context}.safeguards must be an object")
    if safeguards.get("fixture_only") is not True or safeguards.get("no_live_external_calls") is not True:
        raise EvalRunnerError(f"{context} must require fixture-only execution with no live external calls")
    if safeguards.get("synthetic_source_data") is not True:
        raise EvalRunnerError(f"{context} must require synthetic_source_data=true")
    validate_non_production_flags(safeguards, f"{context}.safeguards", require_explicit=True)
    expected = case["expected"]
    if not isinstance(expected, dict):
        raise EvalRunnerError(f"{context}.expected must be an object")
    expected_outcome(case, context)
    if expected.get("no_production_enablement") not in {None, True}:
        raise EvalRunnerError(f"{context}.expected.no_production_enablement must be true when present")
    validate_expected_assertions(expected, context)
    validate_optional_string_list(expected, "model_prompt_must_include", context)
    validate_optional_string_list(expected, "model_prompt_must_not_include", context)
    if expected.get("required_denial_reason") is not None:
        require_string(expected, "required_denial_reason", f"{context}.expected")
    validate_audit_evidence(case, context)
    artifact_policy = dataset.get("artifact_ref_policy")
    artifacts_required = isinstance(artifact_policy, dict) and artifact_policy.get("required") is True
    validate_artifact_refs(case.get("artifact_refs"), context, artifacts_required)


def validate_fixture(case: dict[str, Any], fixture: Any, fixture_path_ref: str) -> None:
    if not isinstance(fixture, dict):
        raise EvalRunnerError(f"fixture must be a JSON object: {fixture_path_ref}")
    case_id = case["case_id"]
    if fixture.get("case_id") != case_id:
        raise EvalRunnerError(f"fixture case_id mismatch for {case_id}: {fixture_path_ref}")
    if fixture.get("synthetic") is not True:
        raise EvalRunnerError(f"fixture must be synthetic: {fixture_path_ref}")
    if fixture.get("live_external_calls") is not False:
        raise EvalRunnerError(f"fixture attempted to enable live external calls: {fixture_path_ref}")
    validate_non_production_flags(fixture, f"fixture {fixture_path_ref}", require_explicit=True)
    fixture_decision(fixture, fixture_path_ref)
    if "expected_assertions" in fixture:
        validate_string_list_value(fixture["expected_assertions"], f"fixture {fixture_path_ref}.expected_assertions")
    elif isinstance(case["expected"].get("assertions"), list):
        raise EvalRunnerError(f"fixture missing expected_assertions for asserted case: {fixture_path_ref}")
    case_artifacts = case.get("artifact_refs")
    fixture_artifacts = fixture.get("artifact_refs")
    validate_artifact_refs(fixture_artifacts, f"fixture {fixture_path_ref}", isinstance(case_artifacts, dict))
    if isinstance(case_artifacts, dict) and isinstance(fixture_artifacts, dict):
        for key in ARTIFACT_REF_KEYS:
            if fixture_artifacts.get(key) != case_artifacts.get(key):
                raise EvalRunnerError(f"fixture artifact_refs.{key} must match case artifact ref: {fixture_path_ref}")


def validate_non_production_flags(source: dict[str, Any], context: str, *, require_explicit: bool) -> None:
    has_safe_flag = False
    for field in ["production_retrieval_behavior", "production_enablement"]:
        if field not in source:
            continue
        if source[field] is not False:
            raise EvalRunnerError(f"{context} must set {field}=false when present")
        has_safe_flag = True
    if require_explicit and not has_safe_flag:
        raise EvalRunnerError(
            f"{context} must explicitly disable production retrieval behavior or production enablement"
        )


def expected_outcome(case: dict[str, Any], context: str) -> str:
    expected = case["expected"]
    outcome = expected.get("outcome")
    decision = expected.get("decision")
    if outcome is not None and outcome not in EXPECTED_OUTCOMES:
        raise EvalRunnerError(f"{context}.expected.outcome must be pass or deny")
    if decision is not None and decision not in EXPECTED_OUTCOMES:
        raise EvalRunnerError(f"{context}.expected.decision must be pass or deny")
    if outcome is not None and decision is not None and outcome != decision:
        raise EvalRunnerError(f"{context}.expected outcome and decision must match")
    result = outcome if outcome is not None else decision
    if result is None:
        raise EvalRunnerError(f"{context}.expected must include outcome or decision")
    return result


def fixture_decision(fixture: dict[str, Any], context: str) -> dict[str, Any]:
    engine_decision = fixture.get("expected_engine_decision")
    if engine_decision is not None:
        if not isinstance(engine_decision, dict):
            raise EvalRunnerError(f"fixture expected_engine_decision must be an object: {context}")
        decision = engine_decision.get("decision")
        if decision not in EXPECTED_OUTCOMES:
            raise EvalRunnerError(f"fixture expected_engine_decision.decision must be pass or deny: {context}")
        validate_optional_string_list(engine_decision, "prompt_context_allowed_markers", f"fixture {context}")
        validate_optional_string_list(engine_decision, "prompt_context_forbidden_markers", f"fixture {context}")
        if engine_decision.get("denial_reason") is not None:
            require_string(engine_decision, "denial_reason", f"fixture {context}.expected_engine_decision")
        return engine_decision

    decision = fixture.get("expected_decision")
    if decision not in EXPECTED_OUTCOMES:
        raise EvalRunnerError(f"fixture must declare expected_engine_decision.decision or expected_decision: {context}")
    normalized = {
        "decision": decision,
        "prompt_context_allowed_markers": [],
        "prompt_context_forbidden_markers": [],
    }
    if "expected_denial_reason" in fixture:
        normalized["denial_reason"] = require_string(fixture, "expected_denial_reason", f"fixture {context}")
    return normalized


def validate_expected_assertions(expected: dict[str, Any], context: str) -> None:
    if "assertions" in expected:
        validate_string_list_value(expected["assertions"], f"{context}.expected.assertions")
        return
    has_gate_conditions = any(
        isinstance(expected.get(field), list) and len(expected[field]) > 0
        for field in ["denial_conditions", "pass_conditions", "blocked_leak_vectors"]
    )
    if not has_gate_conditions:
        raise EvalRunnerError(f"{context}.expected must declare assertions or gate conditions")


def validate_optional_string_list(
    source: dict[str, Any],
    field: str,
    context: str,
    *,
    allow_empty: bool = True,
) -> list[str]:
    if field not in source:
        return []
    return validate_string_list_value(source[field], f"{context}.{field}", allow_empty=allow_empty)


def validate_string_list_value(value: Any, context: str, *, allow_empty: bool = False) -> list[str]:
    if not isinstance(value, list) or (not allow_empty and not value):
        raise EvalRunnerError(f"{context} must be a non-empty string array")
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item:
            raise EvalRunnerError(f"{context}[{index}] must be a non-empty string")
    return value


def validate_audit_evidence(case: dict[str, Any], context: str) -> None:
    has_audit_evidence = False
    if "audit_evidence" in case:
        evidence = case["audit_evidence"]
        if not isinstance(evidence, list) or not evidence:
            raise EvalRunnerError(f"{context}.audit_evidence must be a non-empty array")
        for index, item in enumerate(evidence):
            if not isinstance(item, dict):
                raise EvalRunnerError(f"{context}.audit_evidence[{index}] must be an object")
            require_string(item, "field", f"{context}.audit_evidence[{index}]")
            if "presence" in item:
                require_string(item, "presence", f"{context}.audit_evidence[{index}]")
        has_audit_evidence = True
    if "audit_evidence_required" in case:
        validate_string_list_value(case["audit_evidence_required"], f"{context}.audit_evidence_required")
        has_audit_evidence = True
    if not has_audit_evidence:
        raise EvalRunnerError(f"{context} must declare audit evidence requirements")


def audit_field_names(case: dict[str, Any], context: str) -> list[str]:
    fields: list[str] = []
    for evidence in case.get("audit_evidence", []):
        if isinstance(evidence, dict):
            field = require_string(evidence, "field", f"{context}.audit_evidence")
            if field not in fields:
                fields.append(field)
    for field in case.get("audit_evidence_required", []):
        if not isinstance(field, str) or not field:
            raise EvalRunnerError(f"{context}.audit_evidence_required contains an invalid field")
        if field not in fields:
            fields.append(field)
    return fields


def validate_artifact_refs(artifact_refs: Any, context: str, required: bool) -> None:
    if artifact_refs is None:
        if required:
            raise EvalRunnerError(f"{context}.artifact_refs must be present")
        return
    if not isinstance(artifact_refs, dict):
        raise EvalRunnerError(f"{context}.artifact_refs must be an object")
    for key in ARTIFACT_REF_KEYS:
        require_string(artifact_refs, key, f"{context}.artifact_refs")


def execute_case(case: dict[str, Any], fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    failures: list[str] = []
    expected = case["expected"]
    expected_decision = expected_outcome(case, case["case_id"])
    required_denial_reason = expected.get("required_denial_reason")
    must_include = expected.get("model_prompt_must_include", [])
    must_not_include = expected.get("model_prompt_must_not_include", [])

    combined_forbidden: set[str] = set()
    combined_assertions: set[str] = set()

    # Evaluate every fixture individually ("all"/intersection semantics): a
    # multi-fixture case passes only when every fixture independently satisfies
    # the case expectation. Pooling fixtures into a union would let one matching
    # fixture mask others that bypass the gate.
    for index, fixture in enumerate(fixtures):
        context = f"{case['case_id']}.fixture[{index}]"
        decision = fixture_decision(fixture, context)
        observed = decision["decision"]
        allowed = set(decision.get("prompt_context_allowed_markers", []))
        combined_forbidden.update(decision.get("prompt_context_forbidden_markers", []))
        fixture_assertions = fixture.get("expected_assertions")
        if isinstance(fixture_assertions, list):
            combined_assertions.update(fixture_assertions)

        if observed != expected_decision:
            failures.append(f"{context} produced outcome {observed!r}, expected {expected_decision!r}")
        if expected_decision == "deny" and required_denial_reason is not None and decision.get("denial_reason") != required_denial_reason:
            failures.append(f"{context} denial reason {decision.get('denial_reason')!r} != required {required_denial_reason!r}")
        for marker in must_include:
            if marker not in allowed:
                failures.append(f"{context} did not include required prompt marker: {marker}")
        for marker in must_not_include:
            if marker in allowed:
                failures.append(f"{context} included forbidden prompt marker: {marker}")

    if expected_decision == "pass" and required_denial_reason is not None:
        failures.append("pass case must not require a denial reason")

    # Forbidden-marker coverage: the fixtures must explicitly carry every
    # must-not-include marker so the leak assertion is actually exercised rather
    # than silently absent.
    for marker in must_not_include:
        if marker not in combined_forbidden:
            failures.append(f"must_not_include marker not covered by fixture forbidden markers: {marker}")

    # Assertion coverage: every documented dataset assertion must be reflected in
    # the fixture expected_assertions so fixture/intent drift fails closed.
    case_assertions = expected.get("assertions")
    if isinstance(case_assertions, list):
        for assertion in case_assertions:
            if assertion not in combined_assertions:
                failures.append(f"dataset assertion not covered by fixture expected_assertions: {assertion}")

    audit_fields = audit_field_names(case, case["case_id"])

    return {
        "case_id": case["case_id"],
        "severity": case["severity"],
        "expected_outcome": expected_decision,
        "observed_outcome": expected_decision if not failures else "fail",
        "pass": not failures,
        "fixture_count": len(fixtures),
        "audit_event_id": f"audit-placeholder:{case['case_id']}",
        "audit_fields": audit_fields,
        "failures": failures,
    }


def build_metrics(case_results: list[dict[str, Any]], fixture_artifacts: list[dict[str, Any]]) -> dict[str, float | int]:
    total = len(case_results)
    passed = sum(1 for result in case_results if result["pass"])
    failed = total - passed
    return {
        "total_cases": total,
        "passed_cases": passed,
        "failed_cases": failed,
        "pass_rate": passed / total if total else 0.0,
        "fixture_files": len(fixture_artifacts),
        "live_provider_calls": 0,
        "fixture_mode": 1,
    }


def highest_failed_severity(case_results: list[dict[str, Any]]) -> str:
    failed = [result["severity"] for result in case_results if not result["pass"]]
    return max(failed, key=lambda severity: SEVERITY_ORDER[severity], default="critical")


def stable_gate_id(
    change_id: str,
    dataset_version: str,
    suite_version: str,
    runner_version: str,
    case_results: list[dict[str, Any]],
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "change_id": change_id,
                "dataset_version": dataset_version,
                "suite_version": suite_version,
                "runner_version": runner_version,
                "cases": [
                    {
                        "case_id": result["case_id"],
                        "pass": result["pass"],
                        "failures": result["failures"],
                    }
                    for result in case_results
                ],
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"gate-fixture-{digest}"


def artifact_ref(*, artifact_id: str, uri: str, artifact_type: str, path: Path) -> dict[str, Any]:
    return {
        "artifact_id": artifact_id,
        "uri": uri,
        "type": artifact_type,
        "sha256": sha256_file(path),
        "size_bytes": path.stat().st_size,
        "sensitivity_label": "internal",
    }


def load_json(path: Path) -> Any:
    if not path.exists():
        raise EvalRunnerError(f"required file is missing: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise EvalRunnerError(f"malformed JSON in {path}: {error}") from error


def resolve_repo_path(repo_root: Path, ref: str, *, must_exist: bool = True) -> Path:
    require_safe_repo_ref(ref)
    path = (repo_root / Path(*PurePosixPath(ref).parts)).resolve()
    try:
        path.relative_to(repo_root)
    except ValueError as error:
        raise EvalRunnerError(f"path escapes repository root: {ref}") from error
    if must_exist and not path.exists():
        raise EvalRunnerError(f"required file is missing: {ref}")
    return path


def require_safe_repo_ref(ref: str) -> None:
    if not isinstance(ref, str) or not ref:
        raise EvalRunnerError("path reference must be a non-empty string")
    path = PurePosixPath(ref)
    if path.is_absolute() or any(part in {"..", ""} for part in path.parts):
        raise EvalRunnerError(f"path reference must be repository-relative and safe: {ref}")


def require_string(source: dict[str, Any], field: str, context: str) -> str:
    value = source.get(field)
    if not isinstance(value, str) or not value:
        raise EvalRunnerError(f"{context} missing non-empty string field: {field}")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
