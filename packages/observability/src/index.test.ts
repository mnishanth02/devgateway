import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createGatewayMetricDimensionsProvider,
  createGatewayMetricLabels,
  createGatewayRequestMetric,
  createOtlpHttpExporterConfig,
  createInMemoryAuditEventSink,
  createInMemoryCostEventSink,
  attachRequestTraceContext,
  createRequestTraceContext,
  createRequestTraceHeaders,
  createResourceAttributes,
  createStructuredLogger,
  emitAuditEvent,
  emitCostEvent,
  ForbiddenTelemetryFieldError,
  formatAuditEvent,
  formatCostEvent,
  initializeNodeOpenTelemetry,
  registerFastifyRequestTracing,
  sanitizeLogFields,
  TelemetrySinkUnavailableError,
  toAuditEventContractRow,
  toCostEventContractRow,
  toTraceparent,
  type FastifyLikeReply,
  type FastifyLikeRequest,
  type AuditEventInput,
  type CostEventInput,
  type OpenTelemetryRuntime,
} from './index.ts';

describe('observability trace and log helpers', () => {
  it('parses W3C traceparent and preserves request correlation', () => {
    const context = createRequestTraceContext({
      traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
      'x-devgateway-request-id': 'req_123',
      'x-devgateway-sampling-decision': 'drop',
    });

    assert.equal(context.traceId, '0123456789abcdef0123456789abcdef');
    assert.equal(context.parentSpanId, '0123456789abcdef');
    assert.equal(context.requestId, 'req_123');
    assert.equal(context.samplingDecision, 'drop');
    assert.match(toTraceparent(context), /^00-0123456789abcdef0123456789abcdef-[a-f0-9]{16}-01$/u);
  });

  it('sanitizes caller-provided trace fields before structured logging', () => {
    const entries: unknown[] = [];
    const logger = createStructuredLogger('control-api', (entry: unknown) => entries.push(entry));

    logger.log('info', 'test.event', {}, {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: '01',
      requestId: 'dg_vk_rawSecretExample1234567890',
      samplingDecision: 'record',
    });

    const entry = entries[0] as { requestId: string };
    assert.notEqual(entry.requestId, 'dg_vk_rawSecretExample1234567890');
  });

  it('drops secret-shaped request id and tracestate values before propagation', () => {
    const context = createRequestTraceContext({
      'x-devgateway-request-id': 'dg_vk_rawSecretExample1234567890',
      tracestate: 'vendor=sk-abcdefghijklmnopqrstuvwxyz',
    });

    assert.notEqual(context.requestId, 'dg_vk_rawSecretExample1234567890');
    assert.equal(context.tracestate, undefined);
    const headers = createRequestTraceHeaders(context);
    assert.notEqual(headers['x-devgateway-request-id'], 'dg_vk_rawSecretExample1234567890');
    assert.equal(headers.tracestate, undefined);
  });

  it('redacts secret-shaped log fields', () => {
    assert.deepEqual(sanitizeLogFields({ providerToken: 'secret', providerKey: 'pk-live', apiKey: 'ak', route: 'healthz' }), {
      providerToken: '[redacted]',
      providerKey: '[redacted]',
      apiKey: '[redacted]',
      route: 'healthz',
    });
  });

  it('redacts secret-shaped values in neutral log fields and metric labels', () => {
    assert.deepEqual(sanitizeLogFields({ detail: 'sk-abcdefghijklmnopqrstuvwxyz', key: 'safe' }), {
      detail: '[redacted]',
      key: 'safe',
    });
    assert.deepEqual(
      createGatewayMetricLabels({ virtualKeyId: 'dg_vk_rawSecretExample1234567890' }),
      { virtual_key_id: '[redacted]' },
    );
  });

  it('recursively redacts nested secret-shaped log fields before serialization', () => {
    assert.deepEqual(sanitizeLogFields({ metadata: { token: 'nested-secret', route: 'healthz' } }), {
      metadata: JSON.stringify({ token: '[redacted]', route: 'healthz' }),
    });
  });

  it('omits prompt and completion content from structured log fields', () => {
    assert.deepEqual(
      sanitizeLogFields({
        prompt: 'user supplied prompt',
        completion: 'model output',
        metadata: { prompt: 'nested prompt', route: 'gateway' },
        route: 'gateway',
      }),
      {
        metadata: JSON.stringify({ route: 'gateway' }),
        route: 'gateway',
      },
    );
  });

  it('creates safe OpenTelemetry resource attributes', () => {
    assert.deepEqual(
      createResourceAttributes({
        serviceName: 'control-api',
        environment: 'production',
        version: '1.2.3',
        deployment: 'railway-prod',
        project: 'devgateway',
        attributes: {
          'service.namespace': 'devgateway',
          'custom.api_key': 'must-not-appear',
          'devgateway.virtual_key_id': 'dg_vk_rawSecretExample1234567890',
          'devgateway.context': 'id=dg_vk_rawSecretExample1234567890',
          other: 'token sk-abcdefghijklmnopqrstuvwxyz',
          empty: '',
        },
      }),
      {
        'service.name': 'control-api',
        'deployment.environment.name': 'production',
        'service.version': '1.2.3',
        'devgateway.deployment': 'railway-prod',
        'devgateway.project': 'devgateway',
        'service.namespace': 'devgateway',
      },
    );
  });

  it('initializes injected Node OpenTelemetry runtime with OTLP HTTP exporters', async () => {
    const createdExporters: Readonly<Record<string, unknown>>[] = [];
    let sdkConfig: Readonly<Record<string, unknown>> | undefined;
    let shutdownCalled = false;
    class Exporter {
      constructor(options: Readonly<Record<string, unknown>>) {
        createdExporters.push(options);
      }
    }
    class MetricReader {
      constructor(options: Readonly<Record<string, unknown>>) {
        createdExporters.push(options);
      }
    }
    class NodeSdk {
      constructor(options: Readonly<Record<string, unknown>>) {
        sdkConfig = options;
      }

      start(): void {
        return undefined;
      }

      shutdown(): void {
        shutdownCalled = true;
      }
    }
    const runtime: OpenTelemetryRuntime = {
      NodeSDK: NodeSdk,
      OTLPTraceExporter: Exporter,
      OTLPMetricExporter: Exporter,
      PeriodicExportingMetricReader: MetricReader,
      resourceFromAttributes: (attributes) => ({ attributes }),
    };

    const handle = await initializeNodeOpenTelemetry({
      enabled: true,
      serviceName: 'control-api',
      environment: 'test',
      traces: { exporter: { url: 'http://collector:4318/v1/traces', headers: { authorization: 'Bearer redacted-at-source' } } },
      metrics: { exportIntervalMillis: 30_000, exporter: { url: 'http://collector:4318/v1/metrics' } },
      runtime,
    });

    assert.equal(handle.enabled, true);
    assert.equal(sdkConfig?.resource !== undefined, true);
    assert.deepEqual(createdExporters[0], { url: 'http://collector:4318/v1/traces', headers: { authorization: 'Bearer redacted-at-source' } });
    assert.deepEqual(createdExporters[1], { url: 'http://collector:4318/v1/metrics' });
    assert.equal((createdExporters[2] as Readonly<Record<string, unknown>>).exportIntervalMillis, 30_000);
    await handle.shutdown();
    assert.equal(shutdownCalled, true);
  });

  it('does not swallow enabled OpenTelemetry setup errors', async () => {
    class Exporter {
      readonly options: Readonly<Record<string, unknown>>;

      constructor(options: Readonly<Record<string, unknown>>) {
        this.options = options;
      }
    }
    class MetricReader {
      readonly options: Readonly<Record<string, unknown>>;

      constructor(options: Readonly<Record<string, unknown>>) {
        this.options = options;
      }
    }
    class FailingNodeSdk {
      readonly options: Readonly<Record<string, unknown>>;

      constructor(options: Readonly<Record<string, unknown>>) {
        this.options = options;
      }

      start(): void {
        throw new Error('otel boom');
      }

      shutdown(): void {
        return undefined;
      }
    }
    const runtime: OpenTelemetryRuntime = {
      NodeSDK: FailingNodeSdk,
      OTLPTraceExporter: Exporter,
      OTLPMetricExporter: Exporter,
      PeriodicExportingMetricReader: MetricReader,
    };

    await assert.rejects(
      () => initializeNodeOpenTelemetry({ enabled: true, serviceName: 'control-api', environment: 'production', runtime }),
      /otel boom/u,
    );
    assert.deepEqual(createOtlpHttpExporterConfig({ url: 'http://collector', timeoutMillis: 10_000 }), {
      url: 'http://collector',
      timeoutMillis: 10_000,
    });
  });

  it('builds gateway metric labels and measurements without prompt or key material', () => {
    assert.deepEqual(
      createGatewayMetricLabels({
        modelAlias: 'claude-fast',
        virtualKeyId: 'vk_123',
        projectId: 'proj_123',
        routeIntent: 'chat',
        decisionReason: 'dynamic upstream error with request id 123',
        fallbackAttempt: 2.8,
      }),
      {
        model_alias: 'claude-fast',
        virtual_key_id: 'vk_123',
        project_id: 'proj_123',
        route_intent: 'chat',
        decision_reason: 'other',
        fallback_attempt: '2',
      },
    );

    const metric = createGatewayRequestMetric({
      modelAlias: 'claude-fast',
      virtualKeyId: 'Bearer raw-secret',
      latencyMs: 42.5,
      costEstimateUsd: 0.0012,
    });

    it('uses Fastify request id when request-id header is absent', () => {
      const request = attachRequestTraceContext({
        id: 'fastify-req-1',
        headers: {},
      });

      assert.equal(request.devgatewayTrace.requestId, 'fastify-req-1');
    });
    assert.equal(metric.measurements.latency_ms, 42.5);
    assert.equal(metric.measurements.cost_estimate_usd, 0.0012);
    assert.equal(metric.labels.virtual_key_id, '[redacted]');
  });

  it('merges gateway metric label defaults through the dimensions provider', () => {
    const labelsFor = createGatewayMetricDimensionsProvider({ projectId: 'proj-default', routeIntent: 'chat' });
    assert.deepEqual(labelsFor({ modelAlias: 'gpt-4o-mini', routeIntent: 'embeddings' }), {
      project_id: 'proj-default',
      route_intent: 'embeddings',
      model_alias: 'gpt-4o-mini',
    });
  });

  it('registers a Fastify-compatible request tracing hook', () => {
    let onRequest: ((request: FastifyLikeRequest, reply: FastifyLikeReply, done: (error?: Error) => void) => void) | undefined;
    registerFastifyRequestTracing({
      addHook(_name, hook) {
        onRequest = hook;
      },
    });
    assert.ok(onRequest);

    const request: FastifyLikeRequest = {
      headers: {
        traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        'x-devgateway-request-id': 'req_hook',
      },
    };
    const responseHeaders: Record<string, string> = {};
    const reply: FastifyLikeReply = {
      header(name, value) {
        responseHeaders[name] = value;
      },
    };

    onRequest(request, reply, (error) => {
      assert.equal(error, undefined);
    });

    assert.equal(request.devgatewayTrace?.traceId, '0123456789abcdef0123456789abcdef');
    assert.equal(request.devgatewayTrace?.requestId, 'req_hook');
    assert.ok(responseHeaders.traceparent);
    assert.match(responseHeaders.traceparent, /^00-0123456789abcdef0123456789abcdef-[a-f0-9]{16}-01$/u);
    assert.equal(responseHeaders['x-devgateway-request-id'], 'req_hook');
  });
});

