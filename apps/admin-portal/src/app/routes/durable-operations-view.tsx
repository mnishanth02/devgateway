import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  cancelTask,
  requestArtifactSignedAccess,
  resolveManualReview,
  retryWorkflow,
  type ControlApiMutationBody,
} from '../../features/control-api-client.js';
import { operationalSnapshotQueryKey, operationalSnapshotQueryOptions } from '../../features/operations-snapshot-query.js';
import type {
  ArtifactLifecyclePanel,
  DurableControlView,
  DurableOperationsPanel,
  ManualReviewItemView,
  ManualReviewPanel,
  OutboxStatusView,
} from '../../features/operational-views.js';

type DurableAction =
  | { readonly kind: 'retry'; readonly control: DurableControlView }
  | { readonly kind: 'cancel'; readonly control: DurableControlView }
  | { readonly kind: 'manual-review'; readonly item: ManualReviewItemView }
  | { readonly kind: 'signed-access'; readonly panel: ArtifactLifecyclePanel; readonly control: DurableControlView };

interface ControlMutationState {
  readonly data: { readonly ok: boolean; readonly path: string; readonly status: number; readonly error?: string } | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly isIdle: boolean;
  readonly isPending: boolean;
}

export function DurableOperationsView() {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(operationalSnapshotQueryOptions());
  const actionMutation = useMutation({
    mutationFn: async (action: DurableAction) => executeDurableAction(action),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: operationalSnapshotQueryKey });
    },
  });

  if (snapshotQuery.isPending) {
    return (
      <section className="trace-view trace-view--state" aria-busy="true">
        <div className="trace-state-panel">
          <p className="eyebrow">Phase 9 durable operations</p>
          <h1>Checking durable runtime…</h1>
          <p>Loading retry, cancellation, manual-review, lease, outbox, and artifact lifecycle metadata.</p>
        </div>
      </section>
    );
  }

  if (snapshotQuery.isError) {
    return (
      <section className="trace-view trace-view--state" role="alert">
        <div className="trace-state-panel trace-state-panel--error">
          <p className="eyebrow">Durable operations fail-closed</p>
          <h1>Durable snapshot failed.</h1>
          <p>{snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'The durable operation snapshot could not be read.'}</p>
        </div>
      </section>
    );
  }

  const panel = snapshotQuery.data.model.durableOperations;

  return (
    <section className="trace-view durable-view" aria-labelledby="durable-operations-title">
      <header className="trace-hero">
        <div className="trace-hero__content">
          <p className="eyebrow">Phase 9 / durable operations</p>
          <h1 id="durable-operations-title">Durable operations, sealed by default.</h1>
          <p>
            Retry, cancellation, review resolution, stuck lease, outbox backlog, and artifact lifecycle surfaces use
            Control API metadata only. Signed access grants and object bodies are never displayed.
          </p>
          <div className="trace-chip-row">
            <span className={`trace-chip trace-chip--${panel.actionPolicy.allowed ? 'ok' : 'muted'}`}>
              {panel.actionPolicy.allowed ? 'metadata ready' : 'fail-closed'}
            </span>
            <span className="trace-chip">workflow {panel.workflowId}</span>
            <span className="trace-chip">task {panel.taskId}</span>
          </div>
        </div>
        <div className="trace-hero__readout">
          <Readout label="retry endpoint" value={panel.retry.endpoint} />
          <Readout label="cancel endpoint" value={panel.cancel.endpoint} />
          <Readout label="artifact" value={panel.artifactLifecycle.artifactId} />
        </div>
      </header>

      <ActionResult mutation={actionMutation} />

      <div className="trace-layout">
        <div className="trace-layout__main">
          <ControlPanel
            busy={actionMutation.isPending}
            onAction={(action) => actionMutation.mutate(action)}
            panel={panel}
          />
          <ManualReviewPanelView
            busy={actionMutation.isPending}
            onResolve={(item) => actionMutation.mutate({ kind: 'manual-review', item })}
            panel={panel.manualReview}
          />
          <LeasePanel panel={panel} />
        </div>

        <aside className="trace-layout__side" aria-label="Durable metadata panels">
          <OutboxPanel panel={panel} />
          <ArtifactLifecyclePanelView
            busy={actionMutation.isPending}
            onSignedAccess={(control) => actionMutation.mutate({ kind: 'signed-access', panel: panel.artifactLifecycle, control })}
            panel={panel}
          />
        </aside>
      </div>
    </section>
  );
}

