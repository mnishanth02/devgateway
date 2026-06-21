export type ControlPlaneDeniedCode =
  | 'CONTROL_AUTH_MISSING'
  | 'CONTROL_POLICY_STALE'
  | 'CONTROL_KEY_REVOKED'
  | 'CONTROL_BUDGET_EXHAUSTED'
  | 'CONTROL_PRODUCTION_DISABLED'
  | 'CONTROL_APPROVAL_REQUIRED'
  | 'CONTROL_TOTP_REQUIRED'
  | 'CONTROL_FRESH_SESSION_REQUIRED';

export type ControlPlaneDeniedReason =
  | 'auth_required'
  | 'policy_stale'
  | 'key_revoked'
  | 'budget_exhausted'
  | 'production_disabled'
  | 'approval_required'
  | 'totp_required'
  | 'fresh_session_required';

export interface ControlPlaneDeniedDefinition {
  readonly code: ControlPlaneDeniedCode;
  readonly reason: ControlPlaneDeniedReason;
  readonly httpStatus: 401 | 403 | 409 | 423 | 429;
  readonly message: string;
  readonly auditEvent: 'control_plane.request.denied';
  readonly successFallbackAllowed: false;
}

export interface ControlPlaneDeniedContext {
  readonly traceId?: string;
  readonly requestId?: string;
  readonly policyVersion?: string;
  readonly registryVersion?: string;
  readonly actorId?: string;
  readonly projectId?: string;
  readonly virtualKeyId?: string;
}

export interface ControlPlaneDeniedErrorBody {
  readonly decision: 'deny';
  readonly error: {
    readonly code: ControlPlaneDeniedCode;
    readonly reason: ControlPlaneDeniedReason;
    readonly message: string;
  };
  readonly traceId?: string;
  readonly requestId?: string;
}

export interface ControlPlaneDeniedError {
  readonly name: 'ControlPlaneDeniedError';
  readonly decision: 'deny';
  readonly code: ControlPlaneDeniedCode;
  readonly reason: ControlPlaneDeniedReason;
  readonly httpStatus: ControlPlaneDeniedDefinition['httpStatus'];
  readonly message: string;
  readonly audit: {
    readonly event: 'control_plane.request.denied';
    readonly required: true;
    readonly reason: ControlPlaneDeniedReason;
    readonly context: ControlPlaneDeniedContext;
  };
  readonly successFallbackAllowed: false;
  toResponseBody(): ControlPlaneDeniedErrorBody;
}

export const CONTROL_PLANE_DENIED_DEFINITIONS = {
  CONTROL_AUTH_MISSING: {
    code: 'CONTROL_AUTH_MISSING',
    reason: 'auth_required',
    httpStatus: 401,
    message: 'Authentication required',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_POLICY_STALE: {
    code: 'CONTROL_POLICY_STALE',
    reason: 'policy_stale',
    httpStatus: 409,
    message: 'Policy state is not current',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_KEY_REVOKED: {
    code: 'CONTROL_KEY_REVOKED',
    reason: 'key_revoked',
    httpStatus: 403,
    message: 'Credential is not active',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_BUDGET_EXHAUSTED: {
    code: 'CONTROL_BUDGET_EXHAUSTED',
    reason: 'budget_exhausted',
    httpStatus: 429,
    message: 'Budget is exhausted',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_PRODUCTION_DISABLED: {
    code: 'CONTROL_PRODUCTION_DISABLED',
    reason: 'production_disabled',
    httpStatus: 423,
    message: 'Production access is disabled',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_APPROVAL_REQUIRED: {
    code: 'CONTROL_APPROVAL_REQUIRED',
    reason: 'approval_required',
    httpStatus: 403,
    message: 'Approval is required',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_TOTP_REQUIRED: {
    code: 'CONTROL_TOTP_REQUIRED',
    reason: 'totp_required',
    httpStatus: 403,
    message: 'TOTP verification is required',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
  CONTROL_FRESH_SESSION_REQUIRED: {
    code: 'CONTROL_FRESH_SESSION_REQUIRED',
    reason: 'fresh_session_required',
    httpStatus: 403,
    message: 'Fresh session is required',
    auditEvent: 'control_plane.request.denied',
    successFallbackAllowed: false,
  },
} as const satisfies Record<ControlPlaneDeniedCode, ControlPlaneDeniedDefinition>;

export function createControlPlaneDeniedError(
  code: ControlPlaneDeniedCode,
  context: ControlPlaneDeniedContext = {},
): ControlPlaneDeniedError {
  const definition = CONTROL_PLANE_DENIED_DEFINITIONS[code];
  return {
    name: 'ControlPlaneDeniedError',
    decision: 'deny',
    code: definition.code,
    reason: definition.reason,
    httpStatus: definition.httpStatus,
    message: definition.message,
    audit: {
      event: definition.auditEvent,
      required: true,
      reason: definition.reason,
      context,
    },
    successFallbackAllowed: false,
    toResponseBody() {
      const body: ControlPlaneDeniedErrorBody = {
        decision: 'deny',
        error: {
          code: definition.code,
          reason: definition.reason,
          message: definition.message,
        },
      };
      return withOptionalCorrelation(body, context);
    },
  };
}

function withOptionalCorrelation(
  body: ControlPlaneDeniedErrorBody,
  context: ControlPlaneDeniedContext,
): ControlPlaneDeniedErrorBody {
  return {
    ...body,
    ...(context.traceId ? { traceId: context.traceId } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
  };
}
