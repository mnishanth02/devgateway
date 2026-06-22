# Eval runner skeleton

Phase 0.7 adds a fixture-only eval runner in `workers\eval-runner`. It executes registered inert datasets under `evals\datasets\` against JSON fixtures in `evals\fixtures\` and emits gate-shaped results. Track 3 adds durable workflow, approval-gate, and workflow-outbox fixture suites; they remain synthetic and never call live providers.

## Command

```powershell
pnpm eval:smoke
```

The root command runs the real runner through `scripts\eval-smoke.mjs`. The wrapper only locates Python, sets `PYTHONPATH` to the worker source tree, and invokes:

```powershell
python -m devgateway_eval_runner --provider-mode fixture
```

## Output contract

The smoke output includes the shared gate-result fields: `change_id`, `dataset_version`, `eval_suite_version`, `runner_version`, `metrics`, `thresholds`, `pass`, `blocking_severity`, placeholder reviewer/approver values, artifact refs, and an audit event id placeholder.

## Safety posture

- Fixture mode is the only supported provider mode.
- Live external/model calls are not configurable.
- Missing datasets, missing fixtures, unsafe fixture paths, malformed JSON, suite mismatches, or fixture attempts to enable live/production behavior fail closed.
- Results are smoke evidence only and do not enable production routes, providers, retrieval, prompts, tools, or skills.

## Track 3 chaos gate

```powershell
pnpm test:durable:chaos
```

This opt-in durability exit gate runs selected Postgres-backed runtime tests for process-kill/restart recovery, stuck-lease recovery, outbox crash-before-delivery recovery, and approval resume. It requires a disposable Postgres URL in `DATABASE_CHECK_URL` or `AGENT_RUNTIME_POSTGRES_TEST_URL`; when neither is set, the command fails clearly before running tests.
