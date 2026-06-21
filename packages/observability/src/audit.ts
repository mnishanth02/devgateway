import { randomUUID } from 'node:crypto';

import {
  gatewayControlContractVersion,
  type BudgetScopeType,
  type EnvironmentName,
  type GatewayControlContractVersion,
  type GatewayDecision,
  type PrincipalType,
} from '@devgateway/shared-types';

import { assertProductionTelemetrySink, type TelemetrySinkStatus } from './telemetry-sinks.ts';
import { assertNoForbiddenTelemetryFields } from './telemetry-safety.ts';

export type AuditOutcome = 'allow' | 'deny' | 'success' | 'failure' | 'error';
export type AuditTelemetryId = string | number;

export interface AuditTraceInput {
  readonly traceId: string;
  readonly requestId: string;
  readonly spanId?: string | null;
}

export interface AuditActorInput {
  readonly principalId: AuditTelemetryId;
  readonly principalType?: PrincipalType;
  readonly authSubjectRef?: string;
  readonly authUserId?: string;
}

export interface AuditProjectInput {
  readonly projectId: AuditTelemetryId;
  readonly tenantId?: string;
  readonly orgId?: string;
  readonly teamIds?: readonly string[];
  readonly environment?: EnvironmentName;
}

export interface AuditVirtualKeyInput {
  readonly virtualKeyId: AuditTelemetryId;
  readonly keyPrefix?: string;
  readonly budgetScopeId?: AuditTelemetryId;
  readonly budgetScopeType?: BudgetScopeType;
}

export interface AuditEventInput {
  readonly auditEventId?: string;
  readonly eventName?: string;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly decision?: GatewayDecision | null;
  readonly reason?: string | null;
  readonly actor?: AuditActorInput;
  readonly actorPrincipalId?: AuditTelemetryId | null;
  readonly principalId?: AuditTelemetryId | null;
  readonly targetPrincipalId?: AuditTelemetryId | null;
  readonly authUserId?: string | null;
  readonly project?: AuditProjectInput;
  readonly projectId?: AuditTelemetryId | null;
  readonly environment: EnvironmentName;
  readonly trace: AuditTraceInput;
  readonly policyVersion?: string | null;
  readonly registryVersion?: string | null;
  readonly virtualKey?: AuditVirtualKeyInput;
  readonly virtualKeyId?: AuditTelemetryId | null;
  readonly budgetScopeId?: AuditTelemetryId | null;
  readonly budgetScopeType?: BudgetScopeType | null;
  readonly modelAlias?: string | null;
  readonly providerId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: string;
}

