import type { ModelProviderRegistrySnapshot } from '@devgateway/registry';
import type { ProviderPolicyMatrix } from '@devgateway/policy';

import { buildPolicyFreshnessReport, currentPolicySnapshot } from './policy.ts';
import { buildRegistryFreshnessReport, currentRegistrySnapshot } from './registry.ts';
import {
  checksumSnapshot,
  denySnapshotRouteInProduction,
  getRequestPathname,
  isFreshnessStale,
  jsonResponse,
  notFoundResponse,
  registerSnapshotRoutes,
  snapshotErrorBody,
  snapshotErrorResponse,
  type SnapshotChecksumReport,
  type SnapshotFreshnessReport,
  type SnapshotRoute,
  type SnapshotRouteErrorBody,
  type SnapshotRouteRegistrar,
  type SnapshotProductionGateOptions,
} from './snapshot-common.ts';

export const BIFROST_CONFIG_CURRENT_PATH = '/bifrost/config/current';
export const BIFROST_CONFIG_VALIDATION_PATH = '/bifrost/config/validation';
export const BIFROST_CONFIG_CONTRACT_VERSION = 'bifrost-config-report.v0.1' as const;

export interface BifrostConfigRouteOptions extends SnapshotProductionGateOptions {
  readonly registrySnapshot?: ModelProviderRegistrySnapshot | null;
  readonly policySnapshot?: ProviderPolicyMatrix | null;
  readonly now?: Date;
}

export interface BifrostSnapshotReference {
  readonly version: string;
  readonly checksum: SnapshotChecksumReport;
  readonly freshness: SnapshotFreshnessReport;
}

export interface BifrostConfigValidationReport {
  readonly kind: 'bifrost_config_validation_report';
  readonly contract_version: typeof BIFROST_CONFIG_CONTRACT_VERSION;
  readonly route_config_version: string;
  readonly valid: false;
  readonly status: 'blocked';
  readonly fail_closed: true;
  readonly production_enabled: false;
  readonly generated_config_available: false;
  readonly registry: BifrostSnapshotReference;
  readonly policy: BifrostSnapshotReference;
  readonly errors: readonly SnapshotRouteErrorBody[];
}

export function createBifrostConfigRoutes(options: BifrostConfigRouteOptions = {}): readonly SnapshotRoute[] {
  return [
    {
      method: 'GET',
      path: BIFROST_CONFIG_CURRENT_PATH,
      schema: {
        operationId: 'getCurrentBifrostConfigArtifact',
        summary: 'Return the generated Bifrost config artifact when route generation is enabled.',
        tags: ['Bifrost'],
        responses: { 409: { description: 'Config generation is disabled fail-closed.' }, 503: { description: 'Missing or stale policy/registry snapshot.' } },
      },
      handler: (request) => handleBifrostConfigRoute(request, options),
    },
    {
      method: 'GET',
      path: BIFROST_CONFIG_VALIDATION_PATH,
      schema: {
        operationId: 'getBifrostConfigValidationReport',
        summary: 'Return a validation report explaining why Bifrost config generation remains disabled.',
        tags: ['Bifrost'],
        responses: { 200: { description: 'Fail-closed Bifrost config validation report.' }, 503: { description: 'Missing or stale policy/registry snapshot.' } },
      },
      handler: (request) => handleBifrostConfigRoute(request, options),
    },
  ];
}

export function registerBifrostConfigRoutes(registrar: SnapshotRouteRegistrar, options: BifrostConfigRouteOptions = {}): void {
  registerSnapshotRoutes(createBifrostConfigRoutes(options), registrar);
}