describe('audit telemetry helpers', () => {
  it('formats gateway-contract audit fields and contract rows', () => {
    const event = formatAuditEvent(baseAuditInput());

    assert.equal(event.contract_version, '0.1.0');
    assert.equal(event.event_name, 'gateway.request.policy');
    assert.equal(event.actor_principal_id, 'principal_1');
    assert.equal(event.principal_id, 'principal_1');
    assert.equal(event.project_id, 'project_1');
    assert.equal(event.action, 'gateway.request.authorize');
    assert.equal(event.outcome, 'allow');
    assert.equal(event.decision, 'allow');
    assert.equal(event.policy_version, 'policy_v1');
    assert.equal(event.registry_version, 'registry_v1');
    assert.equal(event.trace_id, 'trace_123');
    assert.equal(event.request_id, 'req_123');
    assert.equal(event.virtual_key_id, 'vk_123');
    assert.equal(event.budget_scope_id, 'budget_123');
    assert.equal(event.model_alias, 'claude-fast');
    assert.equal(event.provider_id, 'anthropic');

    assert.deepEqual(toAuditEventContractRow(event), {
      audit_event_id: event.audit_event_id,
      event_name: 'gateway.request.policy',
      action: 'gateway.request.authorize',
      outcome: 'allow',
      decision: 'allow',
      reason: 'policy_allow',
      actor_principal_id: 'principal_1',
      principal_id: 'principal_1',
      target_principal_id: null,
      project_id: 'project_1',
      virtual_key_id: 'vk_123',
      budget_scope_id: 'budget_123',
      auth_user_id: 'auth_user_1',
      trace_id: 'trace_123',
      request_id: 'req_123',
      span_id: 'span_123',
      policy_version: 'policy_v1',
      registry_version: 'registry_v1',
      environment: 'test',
      metadata: event.metadata,
      created_at: event.created_at,
    });
  });

  it('fails closed for missing or test audit sinks in production', async () => {
    await assert.rejects(() => emitAuditEvent(baseAuditInput(), undefined, { environment: 'production' }), TelemetrySinkUnavailableError);
    await assert.rejects(
      () => emitAuditEvent(baseAuditInput(), createInMemoryAuditEventSink(), { environment: 'production' }),
      TelemetrySinkUnavailableError,
    );
  });

  it('uses the effective project environment for audit sink fail-closed decisions', async () => {
    await assert.rejects(
      () =>
        emitAuditEvent(
          baseAuditInput({
            environment: 'development',
            project: {
              projectId: 'project_1',
              environment: 'production',
            },
          }),
          createInMemoryAuditEventSink(),
        ),
      TelemetrySinkUnavailableError,
    );
  });

  it('allows explicit non-production audit sinks', async () => {
    const sink = createInMemoryAuditEventSink();
    const event = await emitAuditEvent(baseAuditInput(), sink);

    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0], event);
  });

  it('rejects prompt, completion, provider-key, and raw virtual-key fields', () => {
    assert.throws(
      () => formatAuditEvent(baseAuditInput({ metadata: { prompt: 'do not record' } })),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatAuditEvent(baseAuditInput({ metadata: { providerKey: 'pk-live' } })),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatAuditEvent(baseAuditInput({ metadata: { raw_virtual_key: 'vk-secret' } })),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatAuditEvent(baseAuditInput({ metadata: { detail: 'dg_vk_rawSecretExample1234567890' } })),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatAuditEvent(baseAuditInput({ metadata: { detail: 'sk-abcdefghijklmnopqrstuvwxyz' } })),
      ForbiddenTelemetryFieldError,
    );
  });
});

