#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  loadRegistrySnapshot,
  validateRegistry,
} from '../packages/registry/src/index.ts';
import {
  DENIAL_REASON_CODES,
  loadProviderDataClassMatrix,
  validatePolicy,
} from '../packages/policy/src/index.ts';

export const BIFROST_CONFIG_CONTRACT_VERSION = 'bifrost-config.v0.1';
export const BIFROST_CONFIG_REPORT_CONTRACT_VERSION = 'bifrost-config-report.v0.1';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultRegistryPath = fileURLToPath(new URL('../packages/registry/registry/model-aliases.v0.1.json', import.meta.url));
const defaultPolicyPath = fileURLToPath(new URL('../packages/policy/policies/provider-data-class-matrix.v0.1.json', import.meta.url));

const supportedDenialReasons = new Set(DENIAL_REASON_CODES);

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === 'generate') {
    const { config, report } = await buildFromFiles(options);
    if (!report.valid) {
      printValidationIssues(report.issues);
      process.exitCode = 1;
      return report;
    }
    const rendered = `${JSON.stringify(config, null, 2)}\n`;
    if (options.out) await writeFile(options.out, rendered, 'utf8');
    else process.stdout.write(rendered);
    if (options.reportOut) await writeFile(options.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    return report;
  }

  if (command === 'validate') {
    if (!options.config) {
      console.error('validate requires --config pointing at a committed/generated Bifrost config artifact.');
      process.exitCode = 1;
      return null;
    }
    const { registry, policy } = await loadSnapshots(options);
    const config = JSON.parse(await readFile(options.config, 'utf8'));
    const validation = validateBifrostConfig({
      config,
      registry,
      policy,
      now: options.now ? new Date(options.now) : new Date(),
      maxStalenessSeconds: options.maxStalenessSeconds,
    });
    const report = buildBifrostConfigReport({ config, registry, policy, validation });
    if (options.reportOut) await writeFile(options.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (!validation.ok) {
      printValidationIssues(validation.issues);
      process.exitCode = 1;
    } else {
      console.log('Bifrost config validation passed.');
    }
    return report;
  }

  printHelp();
  process.exitCode = 1;
  return null;
}

export async function buildFromFiles(options = {}) {
  const { registry, policy } = await loadSnapshots(options);
  const config = buildBifrostConfig({ registry, policy });
  const validation = validateBifrostConfig({
    config,
    registry,
    policy,
    now: options.now ? new Date(options.now) : new Date(),
    maxStalenessSeconds: options.maxStalenessSeconds,
  });
  return {
    config,
    report: buildBifrostConfigReport({ config, registry, policy, validation }),
  };
}

export async function loadSnapshots(options = {}) {
  const registry = await loadRegistrySnapshot({ path: options.registry ?? defaultRegistryPath });
  const policy = await loadProviderDataClassMatrix({ path: options.policy ?? defaultPolicyPath });
  return { registry, policy };
}

export function buildBifrostConfig({ registry, policy }) {
  const providerRouteCandidates = buildProviderRouteCandidates({ registry, policy });
  const productionDisabledPosture = {
    production_enabled: false,
    provider_credentials_enabled: false,
    route_provisioning_enabled: false,
    provider_count_enabled: 0,
    route_count_enabled: 0,
    denial_reason: 'route_disabled',
    notes: 'Generated config is intentionally non-production until registry and policy gate evidence exists.',
  };

  return {
    kind: 'bifrost_config',
    contract_version: BIFROST_CONFIG_CONTRACT_VERSION,
    route_config_version: routeConfigVersion(registry, policy),
    generated_from: {
      registry: snapshotReference('registry', registry.registry_version, registry.created_at, registry.freshness_expires_at, registry),
      policy: snapshotReference('policy', policy.matrixId, policy.createdAt, policy.freshnessExpiresAt, policy),
    },
    production_disabled_posture: productionDisabledPosture,
    registry: {
      validate_before_start: true,
      source_of_truth: 'model-provider-registry',
      route_config_version: routeConfigVersion(registry, policy),
    },
    providers: Object.fromEntries(
      policy.providers.map((provider) => [
        provider.providerId,
        {
          enabled: false,
          production_enabled: false,
          credentials: {
            configured: false,
            source: 'not_configured',
            environment_variable: null,
          },
          allowed_data_classes: provider.dataClassPolicy.allowedDataClasses,
          denied_data_classes: provider.dataClassPolicy.deniedDataClasses,
          denial_reason: 'route_disabled',
          enablement_requires_gate_result: true,
        },
      ]),
    ),
    routes: registry.model_aliases.map((alias) => ({
      alias: alias.alias,
      enabled: false,
      production_enabled: false,
      lifecycle_status: alias.lifecycle_status,
      routing_tier: alias.routing.tier,
      fallback_aliases: alias.routing.fallback_aliases,
      denial_reason: 'route_disabled',
      gate_evidence_required: true,
      candidates: providerRouteCandidates
        .filter((candidate) => candidate.alias === alias.alias && candidate.source === 'registry')
        .map((candidate) => candidate.candidate_id),
    })),
    provider_route_candidates: providerRouteCandidates,
    policy_context: {
      required_headers: [
        'x-devgateway-principal-id',
        'x-devgateway-project-id',
        'x-devgateway-data-class',
        'x-devgateway-policy-version',
        'x-devgateway-registry-version',
        'x-devgateway-trace-id',
      ],
      supported_denial_reasons: DENIAL_REASON_CODES,
      unsupported_denial_reason_action: 'fail_closed',
    },
    production: {
      provisioning_enabled: false,
      deploy_approval_required: true,
      provider_credentials_enabled: false,
      routes_enabled: false,
      denial_reason: 'route_disabled',
    },
  };
}

export function buildProviderRouteCandidates({ registry, policy }) {
  const policyByProvider = new Map(policy.providers.map((provider) => [provider.providerId, provider]));
  const candidates = [];
  for (const alias of registry.model_aliases) {
    for (const candidate of alias.candidates) {
      const provider = policyByProvider.get(candidate.provider_id);
      const drift = [];
      if (!provider) drift.push('policy_provider_missing');
      if (provider && !provider.allowedModelAliases.includes(alias.alias)) drift.push('policy_alias_missing');
      if (provider && !sameStringSet(candidate.allowed_data_classes, provider.dataClassPolicy.allowedDataClasses)) {
        drift.push('data_class_mismatch');
      }
      candidates.push({
        source: 'registry',
        alias: alias.alias,
        candidate_id: candidate.candidate_id,
        provider_id: candidate.provider_id,
        model_id: candidate.model_id,
        wire_format: candidate.wire_format,
        bifrost_enabled: false,
        production_enabled: false,
        registry_allowed_data_classes: candidate.allowed_data_classes,
        policy_allowed_data_classes: provider?.dataClassPolicy.allowedDataClasses ?? [],
        effective_allowed_data_classes: provider
          ? candidate.allowed_data_classes.filter((dataClass) => provider.dataClassPolicy.allowedDataClasses.includes(dataClass))
          : [],
        disabled_reason: drift.length > 0 ? 'policy_stale' : 'route_disabled',
        drift,
        gate_evidence: {
          registry_gate_result_ref: alias.production_gate.gate_result_ref,
          policy_eval_gate_status: provider?.evalGate.status ?? null,
        },
      });
    }
  }

  for (const provider of policy.providers) {
    for (const alias of provider.allowedModelAliases) {
      if (candidates.some((candidate) => candidate.alias === alias && candidate.provider_id === provider.providerId)) continue;
      candidates.push({
        source: 'policy',
        alias,
        candidate_id: `${provider.providerId}:${alias}`,
        provider_id: provider.providerId,
        model_id: null,
        wire_format: null,
        bifrost_enabled: false,
        production_enabled: false,
        registry_allowed_data_classes: [],
        policy_allowed_data_classes: provider.dataClassPolicy.allowedDataClasses,
        effective_allowed_data_classes: [],
        disabled_reason: 'route_disabled',
        drift: ['registry_candidate_missing'],
        gate_evidence: {
          registry_gate_result_ref: null,
          policy_eval_gate_status: provider.evalGate.status,
        },
      });
    }
  }

  return candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
}

export function validateBifrostConfig({ config, registry, policy, now = new Date(), maxStalenessSeconds }) {
  const issues = [];
  const registryValidation = validateRegistry({ snapshot: registry, now });
  const policyValidation = validatePolicy({ matrix: policy, now });
  pushNestedIssues(issues, 'registry', registryValidation.issues);
  pushNestedIssues(issues, 'policy', policyValidation.issues);
  validateSnapshotFreshness('registry', registry.registry_version, registry.freshness_expires_at, now, '$.registry', issues);
  validateSnapshotFreshness('policy', policy.matrixId, policy.freshnessExpiresAt, now, '$.policy', issues);
  validateSnapshotMaxStaleness('registry', registry.created_at, maxStalenessSeconds, now, '$.registry.created_at', issues);
  validateSnapshotMaxStaleness('policy', policy.createdAt, maxStalenessSeconds, now, '$.policy.createdAt', issues);
  validateGeneratedReferences(config, registry, policy, issues);
  validateProviderRouteDrift(config, registry, policy, issues);
  validateDenialReasons(config, issues);
  validateProductionPosture(config, registry, policy, issues);
  return { ok: issues.length === 0, issues };
}

export function buildBifrostConfigReport({ config, registry, policy, validation }) {
  return {
    kind: 'bifrost_config_report',
    contract_version: BIFROST_CONFIG_REPORT_CONTRACT_VERSION,
    route_config_version: routeConfigVersion(registry, policy),
    valid: validation.ok,
    production_enabled: false,
    generated_config_available: true,
    registry: snapshotReference('registry', registry.registry_version, registry.created_at, registry.freshness_expires_at, registry),
    policy: snapshotReference('policy', policy.matrixId, policy.createdAt, policy.freshnessExpiresAt, policy),
    provider_route_candidates: buildProviderRouteCandidates({ registry, policy }),
    production_disabled_posture: config.production_disabled_posture,
    issues: validation.issues,
  };
}

function validateGeneratedReferences(config, registry, policy, issues) {
  const actualVersion = routeConfigVersion(registry, policy);
  if (config?.contract_version !== BIFROST_CONFIG_CONTRACT_VERSION) {
    issues.push(issue('schema', '$.contract_version', `expected ${BIFROST_CONFIG_CONTRACT_VERSION}`));
  }
  if (config?.route_config_version !== actualVersion) {
    issues.push(issue('policy_stale', '$.route_config_version', `expected route config version ${actualVersion}`));
  }
  validateSnapshotReference(config?.generated_from?.registry, 'registry', registry.registry_version, registry, '$.generated_from.registry', issues);
  validateSnapshotReference(config?.generated_from?.policy, 'policy', policy.matrixId, policy, '$.generated_from.policy', issues);
}

function validateSnapshotReference(reference, source, version, snapshot, path, issues) {
  if (!reference) {
    issues.push(issue('policy_stale', path, `${source} snapshot reference is missing`));
    return;
  }
  if (reference.version !== version) {
    issues.push(issue('policy_stale', `${path}.version`, `${source} version does not match loaded snapshot`));
  }
  const expectedChecksum = checksumSnapshot(snapshot).checksum;
  if (reference.checksum?.checksum !== expectedChecksum) {
    issues.push(issue('policy_stale', `${path}.checksum.checksum`, `${source} checksum does not match loaded snapshot`));
  }
}

function validateProviderRouteDrift(config, registry, policy, issues) {
  const expectedCandidates = buildProviderRouteCandidates({ registry, policy });
  const actualCandidates = Array.isArray(config?.provider_route_candidates) ? config.provider_route_candidates : [];
  const expectedSignatures = new Set(expectedCandidates.map(candidateSignature));
  const actualSignatures = new Set(actualCandidates.map(candidateSignature));
  for (const signature of expectedSignatures) {
    if (!actualSignatures.has(signature)) {
      issues.push(issue('route_provider_drift', '$.provider_route_candidates', `missing provider route candidate ${signature}`));
    }
  }
  for (const signature of actualSignatures) {
    if (!expectedSignatures.has(signature)) {
      issues.push(issue('route_provider_drift', '$.provider_route_candidates', `unexpected provider route candidate ${signature}`));
    }
  }
  actualCandidates.forEach((candidate, index) => {
    if (!Array.isArray(candidate?.drift)) return;
    const blockingDrift = candidate.drift.filter((drift) => drift !== 'registry_candidate_missing');
    if (blockingDrift.length > 0) {
      issues.push(issue('route_provider_drift', `$.provider_route_candidates[${index}].drift`, `blocking registry/policy drift: ${blockingDrift.join(', ')}`));
    }
  });

  const expectedAliases = new Set(registry.model_aliases.map((alias) => alias.alias));
  const expectedRoutes = buildBifrostConfig({ registry, policy }).routes;
  const expectedRouteSignatures = new Set(expectedRoutes.map(routeSignature));
  const routes = Array.isArray(config?.routes) ? config.routes : [];
  const actualRouteSignatures = new Set(routes.map(routeSignature));
  for (const signature of expectedRouteSignatures) {
    if (!actualRouteSignatures.has(signature)) {
      issues.push(issue('route_provider_drift', '$.routes', `missing route ${signature}`));
    }
  }
  for (const signature of actualRouteSignatures) {
    if (!expectedRouteSignatures.has(signature)) {
      issues.push(issue('route_provider_drift', '$.routes', `unexpected route ${signature}`));
    }
  }
  for (const route of routes) {
    if (typeof route?.alias === 'string' && !expectedAliases.has(route.alias)) {
      issues.push(issue('route_provider_drift', '$.routes', `route alias ${route.alias} is not present in registry snapshot`));
    }
  }
}

function validateDenialReasons(value, issues, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateDenialReasons(entry, issues, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    const reasonKey = key === 'reason' || key === 'denial_reason' || key === 'disabled_reason';
    if (reasonKey && typeof entry === 'string' && !supportedDenialReasons.has(entry)) {
      issues.push(issue('unsupported_denial_reason', childPath, `unsupported denial reason "${entry}"`));
    }
    validateDenialReasons(entry, issues, childPath);
  }
}

function validateProductionPosture(config, registry, policy, issues) {
  assertFalse(config?.production_disabled_posture?.production_enabled, '$.production_disabled_posture.production_enabled', 'generated config must keep production disabled', issues);
  assertFalse(config?.production_disabled_posture?.provider_credentials_enabled, '$.production_disabled_posture.provider_credentials_enabled', 'provider credentials must remain disabled', issues);
  assertFalse(config?.production_disabled_posture?.route_provisioning_enabled, '$.production_disabled_posture.route_provisioning_enabled', 'route provisioning must remain disabled', issues);
  if (config?.production_disabled_posture?.provider_count_enabled !== 0) {
    issues.push(issue('production_gate', '$.production_disabled_posture.provider_count_enabled', 'enabled provider count must remain 0'));
  }
  if (config?.production_disabled_posture?.route_count_enabled !== 0) {
    issues.push(issue('production_gate', '$.production_disabled_posture.route_count_enabled', 'enabled route count must remain 0'));
  }
  assertFalse(config?.production?.provider_credentials_enabled, '$.production.provider_credentials_enabled', 'provider credentials must not be enabled', issues);
  assertFalse(config?.production?.routes_enabled, '$.production.routes_enabled', 'production routes must not be enabled', issues);
  assertFalse(config?.production?.provisioning_enabled, '$.production.provisioning_enabled', 'production provisioning must not be enabled', issues);

  const aliasesByName = new Map(registry.model_aliases.map((alias) => [alias.alias, alias]));
  const policyByProvider = new Map(policy.providers.map((provider) => [provider.providerId, provider]));
  const routes = Array.isArray(config?.routes) ? config.routes : [];
  routes.forEach((route, index) => {
    if (route?.production_enabled !== true) return;
    const alias = aliasesByName.get(route.alias);
    if (!alias?.production_gate.production_enabled || !alias.production_gate.gate_result_ref) {
      issues.push(issue('production_gate', `$.routes[${index}]`, `production route ${route.alias} lacks matching registry gate evidence`));
    }
  });

  const candidates = Array.isArray(config?.provider_route_candidates) ? config.provider_route_candidates : [];
  candidates.forEach((candidate, index) => {
    if (candidate?.production_enabled !== true) return;
    const provider = policyByProvider.get(candidate.provider_id);
    if (!provider?.productionEnabled || provider.evalGate.status !== 'passed' || !provider.evalGate.evidenceRef) {
      issues.push(issue('production_gate', `$.provider_route_candidates[${index}]`, `production provider ${candidate.provider_id} lacks matching policy gate evidence`));
    }
  });

  for (const [providerId, providerConfig] of Object.entries(config?.providers ?? {})) {
    const providerPath = `$.providers.${providerId}`;
    assertFalse(providerConfig?.enabled, `${providerPath}.enabled`, 'Bifrost provider enablement must remain disabled', issues);
    assertFalse(providerConfig?.production_enabled, `${providerPath}.production_enabled`, 'Bifrost provider production enablement must remain disabled', issues);
    assertFalse(providerConfig?.credentials?.configured, `${providerPath}.credentials.configured`, 'provider credentials must remain unconfigured', issues);
    if (providerConfig?.credentials?.environment_variable !== null) {
      issues.push(issue('production_gate', `${providerPath}.credentials.environment_variable`, 'provider credential environment variables must remain null'));
    }
  }
}

function validateSnapshotFreshness(source, version, freshnessExpiresAt, now, path, issues) {
  if (typeof version !== 'string' || version.trim().length === 0) {
    issues.push(issue('policy_stale', `${path}.version`, `${source} version is missing`));
  }
  if (typeof freshnessExpiresAt !== 'string' || freshnessExpiresAt.trim().length === 0) {
    issues.push(issue('policy_stale', `${path}.freshness_expires_at`, `${source} freshness deadline is missing`));
    return;
  }
  const parsed = Date.parse(freshnessExpiresAt);
  if (Number.isNaN(parsed) || parsed <= now.getTime()) {
    issues.push(issue('policy_stale', `${path}.freshness_expires_at`, `${source} snapshot is stale`));
  }
}

function validateSnapshotMaxStaleness(source, createdAt, maxStalenessSeconds, now, path, issues) {
  if (maxStalenessSeconds === undefined || maxStalenessSeconds === null || maxStalenessSeconds === '') return;
  const maxSeconds = Number(maxStalenessSeconds);
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    issues.push(issue('policy_stale', path, `${source} max staleness must be a positive number of seconds`));
    return;
  }
  if (typeof createdAt !== 'string' || createdAt.trim().length === 0) {
    issues.push(issue('policy_stale', path, `${source} creation timestamp is missing for max-staleness validation`));
    return;
  }
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) {
    issues.push(issue('policy_stale', path, `${source} creation timestamp is invalid`));
    return;
  }
  if ((now.getTime() - parsed) / 1000 > maxSeconds) {
    issues.push(issue('policy_stale', path, `${source} snapshot exceeds BIFROST_POLICY_MAX_STALENESS_SECONDS`));
  }
}

