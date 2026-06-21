import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  budgetScopeTypes,
  gatewayControlContractVersion,
  routeIntents,
  type BudgetScopeType,
  type EnvironmentName,
  type PrincipalBinding,
  type PrincipalType,
  type ProjectBinding,
  type VirtualKeyRecord,
  type VirtualKeyScopeConstraints,
  type VirtualKeyStatus,
} from '../../../../packages/shared-types/src/gateway-control.ts';

import {
  isControlDeniedError,
  missingAuthControlError,
  productionDisabledRouteControlError,
  revokedKeyControlError,
  stalePolicyControlError,
  toControlDeniedErrorBody,
} from '../policies/control-errors.ts';

export const VIRTUAL_KEYS_BASE_PATH = '/api/virtual-keys' as const;

export interface ControlRouteDefinition {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly handler: (request: ControlRouteRequest, reply?: ControlRouteReply) => Promise<unknown>;
}

export interface ControlRouteRegistrar {
  route(route: ControlRouteDefinition): unknown;
}

export interface ControlRouteRequest {
  readonly headers?: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
  readonly params?: unknown;
  readonly query?: unknown;
}

export interface ControlRouteReply {
  code(statusCode: number): ControlRouteReply;
}

export interface ControlRouteAuthContext {
  readonly principalId: string;
  readonly authSubjectRef: string;
}

export interface VirtualKeyRouteOptions {
  readonly runtimeEnvironment?: EnvironmentName | 'production';
  readonly store?: VirtualKeyStore;
  readonly authenticate?: (request: ControlRouteRequest) => ControlRouteAuthContext | Promise<ControlRouteAuthContext>;
}

export interface VirtualKeyStore {
  create(input: CreateVirtualKeyRequest, actor: ControlRouteAuthContext): Promise<VirtualKeyIssuanceResponse>;
  list(filter: VirtualKeyListFilter): Promise<VirtualKeyPublicRecord[]>;
  get(virtualKeyId: string): Promise<VirtualKeyPublicRecord | null>;
  rotate(
    virtualKeyId: string,
    input: RotateVirtualKeyRequest,
    actor: ControlRouteAuthContext,
  ): Promise<VirtualKeyRotationResponse>;
  revoke(
    virtualKeyId: string,
    input: RevokeVirtualKeyRequest,
    actor: ControlRouteAuthContext,
  ): Promise<VirtualKeyRevokeResponse>;
}

export interface CreateVirtualKeyRequest {
  readonly principal_id: string;
  readonly principal_type?: PrincipalType | undefined;
  readonly auth_subject_ref?: string | undefined;
  readonly project_id: string;
  readonly tenant_id?: string | undefined;
  readonly org_id?: string | undefined;
  readonly team_ids?: readonly string[] | undefined;
  readonly budget_scope_id: string;
  readonly budget_scope_type?: BudgetScopeType | undefined;
  readonly environment?: EnvironmentName | undefined;
  readonly scope_constraints: VirtualKeyScopeConstraints;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly policy_snapshot_checksum?: string | undefined;
  readonly registry_snapshot_checksum?: string | undefined;
  readonly expires_at: string;
  readonly not_before?: string | null | undefined;
  readonly idempotency_key?: string | undefined;
}

export interface RotateVirtualKeyRequest {
  readonly policy_version: string;
  readonly registry_version: string;
  readonly expires_at: string;
  readonly overlap_expires_at?: string | undefined;
}

export interface RevokeVirtualKeyRequest {
  readonly revocation_reason: string;
  readonly request_id?: string | undefined;
  readonly trace_id?: string | undefined;
}

export interface VirtualKeyListFilter {
  readonly principal_id?: string | undefined;
  readonly project_id?: string | undefined;
  readonly budget_scope_id?: string | undefined;
  readonly status?: VirtualKeyStatus | undefined;
}

export type VirtualKeyPublicRecord = Pick<
  VirtualKeyRecord,
  | 'contract_version'
  | 'virtual_key_id'
  | 'external_key_id'
  | 'key_prefix'
  | 'status'
  | 'production_posture'
  | 'principal_binding'
  | 'project_binding'
  | 'scope_constraints'
  | 'budget_scope_ref'
  | 'policy_version'
  | 'registry_version'
  | 'issued_at'
  | 'not_before'
  | 'expires_at'
  | 'rotation'
  | 'revocation'
  | 'created_at'
  | 'updated_at'