export interface StructuredAuditEvent {
  readonly contract_version: GatewayControlContractVersion;
  readonly audit_event_id: string;
  readonly event_name: string;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly decision: GatewayDecision | null;
  readonly reason: string | null;
  readonly actor_principal_id: AuditTelemetryId | null;
  readonly principal_id: AuditTelemetryId | null;
  readonly target_principal_id: AuditTelemetryId | null;
  readonly principal_type: PrincipalType | null;
  readonly auth_subject_ref: string | null;
  readonly auth_user_id: string | null;
  readonly project_id: AuditTelemetryId | null;
  readonly tenant_id: string | null;
  readonly org_id: string | null;
  readonly team_ids: readonly string[];
  readonly virtual_key_id: AuditTelemetryId | null;
  readonly budget_scope_id: AuditTelemetryId | null;
  readonly budget_scope_type: BudgetScopeType | null;
  readonly model_alias: string | null;
  readonly provider_id: string | null;
  readonly trace_id: string;
  readonly request_id: string;
  readonly span_id: string | null;
  readonly policy_version: string | null;
  readonly registry_version: string | null;
  readonly environment: EnvironmentName;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface AuditEventContractRow {
  readonly audit_event_id: string;
  readonly event_name: string;
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly decision: GatewayDecision | null;
  readonly reason: string | null;
  readonly actor_principal_id: AuditTelemetryId | null;
  readonly principal_id: AuditTelemetryId | null;
  readonly target_principal_id: AuditTelemetryId | null;
  readonly project_id: AuditTelemetryId | null;
  readonly virtual_key_id: AuditTelemetryId | null;
  readonly budget_scope_id: AuditTelemetryId | null;
  readonly auth_user_id: string | null;
  readonly trace_id: string;
  readonly request_id: string;
  readonly span_id: string | null;
  readonly policy_version: string | null;
  readonly registry_version: string | null;
  readonly environment: EnvironmentName;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface AuditEventSink extends TelemetrySinkStatus {
  writeAuditEvent(event: StructuredAuditEvent): Promise<void> | void;
}

export interface InMemoryAuditEventSink extends AuditEventSink {
  readonly productionSafe: false;
  readonly events: readonly StructuredAuditEvent[];
}

export interface EmitAuditEventOptions {
  readonly environment?: EnvironmentName;
}

export function formatAuditEvent(input: AuditEventInput): StructuredAuditEvent {
  assertNoForbiddenTelemetryFields(input, 'audit event input');
  const actorPrincipalId = input.actor?.principalId ?? input.actorPrincipalId ?? null;
  const principalId = input.principalId ?? actorPrincipalId;
  const projectId = input.project?.projectId ?? input.projectId ?? null;
  const virtualKeyId = input.virtualKey?.virtualKeyId ?? input.virtualKeyId ?? null;
  const budgetScopeId = input.virtualKey?.budgetScopeId ?? input.budgetScopeId ?? null;
  const budgetScopeType = input.virtualKey?.budgetScopeType ?? input.budgetScopeType ?? null;
  const event: StructuredAuditEvent = {
    contract_version: gatewayControlContractVersion,
    audit_event_id: input.auditEventId ?? `audit_${randomUUID()}`,
    event_name: input.eventName ?? input.action,
    action: input.action,
    outcome: input.outcome,
    decision: input.decision ?? toDecision(input.outcome),
    reason: input.reason ?? null,
    actor_principal_id: actorPrincipalId,
    principal_id: principalId,
    target_principal_id: input.targetPrincipalId ?? null,
    principal_type: input.actor?.principalType ?? null,
    auth_subject_ref: input.actor?.authSubjectRef ?? null,
    auth_user_id: input.actor?.authUserId ?? input.authUserId ?? null,
    project_id: projectId,
    tenant_id: input.project?.tenantId ?? null,
    org_id: input.project?.orgId ?? null,
    team_ids: input.project?.teamIds ?? [],
    virtual_key_id: virtualKeyId,
    budget_scope_id: budgetScopeId,
    budget_scope_type: budgetScopeType,
    model_alias: input.modelAlias ?? null,
    provider_id: input.providerId ?? null,
    trace_id: requireNonEmpty(input.trace.traceId, 'trace.traceId'),
    request_id: requireNonEmpty(input.trace.requestId, 'trace.requestId'),
    span_id: input.trace.spanId ?? null,
    policy_version: input.policyVersion ?? null,
    registry_version: input.registryVersion ?? null,
    environment: input.project?.environment ?? input.environment,
    metadata: removeUndefined({
      ...input.metadata,
      ...(input.actor?.principalType === undefined ? {} : { principal_type: input.actor.principalType }),
      ...(input.actor?.authSubjectRef === undefined ? {} : { auth_subject_ref: input.actor.authSubjectRef }),
      ...(input.project?.tenantId === undefined ? {} : { tenant_id: input.project.tenantId }),
      ...(input.project?.orgId === undefined ? {} : { org_id: input.project.orgId }),
      ...(input.project?.teamIds === undefined ? {} : { team_ids: input.project.teamIds }),
      ...(budgetScopeType === null ? {} : { budget_scope_type: budgetScopeType }),
      ...(input.modelAlias === undefined || input.modelAlias === null ? {} : { model_alias: input.modelAlias }),
      ...(input.providerId === undefined || input.providerId === null ? {} : { provider_id: input.providerId }),
      ...(input.virtualKey?.keyPrefix === undefined ? {} : { key_prefix: input.virtualKey.keyPrefix }),
      contract_version: gatewayControlContractVersion,
    }),
    created_at: input.occurredAt ?? new Date().toISOString(),
  };
  assertNoForbiddenTelemetryFields(event, 'audit event');
  return event;
}

export async function emitAuditEvent(
  input: AuditEventInput,
  sink: AuditEventSink | undefined,
  options: EmitAuditEventOptions = {},
): Promise<StructuredAuditEvent> {
  const event = formatAuditEvent(input);
  assertProductionTelemetrySink('audit', options.environment ?? event.environment, sink);
  if (sink !== undefined) {
    await sink.writeAuditEvent(event);
  }
  return event;
}

export function createInMemoryAuditEventSink(): InMemoryAuditEventSink {
  const events: StructuredAuditEvent[] = [];
  return {
    productionSafe: false,
    get events() {
      return events;
    },
    writeAuditEvent(event) {
      events.push(event);
    },
  };
}

export function toAuditEventContractRow(event: StructuredAuditEvent): AuditEventContractRow {
  return {
    audit_event_id: event.audit_event_id,
    event_name: event.event_name,
    action: event.action,
    outcome: event.outcome,
    decision: event.decision,
    reason: event.reason,
    actor_principal_id: event.actor_principal_id,
    principal_id: event.principal_id,
    target_principal_id: event.target_principal_id,
    project_id: event.project_id,
    virtual_key_id: event.virtual_key_id,
    budget_scope_id: event.budget_scope_id,
    auth_user_id: event.auth_user_id,
    trace_id: event.trace_id,
    request_id: event.request_id,
    span_id: event.span_id,
    policy_version: event.policy_version,
    registry_version: event.registry_version,
    environment: event.environment,
    metadata: event.metadata,
    created_at: event.created_at,
  };
}

function toDecision(outcome: AuditOutcome): GatewayDecision | null {
  if (outcome === 'allow' || outcome === 'deny') return outcome;
  return null;
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`Audit event requires non-empty ${field}`);
  }
  return value;
}

function removeUndefined(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
