export type DeploymentEnvironment = 'development' | 'test' | 'staging' | 'production' | (string & {});

export interface ResourceAttributeOptions {
  readonly serviceName: string;
  readonly environment?: DeploymentEnvironment;
  readonly version?: string;
  readonly deployment?: string;
  readonly project?: string;
  readonly attributes?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

export interface OtlpHttpExporterOptions {
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMillis?: number;
  readonly compression?: 'gzip' | 'none';
  readonly concurrencyLimit?: number;
  readonly temporalityPreference?: 'cumulative' | 'delta' | 'lowmemory';
}

export interface OpenTelemetrySignalOptions {
  readonly enabled?: boolean;
  readonly exporter?: OtlpHttpExporterOptions;
}

export interface OpenTelemetryMetricOptions extends OpenTelemetrySignalOptions {
  readonly exportIntervalMillis?: number;
  readonly exportTimeoutMillis?: number;
}

export interface OpenTelemetryLogger {
  error(message: string, error: unknown): void;
  warn?(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info?(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface NodeOpenTelemetryOptions extends ResourceAttributeOptions {
  readonly enabled?: boolean;
  readonly traces?: OpenTelemetrySignalOptions;
  readonly metrics?: OpenTelemetryMetricOptions;
  readonly logger?: OpenTelemetryLogger;
  readonly runtime?: OpenTelemetryRuntime;
}

export interface OpenTelemetryHandle {
  readonly enabled: boolean;
  readonly resourceAttributes: Readonly<Record<string, string | number | boolean>>;
  readonly reason?: string;
  shutdown(): Promise<void>;
}

export interface OpenTelemetryRuntime {
  readonly NodeSDK: new (options: Readonly<Record<string, unknown>>) => OpenTelemetrySdkInstance;
  readonly OTLPTraceExporter: new (options: Readonly<Record<string, unknown>>) => unknown;
  readonly OTLPMetricExporter: new (options: Readonly<Record<string, unknown>>) => unknown;
  readonly PeriodicExportingMetricReader: new (options: Readonly<Record<string, unknown>>) => unknown;
  readonly resourceFromAttributes?: (attributes: Readonly<Record<string, string | number | boolean>>) => unknown;
  readonly Resource?: new (attributes: Readonly<Record<string, string | number | boolean>>) => unknown;
}

export interface OpenTelemetrySdkInstance {
  start(): void | Promise<void>;
  shutdown(): void | Promise<void>;
}

const SENSITIVE_ATTRIBUTE_PATTERNS = [/secret/iu, /token/iu, /password/iu, /credential/iu, /authorization/iu, /cookie/iu, /api[_-]?key/iu, /prompt/iu, /completion/iu] as const;

export function createResourceAttributes(options: ResourceAttributeOptions): Readonly<Record<string, string | number | boolean>> {
  const attributes: Record<string, string | number | boolean> = {};
  addSafeAttribute(attributes, 'service.name', options.serviceName);
  addSafeAttribute(attributes, 'deployment.environment.name', options.environment);
  addSafeAttribute(attributes, 'service.version', options.version);
  addSafeAttribute(attributes, 'devgateway.deployment', options.deployment);
  addSafeAttribute(attributes, 'devgateway.project', options.project);

  for (const [key, value] of Object.entries(options.attributes ?? {})) {
    addSafeAttribute(attributes, key, value);
  }

  return attributes;
}

export async function initializeNodeOpenTelemetry(options: NodeOpenTelemetryOptions): Promise<OpenTelemetryHandle> {
  const resourceAttributes = createResourceAttributes(options);
  const production = options.environment === 'production' || process.env.NODE_ENV === 'production';
  const enabled = options.enabled ?? production;

  if (!enabled) {
    return disabledOpenTelemetryHandle(resourceAttributes, 'disabled');
  }

  const tracesEnabled = options.traces?.enabled ?? true;
  const metricsEnabled = options.metrics?.enabled ?? true;
  if (!tracesEnabled && !metricsEnabled) {
    return disabledOpenTelemetryHandle(resourceAttributes, 'all-signals-disabled');
  }

  try {
    const runtime = options.runtime ?? (await loadOpenTelemetryRuntime());
    const sdkConfig: Record<string, unknown> = {
      resource: createRuntimeResource(runtime, resourceAttributes),
    };

    if (tracesEnabled) {
      sdkConfig.traceExporter = new runtime.OTLPTraceExporter(createOtlpHttpExporterConfig(options.traces?.exporter));
    }

    if (metricsEnabled) {
      const metricExporter = new runtime.OTLPMetricExporter(createOtlpHttpExporterConfig(options.metrics?.exporter));
      sdkConfig.metricReader = new runtime.PeriodicExportingMetricReader({
        exporter: metricExporter,
        ...(options.metrics?.exportIntervalMillis === undefined ? {} : { exportIntervalMillis: options.metrics.exportIntervalMillis }),
        ...(options.metrics?.exportTimeoutMillis === undefined ? {} : { exportTimeoutMillis: options.metrics.exportTimeoutMillis }),
      });
    }

    const sdk = new runtime.NodeSDK(sdkConfig);
    await sdk.start();

    return {
      enabled: true,
      resourceAttributes,
      async shutdown() {
        await sdk.shutdown();
      },
    };
  } catch (error) {
    options.logger?.error('OpenTelemetry SDK initialization failed', error);
    throw error;
  }
}

export function createOtlpHttpExporterConfig(options: OtlpHttpExporterOptions = {}): Readonly<Record<string, unknown>> {
  return {
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    ...(options.timeoutMillis === undefined ? {} : { timeoutMillis: options.timeoutMillis }),
    ...(options.compression === undefined ? {} : { compression: options.compression }),
    ...(options.concurrencyLimit === undefined ? {} : { concurrencyLimit: options.concurrencyLimit }),
    ...(options.temporalityPreference === undefined ? {} : { temporalityPreference: options.temporalityPreference }),
  };
}

function disabledOpenTelemetryHandle(
  resourceAttributes: Readonly<Record<string, string | number | boolean>>,
  reason: string,
): OpenTelemetryHandle {
  return {
    enabled: false,
    resourceAttributes,
    reason,
    async shutdown() {
      return undefined;
    },
  };
}

function createRuntimeResource(
  runtime: OpenTelemetryRuntime,
  attributes: Readonly<Record<string, string | number | boolean>>,
): unknown {
  if (runtime.resourceFromAttributes !== undefined) {
    return runtime.resourceFromAttributes(attributes);
  }
  if (runtime.Resource !== undefined) {
    return new runtime.Resource(attributes);
  }
  return attributes;
}

async function loadOpenTelemetryRuntime(): Promise<OpenTelemetryRuntime> {
  const [sdkNode, traceExporter, metricExporter, sdkMetrics, resources] = await Promise.all([
    importRuntimeModule('@opentelemetry/sdk-node'),
    importRuntimeModule('@opentelemetry/exporter-trace-otlp-http'),
    importRuntimeModule('@opentelemetry/exporter-metrics-otlp-http'),
    importRuntimeModule('@opentelemetry/sdk-metrics'),
    importRuntimeModule('@opentelemetry/resources'),
  ]);

  return {
    NodeSDK: requiredExport(sdkNode, 'NodeSDK'),
    OTLPTraceExporter: requiredExport(traceExporter, 'OTLPTraceExporter'),
    OTLPMetricExporter: requiredExport(metricExporter, 'OTLPMetricExporter'),
    PeriodicExportingMetricReader: requiredExport(sdkMetrics, 'PeriodicExportingMetricReader'),
    ...optionalRuntimeExport(resources, 'resourceFromAttributes'),
    ...optionalRuntimeExport(resources, 'Resource'),
  };
}

function importRuntimeModule(specifier: string): Promise<object> {
  return import(specifier) as Promise<object>;
}

function requiredExport<T>(module: object, name: string): T {
  const value = (module as Readonly<Record<string, unknown>>)[name];
  if (value === undefined) {
    throw new Error(`OpenTelemetry runtime is missing ${name}`);
  }
  return value as T;
}

function optionalRuntimeExport(module: object, name: 'resourceFromAttributes'): Pick<OpenTelemetryRuntime, 'resourceFromAttributes'> | {};
function optionalRuntimeExport(module: object, name: 'Resource'): Pick<OpenTelemetryRuntime, 'Resource'> | {};
function optionalRuntimeExport(module: object, name: 'resourceFromAttributes' | 'Resource'): Pick<OpenTelemetryRuntime, 'resourceFromAttributes' | 'Resource'> | {} {
  const value = (module as Readonly<Record<string, unknown>>)[name];
  return value === undefined ? {} : { [name]: value };
}

function addSafeAttribute(
  attributes: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean | null | undefined,
): void {
  if (SENSITIVE_ATTRIBUTE_PATTERNS.some((pattern) => pattern.test(key))) return;
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0 || looksSensitiveValue(trimmed)) return;
    attributes[key] = trimmed;
    return;
  }
  attributes[key] = value;
}

function looksSensitiveValue(value: string): boolean {
  return /^bearer\s+/iu.test(value) || /\bsk-[a-z0-9_-]{12,}\b/iu.test(value) || /\bdg_vk_[a-z0-9_-]{12,}\b/iu.test(value);
}