function ControlPanel({
  busy,
  onAction,
  panel,
}: {
  readonly busy: boolean;
  readonly onAction: (action: DurableAction) => void;
  readonly panel: DurableOperationsPanel;
}) {
  return (
    <article className="trace-panel trace-panel--wide" aria-labelledby="durable-controls-title">
      <PanelHeader eyebrow="Retry / cancel controls" title="Durable controls" titleId="durable-controls-title" />
      <div className="durable-card-grid durable-card-grid--two">
        <ControlCard busy={busy} control={panel.retry} onClick={() => onAction({ kind: 'retry', control: panel.retry })} />
        <ControlCard busy={busy} control={panel.cancel} onClick={() => onAction({ kind: 'cancel', control: panel.cancel })} />
      </div>
    </article>
  );
}

function ControlCard({ busy, control, onClick }: { readonly busy: boolean; readonly control: DurableControlView; readonly onClick: () => void }) {
  return (
    <section className="trace-inset">
      <h3>{control.label}</h3>
      <MetadataList
        items={[
          ['target', control.targetId],
          ['method', control.method],
          ['endpoint', control.endpoint],
          ['trace', control.traceId],
          ['policy', control.policyVersion],
          ['registry', control.registryVersion],
        ]}
      />
      <button disabled={busy || !control.available} onClick={onClick} type="button">
        {control.label} via Control API
      </button>
      <p className="trace-empty">{control.reason}</p>
    </section>
  );
}

