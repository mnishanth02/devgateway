import { randomBytes, randomUUID } from 'node:crypto';

import {
  CONTENT_FIELD_PATTERNS,
  sanitizeLogFields,
  SECRET_FIELD_PATTERNS,
  type SanitizedLogValue,
} from './telemetry-safety.ts';

export * from './audit.ts';
export * from './cost.ts';
export * from './otel.ts';
export * from './telemetry-sinks.ts';
export * from './telemetry-safety.ts';

export type SamplingDecision = 'record' | 'drop' | 'defer';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RequestTraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: string;
  readonly tracestate?: string;
  readonly requestId: string;
  readonly samplingDecision: SamplingDecision;
}

export interface StructuredLogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly service: string;
  readonly event: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly requestId?: string;
  readonly fields: Readonly<Record<string, SanitizedLogValue>>;
}

export interface StructuredLogger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>, trace?: RequestTraceContext): void;
}

export interface RequestTraceFields {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: string;
  readonly tracestate?: string;
  readonly requestId: string;
  readonly samplingDecision: SamplingDecision;
}

export interface FastifyLikeRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly id?: string;
  devgatewayTrace?: RequestTraceContext;
}

export interface FastifyLikeReply {
  header(name: string, value: string): unknown;
}

export interface FastifyLikeServer {
  addHook(
    name: 'onRequest',
    hook: (request: FastifyLikeRequest, reply: FastifyLikeReply, done: (error?: Error) => void) => void,
  ): void;
}

export interface RequestTraceHookOptions {
  readonly responseHeaders?: boolean;
}

export interface GatewayMetricDimensions {
  readonly modelAlias?: string;
  readonly virtualKeyId?: string;
  readonly projectId?: string;
  readonly routeIntent?: string;
  readonly decisionReason?: string;
  readonly fallbackAttempt?: number;
}

export interface GatewayRequestMetricInput extends GatewayMetricDimensions {
  readonly latencyMs: number;
  readonly costEstimateUsd?: number;
}

export interface GatewayRequestMetric {
  readonly name: 'devgateway.gateway.request';
  readonly labels: Readonly<Record<string, string>>;
  readonly measurements: Readonly<{
    readonly latency_ms: number;
    readonly cost_estimate_usd?: number;
  }>;
}

export const observabilityPackage = {
  name: '@devgateway/observability',
  status: 'otel-logging-metrics-helpers',
} as const;

export function createRequestTraceContext(headers: Readonly<Record<string, string | string[] | undefined>>): RequestTraceContext {
  const parsedTraceparent = parseTraceparent(firstHeader(headers.traceparent));
  const traceId = parsedTraceparent?.traceId ?? randomHex(16);
  const parentSpanId = parsedTraceparent?.parentSpanId;
  const tracestate = sanitizeTraceState(firstHeader(headers.tracestate));
  const traceFlags = parsedTraceparent?.traceFlags ?? '00';
  const requestId = sanitizeRequestId(firstHeader(headers['x-devgateway-request-id'])) ?? randomUUID();
  return {
    traceId,
    spanId: randomHex(8),
    ...(parentSpanId ? { parentSpanId } : {}),
    traceFlags,
    ...(tracestate ? { tracestate } : {}),
    requestId,
    samplingDecision: parseSamplingDecision(firstHeader(headers['x-devgateway-sampling-decision'])),
  };
}

export function toTraceparent(context: RequestTraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

export function createRequestTraceHeaders(context: RequestTraceContext): Readonly<Record<string, string>> {
  return {
    traceparent: toTraceparent(context),
    'x-devgateway-request-id': context.requestId,
    'x-devgateway-sampling-decision': context.samplingDecision,
    ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
  };
}

export function createRequestTraceFields(context: RequestTraceContext): RequestTraceFields {
  return {
    traceId: context.traceId,
    spanId: context.spanId,
    ...(context.parentSpanId === undefined ? {} : { parentSpanId: context.parentSpanId }),
    traceFlags: context.traceFlags,
    ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
    requestId: context.requestId,
    samplingDecision: context.samplingDecision,
  };
}

export function attachRequestTraceContext<TRequest extends { readonly headers: Readonly<Record<string, string | string[] | undefined>> }>(
  request: TRequest,
): TRequest & { devgatewayTrace: RequestTraceContext } {
  const tracedRequest = request as TRequest & { devgatewayTrace: RequestTraceContext };
  tracedRequest.devgatewayTrace = createRequestTraceContext({
    ...request.headers,
    'x-devgateway-request-id': firstHeader(request.headers['x-devgateway-request-id']) ?? getRequestId(request),
  });
  return tracedRequest;
}

export function registerFastifyRequestTracing(server: FastifyLikeServer, options: RequestTraceHookOptions = {}): void {
  const includeResponseHeaders = options.responseHeaders ?? true;
  server.addHook('onRequest', (request, reply, done) => {
    try {
      const tracedRequest = attachRequestTraceContext(request);
      if (includeResponseHeaders) {
        for (const [key, value] of Object.entries(createRequestTraceHeaders(tracedRequest.devgatewayTrace))) {
          reply.header(key, value);
        }
      }
      done();
    } catch (error) {
      done(error instanceof Error ? error : new Error('Failed to attach request trace context'));
    }
  });
}

export function createGatewayMetricLabels(dimensions: GatewayMetricDimensions): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  addMetricLabel(labels, 'model_alias', dimensions.modelAlias);
  addMetricLabel(labels, 'virtual_key_id', dimensions.virtualKeyId);
  addMetricLabel(labels, 'project_id', dimensions.projectId);
  addMetricLabel(labels, 'route_intent', dimensions.routeIntent);
  addMetricLabel(labels, 'decision_reason', normalizeDecisionReason(dimensions.decisionReason));
  if (dimensions.fallbackAttempt !== undefined) {
    addMetricLabel(labels, 'fallback_attempt', Math.max(0, Math.trunc(dimensions.fallbackAttempt)).toString());
  }
  return labels;
}

