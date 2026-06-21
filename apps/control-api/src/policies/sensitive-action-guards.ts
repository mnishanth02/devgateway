import type { AuthSensitiveAction } from '@devgateway/config';
import { createControlPlaneDeniedError, type ControlPlaneDeniedError } from './denied-error.ts';

export type SensitiveActionGuardRequirement =
  | 'authenticated_admin'
  | 'totp_verified'
  | 'fresh_session'
  | 'approval_recorded'
  | 'production_auth_enabled';

export interface SensitiveActionGuardInput {
  readonly action: AuthSensitiveAction;
  readonly authenticated: boolean;
  readonly admin: boolean;
  readonly totpVerified: boolean;
  readonly freshSession: boolean;
  readonly approvalSatisfied?: boolean;
  readonly productionAuthEnabled?: boolean;
  readonly traceId?: string;
  readonly requestId?: string;
}

export interface SensitiveActionGuardAllowed {
  readonly decision: 'allow';
  readonly action: AuthSensitiveAction;
  readonly requirements: readonly SensitiveActionGuardRequirement[];
}

export interface SensitiveActionGuardDenied {
  readonly decision: 'deny';
  readonly action: AuthSensitiveAction;
  readonly denial: ControlPlaneDeniedError;
  readonly requirements: readonly SensitiveActionGuardRequirement[];
}

export type SensitiveActionGuardDecision = SensitiveActionGuardAllowed | SensitiveActionGuardDenied;

export const SENSITIVE_ACTION_GUARD_REQUIREMENTS = {
  'provider-key-read': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
  'provider-key-rotate': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
  'break-glass-token-mint': [
    'authenticated_admin',
    'totp_verified',
    'fresh_session',
    'approval_recorded',
    'production_auth_enabled',
  ],
  'production-auth-enable': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
} as const satisfies Record<AuthSensitiveAction, readonly SensitiveActionGuardRequirement[]>;

export function evaluateSensitiveActionGuard(input: SensitiveActionGuardInput): SensitiveActionGuardDecision {
  const requirements: readonly SensitiveActionGuardRequirement[] = SENSITIVE_ACTION_GUARD_REQUIREMENTS[input.action];
  const context = {
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };

  if (!input.authenticated || !input.admin) {
    return {
      decision: 'deny',
      action: input.action,
      requirements,
      denial: createControlPlaneDeniedError('CONTROL_AUTH_MISSING', context),
    };
  }
  if (!input.totpVerified) {
    return {
      decision: 'deny',
      action: input.action,
      requirements,
      denial: createControlPlaneDeniedError('CONTROL_TOTP_REQUIRED', context),
    };
  }
  if (!input.freshSession) {
    return {
      decision: 'deny',
      action: input.action,
      requirements,
      denial: createControlPlaneDeniedError('CONTROL_FRESH_SESSION_REQUIRED', context),
    };
  }
  if (requirements.includes('production_auth_enabled') && input.productionAuthEnabled !== true) {
    return {
      decision: 'deny',
      action: input.action,
      requirements,
      denial: createControlPlaneDeniedError('CONTROL_PRODUCTION_DISABLED', context),
    };
  }
  if (input.approvalSatisfied !== true) {
    return {
      decision: 'deny',
      action: input.action,
      requirements,
      denial: createControlPlaneDeniedError('CONTROL_APPROVAL_REQUIRED', context),
    };
  }

  return {
    decision: 'allow',
    action: input.action,
    requirements,
  };
}
