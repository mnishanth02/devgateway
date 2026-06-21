# Eval runner skeleton

Phase 0.7 adds a fixture-only eval runner in `workers\eval-runner`. It executes the existing ACL safety dataset at `evals\datasets\acl-safety.v0.1.json` against JSON fixtures in `evals\fixtures\acl-safety\` and emits a gate-shaped result.

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
