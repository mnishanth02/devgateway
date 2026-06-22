export const schemaCatalog = {
  version: '0.1.0',
  catalog: 'schemas/index.v0.1.json',
  external: {
    openai: 'schemas/external/openai.v0.1.schema.json',
    anthropic: 'schemas/external/anthropic.v0.1.schema.json',
    mcp: 'schemas/external/mcp.v0.1.schema.json',
  },
  shared: {
    gateResult: 'schemas/shared/gate-result.v0.1.schema.json',
    virtualKey: 'schemas/shared/virtual-key.v0.1.schema.json',
    budgetScope: 'schemas/shared/budget-scope.v0.1.schema.json',
    costEvent: 'schemas/shared/cost-event.v0.1.schema.json',
    traceContext: 'schemas/shared/trace-context.v0.1.schema.json',
    evalCase: 'schemas/eval/eval-case.v0.1.schema.json',
  },
  agent: {
    agentDefinition: 'schemas/agent/agent-definition.v0.1.schema.json',
    agentRun: 'schemas/agent/agent-run.v0.1.schema.json',
    delegation: 'schemas/agent/delegation.v0.1.schema.json',
    subAgentResult: 'schemas/agent/sub-agent-result.v0.1.schema.json',
    workflowState: 'schemas/agent/workflow-state.v0.1.schema.json',
    workflowEvent: 'schemas/agent/workflow-event.v0.1.schema.json',
    taskArtifact: 'schemas/agent/task-artifact.v0.1.schema.json',
    toolCall: 'schemas/agent/tool-call.v0.1.schema.json',
    skillDefinition: 'schemas/agent/skill-definition.v0.1.schema.json',
    approvalRequest: 'schemas/agent/approval-request.v0.1.schema.json',
    retryPolicy: 'schemas/agent/retry-policy.v0.1.schema.json',
    cancellation: 'schemas/agent/cancellation.v0.1.schema.json',
    workflowOutbox: 'schemas/agent/workflow-outbox.v0.1.schema.json',
    workflowTemplate: 'schemas/agent/workflow-template.v0.1.schema.json',
    manualReview: 'schemas/agent/manual-review.v0.1.schema.json',
    artifactLifecycle: 'schemas/agent/artifact-lifecycle.v0.1.schema.json',
  },
} as const;

export type SchemaCatalog = typeof schemaCatalog;
