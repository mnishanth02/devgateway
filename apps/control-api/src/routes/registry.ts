import registrySnapshotJson from '../../../../packages/registry/registry/model-aliases.v0.1.json' with { type: 'json' };

import { modelProviderRegistryContractVersion, type ModelProviderRegistrySnapshot } from '@devgateway/registry';

import {
  buildFreshnessReport,
  checksumSnapshot,
  getRequestPathname,
  isFreshnessStale,
  jsonResponse,
  notFoundResponse,
  registerSnapshotRoutes,
  denySnapshotRouteInProduction,
  snapshotErrorResponse,
  type SnapshotChecksumReport,
  type SnapshotFreshnessReport,
  type SnapshotRoute,
  type SnapshotRouteRegistrar,
  type SnapshotProductionGateOptions,
} from './snapshot-common.ts';

export const REGISTRY_CURRENT_PATH = '/registry/current';
export const REGISTRY_CHECKSUM_PATH = '/registry/current/checksum';
export const REGISTRY_FRESHNESS_PATH = '/registry/current/freshness';

export interface RegistryRouteOptions extends SnapshotProductionGateOptions {
  readonly snapshot?: ModelProviderRegistrySnapshot | null;
  readonly now?: Date;
}

export interface RegistrySnapshotResponse {
  readonly kind: 'model_provider_registry_snapshot';
  readonly contract_version: typeof modelProviderRegistryContractVersion;
  readonly registry_version: string;
  readonly production_enabled: false;
  readonly checksum: SnapshotChecksumReport;
  readonly freshness: SnapshotFreshnessReport;
  readonly snapshot: ModelProviderRegistrySnapshot;
}

export const currentRegistrySnapshot = registrySnapshotJson as ModelProviderRegistrySnapshot;

export function createRegistryRoutes(options: RegistryRouteOptions = {}): readonly SnapshotRoute[] {
  return [
    {
      method: 'GET',
      path: REGISTRY_CURRENT_PATH,
      schema: {
        operationId: 'getCurrentRegistrySnapshot',
        summary: 'Return the current model/provider registry snapshot envelope.',
        tags: ['Registry'],
        responses: { 200: { description: 'Current registry snapshot.' }, 503: { description: 'Missing or stale registry snapshot.' } },
      },
      handler: (request) => handleRegistryRoute(request, options),
    },
    {
      method: 'GET',
      path: REGISTRY_CHECKSUM_PATH,
      schema: {
        operationId: 'getCurrentRegistryChecksum',
        summary: 'Return the deterministic checksum for the current registry snapshot.',
        tags: ['Registry'],
        responses: { 200: { description: 'Registry checksum metadata.' }, 503: { description: 'Missing registry snapshot.' } },
      },
      handler: (request) => handleRegistryRoute(request, options),
    },
    {
      method: 'GET',
      path: REGISTRY_FRESHNESS_PATH,
      schema: {
        operationId: 'getCurrentRegistryFreshness',
        summary: 'Return freshness metadata for the current registry snapshot.',
        tags: ['Registry'],
        responses: { 200: { description: 'Registry freshness metadata.' }, 503: { description: 'Missing registry snapshot.' } },
      },
      handler: (request) => handleRegistryRoute(request, options),
    },
  ];
}

export function registerRegistryRoutes(registrar: SnapshotRouteRegistrar, options: RegistryRouteOptions = {}): void {
  registerSnapshotRoutes(createRegistryRoutes(options), registrar);
}

export function handleRegistryRoute(request: Request, options: RegistryRouteOptions = {}): Response {
  if (request.method !== 'GET') return notFoundResponse();
  const productionDenied = denySnapshotRouteInProduction(options);
  if (productionDenied !== undefined) return productionDenied;

  const snapshot = resolveRegistrySnapshot(options);
  if (snapshot === null) {
    return snapshotErrorResponse(503, 'policy_missing', 'policy_stale', 'Registry snapshot artifact is missing.', {
      source: 'registry',
    });
  }

  const pathname = getRequestPathname(request);
  if (pathname === REGISTRY_CURRENT_PATH) {
    const body = buildRegistrySnapshotResponse(snapshot, options.now ?? new Date());
    if (isFreshnessStale(body.freshness)) {
      return snapshotErrorResponse(503, 'policy_stale', 'policy_stale', 'Registry snapshot is stale.', {
        registry_version: snapshot.registry_version,
        freshness: body.freshness,
      });
    }
    return jsonResponse(body);
  }

  if (pathname === REGISTRY_CHECKSUM_PATH) {
    return jsonResponse({
      kind: 'registry_snapshot_checksum',
      registry_version: snapshot.registry_version,
      production_enabled: false,
      ...checksumSnapshot(snapshot),
    });
  }

  if (pathname === REGISTRY_FRESHNESS_PATH) {
    return jsonResponse(buildRegistryFreshnessReport(snapshot, options.now ?? new Date()));
  }

  return notFoundResponse();
}

export function buildRegistrySnapshotResponse(
  snapshot: ModelProviderRegistrySnapshot = currentRegistrySnapshot,
  now: Date = new Date(),
): RegistrySnapshotResponse {
  return {
    kind: 'model_provider_registry_snapshot',
    contract_version: modelProviderRegistryContractVersion,
    registry_version: snapshot.registry_version,
    production_enabled: false,
    checksum: checksumSnapshot(snapshot),
    freshness: buildRegistryFreshnessReport(snapshot, now),
    snapshot,
  };
}

export function buildRegistryFreshnessReport(
  snapshot: ModelProviderRegistrySnapshot = currentRegistrySnapshot,
  now: Date = new Date(),
): SnapshotFreshnessReport {
  return buildFreshnessReport({
    source: 'registry',
    version: snapshot.registry_version,
    createdAt: snapshot.created_at,
    freshnessExpiresAt: snapshot.freshness_expires_at,
    checkedAt: now,
  });
}

function resolveRegistrySnapshot(options: RegistryRouteOptions): ModelProviderRegistrySnapshot | null {
  return options.snapshot === undefined ? currentRegistrySnapshot : options.snapshot;
}
