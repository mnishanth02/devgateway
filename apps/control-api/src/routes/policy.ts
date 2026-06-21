import policySnapshotJson from '../../../../packages/policy/policies/provider-data-class-matrix.v0.1.json' with { type: 'json' };

import {
  DENIAL_TAXONOMY_CONTRACT_VERSION,
  type ProviderPolicyMatrix,
} from '@devgateway/policy';

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

export const POLICY_CURRENT_PATH = '/policy/current';
export const POLICY_CHECKSUM_PATH = '/policy/current/checksum';
export const POLICY_FRESHNESS_PATH = '/policy/current/freshness';
export const POLICY_SNAPSHOT_CREATED_AT = '2026-06-20T07:48:38.024Z';

export interface PolicyRouteOptions extends SnapshotProductionGateOptions {
  readonly snapshot?: ProviderPolicyMatrix | null;
  readonly now?: Date;
}

export interface PolicySnapshotResponse {
  readonly kind: 'provider_data_class_policy_snapshot';
  readonly contract_version: typeof DENIAL_TAXONOMY_CONTRACT_VERSION;
  readonly policy_version: string;
  readonly production_enabled: false;
  readonly checksum: SnapshotChecksumReport;
  readonly freshness: SnapshotFreshnessReport;
  readonly snapshot: ProviderPolicyMatrix;
}

export const currentPolicySnapshot = policySnapshotJson as ProviderPolicyMatrix;

export function createPolicyRoutes(options: PolicyRouteOptions = {}): readonly SnapshotRoute[] {
  return [
    {
      method: 'GET',
      path: POLICY_CURRENT_PATH,
      schema: {
        operationId: 'getCurrentPolicySnapshot',
        summary: 'Return the current provider data-class policy snapshot envelope.',
        tags: ['Policy'],
        responses: { 200: { description: 'Current policy snapshot.' }, 503: { description: 'Missing or stale policy snapshot.' } },
      },
      handler: (request) => handlePolicyRoute(request, options),
    },
    {
      method: 'GET',
      path: POLICY_CHECKSUM_PATH,
      schema: {
        operationId: 'getCurrentPolicyChecksum',
        summary: 'Return the deterministic checksum for the current policy snapshot.',
        tags: ['Policy'],
        responses: { 200: { description: 'Policy checksum metadata.' }, 503: { description: 'Missing policy snapshot.' } },
      },
      handler: (request) => handlePolicyRoute(request, options),
    },
    {
      method: 'GET',
      path: POLICY_FRESHNESS_PATH,
      schema: {
        operationId: 'getCurrentPolicyFreshness',
        summary: 'Return freshness metadata for the current policy snapshot.',
        tags: ['Policy'],
        responses: { 200: { description: 'Policy freshness metadata.' }, 503: { description: 'Missing policy snapshot.' } },
      },
      handler: (request) => handlePolicyRoute(request, options),
    },
  ];
}

export function registerPolicyRoutes(registrar: SnapshotRouteRegistrar, options: PolicyRouteOptions = {}): void {
  registerSnapshotRoutes(createPolicyRoutes(options), registrar);
}

export function handlePolicyRoute(request: Request, options: PolicyRouteOptions = {}): Response {
  if (request.method !== 'GET') return notFoundResponse();
  const productionDenied = denySnapshotRouteInProduction(options);
  if (productionDenied !== undefined) return productionDenied;

  const snapshot = resolvePolicySnapshot(options);
  if (snapshot === null) {
    return snapshotErrorResponse(503, 'policy_missing', 'policy_stale', 'Policy snapshot artifact is missing.', {
      source: 'policy',
    });
  }

  const pathname = getRequestPathname(request);
  if (pathname === POLICY_CURRENT_PATH) {
    const body = buildPolicySnapshotResponse(snapshot, options.now ?? new Date());
    if (isFreshnessStale(body.freshness)) {
      return snapshotErrorResponse(503, 'policy_stale', 'policy_stale', 'Policy snapshot is stale.', {
        policy_version: snapshot.matrixId,
        freshness: body.freshness,
      });
    }
    return jsonResponse(body);
  }

  if (pathname === POLICY_CHECKSUM_PATH) {
    return jsonResponse({
      kind: 'policy_snapshot_checksum',
      policy_version: snapshot.matrixId,
      production_enabled: false,
      ...checksumSnapshot(snapshot),
    });
  }

  if (pathname === POLICY_FRESHNESS_PATH) {
    return jsonResponse(buildPolicyFreshnessReport(snapshot, options.now ?? new Date()));
  }

  return notFoundResponse();
}

export function buildPolicySnapshotResponse(
  snapshot: ProviderPolicyMatrix = currentPolicySnapshot,
  now: Date = new Date(),
): PolicySnapshotResponse {
  return {
    kind: 'provider_data_class_policy_snapshot',
    contract_version: DENIAL_TAXONOMY_CONTRACT_VERSION,
    policy_version: snapshot.matrixId,
    production_enabled: false,
    checksum: checksumSnapshot(snapshot),
    freshness: buildPolicyFreshnessReport(snapshot, now),
    snapshot,
  };
}

export function buildPolicyFreshnessReport(
  snapshot: ProviderPolicyMatrix = currentPolicySnapshot,
  now: Date = new Date(),
): SnapshotFreshnessReport {
  return buildFreshnessReport({
    source: 'policy',
    version: snapshot.matrixId,
    createdAt: snapshot.createdAt,
    freshnessExpiresAt: snapshot.freshnessExpiresAt,
    checkedAt: now,
  });
}

function resolvePolicySnapshot(options: PolicyRouteOptions): ProviderPolicyMatrix | null {
  return options.snapshot === undefined ? currentPolicySnapshot : options.snapshot;
}
