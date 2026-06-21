import { useQuery } from '@tanstack/react-query';
import { operationalSnapshotQueryOptions, type EndpointStatus } from '../../features/operations-snapshot-query.js';
import type {
  AuditPanel,
  BudgetsPanel,
  BreakGlassPanel,
  HealthPanel,
  RoutingPanel,
  VirtualKeysPanel,
} from '../../features/operational-views.js';

export function OperationsHome() {
  const snapshotQuery = useQuery(operationalSnapshotQueryOptions());

  if (snapshotQuery.isPending) {
    return (
      <section className="ops-home" aria-busy="true">
        <div className="ops-home__lede">
          <p className="eyebrow">Track 1 command board</p>
          <h1>Reading control plane…</h1>
          <p>Fetching gateway health, registry posture, key custody, and budget state from the Control API.</p>
        </div>
      </section>
    );
  }

  if (snapshotQuery.isError) {
    return (
      <section className="ops-home" role="alert">
        <div className="ops-home__lede">
          <p className="eyebrow">Control plane unreachable</p>
          <h1>Snapshot failed.</h1>
          <p>{snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'The Control API snapshot could not be read.'}</p>
        </div>
      </section>
    );
  }

  const { model, endpoints, generatedAt } = snapshotQuery.data;

  return (
    <section className="ops-home" aria-labelledby="ops-home-title">
      <div className="ops-home__lede">
        <p className="eyebrow">Track 1 command board</p>
        <h1 id="ops-home-title">Gateway command status, without secrets.</h1>
        <p>
          Every panel is mapped from Control API response shapes. Secret-bearing routes stay fail-closed and
          render their HTTP status instead of data. No provider keys, database handles, or Bifrost-admin
          controls are exposed in the browser.
        </p>
        <div className="ops-home__meta">
          <span>{model.controlApiBaseUrl}</span>
          <span>snapshot {generatedAt}</span>
        </div>
        <a className="ops-home__trace-link" href="/trace">
          Open Trace lab <span>{model.taskTrace.status}</span>
        </a>
      </div>

      <EndpointStrip endpoints={endpoints} />

      <div className="ops-panels">
        <HealthCard panel={model.health} />
        <RoutingCard panel={model.routing} />
        <VirtualKeysCard panel={model.virtualKeys} />
        <BudgetsCard panel={model.budgets} />
        <AuditCard panel={model.audit} />
        <BreakGlassCard panel={model.breakGlass} />
      </div>
    </section>
  );
}

function EndpointStrip({ endpoints }: { readonly endpoints: readonly EndpointStatus[] }) {
  return (
    <ul className="endpoint-strip" aria-label="Control API endpoint status">
      {endpoints.map((endpoint) => (
        <li className={`endpoint endpoint--${statusTone(endpoint)}`} key={endpoint.key}>
          <code>{endpoint.path}</code>
          <span>{endpoint.status === 0 ? 'offline' : endpoint.status}</span>
        </li>
      ))}
    </ul>
  );
}

