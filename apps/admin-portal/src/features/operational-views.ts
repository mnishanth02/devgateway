import type {
    CostEventRecord,
} from '../../../../packages/shared-types/src/gateway-control.ts';
import type {
    VirtualKeyPublicRecord,
} from '../../../control-api/src/routes/virtual-keys.ts';
import type { BudgetSpendInspection } from '../../../control-api/src/routes/budgets.ts';

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

const secretFieldPattern = /(?:one[_-]?time[_-]?secret|raw[_-]?secret|provider[_-]?(?:key|secret|token)|api[_-]?key|key[_-]?hash[_-]?ref|key[_-]?fingerprint|secret|token)/iu;

export function buildOperationalViewModel(
    snapshot: OperationalControlApiSnapshot,
    options: { readonly generatedAt: string; readonly controlApiBaseUrl: string },
): OperationalViewModel {
    const productionRoutes = snapshot.readiness.body?.checks?.productionRoutes ?? 'unknown';
    const routePolicy = actionPolicyFromControlApi(productionRoutes);
    const openApiPaths = Object.keys(snapshot.openapi.body?.paths ?? {});
    const costEvents = snapshot.costEvents.body?.cost_events ?? [];
    const virtualKeys = (snapshot.virtualKeys.body?.virtual_keys ?? []).map(toVirtualKeyView);

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
            spend: (snapshot.budgetSpend.body?.spend ?? []).map(toBudgetSpendView),
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