> & {
  readonly policy_snapshot_checksum?: string;
  readonly registry_snapshot_checksum?: string;
  readonly last_used?: VirtualKeyRecord['last_used'];
};

export interface OneTimeVirtualKeySecret {
  readonly format: 'devgateway_virtual_key_placeholder';
  readonly value: string;
  readonly shown_once: true;
}

export interface VirtualKeyIssuanceResponse {
  readonly virtual_key: VirtualKeyPublicRecord;
  readonly one_time_secret: OneTimeVirtualKeySecret;
  readonly created_audit_event_id: string;
}

export interface VirtualKeyRotationResponse {
  readonly previous_virtual_key_id: string;
  readonly previous_status: 'rotating';
  readonly previous_overlap_expires_at: string | null;
  readonly rotated_virtual_key: VirtualKeyPublicRecord;
  readonly one_time_secret: OneTimeVirtualKeySecret;
  readonly audit_event_ids: readonly string[];
}

export interface VirtualKeyRevokeResponse {
  readonly virtual_key_id: string;
  readonly status: 'revoked';
  readonly revoked_at: string;
  readonly revoked_audit_event_id: string;
}

class ControlRouteValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'invalid_request';

  constructor(message: string) {
    super(message);
    this.name = 'ControlRouteValidationError';
  }
}

export class InMemoryVirtualKeyStore implements VirtualKeyStore {
  readonly #records = new Map<string, VirtualKeyRecord>();

  async create(input: CreateVirtualKeyRequest, actor: ControlRouteAuthContext): Promise<VirtualKeyIssuanceResponse> {
    assertNoForbiddenSecretFields(input);
    assertPolicyPins(input.policy_version, input.registry_version);
    assertNonEmptyString(input.principal_id, 'principal_id');
    assertNonEmptyString(input.project_id, 'project_id');
    assertNonEmptyString(input.budget_scope_id, 'budget_scope_id');
    assertScopeConstraints(input.scope_constraints);
    assertValidActivationWindow(input);

    const now = new Date().toISOString();
    const secret = issuePlaceholderSecret();
    const virtualKeyId = `vk_${randomUUID()}`;
    const auditEventId = `audit_${randomUUID()}`;
    const record: VirtualKeyRecord = {
      contract_version: gatewayControlContractVersion,
      virtual_key_id: virtualKeyId,
      external_key_id: `ext_${virtualKeyId}`,
      key_prefix: deriveKeyPrefix(secret.value),
      key_fingerprint_sha256: sha256Hex(secret.value),
      key_hash_ref: `placeholder-hash-ref:${sha256Hex(`${secret.value}:hash-ref`)}`,
      status: 'active',
      production_posture: {
        production_enabled: false,
        success_fallback_allowed: false,
        fail_closed_without_policy: true,
      },
      principal_binding: toPrincipalBinding(input, actor),
      project_binding: toProjectBinding(input),
      scope_constraints: input.scope_constraints,
      budget_scope_ref: {
        budget_scope_id: input.budget_scope_id,
        budget_scope_type: input.budget_scope_type ?? 'virtual_key',
      },
      policy_version: input.policy_version,
      registry_version: input.registry_version,
      ...(input.policy_snapshot_checksum === undefined ? {} : { policy_snapshot_checksum: input.policy_snapshot_checksum }),
      ...(input.registry_snapshot_checksum === undefined
        ? {}
        : { registry_snapshot_checksum: input.registry_snapshot_checksum }),
      issued_at: now,
      not_before: input.not_before ?? null,
      expires_at: input.expires_at,
      rotation: {
        rotation_state: 'not_scheduled',
        rotated_from_virtual_key_id: null,
        rotated_to_virtual_key_id: null,
        rotation_due_at: null,
      },
      revocation: {
        revoked_at: null,
        revoked_by_principal_id: null,
        revocation_reason: null,
      },
      audit_correlation: {
        created_audit_event_id: auditEventId,
        last_audit_event_id: null,
        trace_id: `trace_${randomUUID()}`,
      },
      created_at: now,
      updated_at: now,
    };
    this.#records.set(record.virtual_key_id, record);
    return {
      virtual_key: toPublicVirtualKey(record),
      one_time_secret: secret,
      created_audit_event_id: auditEventId,
    };
  }

