# Gate Result Persistence Contract

Status: Track 0.7 governance artifact  
Scope: eval gate-result persistence shape, validator matching rules, append-only/audit expectations, retention, and artifact references  
Production capability: this document and `packages\db\src\eval-gate-persistence.ts` define metadata only. They do not create a live DB connection, migration, table, seed, runner change, or production enablement.

## Purpose

Production enablement for a model alias, fallback route, tool, prompt template, retrieval strategy, skill, or index version must be backed by immutable gate evidence. The persisted record is the audit anchor used by registry and policy validators to fail closed before any production route can be enabled.

## Required persisted fields

| Field | Requirement |
|---|---|
| `gate_result_id` | Stable opaque ID referenced by registry/policy gate refs. |
| `change_id` | Exact change being evaluated. |
| `dataset_version` | Exact eval dataset version. |
| `eval_suite_version` | Exact suite definition version. |
| `runner_version` | Eval runner version that produced the result. |
| Target fields | `target_kind`, `artifact_version`, and the relevant `model_alias`, `provider`, `retrieval_strategy_id`, `prompt_template_id`, `tool_name`, `skill_id`, or `index_id`. |
| `metrics` / `thresholds` | Numeric evidence used to reconstruct the pass/fail decision. |
| `pass` | Boolean gate decision. |
| `blocking_severity` | `none`, `low`, `medium`, `high`, or `critical`. |
| Reviewer/approver | Reviewer metadata when reviewed; approver is required when owner approval is required. |
| `artifact_refs` | Immutable artifact IDs/URIs plus hash, size, type, and sensitivity where available. |
| `audit_event_id` | Link to the append-only audit event for the gate result. |

## Validator matching rules

Registry and policy validators must reject production enablement unless the referenced gate result:

1. exactly matches `change_id`, `dataset_version`, `eval_suite_version`, and `artifact_version`;
2. has `pass=true`;
3. has `blocking_severity=none`;
4. has an approver principal when owner approval is required;
5. matches the enabled target kind and target identifier.

Disabled, experimental, and draft entries may exist without passing gates, but production keys must not be able to route to them.

## DB table convention metadata

The Phase 0.7 table convention is `eval_gate_result` in Operational Postgres, owned by `packages\db`. Metadata is defined in `packages\db\src\eval-gate-persistence.ts` and includes columns, indexes, constraints, append-only controls, and retention/artifact policy refs only. A future migration must still be reviewed and generated separately.

## Append-only and audit requirements

Gate results are immutable evidence. Runtime roles may insert records only; `UPDATE` and `DELETE` must be blocked by DB grants and/or triggers before production. Each row must reference an append-only `audit_event_id` so reviewers can reconstruct who/what produced, reviewed, approved, and retained the evidence.

## Retention and artifact storage

Every row must carry `artifact_refs`, `artifact_storage_policy_ref`, and `retention_policy_ref`. Before production, owners must approve retention period, archive/export behavior, partitioning decision, artifact storage class, and access controls for sensitive artifacts.
