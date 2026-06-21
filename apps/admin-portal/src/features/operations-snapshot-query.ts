import { queryOptions } from '@tanstack/react-query';
import {
  CONTROL_API_SNAPSHOT_ENDPOINTS,
  fetchOperationalSnapshot,
  type ControlApiSnapshotKey,
  type FetchControlApiOptions,
} from './control-api-client.js';
import {
  buildOperationalViewModel,
  type OperationalControlApiSnapshot,
  type OperationalViewModel,
} from './operational-views.js';

export const operationalSnapshotQueryKey = ['control-api', 'operational-snapshot'] as const;

export interface EndpointStatus {
  readonly key: ControlApiSnapshotKey;
  readonly path: string;
  readonly status: number;
  readonly ok: boolean;
  readonly detail: string;
}

export interface OperationalSnapshotResult {
  readonly generatedAt: string;
  readonly snapshot: OperationalControlApiSnapshot;
  readonly model: OperationalViewModel;
  readonly endpoints: readonly EndpointStatus[];
}

export async function loadOperationalSnapshot(
  options: FetchControlApiOptions = {},
): Promise<OperationalSnapshotResult> {
  const generatedAt = new Date().toISOString();
  const snapshot = await fetchOperationalSnapshot(options);
  const model = buildOperationalViewModel(snapshot, {
    generatedAt,
    controlApiBaseUrl: controlApiBaseUrlForDisplay(),
  });
  return { generatedAt, snapshot, model, endpoints: summarizeEndpoints(snapshot) };
}

export function operationalSnapshotQueryOptions() {
  return queryOptions({
    queryKey: operationalSnapshotQueryKey,
    queryFn: ({ signal }) => loadOperationalSnapshot({ signal }),
    retry: false,
    staleTime: 10 * 1000,
  });
}

function summarizeEndpoints(snapshot: OperationalControlApiSnapshot): readonly EndpointStatus[] {
  return (Object.keys(CONTROL_API_SNAPSHOT_ENDPOINTS) as ControlApiSnapshotKey[]).map((key) => {
    const result = snapshot[key] as OperationalControlApiSnapshot[ControlApiSnapshotKey] | undefined;
    if (result === undefined) {
      return {
        key,
        path: CONTROL_API_SNAPSHOT_ENDPOINTS[key],
        status: 0,
        ok: false,
        detail: 'endpoint missing from snapshot',
      };
    }
    return {
      key,
      path: result.path,
      status: result.status,
      ok: result.ok,
      detail: result.ok ? 'ok' : (result.error ?? `HTTP ${result.status || 'offline'}`),
    };
  });
}

function controlApiBaseUrlForDisplay(): string {
  const location = globalThis.location;
  if (location !== undefined && typeof location.origin === 'string') {
    return location.origin;
  }
  return 'http://127.0.0.1:43101';
}
