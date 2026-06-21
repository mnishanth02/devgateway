import { randomUUID } from 'node:crypto';

import {
  gatewayControlContractVersion,
  type CostAggregationTargets,
  type CostAttemptStatus,
  type CostEventRecord,
  type CostEventType,
  type CostMeasurement,
  type CostMeasurementSource,
  type DataClass,
  type DenialReasonCode,
  type EnvironmentName,
  type GatewayDecision,
  type RouteIntent,
  type UnitCostBasis,
} from '@devgateway/shared-types';

import { assertProductionTelemetrySink, type TelemetrySinkStatus } from './telemetry-sinks.ts';
import { assertNoForbiddenTelemetryFields } from './telemetry-safety.ts';

export interface CostTraceInput {
  readonly traceId: string;
  readonly requestId: string;
  readonly spanId?: string | null;
}

export type CostMeasurementInput = Partial<CostMeasurement>;

export type CostAggregationTargetsInput = Pick<CostAggregationTargets, 'reset_period_start' | 'reset_period_end'> &
  Partial<CostAggregationTargets>;

export interface CostEventInput {
  readonly costEventId?: string;
  readonly eventType: CostEventType;
  readonly trace: CostTraceInput;
  readonly virtualKeyId: string;
  readonly budgetScopeId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly environment: EnvironmentName;
  readonly routeIntent: RouteIntent;
  readonly dataClass: DataClass;
  readonly modelAlias: string;
  readonly providerId: string | null;
  readonly providerModelId: string | null;
  readonly providerCandidate?: string | null;
  readonly gatewayAttempt?: number;
  readonly fallbackAttempt?: number;
  readonly attemptStatus: CostAttemptStatus;
  readonly fallbackOfCostEventId?: string | null;
  readonly currency: string;
  readonly usageSource?: CostMeasurementSource;
  readonly decision: GatewayDecision;
  readonly estimated?: CostMeasurementInput;
  readonly actual?: CostMeasurementInput;
  readonly denialReason?: DenialReasonCode | null;
  readonly aggregationTargets: CostAggregationTargetsInput;
  readonly policyVersion: string;
  readonly registryVersion: string;
  readonly occurredAt?: string;
  readonly recordedAt?: string;
}

