import type {
    CostEventRecord,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import type {
    VirtualKeyPublicRecord,
} from '../../../control-api/src/routes/virtual-keys.ts';
import type { BudgetSpendInspection } from '../../../control-api/src/routes/budgets.ts';
import type {
    AgentRunResponse,
    ArtifactMetadataResponse,
    SkillResponse,
    TaskResponse,
    WorkflowEventResponse,
    WorkflowResponse,
} from '../../../control-api/src/routes/agent-workflow-store.ts';

export interface ControlApiFetchResult<T> {
    readonly ok: boolean;
    readonly status: number;
    readonly path: string;
    readonly body: T | null;
    readonly error?: string;
}

export interface OperationalControlApiSnapshot {
    readonly health: ControlApiFetchResult<ControlApiHealthPayload>;
    readonly readiness: ControlApiFetchResult<ControlApiReadinessPayload>;
    readonly registry: ControlApiFetchResult<RegistryEnvelope>;
    readonly bifrostValidation: ControlApiFetchResult<BifrostValidationReport>;
    readonly virtualKeys: ControlApiFetchResult<VirtualKeyListEnvelope>;
    readonly budgetSpend: ControlApiFetchResult<BudgetSpendEnvelope>;
    readonly costEvents: ControlApiFetchResult<CostEventsEnvelope>;
    readonly openapi: ControlApiFetchResult<OpenApiEnvelope>;
    readonly task: ControlApiFetchResult<TaskEnvelope>;
    readonly taskArtifacts: ControlApiFetchResult<TaskArtifactsEnvelope>;
    readonly workflow: ControlApiFetchResult<WorkflowEnvelope>;
    readonly workflowEvents: ControlApiFetchResult<WorkflowEventsEnvelope>;
    readonly agentRun: ControlApiFetchResult<AgentRunEnvelope>;
    readonly skills: ControlApiFetchResult<SkillsEnvelope>;
}

export interface OperationalViewModel {
    readonly generatedAt: string;
    readonly controlApiBaseUrl: string;
    readonly health: HealthPanel;
    readonly routing: RoutingPanel;
    readonly virtualKeys: VirtualKeysPanel;
    readonly budgets: BudgetsPanel;
    readonly audit: AuditPanel;
    readonly breakGlass: BreakGlassPanel;
    readonly taskTrace: TaskTracePanel;
}

export interface HealthPanel {
    readonly service: string;
    readonly status: 'ok' | 'degraded' | 'unknown';
    readonly readiness: string;
    readonly checks: readonly KeyValue[];
}

export interface RoutingPanel {
    readonly registryVersion: string;
    readonly routeConfigVersion: string;
    readonly productionEnabled: boolean;
    readonly aliases: readonly AliasView[];
    readonly gateErrors: readonly string[];
}

export interface AliasView {
    readonly alias: string;
    readonly lifecycle: string;
    readonly routeAllowed: boolean;
    readonly gateStatus: string;
    readonly candidates: readonly CandidateView[];
}

export interface CandidateView {
    readonly id: string;
    readonly provider: string;
    readonly model: string;
    readonly region: string;
    readonly dataClasses: readonly string[];
    readonly manualApproval: string;
}

export interface VirtualKeysPanel {
    readonly actionPolicy: ActionPolicy;
    readonly records: readonly VirtualKeyView[];
}

export interface VirtualKeyView {
    readonly id: string;
    readonly prefix: string;
    readonly status: string;
    readonly principal: string;
    readonly project: string;
    readonly budgetScope: string;
    readonly rotation: string;
    readonly revocation: string;
    readonly productionEnabled: boolean;
}

export interface BudgetsPanel {
    readonly actionPolicy: ActionPolicy;
    readonly spend: readonly BudgetSpendView[];
    readonly costEvents: readonly CostEventView[];
}

export interface BudgetSpendView {
    readonly id: string;
    readonly scope: string;
    readonly owner: string;
    readonly status: string;
    readonly spend: string;
    readonly hardCap: string;
    readonly requestCount: string;
    readonly decision: string;
}

export interface CostEventView {
    readonly id: string;
    readonly trace: string;
    readonly request: string;
    readonly modelAlias: string;
    readonly provider: string;
    readonly status: string;
    readonly decision: string;
    readonly amount: string;
    readonly denialReason: string;
}

export interface AuditPanel {
    readonly actionPolicy: ActionPolicy;
    readonly events: readonly AuditEventView[];
    readonly denials: readonly AuditEventView[];
}

export interface AuditEventView {
    readonly id: string;
    readonly source: string;
    readonly action: string;
    readonly outcome: string;
    readonly occurredAt: string;
}

export interface BreakGlassPanel {
    readonly status: 'disabled' | 'pending' | 'allowed';
    readonly reason: string;
    readonly actionPolicy: ActionPolicy;
}

export type TaskTraceStatus = 'ready' | 'partial' | 'empty' | 'error';

export type TaskTraceSnapshotKey =
    | 'task'
    | 'taskArtifacts'
    | 'workflow'
    | 'workflowEvents'
    | 'agentRun'
    | 'skills';

export interface TaskTracePanel {
    readonly actionPolicy: ActionPolicy;
    readonly status: TaskTraceStatus;
    readonly dataSource: string;
    readonly issues: readonly TraceFetchIssue[];
    readonly task: TaskTraceSummaryView;
    readonly workflows: readonly WorkflowTraceListItemView[];
    readonly workflow: WorkflowTraceDetailView;
    readonly delegationTree: DelegationTreePanel;
    readonly eventTimeline: EventTimelinePanel;
    readonly cost: TraceCostPanel;
    readonly artifacts: TraceArtifactPanel;
    readonly tools: TraceToolPanel;
    readonly skills: readonly SkillTraceView[];
}

export interface TraceFetchIssue {
    readonly key: TaskTraceSnapshotKey;
    readonly path: string;
    readonly status: number;
    readonly state: 'ok' | 'empty' | 'error';
    readonly message: string;
}

export interface TaskTraceSummaryView {
    readonly id: string;
    readonly workflowId: string;
    readonly status: string;
    readonly taskType: string;
    readonly priority: string;
    readonly principal: string;
    readonly project: string;
    readonly dataClass: string;
    readonly budgetScope: string;
    readonly trace: string;
    readonly request: string;
    readonly objectiveRef: RefSummaryView;
    readonly contextRefCount: string;
    readonly artifactRefCount: string;
    readonly agentRunRefCount: string;
    readonly idempotency: IdempotencyView;
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface WorkflowTraceListItemView {
    readonly workflowId: string;
    readonly taskId: string;
    readonly status: string;
    readonly currentStep: string;
    readonly trace: string;
    readonly request: string;
    readonly updatedAt: string;
}

export interface WorkflowTraceDetailView {
    readonly workflowId: string;
    readonly taskId: string;
    readonly version: string;
    readonly status: string;
    readonly principal: string;
    readonly project: string;
    readonly dataClass: string;
    readonly budgetScope: string;
    readonly policyVersion: string;
    readonly registryVersion: string;
    readonly trace: TraceRefView;
    readonly currentStep: StepRefView;
    readonly allowedTransitions: readonly string[];
    readonly lease: LeaseView;
    readonly idempotency: readonly IdempotencyView[];
    readonly resumeRef: RefSummaryView;
    readonly terminalFailureRef: string;
    readonly artifactRefs: readonly ArtifactRefView[];
    readonly auditRefs: readonly AuditRefView[];
    readonly costRefs: readonly CostRefView[];
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface DelegationTreePanel {
    readonly actionPolicy: ActionPolicy;
    readonly rootAgentRunId: string;
    readonly nodes: readonly AgentTreeNodeView[];
    readonly edges: readonly AgentTreeEdgeView[];
    readonly emptyState: string;
}

export interface AgentTreeNodeView {
    readonly agentRunId: string;
    readonly parentAgentRunId: string;
    readonly delegationId: string;
    readonly role: string;
    readonly status: string;
    readonly modelAlias: string;
    readonly agentDefinition: string;
    readonly trace: string;
    readonly request: string;
    readonly lease: LeaseView;
    readonly contextRefCount: string;
    readonly childRefs: readonly RefSummaryView[];
    readonly artifactRefs: readonly ArtifactRefView[];
    readonly auditRefs: readonly AuditRefView[];
    readonly costRefs: readonly CostRefView[];
    readonly startedAt: string;
    readonly completedAt: string;
    readonly nodeState: 'loaded' | 'reference-only';
}

export interface AgentTreeEdgeView {
    readonly parentAgentRunId: string;
    readonly childAgentRunId: string;
    readonly delegationId: string;
    readonly label: string;
}

export interface EventTimelinePanel {
    readonly actionPolicy: ActionPolicy;
    readonly events: readonly TimelineEventView[];
    readonly nextCursor: string;
    readonly emptyState: string;
}

export interface TimelineEventView {
    readonly id: string;
    readonly sequence: string;
    readonly type: string;
    readonly actor: string;
    readonly transition: string;
    readonly step: RefSummaryView;
    readonly agentRun: RefSummaryView;
    readonly delegation: RefSummaryView;
    readonly toolCall: RefSummaryView;
    readonly trace: TraceRefView;
    readonly artifactRefs: readonly ArtifactRefView[];
    readonly auditRefs: readonly AuditRefView[];
    readonly costRefs: readonly CostRefView[];
    readonly idempotency: IdempotencyView;
    readonly occurredAt: string;
}

export interface TraceCostPanel {
    readonly actionPolicy: ActionPolicy;
    readonly events: readonly TraceCostEventView[];
    readonly budgetScopes: readonly TraceBudgetScopeView[];
    readonly totals: TraceCostTotalsView;
    readonly visibility: TraceCostVisibilityView;
    readonly referencedCostEvents: readonly CostRefView[];
    readonly emptyState: string;
}

export interface TraceCostEventView {
    readonly id: string;
    readonly eventType: string;
    readonly trace: string;
    readonly request: string;
    readonly workflowId: string;
    readonly delegationId: string;
    readonly toolClass: string;
    readonly routeIntent: string;
    readonly budgetScope: string;
    readonly modelAlias: string;
    readonly provider: string;
    readonly status: string;
    readonly decision: string;
    readonly amount: string;
    readonly estimatedAmount: string;
    readonly inputTokens: string;
    readonly outputTokens: string;
    readonly denialReason: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
}

export interface TraceBudgetScopeView {
    readonly id: string;
    readonly scope: string;
    readonly owner: string;
    readonly status: string;
    readonly spend: string;
    readonly reserved: string;
    readonly hardCap: string;
    readonly requestCount: string;
    readonly decision: string;
    readonly visibility: string;
}

export interface TraceCostTotalsView {
    readonly currency: string;
    readonly actualAmount: string;
    readonly estimatedAmount: string;
    readonly requestCount: string;
}

export interface TraceCostVisibilityView {
    readonly workflowIds: readonly string[];
    readonly delegationIds: readonly string[];
    readonly toolClasses: readonly string[];
    readonly budgetScopeIds: readonly string[];
    readonly modelAliases: readonly string[];
}

export interface TraceArtifactPanel {
    readonly actionPolicy: ActionPolicy;
    readonly metadata: readonly TraceArtifactMetadataView[];
    readonly count: string;
    readonly emptyState: string;
}

export interface TraceArtifactMetadataView {
    readonly id: string;
    readonly kind: string;
    readonly workflowId: string;
    readonly taskId: string;
    readonly delegationId: string;
    readonly agentRunId: string;
    readonly toolCallId: string;
    readonly mediaType: string;
    readonly sizeBytes: string;
    readonly sha256: string;
    readonly sensitivity: string;
    readonly storage: string;
    readonly source: string;
    readonly retention: string;
    readonly signedDownloadEligible: string;
    readonly acl: string;
    readonly artifactRefs: readonly ArtifactRefView[];
    readonly auditRefs: readonly AuditRefView[];
    readonly costRefs: readonly CostRefView[];
    readonly createdAt: string;
    readonly updatedAt: string;
}

export interface TraceToolPanel {
    readonly actionPolicy: ActionPolicy;
    readonly decisions: readonly ToolDecisionView[];
    readonly openApiRoutes: readonly string[];
    readonly emptyState: string;
}

export interface ToolDecisionView {
    readonly id: string;
    readonly source: string;
    readonly toolClass: string;
    readonly toolCallRef: string;
    readonly workflowId: string;
    readonly agentRunId: string;
    readonly delegationId: string;
    readonly decision: string;
    readonly status: string;
    readonly riskTier: string;
    readonly reason: string;
    readonly artifactRefs: readonly ArtifactRefView[];
    readonly auditRefs: readonly AuditRefView[];
    readonly costRefs: readonly CostRefView[];
}

export interface SkillTraceView {
    readonly id: string;
    readonly version: string;
    readonly status: string;
    readonly owner: string;
    readonly modelAliases: readonly string[];
    readonly allowedToolCount: string;
    readonly disallowedToolCount: string;
    readonly instructionTemplateRefCount: string;
    readonly approvalRequired: string;
    readonly rollout: string;
    readonly productionEnabled: boolean;
    readonly trace: string;
    readonly request: string;
}

export interface TraceRefView {
    readonly traceId: string;
    readonly requestId: string;
    readonly traceContextId: string;
    readonly spanId: string;
}

export interface StepRefView {
    readonly id: string;
    readonly type: string;
    readonly status: string;
    readonly agentRunId: string;
    readonly delegationId: string;
}

export interface LeaseView {
    readonly id: string;
    readonly owner: string;
    readonly status: string;
    readonly heartbeatAt: string;
    readonly expiresAt: string;
}

export interface IdempotencyView {
    readonly key: string;
    readonly scope: string;
    readonly dedupeRef: string;
    readonly expiresAt: string;
}

export interface RefSummaryView {
    readonly id: string;
    readonly type: string;
    readonly scope: string;
}

export interface ArtifactRefView {
    readonly id: string;
    readonly kind: string;
    readonly dataClass: string;
    readonly sha256: string;
    readonly sizeBytes: string;
}

export interface AuditRefView {
    readonly id: string;
    readonly stream: string;
    readonly recordedAt: string;
}

export interface CostRefView {
    readonly id: string;
    readonly budgetScope: string;
    readonly phase: string;
    readonly recordedAt: string;
}

export interface ActionPolicy {
    readonly allowed: boolean;
    readonly reason: string;
}

interface KeyValue {
    readonly key: string;
    readonly value: string;
}

interface ControlApiHealthPayload {
    readonly service?: string;
    readonly status?: string;
    readonly port?: number;
}

interface ControlApiReadinessPayload {
    readonly service?: string;
    readonly status?: string;
    readonly checks?: Readonly<Record<string, string>>;
}

interface RegistryEnvelope {
    readonly registry_version?: string;
    readonly production_enabled?: boolean;
    readonly snapshot?: {
        readonly production_posture?: {
            readonly production_enabled?: boolean;
            readonly production_route_allowed?: boolean;
        };
        readonly model_aliases?: readonly RegistryAlias[];
    };
}

interface RegistryAlias {
    readonly alias?: string;
    readonly lifecycle_status?: string;
    readonly production_gate?: {
        readonly production_route_allowed?: boolean;
    };
    readonly eval_gate?: {
        readonly latest_gate_status?: string;
    };
    readonly candidates?: readonly RegistryCandidate[];
}

interface RegistryCandidate {
    readonly candidate_id?: string;
    readonly provider_id?: string;
    readonly provider_region?: string;
    readonly model_id?: string;
    readonly allowed_data_classes?: readonly string[];
    readonly manual_approval_gate?: {
        readonly status?: string;
    };
}

interface BifrostValidationReport {
    readonly route_config_version?: string;
    readonly production_enabled?: boolean;
    readonly errors?: readonly BifrostValidationError[];
}

interface BifrostValidationError {
    readonly code?: string;
    readonly message?: string;
    readonly error?: {
        readonly code?: string;
        readonly message?: string;
    };
}

interface VirtualKeyListEnvelope {
    readonly virtual_keys?: readonly VirtualKeyPublicRecord[];
}

interface BudgetSpendEnvelope {
    readonly spend?: readonly BudgetSpendInspection[];
}

interface CostEventsEnvelope {
    readonly cost_events?: readonly CostEventRecord[];
}

interface OpenApiEnvelope {
    readonly paths?: Readonly<Record<string, unknown>>;
}

interface TaskEnvelope {
    readonly task?: TaskResponse;
}

interface TaskArtifactsEnvelope {
    readonly artifacts?: readonly ArtifactMetadataResponse[];
    readonly count?: number;
}

interface WorkflowEnvelope {
    readonly workflow?: WorkflowResponse;
}

interface WorkflowEventsEnvelope {
    readonly events?: readonly WorkflowEventResponse[];
    readonly next_cursor?: string | null;
}

interface AgentRunEnvelope {
    readonly agent_run?: AgentRunResponse;
}

interface SkillsEnvelope {
    readonly skills?: readonly SkillResponse[];
    readonly count?: number;
}

const secretFieldPattern =
    /(?:one[_-]?time[_-]?secret|raw[_-]?(?:secret|prompt|context|artifact|input|output|completion)|provider[_-]?(?:key|secret|token)|api[_-]?key|key[_-]?hash[_-]?ref|key[_-]?fingerprint|virtual[_-]?key[_-]?(?:value|secret)|signed[_-]?(?:url|uri)|artifact[_-]?body|object[_-]?body|prompt|completion|authorization|password|private[_-]?key|credential|access[_-]?token|refresh[_-]?token|id[_-]?token|(?:^|[_-])secret(?:$|[_-])|(?:^|[_-])token(?:$|[_-])|(?:raw|db|database|unrestricted)[_-]?rows)/iu;

export function buildOperationalViewModel(
    snapshot: OperationalControlApiSnapshot,
    options: { readonly generatedAt: string; readonly controlApiBaseUrl: string },
): OperationalViewModel {
    const productionRoutes = snapshot.readiness.body?.checks?.productionRoutes ?? 'unknown';
    const routePolicy = actionPolicyFromControlApi(productionRoutes);
    const openApiPaths = Object.keys(snapshot.openapi.body?.paths ?? {});
    const costEvents = asReadonlyArray(snapshot.costEvents.body?.cost_events);
    const budgetSpend = asReadonlyArray(snapshot.budgetSpend.body?.spend);
    const virtualKeys = asReadonlyArray(snapshot.virtualKeys.body?.virtual_keys).map(toVirtualKeyView);

    return {
        generatedAt: options.generatedAt,
        controlApiBaseUrl: options.controlApiBaseUrl,
        health: {
            service: snapshot.health.body?.service ?? '@devgateway/control-api',
            status: snapshot.health.ok && snapshot.health.body?.status === 'ok' ? 'ok' : snapshot.readiness.ok ? 'degraded' : 'unknown',
            readiness: snapshot.readiness.body?.status ?? fetchResultLabel(snapshot.readiness),
            checks: Object.entries(snapshot.readiness.body?.checks ?? {}).map(([key, value]) => ({ key, value })),
        },
        routing: {
            registryVersion: snapshot.registry.body?.registry_version ?? 'unavailable',
            routeConfigVersion: snapshot.bifrostValidation.body?.route_config_version ?? 'unavailable',
            productionEnabled:
                snapshot.registry.body?.production_enabled === true ||
                snapshot.registry.body?.snapshot?.production_posture?.production_enabled === true ||
                snapshot.bifrostValidation.body?.production_enabled === true,
            aliases: (snapshot.registry.body?.snapshot?.model_aliases ?? []).map(toAliasView),
            gateErrors: (snapshot.bifrostValidation.body?.errors ?? [])
                .map(toGateErrorText)
                .filter((text) => text.length > 0),
        },
        virtualKeys: {
            actionPolicy: routePolicy,
            records: virtualKeys,
        },
        budgets: {
            actionPolicy: routePolicy,
            spend: budgetSpend.map(toBudgetSpendView),
            costEvents: costEvents.map(toCostEventView),
        },
        audit: {
            actionPolicy: auditActionPolicy(openApiPaths),
            events: virtualKeys
                .flatMap((key) => [
                    { id: key.id, source: 'virtual-key', action: 'status', outcome: key.status, occurredAt: key.revocation },
                ])
                .concat(costEvents.map(toAuditEventView)),
            denials: costEvents.filter((event) => event.decision === 'deny' || event.denial_reason).map(toAuditEventView),
        },
        breakGlass: toBreakGlassPanel(openApiPaths, routePolicy),
        taskTrace: toTaskTracePanel(snapshot, openApiPaths, costEvents, budgetSpend),
    };
}

export function sanitizeForDisplay(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitizeForDisplay);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !secretFieldPattern.test(key))
            .map(([key, child]) => [key, sanitizeForDisplay(child)]),
    );
}

