import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { operationalSnapshotQueryOptions } from '../../features/operations-snapshot-query.js';
import type {
  ActionPolicy,
  AgentTreeNodeView,
  ArtifactRefView,
  AuditRefView,
  CostRefView,
  IdempotencyView,
  LeaseView,
  RefSummaryView,
  SkillTraceView,
  TaskTracePanel,
  TimelineEventView,
  ToolDecisionView,
  TraceArtifactMetadataView,
  TraceBudgetScopeView,
  TraceCostEventView,
  TraceFetchIssue,
  WorkflowTraceListItemView,
} from '../../features/operational-views.js';

export function TaskTraceView() {
  const snapshotQuery = useQuery(operationalSnapshotQueryOptions());

  if (snapshotQuery.isPending) {
    return (
      <section className="trace-view trace-view--state" aria-busy="true">
        <div className="trace-state-panel">
          <p className="eyebrow">Phase 2.9 trace lab</p>
          <h1>Spooling trace telemetry…</h1>
          <p>Loading the task, workflow, delegation, cost, artifact, tool, and skill metadata streams.</p>
        </div>
      </section>
    );
  }

  if (snapshotQuery.isError) {
    return (
      <section className="trace-view trace-view--state" role="alert">
        <div className="trace-state-panel trace-state-panel--error">
          <p className="eyebrow">Trace endpoints fail-closed</p>
          <h1>Trace snapshot failed.</h1>
          <p>
            {snapshotQuery.error instanceof Error
              ? snapshotQuery.error.message
              : 'The Control API trace snapshot could not be read.'}
          </p>
        </div>
      </section>
    );
  }

  const { generatedAt, model } = snapshotQuery.data;
  const trace = model.taskTrace;

  return (
    <section className="trace-view" aria-labelledby="trace-title">
      <header className="trace-hero">
        <div className="trace-hero__content">
          <p className="eyebrow">Phase 2.9 / task trace lab</p>
          <h1 id="trace-title">Every handoff visible. Payloads stay sealed.</h1>
          <p>
            A read-only trace bench for the safe demo task: workflow state, delegated agents, event rails, cost
            pressure, artifacts, tool decisions, and skill registry metadata—without raw prompts, bodies, or signed
            downloads.
          </p>
          <div className="trace-chip-row" aria-label="Trace snapshot metadata">
            <span className={`trace-chip trace-chip--${traceStatusTone(trace.status)}`}>status {trace.status}</span>
            <PolicyChip policy={trace.actionPolicy} />
            <span className="trace-chip">source {trace.dataSource}</span>
            <span className="trace-chip">snapshot {generatedAt}</span>
          </div>
        </div>

        <div className="trace-hero__readout" aria-label="Trace identity readout">
          <Readout label="task" value={trace.task.id} />
          <Readout label="workflow" value={trace.workflow.workflowId} />
          <Readout label="trace" value={trace.task.trace} />
          <Readout label="control" value={model.controlApiBaseUrl} />
        </div>
      </header>

      <TraceIssuesPanel issues={trace.issues} />

      <div className="trace-layout">
        <div className="trace-layout__main">
          <TaskWorkflowPanel trace={trace} />
          <DelegationTreePanel panel={trace.delegationTree} />
          <EventTimelinePanel panel={trace.eventTimeline} />
        </div>

        <aside className="trace-layout__side" aria-label="Trace metadata panels">
          <CostPanel panel={trace.cost} />
          <ArtifactsPanel panel={trace.artifacts} />
          <ToolsPanel panel={trace.tools} />
          <SkillsPanel skills={trace.skills} />
        </aside>
      </div>
    </section>
  );
}