function snapshotReference(source, version, createdAt, freshnessExpiresAt, snapshot) {
  return {
    source,
    version,
    checksum: checksumSnapshot(snapshot),
    freshness_deadline: freshnessExpiresAt,
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function pushNestedIssues(target, source, issues) {
  for (const nestedIssue of issues) {
    target.push(issue(nestedIssue.code, `$.${source}${nestedIssue.path.slice(1)}`, nestedIssue.message));
  }
}

function routeConfigVersion(registry, policy) {
  return `bifrost.${registry.registry_version}.${policy.matrixId}.disabled`;
}

function checksumSnapshot(snapshot) {
  return {
    algorithm: 'sha256',
    canonicalization: 'json-stable-key-sort-v0',
    checksum: createHash('sha256').update(JSON.stringify(sortKeys(snapshot))).digest('hex'),
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}

function candidateSignature(candidate) {
  return JSON.stringify(sortKeys(normalizeCandidateForDrift(candidate)));
}

function routeSignature(route) {
  return JSON.stringify(sortKeys(normalizeRouteForDrift(route)));
}

function normalizeRouteForDrift(route) {
  if (route?.production_enabled === true) return route;
  return { ...route, enabled: false };
}

function normalizeCandidateForDrift(candidate) {
  if (candidate?.production_enabled === true) return candidate;
  return { ...candidate, bifrost_enabled: false };
}

function issue(code, path, message) {
  return { code, path, message };
}

function assertFalse(value, path, message, issues) {
  if (value !== false) {
    issues.push(issue('production_gate', path, message));
  }
}

function sameStringSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function printValidationIssues(issues) {
  for (const validationIssue of issues) {
    console.error(`- [${validationIssue.code}] ${validationIssue.path}: ${validationIssue.message}`);
  }
}

function parseArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--registry' && next) {
      options.registry = next;
      index += 1;
    } else if (arg === '--policy' && next) {
      options.policy = next;
      index += 1;
    } else if (arg === '--config' && next) {
      options.config = next;
      index += 1;
    } else if (arg === '--out' && next) {
      options.out = next;
      index += 1;
    } else if (arg === '--report-out' && next) {
      options.reportOut = next;
      index += 1;
    } else if (arg === '--now' && next) {
      options.now = next;
      index += 1;
    } else if (arg === '--max-staleness-seconds' && next) {
      options.maxStalenessSeconds = next;
      index += 1;
    }
  }
  return { command, options };
}

function printHelp() {
  console.log('Usage: node --experimental-strip-types scripts\\bifrost-config.mjs <generate|validate> [--config path] [--out path] [--report-out path]');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
