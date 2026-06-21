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
        validate_case_shape(case, index)

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
        "production_retrieval_behavior",
        "cases",
    ]:
        if field not in dataset:
            raise EvalRunnerError(f"dataset missing required field: {field}")
    if dataset["suite"] != expected_suite:
        raise EvalRunnerError(f"dataset suite {dataset['suite']!r} does not match requested suite {expected_suite!r}")
    if dataset["inert_fixture_mode"] is not True:
        raise EvalRunnerError("dataset must set inert_fixture_mode=true")
    if dataset["no_live_external_calls"] is not True:
        raise EvalRunnerError("dataset must set no_live_external_calls=true")
    if dataset["production_retrieval_behavior"] is not False:
        raise EvalRunnerError("dataset must set production_retrieval_behavior=false")
    if not isinstance(dataset["cases"], list) or not dataset["cases"]:
        raise EvalRunnerError("dataset cases must be a non-empty array")
    require_string(dataset, "fixture_root", "dataset")


def validate_case_shape(case: dict[str, Any], index: int) -> None:
    context = f"cases[{index}]"
    for field in ["severity", "fixture_refs", "expected", "safeguards", "audit_evidence"]:
        if field not in case:
            raise EvalRunnerError(f"{context} missing required field: {field}")
    if case["severity"] not in SEVERITY_ORDER or case["severity"] == "none":
        raise EvalRunnerError(f"{context} has invalid severity: {case['severity']!r}")
    if not isinstance(case["fixture_refs"], list) or not case["fixture_refs"]:
        raise EvalRunnerError(f"{context} fixture_refs must be a non-empty array")
    safeguards = case["safeguards"]
    if not isinstance(safeguards, dict):
        raise EvalRunnerError(f"{context}.safeguards must be an object")
    if safeguards.get("fixture_only") is not True or safeguards.get("no_live_external_calls") is not True:
        raise EvalRunnerError(f"{context} must require fixture-only execution with no live external calls")
    if safeguards.get("production_retrieval_behavior") is not False:
        raise EvalRunnerError(f"{context} must set production_retrieval_behavior=false")
    expected = case["expected"]
    if not isinstance(expected, dict) or expected.get("outcome") not in {"pass", "deny"}:
        raise EvalRunnerError(f"{context}.expected.outcome must be pass or deny")
    if not isinstance(case["audit_evidence"], list) or not case["audit_evidence"]:
        raise EvalRunnerError(f"{context}.audit_evidence must be a non-empty array")


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
    if fixture.get("production_retrieval_behavior") is not False:
        raise EvalRunnerError(f"fixture attempted to enable production retrieval behavior: {fixture_path_ref}")
    decision = fixture.get("expected_engine_decision")
    if not isinstance(decision, dict) or decision.get("decision") not in {"pass", "deny"}:
        raise EvalRunnerError(f"fixture missing expected_engine_decision decision: {fixture_path_ref}")


def execute_case(case: dict[str, Any], fixtures: list[dict[str, Any]]) -> dict[str, Any]:
    failures: list[str] = []
    expected = case["expected"]
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
        decision = fixture["expected_engine_decision"]
        observed = decision["decision"]
        allowed = set(decision.get("prompt_context_allowed_markers", []))
        combined_forbidden.update(decision.get("prompt_context_forbidden_markers", []))
        fixture_assertions = fixture.get("expected_assertions")
        if isinstance(fixture_assertions, list):
            combined_assertions.update(fixture_assertions)

        if observed != expected["outcome"]:
            failures.append(f"{context} produced outcome {observed!r}, expected {expected['outcome']!r}")
        if expected["outcome"] == "deny" and required_denial_reason is not None and decision.get("denial_reason") != required_denial_reason:
            failures.append(f"{context} denial reason {decision.get('denial_reason')!r} != required {required_denial_reason!r}")
        for marker in must_include:
            if marker not in allowed:
                failures.append(f"{context} did not include required prompt marker: {marker}")
        for marker in must_not_include:
            if marker in allowed:
                failures.append(f"{context} included forbidden prompt marker: {marker}")

    if expected["outcome"] == "pass" and required_denial_reason is not None:
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

    audit_fields = [
        require_string(evidence, "field", f"{case['case_id']}.audit_evidence")
        for evidence in case.get("audit_evidence", [])
        if isinstance(evidence, dict)
    ]

    return {
        "case_id": case["case_id"],
        "severity": case["severity"],
        "expected_outcome": expected["outcome"],
        "observed_outcome": expected["outcome"] if not failures else "fail",
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