function TaskWorkflowPanel({ trace }: { readonly trace: TaskTracePanel }) {
  const workflow = trace.workflow;

  return (
    <article className="trace-panel trace-panel--wide trace-panel--workflow" aria-labelledby="trace-workflow-title">
      <PanelHeader
        eyebrow="Task / workflow command spine"
        title={workflow.workflowId}
        titleId="trace-workflow-title"
        action={<span className={`trace-chip trace-chip--${traceStatusTone(trace.status)}`}>{workflow.status}</span>}
      />

      <div className="trace-workflow-grid">
        <section className="trace-inset" aria-label="Task summary">
          <h3>Task summary</h3>
          <MetadataList
            items={[
              ['task id', trace.task.id],
              ['task type', trace.task.taskType],
              ['priority', trace.task.priority],
              ['status', trace.task.status],
              ['principal', trace.task.principal],
              ['project', trace.task.project],
              ['data class', trace.task.dataClass],
              ['budget scope', trace.task.budgetScope],
              ['request', trace.task.request],
              ['created', trace.task.createdAt],
              ['updated', trace.task.updatedAt],
            ]}
          />
          <RefSummary label="objective" ref={trace.task.objectiveRef} />
          <div className="trace-count-row">
            <Readout label="context refs" value={trace.task.contextRefCount} />
            <Readout label="artifact refs" value={trace.task.artifactRefCount} />
            <Readout label="agent refs" value={trace.task.agentRunRefCount} />
          </div>
          <IdempotencyCard label="task idempotency" ref={trace.task.idempotency} />
        </section>

        <section className="trace-inset trace-inset--hot" aria-labelledby="trace-workflow-state-title">
          <h3 id="trace-workflow-state-title">Workflow state</h3>
          <MetadataList
            items={[
              ['workflow id', workflow.workflowId],
              ['task id', workflow.taskId],
              ['version', workflow.version],
              ['status', workflow.status],
              ['principal', workflow.principal],
              ['project', workflow.project],
              ['data class', workflow.dataClass],
              ['budget scope', workflow.budgetScope],
              ['policy version', workflow.policyVersion],
              ['registry version', workflow.registryVersion],
              ['terminal failure', workflow.terminalFailureRef],
              ['created', workflow.createdAt],
              ['updated', workflow.updatedAt],
            ]}
          />
          <TraceRefBlock trace={workflow.trace} />
          <CurrentStepBlock step={workflow.currentStep} />
          <LeaseBlock lease={workflow.lease} />
          <RefSummary label="resume" ref={workflow.resumeRef} />
        </section>
      </div>

      <section className="trace-strip" aria-label="Workflow transitions and idempotency">
        <div>
          <h3>Allowed transitions</h3>
          <ChipList emptyLabel="none advertised" values={workflow.allowedTransitions} />
        </div>
        <div>
          <h3>Workflow idempotency</h3>
          {workflow.idempotency.length === 0 ? (
            <p className="trace-empty">No workflow idempotency refs returned.</p>
          ) : (
            <div className="trace-idempotency-row">
              {workflow.idempotency.map((ref) => (
                <IdempotencyCard key={`${ref.scope}-${ref.key}`} label={ref.scope} ref={ref} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="trace-strip" aria-label="Known workflow list and reference bundles">
        <div>
          <h3>Workflow summary rail</h3>
          {trace.workflows.length === 0 ? (
            <p className="trace-empty">No workflow summaries returned.</p>
          ) : (
            <ul className="trace-workflow-list">
              {trace.workflows.map((item) => (
                <WorkflowListItem item={item} key={item.workflowId} />
              ))}
            </ul>
          )}
        </div>
        <ReferenceBundle
          artifactRefs={workflow.artifactRefs}
          auditRefs={workflow.auditRefs}
          costRefs={workflow.costRefs}
        />
      </section>
    </article>
  );
}

function DelegationTreePanel({ panel }: { readonly panel: TaskTracePanel['delegationTree'] }) {
  return (
    <article className="trace-panel trace-panel--wide" aria-labelledby="trace-delegation-title">
      <PanelHeader
        eyebrow="Delegation tree / agent runs"
        title={panel.rootAgentRunId}
        titleId="trace-delegation-title"
        action={<PolicyChip policy={panel.actionPolicy} />}
      />
      {panel.nodes.length === 0 ? (
        <p className="trace-empty">{panel.emptyState}</p>
      ) : (
        <>
          <div className="trace-tree" role="list">
            {panel.nodes.map((node, index) => (
              <AgentNodeCard index={index} key={node.agentRunId} node={node} />
            ))}
          </div>
          <section className="trace-edge-ledger" aria-label="Delegation edges">
            <h3>Edges</h3>
            {panel.edges.length === 0 ? (
              <p className="trace-empty">{panel.emptyState}</p>
            ) : (
              <ul>
                {panel.edges.map((edge) => (
                  <li key={`${edge.parentAgentRunId}-${edge.childAgentRunId}-${edge.delegationId}`}>
                    <code>{edge.parentAgentRunId}</code>
                    <span aria-hidden="true">→</span>
                    <code>{edge.childAgentRunId}</code>
                    <strong>{edge.label}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </article>
  );
}

function EventTimelinePanel({ panel }: { readonly panel: TaskTracePanel['eventTimeline'] }) {
  return (
    <article className="trace-panel trace-panel--wide" aria-labelledby="trace-timeline-title">
      <PanelHeader
        eyebrow="Event timeline rail"
        title={`${panel.events.length} events`}
        titleId="trace-timeline-title"
        action={<PolicyChip policy={panel.actionPolicy} />}
      />
      <div className="trace-panel__subhead">
        <span>next cursor {panel.nextCursor}</span>
        <span>{panel.emptyState}</span>
      </div>
      {panel.events.length === 0 ? (
        <p className="trace-empty">{panel.emptyState}</p>
      ) : (
        <ol className="trace-timeline">
          {panel.events.map((event) => (
            <TimelineEventCard event={event} key={event.id} />
          ))}
        </ol>
      )}
    </article>
  );
}

function CostPanel({ panel }: { readonly panel: TaskTracePanel['cost'] }) {
  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="trace-cost-title">
      <PanelHeader
        eyebrow="Cost pressure"
        title={panel.totals.actualAmount}
        titleId="trace-cost-title"
        action={<PolicyChip policy={panel.actionPolicy} />}
      />
      <div className="trace-total-stack" aria-label="Trace cost totals">
        <Readout label="estimated" value={panel.totals.estimatedAmount} />
        <Readout label="currency" value={panel.totals.currency} />
        <Readout label="requests" value={panel.totals.requestCount} />
      </div>

      <section className="trace-inset">
        <h3>Visibility scopes</h3>
        <VisibilityGroup label="workflow" values={panel.visibility.workflowIds} />
        <VisibilityGroup label="delegation" values={panel.visibility.delegationIds} />
        <VisibilityGroup label="tool class" values={panel.visibility.toolClasses} />
        <VisibilityGroup label="budget" values={panel.visibility.budgetScopeIds} />
        <VisibilityGroup label="model" values={panel.visibility.modelAliases} />
      </section>

      <section className="trace-inset">
        <h3>Budget scopes</h3>
        {panel.budgetScopes.length === 0 ? (
          <p className="trace-empty">{panel.emptyState}</p>
        ) : (
          <ul className="trace-ledger">
            {panel.budgetScopes.map((scope) => (
              <BudgetScopeItem key={scope.id} scope={scope} />
            ))}
          </ul>
        )}
      </section>

      <section className="trace-inset">
        <h3>Cost events</h3>
        {panel.events.length === 0 ? (
          <p className="trace-empty">{panel.emptyState}</p>
        ) : (
          <ul className="trace-cost-events">
            {panel.events.map((event) => (
              <CostEventItem event={event} key={event.id} />
            ))}
          </ul>
        )}
      </section>

      <ReferenceBundle artifactRefs={[]} auditRefs={[]} costRefs={panel.referencedCostEvents} />
    </article>
  );
}

function ArtifactsPanel({ panel }: { readonly panel: TaskTracePanel['artifacts'] }) {
  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="trace-artifacts-title">
      <PanelHeader
        eyebrow="Artifact metadata only"
        title={`${panel.count} records`}
        titleId="trace-artifacts-title"
        action={<PolicyChip policy={panel.actionPolicy} />}
      />
      {panel.metadata.length === 0 ? (
        <p className="trace-empty">{panel.emptyState}</p>
      ) : (
        <ul className="trace-artifact-list">
          {panel.metadata.map((artifact) => (
            <ArtifactMetadataCard artifact={artifact} key={artifact.id} />
          ))}
        </ul>
      )}
    </article>
  );
}

function ToolsPanel({ panel }: { readonly panel: TaskTracePanel['tools'] }) {
  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="trace-tools-title">
      <PanelHeader
        eyebrow="Tool decision lattice"
        title={`${panel.decisions.length} decisions`}
        titleId="trace-tools-title"
        action={<PolicyChip policy={panel.actionPolicy} />}
      />
      {panel.openApiRoutes.length > 0 ? (
        <section className="trace-inset">
          <h3>Tool routes</h3>
          <ChipList emptyLabel="none" values={panel.openApiRoutes} />
        </section>
      ) : null}
      {panel.decisions.length === 0 ? (
        <p className="trace-empty">{panel.emptyState}</p>
      ) : (
        <ul className="trace-tool-list">
          {panel.decisions.map((decision) => (
            <ToolDecisionCard decision={decision} key={decision.id} />
          ))}
        </ul>
      )}
    </article>
  );
}

function SkillsPanel({ skills }: { readonly skills: readonly SkillTraceView[] }) {
  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="trace-skills-title">
      <PanelHeader eyebrow="Skill registry" title={`${skills.length} skills`} titleId="trace-skills-title" />
      {skills.length === 0 ? (
        <p className="trace-empty">No skill registry metadata returned by the Control API.</p>
      ) : (
        <ul className="trace-skill-list">
          {skills.map((skill) => (
            <SkillCard skill={skill} key={`${skill.id}-${skill.version}`} />
          ))}
        </ul>
      )}
    </article>
  );
}

function TraceIssuesPanel({ issues }: { readonly issues: readonly TraceFetchIssue[] }) {
  const failing = issues.filter((issue) => issue.state === 'error').length;

  return (
    <article className="trace-issues" aria-labelledby="trace-issues-title">
      <div>
        <p className="eyebrow">Fail-closed endpoint ledger</p>
        <h2 id="trace-issues-title">{failing === 0 ? 'All trace endpoints accounted for.' : `${failing} trace endpoints failed closed.`}</h2>
      </div>
      <ul>
        {issues.map((issue) => (
          <li className={`trace-issue trace-issue--${issueTone(issue.state)}`} key={issue.key}>
            <span>{issue.key}</span>
            <code>{issue.path}</code>
            <strong>{issue.status === 0 ? 'offline' : issue.status}</strong>
            <small>{issue.message}</small>
          </li>
        ))}
      </ul>
    </article>
  );
}

function AgentNodeCard({ index, node }: { readonly index: number; readonly node: AgentTreeNodeView }) {
  return (
    <article className={`trace-node trace-node--${node.nodeState}`} role="listitem">
      <div className="trace-node__stem" aria-hidden="true">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="trace-node__body">
        <header>
          <span className="trace-node__role">{node.role}</span>
          <span className={`trace-chip trace-chip--${node.nodeState === 'loaded' ? 'ok' : 'muted'}`}>{node.status}</span>
        </header>
        <h3>{node.agentRunId}</h3>
        <MetadataList
          items={[
            ['parent', node.parentAgentRunId],
            ['delegation', node.delegationId],
            ['model', node.modelAlias],
            ['definition', node.agentDefinition],
            ['trace', node.trace],
            ['request', node.request],
            ['started', node.startedAt],
            ['completed', node.completedAt],
            ['context refs', node.contextRefCount],
          ]}
        />
        <LeaseBlock lease={node.lease} />
        <ReferenceBundle artifactRefs={node.artifactRefs} auditRefs={node.auditRefs} costRefs={node.costRefs} />
        {node.childRefs.length > 0 ? (
          <div className="trace-ref-group">
            <span className="trace-ref-group__label">child refs</span>
            {node.childRefs.map((ref) => (
              <RefSummaryChip key={`${node.agentRunId}-${ref.type}-${ref.id}`} ref={ref} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TimelineEventCard({ event }: { readonly event: TimelineEventView }) {
  return (
    <li className="trace-timeline__event">
      <div className="trace-timeline__seq" aria-label={`Sequence ${event.sequence}`}>
        {event.sequence}
      </div>
      <article>
        <header>
          <span className="trace-chip trace-chip--ok">{event.type}</span>
          <time>{event.occurredAt}</time>
        </header>
        <h3>{event.transition}</h3>
        <MetadataList
          items={[
            ['event id', event.id],
            ['actor', event.actor],
          ]}
        />
        <div className="trace-ref-grid">
          <RefSummary label="step" ref={event.step} />
          <RefSummary label="agent" ref={event.agentRun} />
          <RefSummary label="delegation" ref={event.delegation} />
          <RefSummary label="tool" ref={event.toolCall} />
        </div>
        <TraceRefBlock trace={event.trace} />
        <IdempotencyCard label="event idempotency" ref={event.idempotency} />
        <ReferenceBundle artifactRefs={event.artifactRefs} auditRefs={event.auditRefs} costRefs={event.costRefs} />
      </article>
    </li>
  );
}

function WorkflowListItem({ item }: { readonly item: WorkflowTraceListItemView }) {
  return (
    <li>
      <strong>{item.workflowId}</strong>
      <span>{item.status}</span>
      <small>
        {item.taskId} · step {item.currentStep} · trace {item.trace} · request {item.request} · {item.updatedAt}
      </small>
    </li>
  );
}

function BudgetScopeItem({ scope }: { readonly scope: TraceBudgetScopeView }) {
  return (
    <li>
      <strong>{scope.id}</strong>
      <span>{scope.status}</span>
      <small>
        {scope.scope} · {scope.owner} · spend {scope.spend} · reserved {scope.reserved} · cap {scope.hardCap} ·{' '}
        {scope.requestCount} requests · {scope.decision}
      </small>
      <em>{scope.visibility}</em>
    </li>
  );
}

function CostEventItem({ event }: { readonly event: TraceCostEventView }) {
  return (
    <li>
      <header>
        <strong>{event.eventType}</strong>
        <span>{event.decision}</span>
      </header>
      <MetadataList
        items={[
          ['id', event.id],
          ['trace', event.trace],
          ['request', event.request],
          ['workflow', event.workflowId],
          ['delegation', event.delegationId],
          ['tool class', event.toolClass],
          ['route intent', event.routeIntent],
          ['budget', event.budgetScope],
          ['model', event.modelAlias],
          ['provider', event.provider],
          ['status', event.status],
          ['actual', event.amount],
          ['estimated', event.estimatedAmount],
          ['input tokens', event.inputTokens],
          ['output tokens', event.outputTokens],
          ['denial', event.denialReason],
          ['occurred', event.occurredAt],
          ['recorded', event.recordedAt],
        ]}
      />
    </li>
  );
}

function ArtifactMetadataCard({ artifact }: { readonly artifact: TraceArtifactMetadataView }) {
  return (
    <li>
      <header>
        <strong>{artifact.kind}</strong>
        <span className="trace-chip trace-chip--warn">{artifact.sensitivity}</span>
      </header>
      <MetadataList
        items={[
          ['id', artifact.id],
          ['workflow', artifact.workflowId],
          ['task', artifact.taskId],
          ['delegation', artifact.delegationId],
          ['agent run', artifact.agentRunId],
          ['tool call', artifact.toolCallId],
          ['media type', artifact.mediaType],
          ['size bytes', artifact.sizeBytes],
          ['sha256', compactHash(artifact.sha256)],
          ['storage', artifact.storage],
          ['source', artifact.source],
          ['retention', artifact.retention],
          ['download policy', artifact.signedDownloadEligible],
          ['acl', artifact.acl],
          ['created', artifact.createdAt],
          ['updated', artifact.updatedAt],
        ]}
      />
      <ReferenceBundle artifactRefs={artifact.artifactRefs} auditRefs={artifact.auditRefs} costRefs={artifact.costRefs} />
    </li>
  );
}

function ToolDecisionCard({ decision }: { readonly decision: ToolDecisionView }) {
  const tone = isToolDecisionDenial(decision.decision) ? 'danger' : 'ok';
  return (
    <li>
      <header>
        <strong>{decision.toolClass}</strong>
        <span className={`trace-chip trace-chip--${tone}`}>{decision.decision}</span>
      </header>
      <MetadataList
        items={[
          ['source', decision.source],
          ['tool call', decision.toolCallRef],
          ['workflow', decision.workflowId],
          ['agent run', decision.agentRunId],
          ['delegation', decision.delegationId],
          ['status', decision.status],
          ['risk', decision.riskTier],
          ['reason', decision.reason],
        ]}
      />
      <ReferenceBundle artifactRefs={decision.artifactRefs} auditRefs={decision.auditRefs} costRefs={decision.costRefs} />
    </li>
  );
}

function isToolDecisionDenial(decision: string): boolean {
  const normalized = decision.toLowerCase();
  return normalized === 'deny' || normalized === 'denied';
}

function SkillCard({ skill }: { readonly skill: SkillTraceView }) {
  return (
    <li>
      <header>
        <strong>{skill.id}</strong>
        <span className={`trace-chip trace-chip--${skill.productionEnabled ? 'warn' : 'muted'}`}>
          {skill.status}
        </span>
      </header>
      <MetadataList
        items={[
          ['version', skill.version],
          ['owner', skill.owner],
          ['allowed tools', skill.allowedToolCount],
          ['blocked tools', skill.disallowedToolCount],
          ['instruction refs', skill.instructionTemplateRefCount],
          ['approval', skill.approvalRequired],
          ['rollout', skill.rollout],
          ['trace', skill.trace],
          ['request', skill.request],
        ]}
      />
      <VisibilityGroup label="models" values={skill.modelAliases} />
    </li>
  );
}

function PanelHeader({
  eyebrow,
  title,
  titleId,
  action,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly titleId?: string;
  readonly action?: ReactNode;
}) {
  return (
    <header className="trace-panel__head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      {action}
    </header>
  );
}

function MetadataList({ items }: { readonly items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <dl className="trace-kv">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TraceRefBlock({ trace }: { readonly trace: TaskTracePanel['workflow']['trace'] }) {
  return (
    <div className="trace-ref-block" aria-label="Trace references">
      <span>trace {trace.traceId}</span>
      <span>request {trace.requestId}</span>
      <span>context {trace.traceContextId}</span>
      <span>span {trace.spanId}</span>
    </div>
  );
}

function CurrentStepBlock({ step }: { readonly step: TaskTracePanel['workflow']['currentStep'] }) {
  return (
    <div className="trace-step">
      <strong>{step.type}</strong>
      <span>{step.status}</span>
      <small>
        {step.id} · agent {step.agentRunId} · delegation {step.delegationId}
      </small>
    </div>
  );
}

function LeaseBlock({ lease }: { readonly lease: LeaseView }) {
  return (
    <div className="trace-lease">
      <strong>lease {lease.status}</strong>
      <span>{lease.id}</span>
      <small>
        owner {lease.owner} · heartbeat {lease.heartbeatAt} · expires {lease.expiresAt}
      </small>
    </div>
  );
}

function IdempotencyCard({ label, ref }: { readonly label: string; readonly ref: IdempotencyView }) {
  return (
    <div className="trace-idempotency">
      <strong>{label}</strong>
      <span>{ref.key}</span>
      <small>
        scope {ref.scope} · dedupe {ref.dedupeRef} · expires {ref.expiresAt}
      </small>
    </div>
  );
}

function RefSummary({ label, ref }: { readonly label: string; readonly ref: RefSummaryView }) {
  return (
    <div className="trace-ref-summary">
      <span>{label}</span>
      <RefSummaryChip ref={ref} />
    </div>
  );
}

function RefSummaryChip({ ref }: { readonly ref: RefSummaryView }) {
  return (
    <span className="trace-ref">
      {ref.type}:{ref.id} · {ref.scope}
    </span>
  );
}

function ReferenceBundle({
  artifactRefs,
  auditRefs,
  costRefs,
}: {
  readonly artifactRefs: readonly ArtifactRefView[];
  readonly auditRefs: readonly AuditRefView[];
  readonly costRefs: readonly CostRefView[];
}) {
  return (
    <div className="trace-reference-bundle">
      <ArtifactRefs refs={artifactRefs} />
      <AuditRefs refs={auditRefs} />
      <CostRefs refs={costRefs} />
    </div>
  );
}

function ArtifactRefs({ refs }: { readonly refs: readonly ArtifactRefView[] }) {
  return (
    <div className="trace-ref-group">
      <span className="trace-ref-group__label">artifact refs</span>
      {refs.length === 0 ? (
        <span className="trace-ref trace-ref--empty">none</span>
      ) : (
        refs.map((ref) => (
          <span className="trace-ref" key={`${ref.id}-${ref.kind}`}>
            {ref.kind}:{ref.id} · {ref.dataClass} · {ref.sizeBytes}b · {compactHash(ref.sha256)}
          </span>
        ))
      )}
    </div>
  );
}

function AuditRefs({ refs }: { readonly refs: readonly AuditRefView[] }) {
  return (
    <div className="trace-ref-group">
      <span className="trace-ref-group__label">audit refs</span>
      {refs.length === 0 ? (
        <span className="trace-ref trace-ref--empty">none</span>
      ) : (
        refs.map((ref) => (
          <span className="trace-ref" key={`${ref.stream}-${ref.id}`}>
            {ref.stream}:{ref.id} · {ref.recordedAt}
          </span>
        ))
      )}
    </div>
  );
}

function CostRefs({ refs }: { readonly refs: readonly CostRefView[] }) {
  return (
    <div className="trace-ref-group">
      <span className="trace-ref-group__label">cost refs</span>
      {refs.length === 0 ? (
        <span className="trace-ref trace-ref--empty">none</span>
      ) : (
        refs.map((ref) => (
          <span className="trace-ref" key={`${ref.budgetScope}-${ref.id}`}>
            {ref.phase}:{ref.id} · {ref.budgetScope} · {ref.recordedAt}
          </span>
        ))
      )}
    </div>
  );
}

function PolicyChip({ policy }: { readonly policy: ActionPolicy }) {
  return (
    <span className={`trace-chip trace-chip--${policy.allowed ? 'ok' : 'muted'}`} title={policy.reason}>
      {policy.allowed ? 'actions visible' : 'fail-closed'}
    </span>
  );
}

function Readout({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="trace-readout">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VisibilityGroup({ label, values }: { readonly label: string; readonly values: readonly string[] }) {
  return (
    <div className="trace-visibility">
      <span>{label}</span>
      <ChipList emptyLabel="none" values={values} />
    </div>
  );
}

function ChipList({ emptyLabel, values }: { readonly emptyLabel: string; readonly values: readonly string[] }) {
  return (
    <div className="trace-chip-list">
      {values.length === 0 ? (
        <span className="trace-chip trace-chip--muted">{emptyLabel}</span>
      ) : (
        values.map((value) => (
          <span className="trace-chip" key={value}>
            {value}
          </span>
        ))
      )}
    </div>
  );
}

function traceStatusTone(status: TaskTracePanel['status']): 'ok' | 'warn' | 'muted' | 'danger' {
  if (status === 'ready') return 'ok';
  if (status === 'partial') return 'warn';
  if (status === 'empty') return 'muted';
  return 'danger';
}

function issueTone(state: TraceFetchIssue['state']): 'ok' | 'warn' | 'danger' {
  if (state === 'ok') return 'ok';
  if (state === 'empty') return 'warn';
  return 'danger';
}

function compactHash(value: string): string {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}
