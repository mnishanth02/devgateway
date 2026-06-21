import type { AuthAdminBootstrapConfig, AuthTotpRequirement, RuntimeEnvironment } from '@devgateway/config';
import type { AuthAuditEventName } from './audit.ts';

export interface InitialAdminBootstrapPlan {
  readonly mode: 'explicit-approval-required';
  readonly accountSource: 'admin-created-or-invite-only';
  readonly productionEnabledByDefault: false;
  readonly requiredBeforeProviderKeyAccess: readonly ['verified_admin_identity', 'totp_enabled', 'fresh_session'];
  readonly bootstrapEnabledByDefault: false;
  readonly bootstrapRequires: readonly ['explicit_env_gate', 'short_ttl', 'single_use_token_hash', 'immutable_audit'];
  readonly totpRequirement: AuthTotpRequirement;
}

export type AdminBootstrapDecisionCode =
  | 'admin_bootstrap_disabled'
  | 'admin_bootstrap_expired'
  | 'admin_bootstrap_token_invalid'
  | 'admin_bootstrap_token_consumed'
  | 'admin_bootstrap_admin_exists'
  | 'admin_bootstrap_audit_required'
  | 'admin_bootstrap_operator_approval_required';

export interface AdminBootstrapPolicyInput {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly bootstrap: AuthAdminBootstrapConfig;
  readonly now: Date;
  readonly tokenHashMatches: boolean;
  readonly activeAdminExists: boolean;
  readonly auditEmitterAvailable: boolean;
}

export interface AdminBootstrapAllowed {
  readonly decision: 'allow';
  readonly auditEventsRequired: readonly ['auth.admin_bootstrap.created', 'auth.admin_bootstrap.consumed'];
  readonly maxTtlSeconds: number;
  readonly singleUse: true;
}

export interface AdminBootstrapDenied {
  readonly decision: 'deny';
  readonly code: AdminBootstrapDecisionCode;
  readonly message: 'Authentication failed';
  readonly auditEventRequired: AuthAuditEventName;
  readonly successFallbackAllowed: false;
}

export type AdminBootstrapDecision = AdminBootstrapAllowed | AdminBootstrapDenied;

export function createInitialAdminBootstrapPlan(totpRequirement: AuthTotpRequirement): InitialAdminBootstrapPlan {
  return {
    mode: 'explicit-approval-required',
    accountSource: 'admin-created-or-invite-only',
    productionEnabledByDefault: false,
    requiredBeforeProviderKeyAccess: ['verified_admin_identity', 'totp_enabled', 'fresh_session'],
    bootstrapEnabledByDefault: false,
    bootstrapRequires: ['explicit_env_gate', 'short_ttl', 'single_use_token_hash', 'immutable_audit'],
    totpRequirement,
  };
}

export function evaluateAdminBootstrapPolicy(input: AdminBootstrapPolicyInput): AdminBootstrapDecision {
  if (!input.bootstrap.enabled) return denyAdminBootstrap('admin_bootstrap_disabled');
  if (!input.auditEmitterAvailable) return denyAdminBootstrap('admin_bootstrap_audit_required');
  if (input.bootstrap.consumed) return denyAdminBootstrap('admin_bootstrap_token_consumed');
  if (input.runtimeEnvironment === 'production' && !input.bootstrap.productionOperatorApproval) {
    return denyAdminBootstrap('admin_bootstrap_operator_approval_required');
  }
  if (!input.bootstrap.expiresAt || new Date(input.bootstrap.expiresAt).getTime() <= input.now.getTime()) {
    return denyAdminBootstrap('admin_bootstrap_expired');
  }
  if (!input.tokenHashMatches) return denyAdminBootstrap('admin_bootstrap_token_invalid');
  if (input.activeAdminExists) return denyAdminBootstrap('admin_bootstrap_admin_exists');

  return {
    decision: 'allow',
    auditEventsRequired: ['auth.admin_bootstrap.created', 'auth.admin_bootstrap.consumed'],
    maxTtlSeconds: 15 * 60,
    singleUse: true,
  };
}

function denyAdminBootstrap(code: AdminBootstrapDecisionCode): AdminBootstrapDenied {
  return {
    decision: 'deny',
    code,
    message: 'Authentication failed',
    auditEventRequired: 'auth.admin_bootstrap.denied',
    successFallbackAllowed: false,
  };
}
