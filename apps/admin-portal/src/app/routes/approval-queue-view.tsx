import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveApprovalRequest,
  denyApprovalRequest,
  type ControlApiMutationBody,
} from '../../features/control-api-client.js';
import { operationalSnapshotQueryKey, operationalSnapshotQueryOptions } from '../../features/operations-snapshot-query.js';
import type { ApprovalQueueItemView, ApprovalQueuePanel } from '../../features/operational-views.js';

type ApprovalDecision = 'approve' | 'deny';
interface ControlMutationState {
  readonly data: { readonly ok: boolean; readonly path: string; readonly status: number; readonly error?: string } | undefined;
  readonly error: unknown;
  readonly isError: boolean;
  readonly isIdle: boolean;
  readonly isPending: boolean;
}

export function ApprovalQueueView() {
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery(operationalSnapshotQueryOptions());
  const decisionMutation = useMutation({
    mutationFn: async ({ decision, item }: { readonly decision: ApprovalDecision; readonly item: ApprovalQueueItemView }) => {
      const body = approvalDecisionBody(decision, item);
      return decision === 'approve'
        ? approveApprovalRequest(item.id, body)
        : denyApprovalRequest(item.id, body);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: operationalSnapshotQueryKey });
    },
  });

  if (snapshotQuery.isPending) {
    return (
      <section className="trace-view trace-view--state" aria-busy="true">
        <div className="trace-state-panel">
          <p className="eyebrow">Phase 9 approval queue</p>
          <h1>Loading approval gates…</h1>
          <p>Reading Control API approval metadata without action prompts, artifact bodies, or signed URLs.</p>
        </div>
      </section>
    );
  }

  if (snapshotQuery.isError) {
    return (
      <section className="trace-view trace-view--state" role="alert">
        <div className="trace-state-panel trace-state-panel--error">
          <p className="eyebrow">Approval queue fail-closed</p>
          <h1>Approval snapshot failed.</h1>
          <p>{snapshotQuery.error instanceof Error ? snapshotQuery.error.message : 'The Control API approval queue could not be read.'}</p>
        </div>
      </section>
    );
  }

  const panel = snapshotQuery.data.model.approvalQueue;

  return (
    <section className="trace-view durable-view" aria-labelledby="approval-queue-title">
      <header className="trace-hero">
        <div className="trace-hero__content">
          <p className="eyebrow">Phase 9 / approval command gate</p>
          <h1 id="approval-queue-title">Approval queue. Payloads stay outside.</h1>
          <p>
            Operators see required action metadata, requester, risk tier, expiry, artifact refs, and audit refs only.
            Approve and deny buttons send trusted decisions to the Control API.
          </p>
          <div className="trace-chip-row">
            <span className="trace-chip trace-chip--ok">{panel.count} pending</span>
            <span className={`trace-chip trace-chip--${panel.actionPolicy.allowed ? 'ok' : 'muted'}`}>
              {panel.actionPolicy.allowed ? 'metadata ready' : 'fail-closed'}
            </span>
          </div>
        </div>
        <div className="trace-hero__readout">
          <Readout label="source" value="Control API /api/approvals" />
          <Readout label="decision path" value="/approve or /deny" />
          <Readout label="payload posture" value="metadata-only" />
        </div>
      </header>

      <DecisionResult mutation={decisionMutation} />
      <ApprovalQueuePanelView
        busy={decisionMutation.isPending}
        onDecision={(decision, item) => decisionMutation.mutate({ decision, item })}
        panel={panel}
      />
    </section>
  );
}

function ApprovalQueuePanelView({
  busy,
  onDecision,
  panel,
}: {
  readonly busy: boolean;
  readonly onDecision: (decision: ApprovalDecision, item: ApprovalQueueItemView) => void;
  readonly panel: ApprovalQueuePanel;
}) {
  if (panel.items.length === 0) {
    return (
      <article className="trace-panel">
        <p className="eyebrow">Queue clear</p>
        <h2>{panel.emptyState}</h2>
        <p className="trace-empty">{panel.actionPolicy.reason}</p>
      </article>
    );
  }

  return (
    <div className="durable-card-grid">
      {panel.items.map((item) => (
        <article className="trace-panel durable-card" key={item.id}>
          <div className="trace-panel__head">
            <div>
              <p className="eyebrow">Approval request</p>
              <h2>{item.requiredAction}</h2>
            </div>
            <span className={`trace-chip trace-chip--${riskTone(item.riskTier)}`}>{item.riskTier}</span>
          </div>

          <MetadataList
            items={[
              ['request', item.id],
              ['state', item.state],
              ['requester', item.requester],
              ['required role', item.requiredRole],
              ['workflow', item.workflowId],
              ['task', item.taskId],
              ['expires', item.expiry],
              ['policy', item.policyVersion],
              ['registry', item.registryVersion],
            ]}
          />

          <section className="trace-inset">
            <h3>Sanitized artifact metadata</h3>
            <MetadataList
              items={[
                ['artifact id', item.actionSummaryArtifact.id],
                ['kind', item.actionSummaryArtifact.kind],
                ['data class', item.actionSummaryArtifact.dataClass],
                ['sha256', compactHash(item.actionSummaryArtifact.sha256)],
                ['size bytes', item.actionSummaryArtifact.sizeBytes],
              ]}
            />
          </section>

          <section className="trace-inset">
            <h3>Audit trail</h3>
            {item.auditTrail.length === 0 ? (
              <p className="trace-empty">No audit refs returned.</p>
            ) : (
              <ul className="trace-ledger">
                {item.auditTrail.map((audit) => (
                  <li key={`${item.id}-${audit.id}`}>
                    <strong>{audit.id}</strong>
                    <small>{audit.stream} · {audit.recordedAt}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="durable-actions" aria-label={`Decision controls for ${item.id}`}>
            <button disabled={busy || item.state !== 'pending'} onClick={() => onDecision('approve', item)} type="button">
              Approve via Control API
            </button>
            <button disabled={busy || item.state !== 'pending'} onClick={() => onDecision('deny', item)} type="button">
              Deny via Control API
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function approvalDecisionBody(decision: ApprovalDecision, item: ApprovalQueueItemView): ControlApiMutationBody {
  return {
    request_id: `admin-portal-${decision}-${item.id}`,
    trace_id: item.traceId,
    policy_version: item.policyVersion,
    registry_version: item.registryVersion,
  };
}

function DecisionResult({ mutation }: { readonly mutation: ControlMutationState }) {
  const result = mutation.data;
  if (mutation.isIdle) return null;
  return (
    <article className="trace-issues" role={result?.ok === false || mutation.isError ? 'alert' : 'status'}>
      <div>
        <p className="eyebrow">Decision result</p>
        <h2>{mutation.isPending ? 'Submitting trusted decision…' : result?.ok ? 'Control API accepted the decision.' : 'Control API rejected the decision.'}</h2>
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

function riskTone(riskTier: string): 'danger' | 'warn' | 'ok' {
  const normalized = riskTier.toLowerCase();
  if (normalized.includes('high') || normalized.includes('critical')) return 'danger';
  if (normalized.includes('medium')) return 'warn';
  return 'ok';
}

function compactHash(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}
