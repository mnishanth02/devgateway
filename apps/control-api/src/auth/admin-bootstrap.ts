import type { AuthTotpRequirement } from '@devgateway/config';

export interface InitialAdminBootstrapPlan {
  readonly mode: 'explicit-approval-required';
  readonly accountSource: 'admin-created-or-invite-only';
  readonly productionEnabledByDefault: false;
  readonly requiredBeforeProviderKeyAccess: readonly ['verified_admin_identity', 'totp_enabled', 'fresh_session'];
  readonly totpRequirement: AuthTotpRequirement;
}

export function createInitialAdminBootstrapPlan(totpRequirement: AuthTotpRequirement): InitialAdminBootstrapPlan {
  return {
    mode: 'explicit-approval-required',
    accountSource: 'admin-created-or-invite-only',
    productionEnabledByDefault: false,
    requiredBeforeProviderKeyAccess: ['verified_admin_identity', 'totp_enabled', 'fresh_session'],
    totpRequirement,
  };
}