function HealthCard({ panel }: { readonly panel: HealthPanel }) {
  return (
    <article className="panel">
      <header className="panel__head">
        <p className="eyebrow">Gateway health / readiness</p>
        <h2>{panel.service}</h2>
        <span className={`pill pill--${panel.status === 'ok' ? 'ok' : panel.status === 'degraded' ? 'warn' : 'muted'}`}>
          {panel.status}
        </span>
      </header>
      <p className="panel__note">readiness: {panel.readiness}</p>
      <dl className="kv">
        {panel.checks.map((check) => (
          <div key={check.key}>
            <dt>{check.key}</dt>
            <dd>{check.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function RoutingCard({ panel }: { readonly panel: RoutingPanel }) {
  return (
    <article className="panel panel--wide">
      <header className="panel__head">
        <p className="eyebrow">Registry route posture</p>
        <h2>{panel.registryVersion}</h2>
        <span className={`pill pill--${panel.productionEnabled ? 'warn' : 'ok'}`}>
          production {panel.productionEnabled ? 'enabled' : 'disabled'}
        </span>
      </header>
      <p className="panel__note">route config: {panel.routeConfigVersion}</p>
      <ul className="alias-list">
        {panel.aliases.map((alias) => (
          <li className="alias" key={alias.alias}>
            <div className="alias__head">
              <strong>{alias.alias}</strong>
              <span className="tag">{alias.lifecycle}</span>
              <span className={`tag ${alias.routeAllowed ? 'tag--warn' : 'tag--ok'}`}>
                route {alias.routeAllowed ? 'allowed' : 'blocked'}
              </span>
              <span className="tag">gate {alias.gateStatus}</span>
            </div>
            <div className="alias__candidates">
              {alias.candidates.map((candidate) => (
                <span className="candidate" key={candidate.id}>
                  {candidate.provider}/{candidate.model} · {candidate.region} · approval {candidate.manualApproval}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {panel.gateErrors.length > 0 ? (
        <ul className="gate-errors">
          {panel.gateErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function VirtualKeysCard({ panel }: { readonly panel: VirtualKeysPanel }) {
  return (
    <article className="panel">
      <header className="panel__head">
        <p className="eyebrow">Virtual key custody</p>
        <h2>{panel.records.length} keys</h2>
        <ActionPill policy={panel.actionPolicy} />
      </header>
      {panel.records.length === 0 ? (
        <p className="panel__empty">{panel.actionPolicy.reason}</p>
      ) : (
        <ul className="record-list">
          {panel.records.map((record) => (
            <li key={record.id}>
              <strong>{record.prefix}…</strong>
              <span>{record.status}</span>
              <small>{record.principal} · {record.project} · rotation {record.rotation}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function BudgetsCard({ panel }: { readonly panel: BudgetsPanel }) {
  return (
    <article className="panel">
      <header className="panel__head">
        <p className="eyebrow">Budget pressure</p>
        <h2>{panel.spend.length} scopes</h2>
        <ActionPill policy={panel.actionPolicy} />
      </header>
      {panel.spend.length === 0 && panel.costEvents.length === 0 ? (
        <p className="panel__empty">{panel.actionPolicy.reason}</p>
      ) : (
        <ul className="record-list">
          {panel.spend.map((spend) => (
            <li key={spend.id}>
              <strong>{spend.scope}</strong>
              <span>{spend.spend} / {spend.hardCap}</span>
              <small>{spend.owner} · {spend.requestCount} req · {spend.decision}</small>
            </li>
          ))}
          {panel.costEvents.map((event) => (
            <li key={event.id}>
              <strong>{event.modelAlias}</strong>
              <span>{event.amount}</span>
              <small>{event.provider} · {event.status} · {event.decision}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function AuditCard({ panel }: { readonly panel: AuditPanel }) {
  return (
    <article className="panel">
      <header className="panel__head">
        <p className="eyebrow">Audit / denial trail</p>
        <h2>{panel.events.length} events</h2>
        <ActionPill policy={panel.actionPolicy} />
      </header>
      {panel.events.length === 0 ? (
        <p className="panel__empty">{panel.actionPolicy.reason}</p>
      ) : (
        <ul className="record-list">
          {panel.events.map((event) => (
            <li key={`${event.source}-${event.id}`}>
              <strong>{event.action}</strong>
              <span>{event.outcome}</span>
              <small>{event.source} · {event.occurredAt}</small>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function BreakGlassCard({ panel }: { readonly panel: BreakGlassPanel }) {
  return (
    <article className="panel">
      <header className="panel__head">
        <p className="eyebrow">Break-glass</p>
        <h2>{panel.status}</h2>
        <ActionPill policy={panel.actionPolicy} />
      </header>
      <p className="panel__empty">{panel.reason}</p>
    </article>
  );
}

function ActionPill({ policy }: { readonly policy: { readonly allowed: boolean; readonly reason: string } }) {
  return (
    <span className={`pill pill--${policy.allowed ? 'ok' : 'muted'}`} title={policy.reason}>
      {policy.allowed ? 'actions live' : 'fail-closed'}
    </span>
  );
}

function statusTone(endpoint: EndpointStatus): 'ok' | 'guard' | 'fail' {
  if (endpoint.ok) return 'ok';
  if (endpoint.status === 401 || endpoint.status === 403 || endpoint.status === 409) return 'guard';
  return 'fail';
}