  async list(filter: VirtualKeyListFilter): Promise<VirtualKeyPublicRecord[]> {
    return [...this.#records.values()]
      .filter((record) => filter.principal_id === undefined || record.principal_binding.principal_id === filter.principal_id)
      .filter((record) => filter.project_id === undefined || record.project_binding.project_id === filter.project_id)
      .filter((record) => filter.budget_scope_id === undefined || record.budget_scope_ref.budget_scope_id === filter.budget_scope_id)
      .filter((record) => filter.status === undefined || record.status === filter.status)
      .map(toPublicVirtualKey);
  }

  async get(virtualKeyId: string): Promise<VirtualKeyPublicRecord | null> {
    const record = this.#records.get(virtualKeyId);
    return record === undefined ? null : toPublicVirtualKey(record);
  }

  async rotate(
    virtualKeyId: string,
    input: RotateVirtualKeyRequest,
    actor: ControlRouteAuthContext,
  ): Promise<VirtualKeyRotationResponse> {
    assertNoForbiddenSecretFields(input);
    assertPolicyPins(input.policy_version, input.registry_version);
    const previous = this.#records.get(virtualKeyId);
    if (previous === undefined) {
      throw new ControlRouteValidationError(`Unknown virtual_key_id: ${virtualKeyId}`);
    }
    if (previous.status === 'revoked') {
      throw revokedKeyControlError({ virtual_key_id: virtualKeyId });
    }
    assertValidRotationWindow(input, previous.scope_constraints);

    const now = new Date().toISOString();
    const secret = issuePlaceholderSecret();
    const newVirtualKeyId = `vk_${randomUUID()}`;
    const createdAuditEventId = `audit_${randomUUID()}`;
    const previousAuditEventId = `audit_${randomUUID()}`;
    const updatedPrevious: VirtualKeyRecord = {
      ...previous,
      status: 'rotating',
      rotation: {
        rotation_state: 'in_progress',
        rotated_from_virtual_key_id: previous.rotation.rotated_from_virtual_key_id,
        rotated_to_virtual_key_id: newVirtualKeyId,
        rotation_due_at: input.overlap_expires_at ?? null,
      },
      audit_correlation: {
        ...previous.audit_correlation,
        last_audit_event_id: previousAuditEventId,
      },
      updated_at: now,
    };
    const rotated: VirtualKeyRecord = {
      ...previous,
      virtual_key_id: newVirtualKeyId,
      external_key_id: `ext_${newVirtualKeyId}`,
      key_prefix: deriveKeyPrefix(secret.value),
      key_fingerprint_sha256: sha256Hex(secret.value),
      key_hash_ref: `placeholder-hash-ref:${sha256Hex(`${secret.value}:hash-ref`)}`,
      status: 'active',
      policy_version: input.policy_version,
      registry_version: input.registry_version,
      issued_at: now,
      expires_at: input.expires_at,
      rotation: {
        rotation_state: 'completed',
        rotated_from_virtual_key_id: previous.virtual_key_id,
        rotated_to_virtual_key_id: null,
        rotation_due_at: null,
      },
      revocation: {
        revoked_at: null,
        revoked_by_principal_id: null,
        revocation_reason: null,
      },
      audit_correlation: {
        created_audit_event_id: createdAuditEventId,
        last_audit_event_id: null,
        trace_id: `trace_${randomUUID()}`,
      },
      created_at: now,
      updated_at: now,
    };
    void actor;
    this.#records.set(previous.virtual_key_id, updatedPrevious);
    this.#records.set(rotated.virtual_key_id, rotated);
    return {
      previous_virtual_key_id: previous.virtual_key_id,
      previous_status: 'rotating',
      previous_overlap_expires_at: input.overlap_expires_at ?? null,
      rotated_virtual_key: toPublicVirtualKey(rotated),
      one_time_secret: secret,
      audit_event_ids: [previousAuditEventId, createdAuditEventId],
    };
  }

  async revoke(
    virtualKeyId: string,
    input: RevokeVirtualKeyRequest,
    actor: ControlRouteAuthContext,
  ): Promise<VirtualKeyRevokeResponse> {
    assertNoForbiddenSecretFields(input);
    assertNonEmptyString(input.revocation_reason, 'revocation_reason');
    const existing = this.#records.get(virtualKeyId);
    if (existing === undefined) {
      throw new ControlRouteValidationError(`Unknown virtual_key_id: ${virtualKeyId}`);
    }
    const revokedAt = new Date().toISOString();
    const auditEventId = `audit_${randomUUID()}`;
    const updated: VirtualKeyRecord = {
      ...existing,
      status: 'revoked',
      revocation: {
        revoked_at: revokedAt,
        revoked_by_principal_id: actor.principalId,
        revocation_reason: input.revocation_reason,
      },
      audit_correlation: {
        ...existing.audit_correlation,
        last_audit_event_id: auditEventId,
        ...(input.trace_id === undefined ? {} : { trace_id: input.trace_id }),
      },
      updated_at: revokedAt,
    };
    this.#records.set(virtualKeyId, updated);
    return {
      virtual_key_id: virtualKeyId,
      status: 'revoked',
      revoked_at: revokedAt,
      revoked_audit_event_id: auditEventId,
    };
  }
}

export function createInMemoryVirtualKeyStore(): VirtualKeyStore {
  return new InMemoryVirtualKeyStore();
}

export function registerVirtualKeyRoutes(registrar: ControlRouteRegistrar, options: VirtualKeyRouteOptions = {}): void {
  const store = options.store ?? createInMemoryVirtualKeyStore();

  registrar.route({
    method: 'POST',
    url: VIRTUAL_KEYS_BASE_PATH,
    schema: createVirtualKeySchema,
    handler: async (request, reply) =>
      handleKnownRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'virtual-key-create');
        const actor = await authenticateControlRequest(request, options);
        return respond(reply, 201, await store.create(asCreateVirtualKeyRequest(request.body), actor));
      }),
  });

  registrar.route({
    method: 'GET',
    url: VIRTUAL_KEYS_BASE_PATH,
    schema: listVirtualKeysSchema,
    handler: async (request, reply) =>
      handleKnownRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'virtual-key-list');
        await authenticateControlRequest(request, options);
        return respond(reply, 200, { virtual_keys: await store.list(asVirtualKeyListFilter(request.query)) });
      }),
  });

  registrar.route({
    method: 'GET',
    url: `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/status`,
    schema: getVirtualKeyStatusSchema,
    handler: async (request, reply) =>
      handleKnownRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'virtual-key-status');
        await authenticateControlRequest(request, options);
        const record = await store.get(getVirtualKeyIdParam(request.params));
        if (record === null) {
          throw new ControlRouteValidationError('Unknown virtual_key_id.');
        }
        return respond(reply, 200, {
          virtual_key_id: record.virtual_key_id,
          status: record.status,
          expires_at: record.expires_at,
          policy_version: record.policy_version,
          registry_version: record.registry_version,
          revocation: record.revocation,
        });
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/rotate`,
    schema: rotateVirtualKeySchema,
    handler: async (request, reply) =>
      handleKnownRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'virtual-key-rotate');
        const actor = await authenticateControlRequest(request, options);
        return respond(
          reply,
          201,
          await store.rotate(getVirtualKeyIdParam(request.params), asRotateVirtualKeyRequest(request.body), actor),
        );
      }),
  });

  registrar.route({
    method: 'POST',
    url: `${VIRTUAL_KEYS_BASE_PATH}/:virtual_key_id/revoke`,
    schema: revokeVirtualKeySchema,
    handler: async (request, reply) =>
      handleKnownRouteErrors(reply, async () => {
        assertRouteEnabledOutsideProduction(options, 'virtual-key-revoke');
        const actor = await authenticateControlRequest(request, options);
        return respond(
          reply,
          200,
          await store.revoke(getVirtualKeyIdParam(request.params), asRevokeVirtualKeyRequest(request.body), actor),
        );
      }),
  });
}

function toPublicVirtualKey(record: VirtualKeyRecord): VirtualKeyPublicRecord {
  return {
    contract_version: record.contract_version,
    virtual_key_id: record.virtual_key_id,
    external_key_id: record.external_key_id,
    key_prefix: record.key_prefix,
    status: record.status,
    production_posture: record.production_posture,
    principal_binding: record.principal_binding,
    project_binding: record.project_binding,
    scope_constraints: record.scope_constraints,
    budget_scope_ref: record.budget_scope_ref,
    policy_version: record.policy_version,
    registry_version: record.registry_version,
    ...(record.policy_snapshot_checksum === undefined ? {} : { policy_snapshot_checksum: record.policy_snapshot_checksum }),
    ...(record.registry_snapshot_checksum === undefined
      ? {}
      : { registry_snapshot_checksum: record.registry_snapshot_checksum }),
    issued_at: record.issued_at,
    not_before: record.not_before,
    expires_at: record.expires_at,
    rotation: record.rotation,
    revocation: record.revocation,
    ...(record.last_used === undefined ? {} : { last_used: record.last_used }),
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function toPrincipalBinding(input: CreateVirtualKeyRequest, actor: ControlRouteAuthContext): PrincipalBinding {
  return {
    principal_id: input.principal_id,
    principal_type: input.principal_type ?? 'service_account',
    auth_subject_ref: input.auth_subject_ref ?? actor.authSubjectRef,
  };
}

function toProjectBinding(input: CreateVirtualKeyRequest): ProjectBinding {
  return {
    project_id: input.project_id,
    tenant_id: input.tenant_id ?? 'tenant_nonproduction_placeholder',
    org_id: input.org_id ?? 'org_nonproduction_placeholder',
    team_ids: input.team_ids ?? [],
    environment: input.environment ?? 'development',
  };
}

async function authenticateControlRequest(
  request: ControlRouteRequest,
  options: VirtualKeyRouteOptions,
): Promise<ControlRouteAuthContext> {
  if (options.authenticate !== undefined) {
    return options.authenticate(request);
  }
  const principalId = getHeaderValue(request.headers, 'x-devgateway-principal-id');
  if (principalId === undefined || principalId.trim() === '') {
    throw missingAuthControlError({ header: 'x-devgateway-principal-id' });
  }
  return {
    principalId,
    authSubjectRef: getHeaderValue(request.headers, 'x-devgateway-auth-subject') ?? principalId,
  };
}

function assertRouteEnabledOutsideProduction(options: VirtualKeyRouteOptions, route: string): void {
  if ((options.runtimeEnvironment ?? process.env.NODE_ENV) === 'production') {
    throw productionDisabledRouteControlError({
      route,
      store: 'in_memory_placeholder',
      contract: 'virtual-key production issuance requires approved DB-backed enforcement',
    });
  }
}

function asCreateVirtualKeyRequest(body: unknown): CreateVirtualKeyRequest {
  return createVirtualKeyRequestSchema.parse(body);
}

function asRotateVirtualKeyRequest(body: unknown): RotateVirtualKeyRequest {
  return rotateVirtualKeyRequestSchema.parse(body);
}

function asRevokeVirtualKeyRequest(body: unknown): RevokeVirtualKeyRequest {
  return revokeVirtualKeyRequestSchema.parse(body);
}

function asVirtualKeyListFilter(query: unknown): VirtualKeyListFilter {
  if (query === undefined) return {};
  return virtualKeyListQuerySchema.parse(query);
}

function getVirtualKeyIdParam(params: unknown): string {
  assertObject(params, 'route params');
  const value = (params as Readonly<Record<string, unknown>>).virtual_key_id;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ControlRouteValidationError('virtual_key_id route parameter is required.');
  }
  return value;
}

function assertPolicyPins(policyVersion: string, registryVersion: string): void {
  if (typeof policyVersion !== 'string' || policyVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'policy_version' });
  }
  if (typeof registryVersion !== 'string' || registryVersion.trim() === '') {
    throw stalePolicyControlError({ field: 'registry_version' });
  }
}

function assertScopeConstraints(value: VirtualKeyScopeConstraints): void {
  assertObject(value, 'scope_constraints');
  assertNonEmptyArray(value.route_intents, 'scope_constraints.route_intents');
  assertNonEmptyArray(value.data_classes, 'scope_constraints.data_classes');
  assertNonEmptyArray(value.model_aliases, 'scope_constraints.model_aliases');
  assertNonEmptyArray(value.provider_candidates, 'scope_constraints.provider_candidates');
}

function assertNoForbiddenSecretFields(value: unknown, path = 'body'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (/provider.*(key|secret|token)|api[_-]?key|raw[_-]?secret|virtual[_-]?key[_-]?secret/i.test(key)) {
      throw new ControlRouteValidationError(`Forbidden secret-bearing field is not accepted: ${path}.${key}`);
    }
    assertNoForbiddenSecretFields(nested, `${path}.${key}`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ControlRouteValidationError(`${field} is required.`);
  }
}

function assertNonEmptyArray(value: readonly unknown[], field: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw stalePolicyControlError({ field });
  }
}

function assertValidFutureInstant(value: string, field: string): void {
  assertNonEmptyString(value, field);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ControlRouteValidationError(`${field} must be an ISO timestamp.`);
  }
}

function assertValidActivationWindow(input: CreateVirtualKeyRequest): void {
  const expiresAt = parseInstant(input.expires_at, 'expires_at');
  if (expiresAt <= Date.now()) {
    throw new ControlRouteValidationError('expires_at must be in the future.');
  }
  if (input.not_before !== undefined && input.not_before !== null) {
    const notBefore = parseInstant(input.not_before, 'not_before');
    if (notBefore >= expiresAt) {
      throw new ControlRouteValidationError('not_before must be before expires_at.');
    }
  }

  if (input.scope_constraints.max_expires_at !== null) {
    const maxExpiresAt = parseInstant(input.scope_constraints.max_expires_at, 'scope_constraints.max_expires_at');
    if (expiresAt > maxExpiresAt) {
      throw new ControlRouteValidationError('expires_at must not exceed scope_constraints.max_expires_at.');
    }
  }
}

function assertValidRotationWindow(input: RotateVirtualKeyRequest, scopeConstraints: VirtualKeyScopeConstraints): void {
  const expiresAt = parseInstant(input.expires_at, 'expires_at');
  if (expiresAt <= Date.now()) {
    throw new ControlRouteValidationError('expires_at must be in the future.');
  }
  if (input.overlap_expires_at !== undefined) {
    const overlapExpiresAt = parseInstant(input.overlap_expires_at, 'overlap_expires_at');
    if (overlapExpiresAt <= Date.now()) {
      throw new ControlRouteValidationError('overlap_expires_at must be in the future.');
    }
    if (overlapExpiresAt > expiresAt) {
      throw new ControlRouteValidationError('overlap_expires_at must not exceed expires_at.');
    }
  }
  if (scopeConstraints.max_expires_at !== null) {
    const maxExpiresAt = parseInstant(scopeConstraints.max_expires_at, 'scope_constraints.max_expires_at');
    if (expiresAt > maxExpiresAt) {
      throw new ControlRouteValidationError('expires_at must not exceed scope_constraints.max_expires_at.');
    }
  }
}

function parseInstant(value: string, field: string): number {
  assertValidFutureInstant(value, field);
  return Date.parse(value);
}

function assertObject(value: unknown, label: string): asserts value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ControlRouteValidationError(`${label} must be an object.`);
  }
}

function issuePlaceholderSecret(): OneTimeVirtualKeySecret {
  return {
    format: 'devgateway_virtual_key_placeholder',
    value: `dg_vk_${randomBytes(24).toString('base64url')}`,
    shown_once: true,
  };
}

function deriveKeyPrefix(secret: string): string {
  return secret.slice(0, 14);
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function getHeaderValue(
  headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (typeof direct === 'string') return direct;
  return direct?.[0];
}

async function handleKnownRouteErrors(
  reply: ControlRouteReply | undefined,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (error) {
    if (isControlDeniedError(error)) {
      return respond(reply, error.statusCode, toControlDeniedErrorBody(error));
    }
    if (error instanceof ControlRouteValidationError) {
      return respond(reply, error.statusCode, { error: { code: error.code, message: error.message } });
    }
    if (error instanceof z.ZodError) {
      return respond(reply, 400, { error: { code: 'invalid_request', message: z.prettifyError(error) } });
    }
    throw error;
  }
}

function respond<T>(reply: ControlRouteReply | undefined, statusCode: number, body: T): T {
  reply?.code(statusCode);
  return body;
}

const virtualKeyPublicResponseSchema = z
  .object({
    virtual_key_id: z.string(),
    key_prefix: z.string(),
    status: z.string(),
    principal_binding: z.record(z.string(), z.unknown()),
    project_binding: z.record(z.string(), z.unknown()),
    budget_scope_ref: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const environmentSchema = z.enum(['development', 'test', 'staging', 'production']);
const principalTypeSchema = z.enum(['user', 'service_account', 'automation', 'system']);
const budgetScopeTypeSchema = z.enum(budgetScopeTypes);
const virtualKeyStatusSchema = z.enum(['draft', 'active', 'rotating', 'revoked', 'expired', 'disabled']);
const dataClassSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);
const routeIntentSchema = z.enum(routeIntents);

const scopeConstraintsSchema = z
  .object({
    route_intents: z.array(routeIntentSchema).min(1),
    data_classes: z.array(dataClassSchema).min(1),
    model_aliases: z.array(z.string().min(1)).min(1),
    provider_candidates: z.array(z.string().min(1)),
    max_expires_at: z.string().min(1).nullable(),
  })
  .strict();

const createVirtualKeyRequestSchema = z
  .object({
    principal_id: z.string().min(1),
    principal_type: principalTypeSchema.optional(),
    auth_subject_ref: z.string().min(1).optional(),
    project_id: z.string().min(1),
    tenant_id: z.string().min(1).optional(),
    org_id: z.string().min(1).optional(),
    team_ids: z.array(z.string().min(1)).optional(),
    budget_scope_id: z.string().min(1),
    budget_scope_type: budgetScopeTypeSchema.optional(),
    environment: environmentSchema.optional(),
    scope_constraints: scopeConstraintsSchema,
    policy_version: z.string().min(1),
    registry_version: z.string().min(1),
    policy_snapshot_checksum: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional(),
    registry_snapshot_checksum: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional(),
    expires_at: z.string().min(1),
    not_before: z.string().min(1).nullable().optional(),
    idempotency_key: z.string().min(1).optional(),
  })
  .strict();

const rotateVirtualKeyRequestSchema = z
  .object({
    policy_version: z.string().min(1),
    registry_version: z.string().min(1),
    expires_at: z.string().min(1),
    overlap_expires_at: z.string().min(1).optional(),
  })
  .strict();

const revokeVirtualKeyRequestSchema = z
  .object({
    revocation_reason: z.string().min(1),
    request_id: z.string().min(1).optional(),
    trace_id: z.string().min(1).optional(),
  })
  .strict();

const virtualKeyListQuerySchema = z
  .object({
    principal_id: z.string().min(1).optional(),
    project_id: z.string().min(1).optional(),
    budget_scope_id: z.string().min(1).optional(),
    status: virtualKeyStatusSchema.optional(),
  })
  .strict();

const virtualKeyParamsSchema = z.object({ virtual_key_id: z.string().min(1) }).strict();

export const createVirtualKeySchema = {
  tags: ['control-api', 'virtual-keys'],
  summary: 'Issue a non-production placeholder virtual key',
  description:
    'Request body follows the shared gateway-control virtual-key contract: principal/project/budget binding, scope_constraints, policy_version, registry_version, and expires_at.',
  body: createVirtualKeyRequestSchema,
  response: {
    201: z.object({
      virtual_key: virtualKeyPublicResponseSchema,
      one_time_secret: z.object({
        format: z.literal('devgateway_virtual_key_placeholder'),
        value: z.string(),
        shown_once: z.literal(true),
      }),
      created_audit_event_id: z.string(),
    }),
  },
} as const;

export const listVirtualKeysSchema = {
  tags: ['control-api', 'virtual-keys'],
  summary: 'List virtual key metadata without raw secrets',
  description: 'Supports principal_id, project_id, budget_scope_id, and status query filters.',
  querystring: virtualKeyListQuerySchema,
  response: {
    200: z.object({
      virtual_keys: z.array(virtualKeyPublicResponseSchema),
    }),
  },
} as const;

export const getVirtualKeyStatusSchema = {
  tags: ['control-api', 'virtual-keys'],
  summary: 'Inspect virtual key status without exposing secret material',
  params: virtualKeyParamsSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;

export const rotateVirtualKeySchema = {
  tags: ['control-api', 'virtual-keys'],
  summary: 'Rotate a virtual key and return the new placeholder secret once',
  description: 'Request body requires policy_version, registry_version, expires_at, and optional overlap_expires_at.',
  params: virtualKeyParamsSchema,
  body: rotateVirtualKeyRequestSchema,
  response: { 201: z.record(z.string(), z.unknown()) },
} as const;

export const revokeVirtualKeySchema = {
  tags: ['control-api', 'virtual-keys'],
  summary: 'Revoke a virtual key immediately',
  description: 'Request body requires revocation_reason and may include request_id and trace_id.',
  params: virtualKeyParamsSchema,
  body: revokeVirtualKeyRequestSchema,
  response: { 200: z.record(z.string(), z.unknown()) },
} as const;