describe('cost telemetry helpers', () => {
  it('formats gateway-contract cost fields and contract rows', () => {
    const event = formatCostEvent(baseCostInput());

    assert.equal(event.contract_version, '0.1.0');
    assert.equal(event.event_type, 'actual');
    assert.equal(event.currency, 'USD');
    assert.equal(event.provider_id, 'anthropic');
    assert.equal(event.model_alias, 'claude-fast');
    assert.equal(event.virtual_key_id, 'vk_123');
    assert.equal(event.budget_scope_id, 'budget_123');
    assert.equal(event.trace_id, 'trace_123');
    assert.equal(event.request_id, 'req_123');
    assert.equal(event.gateway_attempt, 2);
    assert.equal(event.fallback_attempt, 1);
    assert.equal(event.estimated.input_tokens, 10);
    assert.equal(event.estimated.cost_amount, 0.01);
    assert.equal(event.actual.output_tokens, 25);
    assert.equal(event.actual.cost_amount, 0.02);
    assert.equal(event.aggregation_targets.project_id, 'project_1');

    const row = toCostEventContractRow(event);
    assert.equal(row.provider, 'anthropic');
    assert.equal(row.estimated_total_tokens, 30);
    assert.equal(row.actual_total_tokens, 40);
    assert.equal(row.actual_cost_amount, 0.02);
    assert.equal(row.metadata.aggregation_targets, event.aggregation_targets);
  });

  it('fails closed for missing or test cost sinks in production', async () => {
    await assert.rejects(() => emitCostEvent(baseCostInput(), undefined, { environment: 'production' }), TelemetrySinkUnavailableError);
    await assert.rejects(
      () => emitCostEvent(baseCostInput(), createInMemoryCostEventSink(), { environment: 'production' }),
      TelemetrySinkUnavailableError,
    );
  });

  it('allows explicit non-production cost sinks', async () => {
    const sink = createInMemoryCostEventSink();
    const event = await emitCostEvent(baseCostInput(), sink);

    assert.equal(sink.events.length, 1);
    assert.equal(sink.events[0], event);
  });

  it('rejects forbidden cost event fields before emission', () => {
    assert.throws(
      () => formatCostEvent({ ...baseCostInput(), estimated: { prompt_tokens: 100 } } as never),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatCostEvent({ ...baseCostInput(), providerKey: 'provider-secret' } as never),
      ForbiddenTelemetryFieldError,
    );
    assert.throws(
      () => formatCostEvent({ ...baseCostInput(), rawVirtualKey: 'vk-secret' } as never),
      ForbiddenTelemetryFieldError,
    );
  });
});

function baseAuditInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    eventName: 'gateway.request.policy',
    action: 'gateway.request.authorize',
    outcome: 'allow',
    reason: 'policy_allow',
    actor: {
      principalId: 'principal_1',
      principalType: 'user',
      authSubjectRef: 'subject_1',
      authUserId: 'auth_user_1',
    },
    project: {
      projectId: 'project_1',
      tenantId: 'tenant_1',
      orgId: 'org_1',
      teamIds: ['team_1'],
      environment: 'test',
    },
    environment: 'test',
    trace: { traceId: 'trace_123', requestId: 'req_123', spanId: 'span_123' },
    policyVersion: 'policy_v1',
    registryVersion: 'registry_v1',
    virtualKey: {
      virtualKeyId: 'vk_123',
      budgetScopeId: 'budget_123',
      budgetScopeType: 'virtual_key',
      keyPrefix: 'dg_v1',
    },
    modelAlias: 'claude-fast',
    providerId: 'anthropic',
    metadata: { route_intent: 'chat' },
    ...overrides,
  };
}

function baseCostInput(overrides: Partial<CostEventInput> = {}): CostEventInput {
  return {
    eventType: 'actual',
    trace: { traceId: 'trace_123', requestId: 'req_123', spanId: 'span_123' },
    virtualKeyId: 'vk_123',
    budgetScopeId: 'budget_123',
    principalId: 'principal_1',
    projectId: 'project_1',
    environment: 'test',
    routeIntent: 'chat',
    dataClass: 'internal',
    modelAlias: 'claude-fast',
    providerId: 'anthropic',
    providerModelId: 'claude-3-5-sonnet',
    providerCandidate: 'anthropic-primary',
    gatewayAttempt: 2,
    fallbackAttempt: 1,
    attemptStatus: 'succeeded',
    currency: 'usd',
    usageSource: 'provider_reported',
    decision: 'allow',
    estimated: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      cost_amount: 0.01,
      unit_cost_basis: 'per_million_tokens',
      source: 'registry_estimate',
    },
    actual: {
      input_tokens: 15,
      output_tokens: 25,
      cache_read_tokens: null,
      cache_write_tokens: null,
      reasoning_tokens: null,
      cost_amount: 0.02,
      unit_cost_basis: 'per_million_tokens',
      source: 'provider_reported',
    },
    aggregationTargets: {
      tenant_id: 'tenant_1',
      org_id: 'org_1',
      team_id: 'team_1',
      reset_period_start: '2026-06-01T00:00:00.000Z',
      reset_period_end: '2026-07-01T00:00:00.000Z',
    },
    policyVersion: 'policy_v1',
    registryVersion: 'registry_v1',
    ...overrides,
  };
}
