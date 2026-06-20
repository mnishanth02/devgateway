export const gateResultContractVersion = '0.1.0' as const;

export const gateResultSchemaId =
  'https://devgateway.local/schemas/shared/gate-result.v0.1.schema.json' as const;

export const gateResultTargetKinds = [
  'model_alias',
  'fallback_route',
  'tool',
  'prompt_template',
  'retrieval_strategy',
  'skill',
  'index_version',
] as const;

export const gateResultBlockingSeverities = ['none', 'low', 'medium', 'high', 'critical'] as const;

export type GateResultTargetKind = (typeof gateResultTargetKinds)[number];
export type GateResultBlockingSeverity = (typeof gateResultBlockingSeverities)[number];

export interface GateResultArtifactRef {
  artifact_id: string;
  uri: string;
  type: string;
  sha256?: string;
  size_bytes?: number;
  sensitivity_label?: 'public' | 'internal' | 'confidential' | 'restricted';
}

export interface GateResultPrincipalReview {
  principal_id: string;
  reviewed_at: string;
}

export interface GateResultPrincipalApproval {
  principal_id: string;
  approved_at: string;
  approval_reason?: string;
}

export interface GateResultTarget {
  kind: GateResultTargetKind;
  artifact_version: string;
  model_alias?: string;
  provider?: string;
  tool_name?: string;
  prompt_template_id?: string;
  retrieval_strategy_id?: string;
  skill_id?: string;
  index_id?: string;
}

export interface GateResultRecord {
  contract_version: typeof gateResultContractVersion;
  gate_result_id: string;
  change_id: string;
  dataset_version: string;
  eval_suite_version: string;
  runner_version: string;
  target: GateResultTarget;
  metrics: Record<string, number>;
  thresholds: Record<string, number>;
  pass: boolean;
  blocking_severity: GateResultBlockingSeverity;
  owner_approval_required?: boolean;
  reviewer?: GateResultPrincipalReview;
  approver?: GateResultPrincipalApproval;
  artifact_refs: readonly GateResultArtifactRef[];
  audit_event_id: string;
  created_at: string;
}

export interface GateResultReference {
  contract_version: typeof gateResultContractVersion;
  gate_result_id: string;
  change_id: string;
  dataset_version: string;
  eval_suite_version: string;
  artifact_version: string;
  required_pass: true;
}

export interface GateResultTargetExpectation {
  kind?: GateResultTargetKind;
  modelAlias?: string;
  provider?: string;
  toolName?: string;
  promptTemplateId?: string;
  retrievalStrategyId?: string;
  skillId?: string;
  indexId?: string;
}

export type GateResultMatchIssueCode =
  | 'missing_reference'
  | 'contract_version'
  | 'required_pass'
  | 'missing_record'
  | 'version_mismatch'
  | 'target_kind'
  | 'target_identifier'
  | 'pass_required'
  | 'blocking_severity'
  | 'approver_required';

export interface GateResultMatchIssue {
  code: GateResultMatchIssueCode;
  message: string;
  field?: string;
}

export interface GateResultReferenceMatchInput {
  ref: GateResultReference | null;
  gateResults: readonly GateResultRecord[];
  target?: GateResultTargetExpectation;
}

export interface GateResultReferenceMatchResult {
  ok: boolean;
  record: GateResultRecord | null;
  issues: GateResultMatchIssue[];
}

export const gateResultPersistenceValidatorRules = [
  {
    id: 'exact-change-dataset-suite-artifact-match',
    description: 'Referenced gate result must exactly match change_id, dataset_version, eval_suite_version, and artifact_version.',
  },
  {
    id: 'passing-result-required',
    description: 'Referenced gate result must have pass=true.',
  },
  {
    id: 'no-blocking-severity',
    description: 'Referenced gate result must have blocking_severity=none.',
  },
  {
    id: 'owner-approval-required',
    description: 'When owner_approval_required=true, referenced gate result must include an approver principal.',
  },
  {
    id: 'target-identity-match',
    description: 'Referenced gate result target kind and target identifier must match the production-enabled artifact.',
  },
] as const;

export function validateGateResultReferenceMatch(
  input: GateResultReferenceMatchInput,
): GateResultReferenceMatchResult {
  const issues: GateResultMatchIssue[] = [];
  const ref = input.ref;

  if (!ref) {
    addIssue(issues, 'missing_reference', 'production enablement requires a gate-result reference');
    return { ok: false, record: null, issues };
  }

  if (ref.contract_version !== gateResultContractVersion) {
    addIssue(issues, 'contract_version', `gate-result reference must use contract ${gateResultContractVersion}`, 'contract_version');
  }
  if (ref.required_pass !== true) {
    addIssue(issues, 'required_pass', 'gate-result reference must require a passing record', 'required_pass');
  }

  const record = input.gateResults.find((candidate) => candidate.gate_result_id === ref.gate_result_id) ?? null;
  if (!record) {
    addIssue(issues, 'missing_record', `referenced gate-result record "${ref.gate_result_id}" was not provided`);
    return { ok: false, record: null, issues };
  }

  if (
    record.change_id !== ref.change_id
    || record.dataset_version !== ref.dataset_version
    || record.eval_suite_version !== ref.eval_suite_version
    || record.target.artifact_version !== ref.artifact_version
  ) {
    addIssue(
      issues,
      'version_mismatch',
      'gate-result record does not match change ID, dataset version, suite version, and artifact version',
    );
  }

  validateTargetExpectation(record, input.target, issues);

  if (record.pass !== true) {
    addIssue(issues, 'pass_required', 'gate-result record must have pass=true', 'pass');
  }
  if (record.blocking_severity !== 'none') {
    addIssue(issues, 'blocking_severity', 'gate-result record must have no blocking severity finding', 'blocking_severity');
  }
  if (record.owner_approval_required === true && !record.approver?.principal_id) {
    addIssue(
      issues,
      'approver_required',
      'gate-result record requires an approver when owner approval is required',
      'approver',
    );
  }

  return { ok: issues.length === 0, record, issues };
}

function validateTargetExpectation(
  record: GateResultRecord,
  target: GateResultTargetExpectation | undefined,
  issues: GateResultMatchIssue[],
): void {
  if (!target) {
    return;
  }

  if (target.kind && record.target.kind !== target.kind) {
    addIssue(issues, 'target_kind', `gate-result target kind must be ${target.kind}`, 'target.kind');
  }

  const identifierChecks: Array<[string | undefined, string | undefined, string]> = [
    [target.modelAlias, record.target.model_alias, 'target.model_alias'],
    [target.provider, record.target.provider, 'target.provider'],
    [target.toolName, record.target.tool_name, 'target.tool_name'],
    [target.promptTemplateId, record.target.prompt_template_id, 'target.prompt_template_id'],
    [target.retrievalStrategyId, record.target.retrieval_strategy_id, 'target.retrieval_strategy_id'],
    [target.skillId, record.target.skill_id, 'target.skill_id'],
    [target.indexId, record.target.index_id, 'target.index_id'],
  ];

  for (const [expected, actual, field] of identifierChecks) {
    if (expected && actual !== expected) {
      addIssue(issues, 'target_identifier', `gate-result ${field} must be ${expected}`, field);
    }
  }
}

function addIssue(
  issues: GateResultMatchIssue[],
  code: GateResultMatchIssueCode,
  message: string,
  field?: string,
): void {
  const issue: GateResultMatchIssue = { code, message };
  if (field) {
    issue.field = field;
  }
  issues.push(issue);
}