export interface CostEventContractRow {
  readonly cost_event_id: string;
  readonly event_type: CostEventType;
  readonly request_id: string;
  readonly trace_id: string;
  readonly span_id: string | null;
  readonly principal_id: string;
  readonly project_id: string;
  readonly virtual_key_id: string;
  readonly budget_scope_id: string;
  readonly policy_version: string;
  readonly registry_version: string;
  readonly environment: EnvironmentName;
  readonly route_intent: RouteIntent;
  readonly data_class: DataClass;
  readonly provider: string | null;
  readonly model_alias: string;
  readonly provider_model_id: string | null;
  readonly gateway_attempt: number;
  readonly fallback_attempt: number;
  readonly attempt_status: CostAttemptStatus;
  readonly currency: string;
  readonly estimated_input_tokens: number | null;
  readonly estimated_output_tokens: number | null;
  readonly estimated_total_tokens: number | null;
  readonly estimated_cost_amount: number | null;
  readonly actual_input_tokens: number | null;
  readonly actual_output_tokens: number | null;
  readonly actual_total_tokens: number | null;
  readonly actual_cost_amount: number | null;
  readonly usage_source: CostMeasurementSource;
  readonly decision: GatewayDecision;
  readonly denial_reason: DenialReasonCode | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

export interface CostEventSink extends TelemetrySinkStatus {
  writeCostEvent(event: CostEventRecord): Promise<void> | void;
}

export interface InMemoryCostEventSink extends CostEventSink {
  readonly productionSafe: false;
  readonly events: readonly CostEventRecord[];
}

export interface EmitCostEventOptions {
  readonly environment?: EnvironmentName;
}

export function formatCostEvent(input: CostEventInput): CostEventRecord {
  assertNoForbiddenTelemetryFields(input, 'cost event input');
  const estimated = formatCostMeasurement(input.estimated, 'registry_estimate');
  const actual = formatCostMeasurement(
    input.actual,
    input.eventType === 'actual' || input.eventType === 'reconciliation' ? 'gateway_counter' : 'not_available',
  );
  const usageSource = input.usageSource ?? (actual.source === 'not_available' ? estimated.source : actual.source);
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const baseEvent = {
    contract_version: gatewayControlContractVersion,
    cost_event_id: input.costEventId ?? `cost_${randomUUID()}`,
    event_type: input.eventType,
    trace_id: requireNonEmpty(input.trace.traceId, 'trace.traceId'),
    request_id: requireNonEmpty(input.trace.requestId, 'trace.requestId'),
    virtual_key_id: requireNonEmpty(input.virtualKeyId, 'virtualKeyId'),
    budget_scope_id: requireNonEmpty(input.budgetScopeId, 'budgetScopeId'),
    principal_id: requireNonEmpty(input.principalId, 'principalId'),
    project_id: requireNonEmpty(input.projectId, 'projectId'),
    environment: input.environment,
    route_intent: input.routeIntent,
    data_class: input.dataClass,
    model_alias: requireNonEmpty(input.modelAlias, 'modelAlias'),
    provider_id: input.providerId,
    provider_model_id: input.providerModelId,
    gateway_attempt: positiveInteger(input.gatewayAttempt ?? 1, 'gatewayAttempt'),
    fallback_attempt: nonNegativeInteger(input.fallbackAttempt ?? 0, 'fallbackAttempt'),
    attempt_status: input.attemptStatus,
    currency: formatCurrency(input.currency),
    usage_source: usageSource,
    decision: input.decision,
    estimated,
    actual,
    aggregation_targets: formatAggregationTargets(input),
    policy_version: requireNonEmpty(input.policyVersion, 'policyVersion'),
    registry_version: requireNonEmpty(input.registryVersion, 'registryVersion'),
    occurred_at: occurredAt,
    recorded_at: input.recordedAt ?? new Date().toISOString(),
  } satisfies Omit<CostEventRecord, 'span_id' | 'provider_candidate' | 'fallback_of_cost_event_id' | 'denial_reason'>;

  const event: CostEventRecord = {
    ...baseEvent,
    ...(input.trace.spanId === undefined ? {} : { span_id: input.trace.spanId }),
    ...(input.providerCandidate === undefined ? {} : { provider_candidate: input.providerCandidate }),
    ...(input.fallbackOfCostEventId === undefined
      ? {}
      : { fallback_of_cost_event_id: input.fallbackOfCostEventId }),
    ...(input.denialReason === undefined ? {} : { denial_reason: input.denialReason }),
  };
  validateCostDecision(event);
  assertNoForbiddenTelemetryFields(event, 'cost event');
  return event;
}

export async function emitCostEvent(
  input: CostEventInput,
  sink: CostEventSink | undefined,
  options: EmitCostEventOptions = {},
): Promise<CostEventRecord> {
  const event = formatCostEvent(input);
  assertProductionTelemetrySink('cost', options.environment ?? event.environment, sink);
  if (sink !== undefined) {
    await sink.writeCostEvent(event);
  }
  return event;
}

export function createInMemoryCostEventSink(): InMemoryCostEventSink {
  const events: CostEventRecord[] = [];
  return {
    productionSafe: false,
    get events() {
      return events;
    },
    writeCostEvent(event) {
      events.push(event);
    },
  };
}

export function toCostEventContractRow(event: CostEventRecord): CostEventContractRow {
  return {
    cost_event_id: event.cost_event_id,
    event_type: event.event_type,
    request_id: event.request_id,
    trace_id: event.trace_id,
    span_id: event.span_id ?? null,
    principal_id: event.principal_id,
    project_id: event.project_id,
    virtual_key_id: event.virtual_key_id,
    budget_scope_id: event.budget_scope_id,
    policy_version: event.policy_version,
    registry_version: event.registry_version,
    environment: event.environment,
    route_intent: event.route_intent,
    data_class: event.data_class,
    provider: event.provider_id,
    model_alias: event.model_alias,
    provider_model_id: event.provider_model_id,
    gateway_attempt: event.gateway_attempt,
    fallback_attempt: event.fallback_attempt,
    attempt_status: event.attempt_status,
    currency: event.currency,
    estimated_input_tokens: event.estimated.input_tokens,
    estimated_output_tokens: event.estimated.output_tokens,
    estimated_total_tokens: totalTokens(event.estimated),
    estimated_cost_amount: event.estimated.cost_amount,
    actual_input_tokens: event.actual.input_tokens,
    actual_output_tokens: event.actual.output_tokens,
    actual_total_tokens: totalTokens(event.actual),
    actual_cost_amount: event.actual.cost_amount,
    usage_source: event.usage_source,
    decision: event.decision,
    denial_reason: event.denial_reason ?? null,
    metadata: removeUndefined({
      provider_candidate: event.provider_candidate,
      fallback_of_cost_event_id: event.fallback_of_cost_event_id,
      estimated: event.estimated,
      actual: event.actual,
      aggregation_targets: event.aggregation_targets,
      contract_version: event.contract_version,
      occurred_at: event.occurred_at,
      recorded_at: event.recorded_at,
    }),
    created_at: event.recorded_at,
  };
}

function formatCostMeasurement(input: CostMeasurementInput | undefined, defaultSource: CostMeasurementSource): CostMeasurement {
  const source = input?.source ?? defaultSource;
  return {
    input_tokens: nullableNonNegativeInteger(input?.input_tokens ?? null, 'input_tokens'),
    output_tokens: nullableNonNegativeInteger(input?.output_tokens ?? null, 'output_tokens'),
    cache_read_tokens: nullableNonNegativeInteger(input?.cache_read_tokens ?? null, 'cache_read_tokens'),
    cache_write_tokens: nullableNonNegativeInteger(input?.cache_write_tokens ?? null, 'cache_write_tokens'),
    reasoning_tokens: nullableNonNegativeInteger(input?.reasoning_tokens ?? null, 'reasoning_tokens'),
    cost_amount: nullableNonNegativeNumber(input?.cost_amount ?? null, 'cost_amount'),
    unit_cost_basis: input?.unit_cost_basis ?? (source === 'not_available' ? 'not_applicable' : 'per_million_tokens'),
    source,
  };
}

function formatAggregationTargets(input: CostEventInput): CostAggregationTargets {
  const targets = input.aggregationTargets;
  return {
    tenant_id: targets.tenant_id ?? null,
    org_id: targets.org_id ?? null,
    team_id: targets.team_id ?? null,
    project_id: targets.project_id ?? input.projectId,
    principal_id: targets.principal_id ?? input.principalId,
    virtual_key_id: targets.virtual_key_id ?? input.virtualKeyId,
    budget_scope_id: targets.budget_scope_id ?? input.budgetScopeId,
    model_alias: targets.model_alias ?? input.modelAlias,
    provider_id: targets.provider_id ?? input.providerId,
    environment: targets.environment ?? input.environment,
    route_intent: targets.route_intent ?? input.routeIntent,
    data_class: targets.data_class ?? input.dataClass,
    reset_period_start: requireNonEmpty(targets.reset_period_start, 'aggregationTargets.reset_period_start'),
    reset_period_end: requireNonEmpty(targets.reset_period_end, 'aggregationTargets.reset_period_end'),
  };
}

function validateCostDecision(event: CostEventRecord): void {
  if (event.decision === 'deny' && (event.denial_reason === undefined || event.denial_reason === null)) {
    throw new Error('Denied cost events require denialReason');
  }
  if (event.event_type === 'denial_estimate' && event.decision !== 'deny') {
    throw new Error('denial_estimate cost events must have decision=deny');
  }
  if (event.event_type === 'estimate' || event.event_type === 'denial_estimate') {
    if (event.actual.source !== 'not_available' || event.actual.cost_amount !== null) {
      throw new Error(`${event.event_type} cost events must not include actual usage or cost`);
    }
  }
}

function totalTokens(measurement: CostMeasurement): number | null {
  const parts = [
    measurement.input_tokens,
    measurement.output_tokens,
    measurement.cache_read_tokens,
    measurement.cache_write_tokens,
    measurement.reasoning_tokens,
  ];
  if (parts.every((part) => part === null)) return null;
  return parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}

function formatCurrency(currency: string): string {
  const formatted = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(formatted)) {
    throw new Error('Cost event currency must be an ISO-4217 three-letter code');
  }
  return formatted;
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`Cost event requires non-empty ${field}`);
  }
  return value;
}

function positiveInteger(value: number, field: string): number {
  const normalized = Math.trunc(value);
  if (!Number.isFinite(value) || normalized < 1) {
    throw new Error(`Cost event ${field} must be an integer >= 1`);
  }
  return normalized;
}

function nonNegativeInteger(value: number, field: string): number {
  const normalized = Math.trunc(value);
  if (!Number.isFinite(value) || normalized < 0) {
    throw new Error(`Cost event ${field} must be an integer >= 0`);
  }
  return normalized;
}

function nullableNonNegativeInteger(value: number | null, field: string): number | null {
  if (value === null) return null;
  return nonNegativeInteger(value, field);
}

function nullableNonNegativeNumber(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Cost event ${field} must be >= 0`);
  }
  return value;
}

function removeUndefined(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
