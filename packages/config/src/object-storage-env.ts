import type { RuntimeEnvironment } from './auth-env.js';

export type ArtifactObjectStorageProvider = 'memory' | 'minio' | 'railway' | 's3';
export type ObjectStorageEnvValidationDecision = 'allow' | 'deny';

export interface ArtifactObjectStorageConfig {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly provider: ArtifactObjectStorageProvider;
  readonly endpointUrl: string;
  readonly region: string;
  readonly bucket: string;
  readonly forcePathStyle: boolean;
  readonly accessKeyConfigured: boolean;
  readonly secretAccessKeyConfigured: boolean;
  readonly signedAccessTtlSeconds: number;
  readonly maxSignedAccessTtlSeconds: 900;
}

export type ObjectStorageEnvInput = Readonly<Record<string, string | undefined>>;

export interface ObjectStorageEnvValidationScenario {
  readonly id: string;
  readonly input: ObjectStorageEnvInput;
  readonly expected: {
    readonly decision: ObjectStorageEnvValidationDecision;
    readonly provider?: ArtifactObjectStorageProvider;
    readonly errorIncludes?: string;
  };
}

const runtimeEnvironments = new Set<RuntimeEnvironment>(['development', 'test', 'production']);
const providers = new Set<ArtifactObjectStorageProvider>(['memory', 'minio', 'railway', 's3']);
const maxSignedAccessTtlSeconds = 900;

export const objectStorageEnvValidationScenarios = [
  {
    id: 'development-minio-defaults',
    input: { NODE_ENV: 'development' },
    expected: { decision: 'allow', provider: 'minio' },
  },
  {
    id: 'test-memory-adapter',
    input: {
      NODE_ENV: 'test',
      ARTIFACT_OBJECT_STORAGE_PROVIDER: 'memory',
      ARTIFACT_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    },
    expected: { decision: 'allow', provider: 'memory' },
  },
  {
    id: 'production-requires-railway-object-storage',
    input: { NODE_ENV: 'production', ARTIFACT_OBJECT_STORAGE_PROVIDER: 'memory' },
    expected: { decision: 'deny', errorIncludes: 'production requires ARTIFACT_OBJECT_STORAGE_PROVIDER=railway' },
  },
  {
    id: 'production-requires-credentials',
    input: {
      NODE_ENV: 'production',
      ARTIFACT_OBJECT_STORAGE_PROVIDER: 'railway',
      ARTIFACT_OBJECT_STORAGE_ENDPOINT: 'https://s3.railway.app',
      ARTIFACT_OBJECT_STORAGE_BUCKET: 'devgateway-prod-artifacts',
    },
    expected: { decision: 'deny', errorIncludes: 'ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_ID' },
  },
] as const satisfies readonly ObjectStorageEnvValidationScenario[];

export function loadObjectStorageEnv(input: ObjectStorageEnvInput): ArtifactObjectStorageConfig {
  const runtimeEnvironment = parseRuntimeEnvironment(input.NODE_ENV);
  const provider = parseProvider(input.ARTIFACT_OBJECT_STORAGE_PROVIDER, runtimeEnvironment);
  if (runtimeEnvironment === 'production' && provider !== 'railway') {
    throw new Error('production requires ARTIFACT_OBJECT_STORAGE_PROVIDER=railway');
  }
  const endpointUrl = parseEndpoint(input.ARTIFACT_OBJECT_STORAGE_ENDPOINT, provider, runtimeEnvironment);
  const region = parseNonEmptyString(input.ARTIFACT_OBJECT_STORAGE_REGION, 'us-east-1', 'ARTIFACT_OBJECT_STORAGE_REGION');
  const bucket = parseNonEmptyString(
    input.ARTIFACT_OBJECT_STORAGE_BUCKET,
    runtimeEnvironment === 'production' ? '' : 'devgateway-artifacts',
    'ARTIFACT_OBJECT_STORAGE_BUCKET',
  );
  const forcePathStyle = parseBoolean(input.ARTIFACT_OBJECT_STORAGE_FORCE_PATH_STYLE, provider !== 'railway', 'ARTIFACT_OBJECT_STORAGE_FORCE_PATH_STYLE');
  const accessKeyConfigured = Boolean(input.ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_ID?.trim());
  const secretAccessKeyConfigured = Boolean(input.ARTIFACT_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim());
  const signedAccessTtlSeconds = parsePositiveInteger(
    input.ARTIFACT_SIGNED_ACCESS_TTL_SECONDS,
    300,
    'ARTIFACT_SIGNED_ACCESS_TTL_SECONDS',
  );

  if (signedAccessTtlSeconds > maxSignedAccessTtlSeconds) {
    throw new Error('ARTIFACT_SIGNED_ACCESS_TTL_SECONDS must be 900 seconds or less');
  }
  if (runtimeEnvironment === 'production') {
    if (!accessKeyConfigured) {
      throw new Error('ARTIFACT_OBJECT_STORAGE_ACCESS_KEY_ID must be set in production');
    }
    if (!secretAccessKeyConfigured) {
      throw new Error('ARTIFACT_OBJECT_STORAGE_SECRET_ACCESS_KEY must be set in production');
    }
  }

  return {
    runtimeEnvironment,
    provider,
    endpointUrl,
    region,
    bucket,
    forcePathStyle,
    accessKeyConfigured,
    secretAccessKeyConfigured,
    signedAccessTtlSeconds,
    maxSignedAccessTtlSeconds,
  };
}

function parseRuntimeEnvironment(raw: string | undefined): RuntimeEnvironment {
  const value = raw ?? 'development';
  if (!runtimeEnvironments.has(value as RuntimeEnvironment)) {
    throw new Error(`NODE_ENV must be one of: ${[...runtimeEnvironments].join(', ')}`);
  }
  return value as RuntimeEnvironment;
}

function parseProvider(raw: string | undefined, runtimeEnvironment: RuntimeEnvironment): ArtifactObjectStorageProvider {
  const value = raw ?? (runtimeEnvironment === 'production' ? 'railway' : 'minio');
  if (!providers.has(value as ArtifactObjectStorageProvider)) {
    throw new Error(`ARTIFACT_OBJECT_STORAGE_PROVIDER must be one of: ${[...providers].join(', ')}`);
  }
  return value as ArtifactObjectStorageProvider;
}

function parseEndpoint(
  raw: string | undefined,
  provider: ArtifactObjectStorageProvider,
  runtimeEnvironment: RuntimeEnvironment,
): string {
  const fallback = provider === 'minio' ? 'http://127.0.0.1:9000' : '';
  const value = raw?.trim() || fallback;
  if (!value) {
    throw new Error('ARTIFACT_OBJECT_STORAGE_ENDPOINT must be set');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ARTIFACT_OBJECT_STORAGE_ENDPOINT must be an absolute URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('ARTIFACT_OBJECT_STORAGE_ENDPOINT must not include credentials, query, or fragment');
  }
  if (runtimeEnvironment === 'production' && url.protocol !== 'https:') {
    throw new Error('ARTIFACT_OBJECT_STORAGE_ENDPOINT must use https in production');
  }
  return url.toString().replace(/\/$/u, '');
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}

function parseNonEmptyString(raw: string | undefined, fallback: string, name: string): string {
  const value = raw?.trim() || fallback;
  if (!value) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}