export function handleBifrostConfigRoute(request: Request, options: BifrostConfigRouteOptions = {}): Response {
  if (request.method !== 'GET') return notFoundResponse();
  const productionDenied = denySnapshotRouteInProduction(options);
  if (productionDenied !== undefined) return productionDenied;

  const registry = resolveRegistrySnapshot(options);
  const policy = resolvePolicySnapshot(options);
  if (registry === null || policy === null) {
    return snapshotErrorResponse(503, 'policy_missing', 'policy_stale', 'Bifrost config cannot load missing registry or policy snapshots.', {
      registry_missing: registry === null,
      policy_missing: policy === null,
    });
  }

  const report = buildBifrostConfigValidationReport({ ...options, policySnapshot: policy, registrySnapshot: registry });
  if (isFreshnessStale(report.registry.freshness) || isFreshnessStale(report.policy.freshness)) {
    return snapshotErrorResponse(503, 'policy_stale', 'policy_stale', 'Bifrost config validation failed because policy or registry snapshot is stale.', {
      registry: report.registry.freshness,
      policy: report.policy.freshness,
    });
  }

  const pathname = getRequestPathname(request);
  if (pathname === BIFROST_CONFIG_VALIDATION_PATH) return jsonResponse(report);

  if (pathname === BIFROST_CONFIG_CURRENT_PATH) {
    return snapshotErrorResponse(409, 'route_disabled', 'route_disabled', 'Bifrost config generation is disabled until production gate evidence exists.', {
      route_config_version: report.route_config_version,
      validation_path: BIFROST_CONFIG_VALIDATION_PATH,
      generated_config_available: false,
      report,
    });
  }

  return notFoundResponse();
}

export function buildBifrostConfigValidationReport(
  options: BifrostConfigRouteOptions & {
    readonly registrySnapshot?: ModelProviderRegistrySnapshot;
    readonly policySnapshot?: ProviderPolicyMatrix | null;
  } = {},
): BifrostConfigValidationReport {
  const registry = options.registrySnapshot ?? currentRegistrySnapshot;
  const policy = options.policySnapshot ?? currentPolicySnapshot;
  const registryFreshness = buildRegistryFreshnessReport(registry, options.now ?? new Date());
  const policyFreshness = buildPolicyFreshnessReport(policy, options.now ?? new Date());
  const routeConfigVersion = `bifrost.${registry.registry_version}.${policy.matrixId}.disabled`;
  const aliasesMissingGate = registry.model_aliases
    .filter((alias) => alias.eval_gate.latest_gate_status !== 'passing' || alias.eval_gate.gate_result_ref === null)
    .map((alias) => alias.alias);
  const providersMissingGate = policy.providers
    .filter((provider) => provider.evalGate.requiredForProduction && provider.evalGate.status !== 'passed')
    .map((provider) => provider.providerId);

  return {
    kind: 'bifrost_config_validation_report',
    contract_version: BIFROST_CONFIG_CONTRACT_VERSION,
    route_config_version: routeConfigVersion,
    valid: false,
    status: 'blocked',
    fail_closed: true,
    production_enabled: false,
    generated_config_available: false,
    registry: {
      version: registry.registry_version,
      checksum: checksumSnapshot(registry),
      freshness: registryFreshness,
    },
    policy: {
      version: policy.matrixId,
      checksum: checksumSnapshot(policy),
      freshness: policyFreshness,
    },
    errors: [
      snapshotErrorBody('route_disabled', 'route_disabled', 'Production Bifrost route/config generation remains disabled by registry and policy posture.', {
        registry_production_enabled: registry.production_posture.production_enabled,
        policy_production_enabled: policy.productionEnablement.enabled,
      }),
      snapshotErrorBody('eval_gate_missing', 'eval_gate', 'Passing eval gate evidence is missing for production route/config generation.', {
        registry_aliases_missing_gate: aliasesMissingGate,
        policy_providers_missing_gate: providersMissingGate,
      }),
    ],
  };
}

function resolveRegistrySnapshot(options: BifrostConfigRouteOptions): ModelProviderRegistrySnapshot | null {
  return options.registrySnapshot === undefined ? currentRegistrySnapshot : options.registrySnapshot;
}

function resolvePolicySnapshot(options: BifrostConfigRouteOptions): ProviderPolicyMatrix | null {
  return options.policySnapshot === undefined ? currentPolicySnapshot : options.policySnapshot;
}