function ManualReviewPanelView({
  busy,
  onResolve,
  panel,
}: {
  readonly busy: boolean;
  readonly onResolve: (item: ManualReviewItemView) => void;
  readonly panel: ManualReviewPanel;
}) {
  return (
    <article className="trace-panel trace-panel--wide" aria-labelledby="manual-review-title">
      <PanelHeader
        eyebrow="Manual review controls"
        title={`${panel.count} review items`}
        titleId="manual-review-title"
        action={<span className={`trace-chip trace-chip--${panel.actionPolicy.allowed ? 'ok' : 'muted'}`}>{panel.actionPolicy.allowed ? 'loaded' : 'closed'}</span>}
      />
      {panel.items.length === 0 ? (
        <p className="trace-empty">{panel.emptyState}</p>
      ) : (
        <ul className="trace-tool-list">
          {panel.items.map((item) => (
            <li key={item.id}>
              <header>
                <strong>{item.id}</strong>
                <span className="trace-chip trace-chip--warn">{item.state}</span>
              </header>
              <MetadataList
                items={[
                  ['workflow', item.workflowId],
                  ['task', item.taskId],
                  ['blocking', item.blockingState],
                  ['owner', item.owner],
                  ['role', item.ownerRole],
                  ['reason ref', item.reasonRef.id],
                  ['safe actions', String(item.safeActions.length)],
                  ['side effects', String(item.sideEffects.length)],
                  ['policy', item.policyVersion],
                  ['registry', item.registryVersion],
                ]}
              />
              <button disabled={busy || item.state === 'resolved' || item.state === 'closed'} onClick={() => onResolve(item)} type="button">
                Resolve manual review via Control API
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function LeasePanel({ panel }: { readonly panel: DurableOperationsPanel }) {
  const lease = panel.leaseStatus;
  return (
    <article className="trace-panel trace-panel--wide" aria-labelledby="lease-status-title">
      <PanelHeader eyebrow="Stuck lease / worker status" title={`${lease.stuckCount} stuck`} titleId="lease-status-title" />
      <div className="trace-count-row">
        <Readout label="active" value={lease.activeCount} />
        <Readout label="expired" value={lease.expiredCount} />
        <Readout label="stuck" value={lease.stuckCount} />
        <Readout label="checked" value={lease.checkedAt} />
      </div>
      <section className="trace-inset">
        <h3>Workflow lease</h3>
        <MetadataList
          items={[
            ['workflow', lease.workflowId],
            ['status', lease.workflowStatus],
            ['lease id', lease.workflowLease.id],
            ['owner', lease.workflowLease.owner],
            ['heartbeat', lease.workflowLease.heartbeatAt],
            ['expires', lease.workflowLease.expiresAt],
          ]}
        />
      </section>
      <section className="trace-inset">
        <h3>Worker leases</h3>
        {lease.agentLeases.length === 0 ? (
          <p className="trace-empty">No agent-run lease metadata returned.</p>
        ) : (
          <ul className="trace-ledger">
            {lease.agentLeases.map((agent) => (
              <li key={agent.agentRunId}>
                <strong>{agent.agentRunId}</strong>
                <span>{agent.status}</span>
                <small>{agent.lease.id} · owner {agent.lease.owner} · heartbeat {agent.lease.heartbeatAt}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function OutboxPanel({ panel }: { readonly panel: DurableOperationsPanel }) {
  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="outbox-backlog-title">
      <PanelHeader eyebrow="Outbox backlog" title={panel.outbox.workflowStatus.backlog} titleId="outbox-backlog-title" />
      <OutboxStatusBlock label="workflow outbox" status={panel.outbox.workflowStatus} />
      <OutboxStatusBlock label="global filtered outbox" status={panel.outbox.globalStatus} />
    </article>
  );
}

function OutboxStatusBlock({ label, status }: { readonly label: string; readonly status: OutboxStatusView }) {
  return (
    <section className="trace-inset">
      <h3>{label}</h3>
      <div className="trace-count-row">
        <Readout label="total" value={status.total} />
        <Readout label="backlog" value={status.backlog} />
        <Readout label="failed" value={status.failed} />
        <Readout label="dead letter" value={status.deadLettered} />
      </div>
      <MetadataList items={[...status.byState.map((item) => [`state ${item.key}`, item.value] as const), ...status.byDestination.map((item) => [`destination ${item.key}`, item.value] as const)]} />
    </section>
  );
}

function ArtifactLifecyclePanelView({
  busy,
  onSignedAccess,
  panel,
}: {
  readonly busy: boolean;
  readonly onSignedAccess: (control: DurableControlView) => void;
  readonly panel: DurableOperationsPanel;
}) {
  const lifecycle = panel.artifactLifecycle;
  const signedAccessControl: DurableControlView = {
    ...panel.retry,
    label: 'Check signed access',
    targetId: lifecycle.artifactId,
    endpoint: `/api/artifacts/${lifecycle.artifactId}/signed-access`,
    available: lifecycle.artifactId !== 'artifact unavailable',
    reason: 'Returns a sanitized eligibility decision; signed URLs are discarded by the view.',
  };

  return (
    <article className="trace-panel trace-panel--side" aria-labelledby="artifact-lifecycle-title">
      <PanelHeader eyebrow="Artifact lifecycle / signed-access status" title={lifecycle.artifactId} titleId="artifact-lifecycle-title" />
      <MetadataList
        items={[
          ['latest state', lifecycle.status.latestState],
          ['latest action', lifecycle.status.latestAction],
          ['legal hold', lifecycle.status.legalHold],
          ['redacted', lifecycle.status.redacted],
          ['delete scheduled', lifecycle.status.deletionScheduledAt],
          ['events', lifecycle.status.eventCount],
          ['signed access', lifecycle.signedAccess.eligible],
          ['approval', lifecycle.signedAccess.requiresApproval],
          ['max ttl', lifecycle.signedAccess.maxDurationSeconds],
        ]}
      />
      <button disabled={busy || !signedAccessControl.available} onClick={() => onSignedAccess(signedAccessControl)} type="button">
        Check signed access via Control API
      </button>
      {lifecycle.events.length === 0 ? (
        <p className="trace-empty">{lifecycle.emptyState}</p>
      ) : (
        <ul className="trace-artifact-list">
          {lifecycle.events.map((event) => (
            <li key={event.id}>
              <header>
                <strong>{event.action}</strong>
                <span className="trace-chip trace-chip--ok">{event.state}</span>
              </header>
              <MetadataList
                items={[
                  ['event', event.id],
                  ['storage ref', event.storage.id],
                  ['checksum', compactHash(event.checksumSha256)],
                  ['retention', event.retention],
                  ['signed access', event.signedAccess],
                  ['legal hold', event.legalHold],
                  ['redacted', event.redacted],
                  ['delete scheduled', event.deletionScheduledAt],
                  ['audit refs', String(event.auditTrail.length)],
                  ['occurred', event.occurredAt],
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

async function executeDurableAction(action: DurableAction) {
  if (action.kind === 'retry') {
    const body = durableBody(action.control, {
      idempotency_key: `admin-portal-retry-${action.control.targetId}`,
    });
    return retryWorkflow(action.control.targetId, body);
  }
  if (action.kind === 'cancel') {
    return cancelTask(action.control.targetId, durableBody(action.control, { cancellation_reason: 'admin_portal_operator_request' }));
  }
  if (action.kind === 'manual-review') {
    const item = action.item;
    return resolveManualReview(
      item.workflowId,
      item.id,
      {
        request_id: `admin-portal-resolve-${item.id}`,
        trace_id: item.traceId,
        policy_version: item.policyVersion,
        registry_version: item.registryVersion,
        idempotency_key: `admin-portal-review-${item.id}`,
        resolution_ref: {
          ref_id: `admin_portal_resolution_${item.id}`,
          ref_type: 'manual_review_resolution_ref',
          scope_ref: item.workflowId,
        },
      },
    );
  }

  return requestArtifactSignedAccess(
    action.panel.artifactId,
    durableBody(action.control, { requested_duration_seconds: 300 }),
  );
}

function durableBody(control: DurableControlView, extra: ControlApiMutationBody = {}): ControlApiMutationBody {
  return {
    request_id: `admin-portal-${control.label.toLowerCase().replaceAll(' ', '-')}-${control.targetId}`,
    trace_id: control.traceId,
    policy_version: control.policyVersion,
    registry_version: control.registryVersion,
    ...extra,
  };
}

function ActionResult({ mutation }: { readonly mutation: ControlMutationState }) {
  const result = mutation.data;
  if (mutation.isIdle) return null;
  return (
    <article className="trace-issues" role={result?.ok === false || mutation.isError ? 'alert' : 'status'}>
      <div>
        <p className="eyebrow">Control API action</p>
        <h2>{mutation.isPending ? 'Submitting operation…' : result?.ok ? 'Operation accepted.' : 'Operation failed closed.'}</h2>
      </div>
      <p className="trace-empty">
        {mutation.isError
          ? mutation.error instanceof Error ? mutation.error.message : 'request failed'
          : result === undefined
            ? 'waiting'
            : `${result.path} · ${result.status === 0 ? 'offline' : result.status}${result.error ? ` · ${result.error}` : ''}`}
      </p>
    </article>
  );
}

function PanelHeader({
  action,
  eyebrow,
  title,
  titleId,
}: {
  readonly action?: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly titleId: string;
}) {
  return (
    <div className="trace-panel__head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
      </div>
      {action}
    </div>
  );
}

function MetadataList({ items }: { readonly items: readonly (readonly [string, string])[] }) {
  return (
    <dl className="trace-kv">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
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

function compactHash(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}