export function createGatewayMetricDimensionsProvider(defaults: GatewayMetricDimensions = {}): (dimensions?: GatewayMetricDimensions) => Readonly<Record<string, string>> {
  return (dimensions = {}) => createGatewayMetricLabels({ ...defaults, ...dimensions });
}

export function createGatewayRequestMetric(input: GatewayRequestMetricInput): GatewayRequestMetric {
  return {
    name: 'devgateway.gateway.request',
    labels: createGatewayMetricLabels(input),
    measurements: {
      latency_ms: Math.max(0, input.latencyMs),
      ...(input.costEstimateUsd === undefined ? {} : { cost_estimate_usd: Math.max(0, input.costEstimateUsd) }),
    },
  };
}

export function createStructuredLogger(
  service: string,
  sink: (entry: StructuredLogEntry) => void = (entry) => {
    console.log(JSON.stringify(entry));
  },
): StructuredLogger {
  return {
    log(level, event, fields = {}, trace) {
      sink({
        timestamp: new Date().toISOString(),
        level,
        service,
        event,
        ...(trace ? {
          traceId: sanitizeTraceField(trace.traceId, 'trace_id') ?? randomHex(16),
          spanId: sanitizeTraceField(trace.spanId, 'span_id') ?? randomHex(8),
          requestId: sanitizeRequestId(trace.requestId) ?? randomUUID(),
        } : {}),
        fields: sanitizeLogFields(fields),
      });
    },
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getRequestId(request: unknown): string | undefined {
  if (request === null || typeof request !== 'object') return undefined;
  const id = (request as { readonly id?: unknown }).id;
  return typeof id === 'string' && id.trim().length > 0 ? id : undefined;
}

const allowedDecisionReasons = new Set([
  'budget',
  'rate_limit',
  'data_class',
  'provider_lifecycle',
  'eval_gate',
  'policy_stale',
  'route_disabled',
  'approval_required',
  'allow',
  'deny',
  'success',
  'error',
]);

function normalizeDecisionReason(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return allowedDecisionReasons.has(value) ? value : 'other';
}

function parseTraceparent(raw: string | undefined): { traceId: string; parentSpanId: string; traceFlags: string } | undefined {
  if (!raw) return undefined;
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/iu.exec(raw.trim());
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return {
    traceId: match[1].toLowerCase(),
    parentSpanId: match[2].toLowerCase(),
    traceFlags: match[3].toLowerCase(),
  };
}

function parseSamplingDecision(raw: string | undefined): SamplingDecision {
  if (raw === 'record' || raw === 'drop' || raw === 'defer') return raw;
  return 'record';
}

function sanitizeRequestId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || looksSensitiveTraceValue(trimmed)) return undefined;
  return trimmed.length > 128 ? trimmed.slice(0, 128) : trimmed;
}

function sanitizeTraceState(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || looksSensitiveTraceValue(trimmed)) return undefined;
  return trimmed;
}

function looksSensitiveTraceValue(value: string): boolean {
  return /^bearer\s+/iu.test(value) || /\bsk-[a-z0-9_-]{12,}\b/iu.test(value) || /\bdg_vk_[a-z0-9_-]{12,}\b/iu.test(value);
}

function sanitizeTraceField(raw: string, field: 'trace_id' | 'span_id'): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  const expected = field === 'trace_id' ? /^[a-f0-9]{32}$/u : /^[a-f0-9]{16}$/u;
  if (!expected.test(trimmed) || looksSensitiveTraceValue(trimmed)) return undefined;
  return trimmed;
}

function addMetricLabel(labels: Record<string, string>, key: string, value: string | undefined): void {
  if (value === undefined) return;
  if (SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(key)) || CONTENT_FIELD_PATTERNS.some((pattern) => pattern.test(key))) return;
  const normalized = normalizeMetricLabelValue(value);
  if (normalized !== undefined) {
    labels[key] = normalized;
  }
}

function normalizeMetricLabelValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (/^bearer\s+/iu.test(trimmed) || /^sk-[a-z0-9_-]{12,}$/iu.test(trimmed) || /^dg_vk_[a-z0-9_-]{12,}$/iu.test(trimmed)) return '[redacted]';
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
