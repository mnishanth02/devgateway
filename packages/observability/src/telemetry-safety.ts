export type SanitizedLogValue = string | number | boolean | null;

export interface ForbiddenTelemetryFieldViolation {
  readonly path: string;
  readonly field: string;
  readonly reason:
    | 'prompt_content'
    | 'completion_content'
    | 'provider_key_secret'
    | 'raw_virtual_key_secret'
    | 'secret_field';
}

export class ForbiddenTelemetryFieldError extends Error {
  readonly violations: readonly ForbiddenTelemetryFieldViolation[];

  constructor(context: string, violations: readonly ForbiddenTelemetryFieldViolation[]) {
    super(
      `${context} contains forbidden telemetry fields: ${violations
        .map((violation) => `${violation.path} (${violation.reason})`)
        .join(', ')}`,
    );
    this.name = 'ForbiddenTelemetryFieldError';
    this.violations = violations;
  }
}

export const SECRET_FIELD_PATTERNS = [
  /secret/iu,
  /token/iu,
  /password/iu,
  /credential/iu,
  /authorization/iu,
  /cookie/iu,
  /key_material/iu,
  /api[_-]?key/iu,
  /provider[_-]?key/iu,
  /providerKey/u,
  /apiKey/u,
] as const;

export const CONTENT_FIELD_PATTERNS = [/prompt/iu, /completion/iu] as const;

const FORBIDDEN_TELEMETRY_FIELD_PATTERNS = [
  { pattern: /prompt/iu, reason: 'prompt_content' },
  { pattern: /completion/iu, reason: 'completion_content' },
  { pattern: /provider[_-]?key/iu, reason: 'provider_key_secret' },
  { pattern: /^(raw[_-]?virtual[_-]?key|virtual[_-]?key[_-]?(secret|value|raw))$/iu, reason: 'raw_virtual_key_secret' },
  { pattern: /^(one_time_secret|one-time-secret|raw_secret|raw-secret|key_hash_ref|key-hash-ref)$/iu, reason: 'secret_field' },
] as const satisfies readonly { readonly pattern: RegExp; readonly reason: ForbiddenTelemetryFieldViolation['reason'] }[];

const FORBIDDEN_TELEMETRY_VALUE_PATTERNS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/u, reason: 'provider_key_secret' },
  { pattern: /\bdg_vk_[A-Za-z0-9_-]{12,}\b/u, reason: 'raw_virtual_key_secret' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/iu, reason: 'secret_field' },
] as const satisfies readonly { readonly pattern: RegExp; readonly reason: ForbiddenTelemetryFieldViolation['reason'] }[];

export function sanitizeLogFields(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, SanitizedLogValue>> {
  const sanitized: Record<string, SanitizedLogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (CONTENT_FIELD_PATTERNS.some((pattern) => pattern.test(key))) {
      continue;
    }
    if (isSecretFieldName(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }
    const redactedValue = redactLogValue(value);
    if (redactedValue !== undefined) {
      sanitized[key] = redactedValue;
    }
  }
  return sanitized;
}

export function detectForbiddenTelemetryFields(value: unknown): readonly ForbiddenTelemetryFieldViolation[] {
  const violations: ForbiddenTelemetryFieldViolation[] = [];
  collectForbiddenTelemetryFields(value, '$', violations);
  return violations;
}

export function assertNoForbiddenTelemetryFields(value: unknown, context = 'telemetry event'): void {
  const violations = detectForbiddenTelemetryFields(value);
  if (violations.length > 0) {
    throw new ForbiddenTelemetryFieldError(context, violations);
  }
}

function collectForbiddenTelemetryFields(
  value: unknown,
  path: string,
  violations: ForbiddenTelemetryFieldViolation[],
): void {
  if (typeof value === 'string') {
    const reason = forbiddenTelemetryValueReason(value);
    if (reason !== undefined) {
      violations.push({ path, field: path.split('.').at(-1) ?? path, reason });
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenTelemetryFields(entry, `${path}[${index}]`, violations));
    return;
  }

  for (const [field, child] of Object.entries(value as Readonly<Record<string, unknown>>)) {
    const reason = forbiddenTelemetryFieldReason(field);
    const childPath = `${path}.${field}`;
    if (reason !== undefined) {
      violations.push({ path: childPath, field, reason });
    }
    collectForbiddenTelemetryFields(child, childPath, violations);
  }
}

function forbiddenTelemetryFieldReason(field: string): ForbiddenTelemetryFieldViolation['reason'] | undefined {
  const explicitMatch = FORBIDDEN_TELEMETRY_FIELD_PATTERNS.find(({ pattern }) => pattern.test(field));
  if (explicitMatch !== undefined) return explicitMatch.reason;
  return isSecretFieldName(field) ? 'secret_field' : undefined;
}

function isSecretFieldName(field: string): boolean {
  if (/^(estimated_|actual_)?(input|output|cache_read|cache_write|reasoning|total)_tokens$/iu.test(field)) {
    return false;
  }

  return SECRET_FIELD_PATTERNS.some((pattern) => pattern.test(field));
}

function forbiddenTelemetryValueReason(value: string): ForbiddenTelemetryFieldViolation['reason'] | undefined {
  return FORBIDDEN_TELEMETRY_VALUE_PATTERNS.find(({ pattern }) => pattern.test(value))?.reason;
}

function redactLogValue(value: unknown): SanitizedLogValue | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    if (typeof value === 'string' && forbiddenTelemetryValueReason(value) !== undefined) return '[redacted]';
    return value;
  }
  if (value === undefined) return undefined;
  return JSON.stringify(redactNestedLogValue(value));
}

function redactNestedLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactNestedLogValue(entry));
  if (typeof value === 'string' && forbiddenTelemetryValueReason(value) !== undefined) return '[redacted]';
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([key]) => !CONTENT_FIELD_PATTERNS.some((pattern) => pattern.test(key)))
      .map(([key, nested]) => [
        key,
        isSecretFieldName(key) ? '[redacted]' : redactNestedLogValue(nested),
      ]),
  );
}
