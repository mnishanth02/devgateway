import type { DenialReasonCode } from '../../../../packages/shared-types/src/gateway-control.ts';

export type ControlErrorKind =
  | 'missing_auth'
  | 'revoked_key'
  | 'budget_exhausted'
  | 'stale_policy'
  | 'production_disabled_route';

export interface ControlDeniedErrorOptions {
  readonly kind: ControlErrorKind;
  readonly message: string;
  readonly statusCode: number;
  readonly denialReason: DenialReasonCode;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface ControlDeniedErrorBody {
  readonly error: {
    readonly code: ControlErrorKind;
    readonly message: string;
    readonly decision: 'deny';
    readonly denial_reason: DenialReasonCode;
    readonly retryable: boolean;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export class ControlDeniedError extends Error {
  readonly kind: ControlErrorKind;
  readonly statusCode: number;
  readonly denialReason: DenialReasonCode;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(options: ControlDeniedErrorOptions) {
    super(options.message);
    this.name = 'ControlDeniedError';
    this.kind = options.kind;
    this.statusCode = options.statusCode;
    this.denialReason = options.denialReason;
    this.retryable = options.retryable;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function missingAuthControlError(details?: Readonly<Record<string, unknown>>): ControlDeniedError {
  return new ControlDeniedError({
    kind: 'missing_auth',
    message: 'Control API authentication context is required.',
    statusCode: 401,
    denialReason: 'approval_required',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

export function revokedKeyControlError(details?: Readonly<Record<string, unknown>>): ControlDeniedError {
  return new ControlDeniedError({
    kind: 'revoked_key',
    message: 'The virtual key is revoked and cannot be used for this operation.',
    statusCode: 403,
    denialReason: 'route_disabled',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

export function budgetExhaustedControlError(details?: Readonly<Record<string, unknown>>): ControlDeniedError {
  return new ControlDeniedError({
    kind: 'budget_exhausted',
    message: 'The resolved budget scope has no remaining hard-cap headroom.',
    statusCode: 402,
    denialReason: 'budget',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

export function stalePolicyControlError(details?: Readonly<Record<string, unknown>>): ControlDeniedError {
  return new ControlDeniedError({
    kind: 'stale_policy',
    message: 'Policy or registry version is missing, stale, or unverifiable.',
    statusCode: 409,
    denialReason: 'policy_stale',
    retryable: true,
    ...(details === undefined ? {} : { details }),
  });
}

export function productionDisabledRouteControlError(details?: Readonly<Record<string, unknown>>): ControlDeniedError {
  return new ControlDeniedError({
    kind: 'production_disabled_route',
    message: 'This Control API route is explicitly disabled for production until DB-backed enforcement is approved.',
    statusCode: 503,
    denialReason: 'route_disabled',
    retryable: false,
    ...(details === undefined ? {} : { details }),
  });
}

export function isControlDeniedError(error: unknown): error is ControlDeniedError {
  return error instanceof ControlDeniedError;
}

export function toControlDeniedErrorBody(error: ControlDeniedError): ControlDeniedErrorBody {
  return {
    error: {
      code: error.kind,
      message: error.message,
      decision: 'deny',
      denial_reason: error.denialReason,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };
}