export function renderOperationalPortalHtml(model: OperationalViewModel): string {
    const safeModel = sanitizeForDisplay(model) as OperationalViewModel;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DevGateway Operational Console</title>
    <style>${portalCss()}</style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">Control plane / operational views</p>
        <h1>Gateway command status, without secrets.</h1>
        <p class="lede">Every card is mapped from Control API response shapes. Production actions stay inert unless readiness explicitly enables them.</p>
        <div class="hero-meta">
          <span>${escapeHtml(safeModel.controlApiBaseUrl)}</span>
          <span>${escapeHtml(safeModel.generatedAt)}</span>
        </div>
      </section>
      ${renderHealth(safeModel.health)}
      ${renderRouting(safeModel.routing)}
      ${renderVirtualKeys(safeModel.virtualKeys)}
      ${renderBudgets(safeModel.budgets)}
      ${renderAudit(safeModel.audit)}
      ${renderBreakGlass(safeModel.breakGlass)}
    </main>
  </body>
</html>
`;
}

function toAliasView(alias: RegistryAlias): AliasView {
    return {
        alias: alias.alias ?? 'unknown-alias',
        lifecycle: alias.lifecycle_status ?? 'unknown',
        routeAllowed: alias.production_gate?.production_route_allowed === true,
        gateStatus: alias.eval_gate?.latest_gate_status ?? 'unknown',
        candidates: (alias.candidates ?? []).map((candidate) => ({
            id: candidate.candidate_id ?? 'candidate',
            provider: candidate.provider_id ?? 'provider',
            model: candidate.model_id ?? 'model',
            region: candidate.provider_region ?? 'region',
            dataClasses: candidate.allowed_data_classes ?? [],
            manualApproval: candidate.manual_approval_gate?.status ?? 'unknown',
        })),
    };
}

function toVirtualKeyView(record: VirtualKeyPublicRecord): VirtualKeyView {
    return {
        id: record.virtual_key_id,
        prefix: record.key_prefix,
        status: record.status,
        principal: record.principal_binding.principal_id,
        project: record.project_binding.project_id,
        budgetScope: record.budget_scope_ref.budget_scope_id,
        rotation: record.rotation.rotation_state,
        revocation: record.revocation.revoked_at === null ? 'not revoked' : `revoked ${record.revocation.revoked_at}`,
        productionEnabled: record.production_posture.production_enabled,
    };
}

function toBudgetSpendView(spend: BudgetSpendInspection): BudgetSpendView {
    return {
        id: spend.budget_scope_id,
        scope: spend.scope_type,
        owner: spend.owner_id,
        status: spend.status,
        spend: money(spend.spend_state.actual_spend_amount, spend.currency),
        hardCap: spend.limits.hard_cap_amount === null ? 'uncapped' : money(spend.limits.hard_cap_amount, spend.currency),
        requestCount: String(spend.spend_state.actual_request_count),
        decision: spend.decision,
    };
}

function toCostEventView(event: CostEventRecord): CostEventView {
    return {
        id: event.cost_event_id,
        trace: event.trace_id,
        request: event.request_id,
        modelAlias: event.model_alias,
        provider: event.provider_id ?? 'unassigned',
        status: event.attempt_status,
        decision: event.decision,
        amount: event.actual.cost_amount === null ? 'not reported' : money(event.actual.cost_amount, event.currency),
        denialReason: event.denial_reason ?? 'none',
    };
}

function toAuditEventView(event: CostEventRecord): AuditEventView {
    return {
        id: event.cost_event_id,
        source: 'cost-event',
        action: event.event_type,
        outcome: event.denial_reason ?? event.decision,
        occurredAt: event.occurred_at,
    };
}

function actionPolicyFromControlApi(productionRoutes: string): ActionPolicy {
    return productionRoutes === 'enabled'
        ? { allowed: true, reason: 'Control API readiness reports productionRoutes enabled.' }
        : { allowed: false, reason: `Control API readiness reports productionRoutes=${productionRoutes}; action controls are disabled.` };
}

function auditActionPolicy(openApiPaths: readonly string[]): ActionPolicy {
    return openApiPaths.some((path) => path.includes('audit'))
        ? { allowed: true, reason: 'Control API exposes audit routes.' }
        : { allowed: false, reason: 'No Control API audit-event stream route is exposed; showing correlated audit IDs and denials only.' };
}

function toBreakGlassPanel(openApiPaths: readonly string[], routePolicy: ActionPolicy): BreakGlassPanel {
    const hasBreakGlassPath = openApiPaths.some((path) => /break[-_]?glass/iu.test(path));
    if (!hasBreakGlassPath) {
        return {
            status: 'disabled',
            reason: 'Control API does not expose a break-glass route; pending/disabled state is fail-closed.',
            actionPolicy: { allowed: false, reason: 'Break-glass action unavailable in Control API route shapes.' },
        };
    }
    return {
        status: routePolicy.allowed ? 'allowed' : 'pending',
        reason: routePolicy.allowed ? 'Control API routes are enabled.' : routePolicy.reason,
        actionPolicy: routePolicy,
    };
}

function toTaskTracePanel(
    snapshot: OperationalControlApiSnapshot,
    openApiPaths: readonly string[],
    costEvents: readonly CostEventRecord[],
    budgetSpend: readonly BudgetSpendInspection[],
): TaskTracePanel {
    const task = snapshot.task?.body?.task ?? null;
    const workflow = snapshot.workflow?.body?.workflow ?? null;
    const workflowEvents = asReadonlyArray(snapshot.workflowEvents?.body?.events);
    const agentRun = snapshot.agentRun?.body?.agent_run ?? null;
    const artifacts = asReadonlyArray(snapshot.taskArtifacts?.body?.artifacts);
    const skills = asReadonlyArray(snapshot.skills?.body?.skills);
    const issues = toTaskTraceIssues(snapshot, { task, workflow, workflowEvents, agentRun, artifacts, skills });
    const status = toTaskTraceStatus(issues, { task, workflow, workflowEvents, agentRun, artifacts, skills });
    const workflowItems = workflow === null ? [] : [toWorkflowTraceListItem(workflow)];
    return {
        actionPolicy: toTaskTraceActionPolicy(status, issues),
        status,
        dataSource: 'Control API Track 2 fixture trace endpoints',
        issues,
        task: toTaskTraceSummary(task, workflow),
        workflows: workflowItems,
        workflow: toWorkflowTraceDetail(workflow),
        delegationTree: toDelegationTreePanel(snapshot.agentRun, task, agentRun),
        eventTimeline: toEventTimelinePanel(snapshot.workflowEvents, workflowEvents),
        cost: toTraceCostPanel(snapshot.costEvents, snapshot.budgetSpend, costEvents, budgetSpend, workflow, agentRun, workflowEvents, artifacts),
        artifacts: toTraceArtifactPanel(snapshot.taskArtifacts, artifacts),
        tools: toTraceToolPanel(openApiPaths, workflowEvents, artifacts, costEvents, agentRun, skills),
        skills: skills.map(toSkillTraceView),
    };
}

function toTaskTraceIssues(
    snapshot: OperationalControlApiSnapshot,
    data: {
        readonly task: TaskResponse | null;
        readonly workflow: WorkflowResponse | null;
        readonly workflowEvents: readonly WorkflowEventResponse[];
        readonly agentRun: AgentRunResponse | null;
        readonly artifacts: readonly ArtifactMetadataResponse[];
        readonly skills: readonly SkillResponse[];
    },
): readonly TraceFetchIssue[] {
    return [
        traceIssue('task', snapshot.task, data.task !== null),
        traceIssue('taskArtifacts', snapshot.taskArtifacts, data.artifacts.length > 0),
        traceIssue('workflow', snapshot.workflow, data.workflow !== null),
        traceIssue('workflowEvents', snapshot.workflowEvents, data.workflowEvents.length > 0),
        traceIssue('agentRun', snapshot.agentRun, data.agentRun !== null),
        traceIssue('skills', snapshot.skills, data.skills.length > 0),
    ];
}

function traceIssue(
    key: TaskTraceSnapshotKey,
    result: ControlApiFetchResult<unknown> | undefined,
    hasData: boolean,
): TraceFetchIssue {
    if (result === undefined) {
        return {
            key,
            path: 'not requested',
            status: 0,
            state: 'error',
            message: 'Control API trace endpoint was not present in the snapshot.',
        };
    }
    if (!result.ok) {
        return {
            key,
            path: result.path,
            status: result.status,
            state: 'error',
            message: result.error ?? `HTTP ${result.status || 'offline'}`,
        };
    }
    return {
        key,
        path: result.path,
        status: result.status,
        state: hasData ? 'ok' : 'empty',
        message: hasData ? 'ok' : 'Control API returned no trace records for the safe demo IDs.',
    };
}

function toTaskTraceStatus(
    issues: readonly TraceFetchIssue[],
    data: {
        readonly task: TaskResponse | null;
        readonly workflow: WorkflowResponse | null;
        readonly workflowEvents: readonly WorkflowEventResponse[];
        readonly agentRun: AgentRunResponse | null;
        readonly artifacts: readonly ArtifactMetadataResponse[];
        readonly skills: readonly SkillResponse[];
    },
): TaskTraceStatus {
    const hasData =
        data.task !== null ||
        data.workflow !== null ||
        data.workflowEvents.length > 0 ||
        data.agentRun !== null ||
        data.artifacts.length > 0 ||
        data.skills.length > 0;
    const hasError = issues.some((issue) => issue.state === 'error');
    if (!hasData) return hasError ? 'error' : 'empty';
    return hasError ? 'partial' : 'ready';
}

function toTaskTraceActionPolicy(status: TaskTraceStatus, issues: readonly TraceFetchIssue[]): ActionPolicy {
    if (status === 'ready') {
        return { allowed: true, reason: 'Track 2 trace data was loaded from Control API endpoints.' };
    }
    if (status === 'partial') {
        const failed = issues.filter((issue) => issue.state === 'error').map((issue) => issue.key).join(', ');
        return { allowed: true, reason: `Partial Control API trace data loaded; failed endpoints: ${failed}.` };
    }
    if (status === 'empty') {
        return { allowed: false, reason: 'Control API trace endpoints returned empty demo trace records.' };
    }
    return { allowed: false, reason: 'Control API trace endpoints failed closed; showing sanitized fallback states only.' };
}

function toTaskTraceSummary(task: TaskResponse | null, workflow: WorkflowResponse | null): TaskTraceSummaryView {
    if (task === null) {
        return {
            id: 'task unavailable',
            workflowId: workflow?.workflow_id ?? 'workflow unavailable',
            status: 'unavailable',
            taskType: 'unavailable',
            priority: 'unavailable',
            principal: workflow?.principal_id ?? 'principal unavailable',
            project: workflow?.project_id ?? 'project unavailable',
            dataClass: workflow?.data_class ?? 'data class unavailable',
            budgetScope: workflow?.budget_scope_id ?? 'budget scope unavailable',
            trace: workflow?.trace_id ?? 'trace unavailable',
            request: workflow?.request_id ?? 'request unavailable',
            objectiveRef: emptyRef('objective ref unavailable'),
            contextRefCount: '0',
            artifactRefCount: String(workflow?.artifact_refs.length ?? 0),
            agentRunRefCount: '0',
            idempotency: emptyIdempotency(),
            createdAt: workflow?.created_at ?? 'unavailable',
            updatedAt: workflow?.updated_at ?? 'unavailable',
        };
    }
    return {
        id: task.task_id,
        workflowId: task.workflow_id,
        status: task.status,
        taskType: task.task_type,
        priority: task.priority,
        principal: task.principal_id,
        project: task.project_id,
        dataClass: task.data_class,
        budgetScope: task.budget_scope_id,
        trace: task.trace_id,
        request: task.request_id,
        objectiveRef: toRefSummary(task.objective_ref, 'objective ref unavailable'),
        contextRefCount: String(task.input_context_refs.length),
        artifactRefCount: String(task.artifact_refs.length),
        agentRunRefCount: String(task.agent_run_refs.length),
        idempotency: toIdempotencyView(task.idempotency),
        createdAt: task.created_at,
        updatedAt: task.updated_at,
    };
}

function toWorkflowTraceListItem(workflow: WorkflowResponse): WorkflowTraceListItemView {
    return {
        workflowId: workflow.workflow_id,
        taskId: workflow.task_id,
        status: workflow.status,
        currentStep: workflow.current_step_ref.step_type,
        trace: workflow.trace_id,
        request: workflow.request_id,
        updatedAt: workflow.updated_at,
    };
}

function toWorkflowTraceDetail(workflow: WorkflowResponse | null): WorkflowTraceDetailView {
    if (workflow === null) {
        return {
            workflowId: 'workflow unavailable',
            taskId: 'task unavailable',
            version: 'unavailable',
            status: 'unavailable',
            principal: 'principal unavailable',
            project: 'project unavailable',
            dataClass: 'data class unavailable',
            budgetScope: 'budget scope unavailable',
            policyVersion: 'policy unavailable',
            registryVersion: 'registry unavailable',
            trace: emptyTrace(),
            currentStep: emptyStep(),
            allowedTransitions: [],
            lease: emptyLease(),
            idempotency: [],
            resumeRef: emptyRef('resume ref unavailable'),
            terminalFailureRef: 'none',
            artifactRefs: [],
            auditRefs: [],
            costRefs: [],
            createdAt: 'unavailable',
            updatedAt: 'unavailable',
        };
    }
    return {
        workflowId: workflow.workflow_id,
        taskId: workflow.task_id,
        version: workflow.workflow_version,
        status: workflow.status,
        principal: workflow.principal_id,
        project: workflow.project_id,
        dataClass: workflow.data_class,
        budgetScope: workflow.budget_scope_id,
        policyVersion: workflow.policy_version,
        registryVersion: workflow.registry_version,
        trace: toTraceRefView(workflow.trace_id, workflow.request_id, workflow.trace_context_ref),
        currentStep: toStepRefView(workflow.current_step_ref),
        allowedTransitions: workflow.allowed_transitions,
        lease: toLeaseView(workflow.lease_state),
        idempotency: workflow.idempotency_refs.map(toIdempotencyView),
        resumeRef: toRefSummary(workflow.resume_ref, 'resume ref unavailable'),
        terminalFailureRef: toFailureRefSummary(workflow.terminal_failure_ref),
        artifactRefs: workflow.artifact_refs.map(toArtifactRefView),
        auditRefs: workflow.audit_refs.map(toAuditRefView),
        costRefs: workflow.cost_refs.map(toCostRefView),
        createdAt: workflow.created_at,
        updatedAt: workflow.updated_at,
    };
}

function toDelegationTreePanel(
    result: ControlApiFetchResult<AgentRunEnvelope> | undefined,
    task: TaskResponse | null,
    agentRun: AgentRunResponse | null,
): DelegationTreePanel {
    const nodes = new Map<string, AgentTreeNodeView>();
    if (agentRun !== null) {
        nodes.set(agentRun.agent_run_id, toAgentTreeNode(agentRun));
        for (const child of agentRun.child_agent_run_refs) {
            nodes.set(child.ref_id, toReferenceAgentNode(child, agentRun.agent_run_id));
        }
    }
    for (const ref of task?.agent_run_refs ?? []) {
        if (!nodes.has(ref.ref_id)) {
            nodes.set(ref.ref_id, toReferenceAgentNode(ref, 'parent unavailable'));
        }
    }
    const edges = Array.from(nodes.values())
        .filter((node) => node.parentAgentRunId !== 'none' && node.parentAgentRunId !== 'parent unavailable')
        .map((node) => ({
            parentAgentRunId: node.parentAgentRunId,
            childAgentRunId: node.agentRunId,
            delegationId: node.delegationId,
            label: node.delegationId === 'none' ? 'agent child ref' : `delegation ${node.delegationId}`,
        }));
    return {
        actionPolicy: resultPolicy(result, nodes.size > 0, 'Agent run metadata loaded from Control API.'),
        rootAgentRunId: agentRun?.agent_run_id ?? task?.agent_run_refs[0]?.ref_id ?? 'agent run unavailable',
        nodes: Array.from(nodes.values()),
        edges,
        emptyState: nodes.size === 0 ? 'No agent-run or delegation refs returned by Control API.' : 'Agent tree loaded from metadata refs only.',
    };
}

function toAgentTreeNode(agentRun: AgentRunResponse): AgentTreeNodeView {
    return {
        agentRunId: agentRun.agent_run_id,
        parentAgentRunId: agentRun.parent_agent_run_id ?? 'none',
        delegationId: agentRun.delegation_id ?? 'none',
        role: agentRun.role,
        status: agentRun.status,
        modelAlias: agentRun.model_alias,
        agentDefinition: `${agentRun.agent_definition_ref.agent_definition_id}@${agentRun.agent_definition_ref.agent_definition_version}`,
        trace: agentRun.trace_id,
        request: agentRun.request_id,
        lease: toLeaseView(agentRun.lease_ref),
        contextRefCount: String(agentRun.context_refs.length),
        childRefs: agentRun.child_agent_run_refs.map((ref) => toRefSummary(ref, 'agent ref unavailable')),
        artifactRefs: agentRun.artifact_refs.map(toArtifactRefView),
        auditRefs: agentRun.audit_refs.map(toAuditRefView),
        costRefs: agentRun.cost_refs.map(toCostRefView),
        startedAt: agentRun.started_at ?? 'not started',
        completedAt: agentRun.completed_at ?? 'not completed',
        nodeState: 'loaded',
    };
}

function toReferenceAgentNode(ref: RefSummaryView | { readonly ref_id: string; readonly ref_type: string; readonly scope_ref: string }, parentId: string): AgentTreeNodeView {
    const summary = 'ref_id' in ref ? toRefSummary(ref, 'agent ref unavailable') : ref;
    return {
        agentRunId: summary.id,
        parentAgentRunId: parentId,
        delegationId: summary.type === 'delegation' ? summary.id : 'none',
        role: 'unknown',
        status: 'reference-only',
        modelAlias: 'model unavailable',
        agentDefinition: summary.type,
        trace: 'trace unavailable',
        request: 'request unavailable',
        lease: emptyLease(),
        contextRefCount: '0',
        childRefs: [],
        artifactRefs: [],
        auditRefs: [],
        costRefs: [],
        startedAt: 'unavailable',
        completedAt: 'unavailable',
        nodeState: 'reference-only',
    };
}

function toEventTimelinePanel(
    result: ControlApiFetchResult<WorkflowEventsEnvelope> | undefined,
    events: readonly WorkflowEventResponse[],
): EventTimelinePanel {
    return {
        actionPolicy: resultPolicy(result, events.length > 0, 'Workflow events loaded from Control API.'),
        events: events.map(toTimelineEventView),
        nextCursor: result?.body?.next_cursor ?? 'none',
        emptyState: events.length === 0 ? 'No workflow events returned by Control API.' : 'Timeline uses refs only; raw prompts and artifact bodies are not requested.',
    };
}

function toTimelineEventView(event: WorkflowEventResponse): TimelineEventView {
    return {
        id: event.workflow_event_id,
        sequence: String(event.sequence_number),
        type: event.event_type,
        actor: `${event.actor_ref.actor_type}:${event.actor_ref.actor_ref}`,
        transition: `${event.state_transition.from_status ?? 'none'} → ${event.state_transition.to_status ?? 'none'}`,
        step: toRefSummary(event.step_ref, 'step ref unavailable'),
        agentRun: toRefSummary(event.agent_run_ref, 'agent run ref unavailable'),
        delegation: toRefSummary(event.delegation_ref, 'delegation ref unavailable'),
        toolCall: toRefSummary(event.tool_call_ref, 'tool call ref unavailable'),
        trace: toTraceRefView(event.trace_id, event.request_id, event.trace_context_ref),
        artifactRefs: event.artifact_refs.map(toArtifactRefView),
        auditRefs: event.audit_refs.map(toAuditRefView),
        costRefs: event.cost_refs.map(toCostRefView),
        idempotency: toIdempotencyView(event.idempotency),
        occurredAt: event.occurred_at,
    };
}

function toTraceCostPanel(
    costResult: ControlApiFetchResult<CostEventsEnvelope> | undefined,
    spendResult: ControlApiFetchResult<BudgetSpendEnvelope> | undefined,
    costEvents: readonly CostEventRecord[],
    budgetSpend: readonly BudgetSpendInspection[],
    workflow: WorkflowResponse | null,
    agentRun: AgentRunResponse | null,
    workflowEvents: readonly WorkflowEventResponse[],
    artifacts: readonly ArtifactMetadataResponse[],
): TraceCostPanel {
    const eventViews = costEvents.map(toTraceCostEventView);
    const budgetScopes = budgetSpend.map((spend) => toTraceBudgetScopeView(spend, workflow));
    const referencedCostEvents = uniqueCostRefs([
        ...(workflow?.cost_refs ?? []),
        ...(agentRun?.cost_refs ?? []),
        ...workflowEvents.flatMap((event) => event.cost_refs),
        ...artifacts.flatMap((artifact) => artifact.cost_refs),
    ]).map(toCostRefView);
    const hasData = eventViews.length > 0 || budgetScopes.length > 0 || referencedCostEvents.length > 0;
    return {
        actionPolicy: combinedResultPolicy(
            [costResult, spendResult],
            hasData,
            'Cost events and budget spend loaded from Control API.',
            'Cost events or budget spend are unavailable; showing empty trace-cost state.',
        ),
        events: eventViews,
        budgetScopes,
        totals: toTraceCostTotals(costEvents),
        visibility: toTraceCostVisibility(costEvents, budgetSpend, workflow),
        referencedCostEvents,
        emptyState: hasData ? 'Cost metadata loaded; no unrestricted database rows are exposed.' : 'No workflow/delegation/tool-class cost metadata returned.',
    };
}

function toTraceCostEventView(event: CostEventRecord): TraceCostEventView {
    const workflowId = event.aggregation_targets.workflow_run_id ?? 'workflow unavailable';
    const delegationId = event.aggregation_targets.delegation_id ?? 'delegation unavailable';
    const toolClass = event.aggregation_targets.tool_class ?? 'tool class unavailable';
    return {
        id: event.cost_event_id,
        eventType: event.event_type,
        trace: event.trace_id,
        request: event.request_id,
        workflowId,
        delegationId,
        toolClass,
        routeIntent: event.route_intent,
        budgetScope: event.budget_scope_id,
        modelAlias: event.model_alias,
        provider: event.provider_id ?? 'unassigned',
        status: event.attempt_status,
        decision: event.decision,
        amount: formatNullableMoney(event.actual.cost_amount, event.currency),
        estimatedAmount: formatNullableMoney(event.estimated.cost_amount, event.currency),
        inputTokens: formatNullableNumber(event.actual.input_tokens ?? event.estimated.input_tokens),
        outputTokens: formatNullableNumber(event.actual.output_tokens ?? event.estimated.output_tokens),
        denialReason: event.denial_reason ?? 'none',
        occurredAt: event.occurred_at,
        recordedAt: event.recorded_at,
    };
}

function toTraceBudgetScopeView(spend: BudgetSpendInspection, workflow: WorkflowResponse | null): TraceBudgetScopeView {
    return {
        id: spend.budget_scope_id,
        scope: spend.scope_type,
        owner: spend.owner_id,
        status: spend.status,
        spend: money(spend.spend_state.actual_spend_amount, spend.currency),
        reserved: money(spend.reservation_state.reserved_amount, spend.currency),
        hardCap: spend.limits.hard_cap_amount === null ? 'uncapped' : money(spend.limits.hard_cap_amount, spend.currency),
        requestCount: String(spend.spend_state.actual_request_count),
        decision: spend.decision,
        visibility: toBudgetVisibilityLabel(spend, workflow),
    };
}

function toTraceCostTotals(events: readonly CostEventRecord[]): TraceCostTotalsView {
    const currencies = uniqueStrings(events.map((event) => event.currency));
    const currency = currencies.length === 0 ? 'not reported' : currencies.length === 1 ? currencies[0] ?? 'not reported' : 'mixed';
    const actual = sumNullable(events.map((event) => event.actual.cost_amount));
    const estimated = sumNullable(events.map((event) => event.estimated.cost_amount));
    return {
        currency,
        actualAmount: actual === null ? 'not reported' : formatNullableMoney(actual, currency),
        estimatedAmount: estimated === null ? 'not reported' : formatNullableMoney(estimated, currency),
        requestCount: String(events.length),
    };
}

function toTraceCostVisibility(
    events: readonly CostEventRecord[],
    budgetSpend: readonly BudgetSpendInspection[],
    workflow: WorkflowResponse | null,
): TraceCostVisibilityView {
    return {
        workflowIds: uniqueStrings([
            ...(workflow === null ? [] : [workflow.workflow_id]),
            ...events.map((event) => event.aggregation_targets.workflow_run_id ?? ''),
            ...budgetSpend.filter((spend) => spend.scope_type === 'workflow').map((spend) => spend.owner_id),
        ]),
        delegationIds: uniqueStrings([
            ...events.map((event) => event.aggregation_targets.delegation_id ?? ''),
            ...budgetSpend.filter((spend) => spend.scope_type === 'delegation').map((spend) => spend.owner_id),
        ]),
        toolClasses: uniqueStrings([
            ...events.map((event) => event.aggregation_targets.tool_class ?? ''),
            ...budgetSpend.filter((spend) => spend.scope_type === 'tool_class').map((spend) => spend.owner_id),
        ]),
        budgetScopeIds: uniqueStrings([
            ...(workflow === null ? [] : [workflow.budget_scope_id]),
            ...events.map((event) => event.budget_scope_id),
            ...budgetSpend.map((spend) => spend.budget_scope_id),
        ]),
        modelAliases: uniqueStrings(events.map((event) => event.model_alias)),
    };
}

function toTraceArtifactPanel(
    result: ControlApiFetchResult<TaskArtifactsEnvelope> | undefined,
    artifacts: readonly ArtifactMetadataResponse[],
): TraceArtifactPanel {
    return {
        actionPolicy: resultPolicy(result, artifacts.length > 0, 'Artifact metadata loaded from Control API.'),
        metadata: artifacts.map(toTraceArtifactMetadataView),
        count: String(result?.body?.count ?? artifacts.length),
        emptyState: artifacts.length === 0 ? 'No artifact metadata returned; raw artifact bodies are never requested.' : 'Artifact panel contains metadata only.',
    };
}

function toTraceArtifactMetadataView(artifact: ArtifactMetadataResponse): TraceArtifactMetadataView {
    return {
        id: artifact.artifact_id,
        kind: artifact.artifact_kind,
        workflowId: artifact.workflow_id,
        taskId: artifact.task_id,
        delegationId: artifact.delegation_id ?? 'none',
        agentRunId: artifact.agent_run_id ?? 'none',
        toolCallId: artifact.tool_call_id ?? 'none',
        mediaType: artifact.media_type,
        sizeBytes: String(artifact.size_bytes),
        sha256: artifact.sha256,
        sensitivity: artifact.sensitivity_label,
        storage: `${artifact.storage_ref.storage_system}:${artifact.storage_ref.container_ref}`,
        source: toRecordLabel(artifact.source_ref, ['source_type', 'source_id'], 'source metadata'),
        retention: toRecordLabel(artifact.retention_policy, ['retained_until', 'delete_after_seconds', 'legal_hold'], 'retention metadata'),
        signedDownloadEligible: artifact.signed_download_eligible ? 'eligible by policy' : 'not eligible',
        acl: toRecordCountsLabel(artifact.acl_scope, 'acl metadata'),
        artifactRefs: artifact.related_artifact_refs.map(toArtifactRefView),
        auditRefs: artifact.audit_refs.map(toAuditRefView),
        costRefs: artifact.cost_refs.map(toCostRefView),
        createdAt: artifact.created_at,
        updatedAt: artifact.updated_at,
    };
}

function toTraceToolPanel(
    openApiPaths: readonly string[],
    workflowEvents: readonly WorkflowEventResponse[],
    artifacts: readonly ArtifactMetadataResponse[],
    costEvents: readonly CostEventRecord[],
    agentRun: AgentRunResponse | null,
    skills: readonly SkillResponse[],
): TraceToolPanel {
    const openApiRoutes = openApiPaths.filter((path) => /tool/iu.test(path));
    const decisions = [
        ...workflowEvents.flatMap(toToolDecisionsFromEvent),
        ...artifacts.flatMap(toToolDecisionsFromArtifact),
        ...costEvents.flatMap(toToolDecisionsFromCostEvent),
        ...(agentRun === null ? [] : toToolDecisionsFromAgentRun(agentRun)),
        ...skills.flatMap(toToolDecisionsFromSkill),
    ];
    const hasData = decisions.length > 0 || openApiRoutes.length > 0;
    return {
        actionPolicy: hasData
            ? { allowed: true, reason: 'Tool policy refs or tool-related routes are visible from Control API metadata.' }
            : { allowed: false, reason: 'No tool decision refs are visible yet; using safe fallback labels.' },
        decisions: dedupeToolDecisions(decisions),
        openApiRoutes,
        emptyState: hasData ? 'Tool panel uses decision refs only; arguments and outputs are withheld.' : 'No tool calls or tool classes returned by Control API.',
    };
}

function toToolDecisionsFromEvent(event: WorkflowEventResponse): readonly ToolDecisionView[] {
    if (event.tool_call_ref === null) return [];
    return [
        {
            id: `${event.workflow_event_id}:${event.tool_call_ref.ref_id}`,
            source: 'workflow-event',
            toolClass: event.tool_call_ref.ref_type,
            toolCallRef: event.tool_call_ref.ref_id,
            workflowId: event.workflow_id,
            agentRunId: event.agent_run_ref?.ref_id ?? 'agent run unavailable',
            delegationId: event.delegation_ref?.ref_id ?? 'delegation unavailable',
            decision: event.event_type === 'tool_call_decided' ? 'decision-ref-visible' : event.event_type,
            status: event.state_transition.to_status ?? 'status unavailable',
            riskTier: 'risk unavailable',
            reason: 'Workflow event exposes a tool_call_ref; raw arguments and results are withheld.',
            artifactRefs: event.artifact_refs.map(toArtifactRefView),
            auditRefs: event.audit_refs.map(toAuditRefView),
            costRefs: event.cost_refs.map(toCostRefView),
        },
    ];
}

function toToolDecisionsFromArtifact(artifact: ArtifactMetadataResponse): readonly ToolDecisionView[] {
    if (artifact.tool_call_id === null) return [];
    return [
        {
            id: `${artifact.artifact_id}:${artifact.tool_call_id}`,
            source: 'artifact-metadata',
            toolClass: artifact.artifact_kind === 'tool_result' ? 'tool_result' : 'tool artifact',
            toolCallRef: artifact.tool_call_id,
            workflowId: artifact.workflow_id,
            agentRunId: artifact.agent_run_id ?? 'agent run unavailable',
            delegationId: artifact.delegation_id ?? 'delegation unavailable',
            decision: 'artifact-recorded',
            status: 'metadata-only',
            riskTier: 'risk unavailable',
            reason: 'Artifact metadata references a tool call; artifact body and signed URLs are withheld.',
            artifactRefs: artifact.related_artifact_refs.map(toArtifactRefView),
            auditRefs: artifact.audit_refs.map(toAuditRefView),
            costRefs: artifact.cost_refs.map(toCostRefView),
        },
    ];
}

function toToolDecisionsFromCostEvent(event: CostEventRecord): readonly ToolDecisionView[] {
    const toolClass = event.aggregation_targets.tool_class;
    if (toolClass === null || toolClass === undefined || toolClass.trim() === '') return [];
    return [
        {
            id: `${event.cost_event_id}:${toolClass}`,
            source: 'cost-event',
            toolClass,
            toolCallRef: 'tool call ref unavailable',
            workflowId: event.aggregation_targets.workflow_run_id ?? 'workflow unavailable',
            agentRunId: 'agent run unavailable',
            delegationId: event.aggregation_targets.delegation_id ?? 'delegation unavailable',
            decision: event.decision,
            status: event.attempt_status,
            riskTier: 'risk unavailable',
            reason: event.denial_reason ?? 'Cost aggregation target exposes tool_class.',
            artifactRefs: [],
            auditRefs: [],
            costRefs: [
                {
                    id: event.cost_event_id,
                    budgetScope: event.budget_scope_id,
                    phase: event.event_type,
                    recordedAt: event.recorded_at,
                },
            ],
        },
    ];
}

function toToolDecisionsFromAgentRun(agentRun: AgentRunResponse): readonly ToolDecisionView[] {
    return [
        ...agentRun.allowed_tool_refs.map((ref, index) => toToolDecisionFromPolicyRef(ref, index, 'agent-run-policy', 'allowed', agentRun.workflow_id, agentRun.agent_run_id, agentRun.delegation_id)),
        ...agentRun.disallowed_tool_refs.map((ref, index) => toToolDecisionFromPolicyRef(ref, index, 'agent-run-policy', 'denied', agentRun.workflow_id, agentRun.agent_run_id, agentRun.delegation_id)),
    ];
}

function toToolDecisionsFromSkill(skill: SkillResponse): readonly ToolDecisionView[] {
    return [
        ...skill.allowed_tool_refs.map((ref, index) => toToolDecisionFromPolicyRef(ref, index, 'skill-policy', 'allowed', 'workflow unavailable', 'agent run unavailable', 'delegation unavailable', skill.skill_definition_id)),
        ...skill.disallowed_tool_refs.map((ref, index) => toToolDecisionFromPolicyRef(ref, index, 'skill-policy', 'denied', 'workflow unavailable', 'agent run unavailable', 'delegation unavailable', skill.skill_definition_id)),
    ];
}

function toToolDecisionFromPolicyRef(
    ref: Readonly<Record<string, unknown>>,
    index: number,
    source: string,
    decision: string,
    workflowId: string,
    agentRunId: string,
    delegationId: string | null,
    scope = 'agent-run',
): ToolDecisionView {
    const toolLabel = toolRefLabel(ref);
    return {
        id: `${source}:${scope}:${decision}:${toolLabel}:${index}`,
        source,
        toolClass: toolLabel,
        toolCallRef: 'policy ref only',
        workflowId,
        agentRunId,
        delegationId: delegationId ?? 'delegation unavailable',
        decision,
        status: 'policy-visible',
        riskTier: toolRefRiskTier(ref),
        reason: 'Control API exposes tool policy metadata only.',
        artifactRefs: [],
        auditRefs: [],
        costRefs: [],
    };
}

function toSkillTraceView(skill: SkillResponse): SkillTraceView {
    return {
        id: skill.skill_definition_id,
        version: skill.skill_version_id,
        status: skill.status,
        owner: toRecordLabel(skill.owner_ref, ['owner_type', 'owner_id'], 'owner metadata'),
        modelAliases: skill.allowed_model_aliases,
        allowedToolCount: String(skill.allowed_tool_refs.length),
        disallowedToolCount: String(skill.disallowed_tool_refs.length),
        instructionTemplateRefCount: String(skill.instruction_template_refs.length),
        approvalRequired: recordBoolean(skill.approval_policy, 'approval_required') ? 'required' : 'not required',
        rollout: toRecordLabel(skill.rollout_policy, ['rollout_state'], 'rollout metadata'),
        productionEnabled: recordBoolean(skill.rollout_policy, 'production_enabled'),
        trace: skill.trace_id,
        request: skill.request_id,
    };
}

function resultPolicy(result: ControlApiFetchResult<unknown> | undefined, hasData: boolean, okReason: string): ActionPolicy {
    if (result === undefined) {
        return { allowed: false, reason: 'Control API endpoint missing from snapshot.' };
    }
    if (!result.ok) {
        return { allowed: false, reason: result.error ?? `HTTP ${result.status || 'offline'}` };
    }
    return hasData
        ? { allowed: true, reason: okReason }
        : { allowed: false, reason: 'Control API endpoint returned an empty metadata set.' };
}

function combinedResultPolicy(
    results: readonly (ControlApiFetchResult<unknown> | undefined)[],
    hasData: boolean,
    okReason: string,
    emptyReason: string,
): ActionPolicy {
    const failures = results.filter((result) => result === undefined || !result.ok);
    if (failures.length > 0 && !hasData) {
        return { allowed: false, reason: emptyReason };
    }
    if (failures.length > 0) {
        return { allowed: true, reason: `${okReason} Some endpoints failed closed.` };
    }
    return hasData ? { allowed: true, reason: okReason } : { allowed: false, reason: emptyReason };
}

function toRefSummary(
    ref: { readonly ref_id: string; readonly ref_type: string; readonly scope_ref: string } | null | undefined,
    fallback: string,
): RefSummaryView {
    if (ref === null || ref === undefined) return emptyRef(fallback);
    return {
        id: ref.ref_id,
        type: ref.ref_type,
        scope: ref.scope_ref,
    };
}

function toArtifactRefView(ref: {
    readonly artifact_id: string;
    readonly artifact_kind: string;
    readonly data_class: string;
    readonly sha256: string;
    readonly size_bytes: number;
}): ArtifactRefView {
    return {
        id: ref.artifact_id,
        kind: ref.artifact_kind,
        dataClass: ref.data_class,
        sha256: ref.sha256,
        sizeBytes: String(ref.size_bytes),
    };
}

function toAuditRefView(ref: { readonly audit_event_id: string; readonly audit_stream: string; readonly recorded_at: string }): AuditRefView {
    return {
        id: ref.audit_event_id,
        stream: ref.audit_stream,
        recordedAt: ref.recorded_at,
    };
}

function toCostRefView(ref: { readonly cost_event_id: string; readonly budget_scope_id: string; readonly cost_phase: string; readonly recorded_at: string }): CostRefView {
    return {
        id: ref.cost_event_id,
        budgetScope: ref.budget_scope_id,
        phase: ref.cost_phase,
        recordedAt: ref.recorded_at,
    };
}

function toTraceRefView(
    traceId: string,
    requestId: string,
    traceContext: { readonly trace_context_id: string; readonly span_id: string } | null | undefined,
): TraceRefView {
    return {
        traceId,
        requestId,
        traceContextId: traceContext?.trace_context_id ?? 'trace context unavailable',
        spanId: traceContext?.span_id ?? 'span unavailable',
    };
}

function toStepRefView(step: {
    readonly step_id: string;
    readonly step_type: string;
    readonly step_status: string;
    readonly agent_run_id: string | null;
    readonly delegation_id: string | null;
}): StepRefView {
    return {
        id: step.step_id,
        type: step.step_type,
        status: step.step_status,
        agentRunId: step.agent_run_id ?? 'none',
        delegationId: step.delegation_id ?? 'none',
    };
}

function toLeaseView(lease: {
    readonly lease_id: string | null;
    readonly lease_owner_ref: string | null;
    readonly heartbeat_at: string | null;
    readonly expires_at: string | null;
    readonly lease_status?: string;
}): LeaseView {
    return {
        id: lease.lease_id ?? 'none',
        owner: lease.lease_owner_ref ?? 'none',
        status: lease.lease_status ?? (lease.lease_id === null ? 'none' : 'active'),
        heartbeatAt: lease.heartbeat_at ?? 'none',
        expiresAt: lease.expires_at ?? 'none',
    };
}

function toIdempotencyView(ref: { readonly idempotency_key: string; readonly scope: string; readonly dedupe_ref: string; readonly expires_at: string }): IdempotencyView {
    return {
        key: ref.idempotency_key,
        scope: ref.scope,
        dedupeRef: ref.dedupe_ref,
        expiresAt: ref.expires_at,
    };
}

function toFailureRefSummary(failure: Readonly<Record<string, unknown>> | null): string {
    if (failure === null) return 'none';
    return [recordText(failure, 'failure_type'), recordText(failure, 'failure_code'), recordText(failure, 'failure_ref')]
        .filter((value) => value !== 'unavailable')
        .join(': ') || 'failure ref';
}

function toBudgetVisibilityLabel(spend: BudgetSpendInspection, workflow: WorkflowResponse | null): string {
    if (workflow !== null && spend.budget_scope_id === workflow.budget_scope_id) return `workflow budget ${workflow.workflow_id}`;
    if (spend.scope_type === 'workflow' || spend.scope_type === 'delegation' || spend.scope_type === 'tool_class') {
        return `${spend.scope_type} ${spend.owner_id}`;
    }
    return `scope ${spend.scope_type}`;
}

function toRecordLabel(record: Readonly<Record<string, unknown>>, fields: readonly string[], fallback: string): string {
    const values = fields
        .map((field) => recordText(record, field))
        .filter((value) => value !== 'unavailable');
    return values.length === 0 ? fallback : values.join(' · ');
}

function toRecordCountsLabel(record: Readonly<Record<string, unknown>>, fallback: string): string {
    const entries = Object.entries(record)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => `${key}:${(value as readonly unknown[]).length}`);
    return entries.length === 0 ? fallback : entries.join(' · ');
}

function recordText(record: Readonly<Record<string, unknown>>, field: string): string {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return 'unavailable';
}

function recordBoolean(record: Readonly<Record<string, unknown>>, field: string): boolean {
    return record[field] === true;
}

function toolRefLabel(ref: Readonly<Record<string, unknown>>): string {
    return recordText(ref, 'tool_definition_id') !== 'unavailable'
        ? recordText(ref, 'tool_definition_id')
        : recordText(ref, 'tool_class') !== 'unavailable'
          ? recordText(ref, 'tool_class')
          : recordText(ref, 'operation_ref') !== 'unavailable'
            ? recordText(ref, 'operation_ref')
            : 'tool policy ref';
}

function toolRefRiskTier(ref: Readonly<Record<string, unknown>>): string {
    const risk = recordText(ref, 'risk_tier');
    return risk === 'unavailable' ? 'risk unavailable' : risk;
}

function dedupeToolDecisions(decisions: readonly ToolDecisionView[]): readonly ToolDecisionView[] {
    const seen = new Set<string>();
    return decisions.filter((decision) => {
        const key = `${decision.source}:${decision.id}:${decision.decision}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function uniqueCostRefs(refs: readonly { readonly cost_event_id: string; readonly budget_scope_id: string; readonly cost_phase: string; readonly recorded_at: string }[]): readonly {
    readonly cost_event_id: string;
    readonly budget_scope_id: string;
    readonly cost_phase: string;
    readonly recorded_at: string;
}[] {
    const seen = new Set<string>();
    return refs.filter((ref) => {
        if (seen.has(ref.cost_event_id)) return false;
        seen.add(ref.cost_event_id);
        return true;
    });
}

function uniqueStrings(values: readonly string[]): readonly string[] {
    return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function sumNullable(values: readonly (number | null)[]): number | null {
    const reported = values.filter((value): value is number => typeof value === 'number');
    if (reported.length === 0) return null;
    return reported.reduce((total, value) => total + value, 0);
}

function formatNullableMoney(amount: number | null, currency: string): string {
    return amount === null ? 'not reported' : money(amount, currency);
}

function formatNullableNumber(value: number | null): string {
    return value === null ? 'not reported' : String(value);
}

function emptyRef(label: string): RefSummaryView {
    return { id: label, type: 'none', scope: 'none' };
}

function emptyTrace(): TraceRefView {
    return {
        traceId: 'trace unavailable',
        requestId: 'request unavailable',
        traceContextId: 'trace context unavailable',
        spanId: 'span unavailable',
    };
}

function emptyStep(): StepRefView {
    return {
        id: 'step unavailable',
        type: 'none',
        status: 'unavailable',
        agentRunId: 'none',
        delegationId: 'none',
    };
}

function emptyLease(): LeaseView {
    return {
        id: 'none',
        owner: 'none',
        status: 'none',
        heartbeatAt: 'none',
        expiresAt: 'none',
    };
}

function emptyIdempotency(): IdempotencyView {
    return {
        key: 'idempotency unavailable',
        scope: 'none',
        dedupeRef: 'none',
        expiresAt: 'none',
    };
}

function asReadonlyArray<T>(value: readonly T[] | null | undefined): readonly T[] {
    return Array.isArray(value) ? value : [];
}

function fetchResultLabel(result: ControlApiFetchResult<unknown>): string {
    return result.ok ? 'ok' : `${result.status || 'offline'} ${result.error ?? 'unavailable'}`;
}

function toGateErrorText(entry: BifrostValidationError): string {
    const code = entry.error?.code ?? entry.code;
    const message = entry.error?.message ?? entry.message;
    return [code, message].filter((value): value is string => typeof value === 'string' && value.length > 0).join(': ');
}

function renderHealth(panel: HealthPanel): string {
    return `<section class="panel health">
      <div><p class="eyebrow">Gateway health / readiness</p><h2>${escapeHtml(panel.service)}</h2></div>
      <strong class="status ${escapeHtml(panel.status)}">${escapeHtml(panel.status)}</strong>
      <dl>${panel.checks.map((check) => `<div><dt>${escapeHtml(check.key)}</dt><dd>${escapeHtml(check.value)}</dd></div>`).join('')}</dl>
    </section>`;
}

function renderRouting(panel: RoutingPanel): string {
    return `<section class="panel">
      <p class="eyebrow">Model aliases / provider candidates / gate state</p>
      <h2>${escapeHtml(panel.registryVersion)} <span>${panel.productionEnabled ? 'production enabled' : 'production disabled'}</span></h2>
      <p class="route-version">${escapeHtml(panel.routeConfigVersion)}</p>
      <div class="alias-grid">${panel.aliases.map(renderAlias).join('') || '<p class="empty">Registry unavailable.</p>'}</div>
      ${panel.gateErrors.length > 0 ? `<ul class="warnings">${panel.gateErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

function renderAlias(alias: AliasView): string {
    return `<article class="alias-card">
      <h3>${escapeHtml(alias.alias)}</h3>
      <p>${escapeHtml(alias.lifecycle)} · gate ${escapeHtml(alias.gateStatus)} · route ${alias.routeAllowed ? 'allowed' : 'blocked'}</p>
      <ul>${alias.candidates.map((candidate) => `<li><b>${escapeHtml(candidate.provider)}</b> ${escapeHtml(candidate.model)} <span>${escapeHtml(candidate.region)}</span></li>`).join('')}</ul>
    </article>`;
}

function renderVirtualKeys(panel: VirtualKeysPanel): string {
    return `<section class="panel">
      <p class="eyebrow">Virtual keys / rotation / revocation</p>
      ${renderActionPolicy(panel.actionPolicy)}
      ${renderTable(['id', 'prefix', 'status', 'principal', 'project', 'budget', 'rotation', 'revocation'], panel.records.map((record) => [record.id, record.prefix, record.status, record.principal, record.project, record.budgetScope, record.rotation, record.revocation]))}
    </section>`;
}

function renderBudgets(panel: BudgetsPanel): string {
    return `<section class="panel">
      <p class="eyebrow">Budgets / spend / cost events</p>
      ${renderActionPolicy(panel.actionPolicy)}
      ${renderTable(['scope', 'owner', 'spend', 'hard cap', 'requests', 'decision'], panel.spend.map((row) => [row.id, row.owner, row.spend, row.hardCap, row.requestCount, row.decision]))}
      ${renderTable(['event', 'trace', 'model', 'provider', 'status', 'decision', 'amount', 'denial'], panel.costEvents.map((row) => [row.id, row.trace, row.modelAlias, row.provider, row.status, row.decision, row.amount, row.denialReason]))}
    </section>`;
}

function renderAudit(panel: AuditPanel): string {
    return `<section class="panel">
      <p class="eyebrow">Audit events / denials</p>
      ${renderActionPolicy(panel.actionPolicy)}
      <h3>Denials</h3>
      ${renderTable(['id', 'source', 'action', 'outcome', 'occurred'], panel.denials.map((row) => [row.id, row.source, row.action, row.outcome, row.occurredAt]))}
    </section>`;
}

function renderBreakGlass(panel: BreakGlassPanel): string {
    return `<section class="panel break-glass">
      <p class="eyebrow">Break-glass pending / disabled</p>
      <h2>${escapeHtml(panel.status)}</h2>
      <p>${escapeHtml(panel.reason)}</p>
      ${renderActionPolicy(panel.actionPolicy)}
    </section>`;
}

function renderActionPolicy(policy: ActionPolicy): string {
    return `<p class="action ${policy.allowed ? 'allowed' : 'disabled'}">${policy.allowed ? 'Actions enabled' : 'Actions disabled'} — ${escapeHtml(policy.reason)}</p>`;
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    if (rows.length === 0) return '<p class="empty">No Control API records returned.</p>';
    return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
}

function money(amount: number, currency: string): string {
    return `${currency} ${amount.toFixed(4)}`;
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function portalCss(): string {
    return `
@font-face { font-family: ui-serif; src: local("Georgia"); }
:root { color-scheme: dark; --bg:#11110f; --panel:#1c1a16; --ink:#f4ead8; --muted:#b8aa92; --line:#403a30; --amber:#ffb000; --red:#e5533d; --green:#6bd18d; }
* { box-sizing: border-box; }
body { margin:0; background: radial-gradient(circle at 18% -10%, #48310e 0, transparent 32rem), linear-gradient(135deg, #11110f, #17130d 55%, #0b0b0a); color:var(--ink); font: 15px/1.55 Georgia, "Times New Roman", serif; }
.shell { width:min(1180px, calc(100% - 32px)); margin:0 auto; padding:48px 0; }
.hero { border:1px solid var(--line); padding:36px; margin-bottom:18px; background:rgba(28,26,22,.82); box-shadow: 0 30px 80px rgba(0,0,0,.35); }
.eyebrow { margin:0 0 8px; color:var(--amber); text-transform:uppercase; letter-spacing:.16em; font-size:12px; }
h1 { max-width:760px; margin:0; font-size: clamp(42px, 7vw, 86px); line-height:.92; letter-spacing:-.06em; }
h2 { margin:0 0 12px; font-size:30px; letter-spacing:-.03em; }
h2 span, .route-version, .lede, .empty, dd { color:var(--muted); }
.hero-meta { display:flex; gap:12px; flex-wrap:wrap; margin-top:22px; color:var(--muted); }
.hero-meta span, .status, .action { border:1px solid var(--line); padding:7px 10px; background:#15130f; }
.panel { margin:18px 0; border:1px solid var(--line); padding:24px; background:rgba(28,26,22,.88); }
.health { display:grid; grid-template-columns: 1fr auto; gap:18px; }
.status.ok, .allowed { color:var(--green); } .status.degraded, .status.unknown, .disabled { color:var(--red); }
dl { grid-column:1/-1; display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:8px; margin:0; }
dt { color:var(--amber); font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
dd { margin:0; }
.alias-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px; }
.alias-card { border:1px solid var(--line); padding:16px; background:#15130f; }
.alias-card h3 { margin:0 0 6px; font-size:23px; }
.alias-card ul, .warnings { padding-left:18px; color:var(--muted); }
table { width:100%; border-collapse:collapse; margin:14px 0; overflow:hidden; }
th, td { border-bottom:1px solid var(--line); padding:10px 8px; text-align:left; vertical-align:top; }
th { color:var(--amber); font-size:12px; text-transform:uppercase; letter-spacing:.12em; }
.break-glass { border-color:#6f2e22; background:linear-gradient(135deg, rgba(111,46,34,.28), rgba(28,26,22,.9)); }
`;
}
