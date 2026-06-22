export const approvalTtlRiskTiers = ['low', 'medium', 'high', 'critical', 'internal-default'] as const;

export type ApprovalTtlRiskTier = (typeof approvalTtlRiskTiers)[number];

export const DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER = {
  low: 72 * 60 * 60,
  medium: 24 * 60 * 60,
  high: 4 * 60 * 60,
  critical: 4 * 60 * 60,
  'internal-default': 24 * 60 * 60,
} as const satisfies Record<ApprovalTtlRiskTier, number>;

export function defaultApprovalTtlSeconds(riskTier: ApprovalTtlRiskTier | string | null | undefined): number {
  if (riskTier === 'low' || riskTier === 'medium' || riskTier === 'high' || riskTier === 'critical') {
    return DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER[riskTier];
  }
  return DEFAULT_APPROVAL_TTL_SECONDS_BY_RISK_TIER['internal-default'];
}

export function approvalExpiresAtForRiskTier(
  riskTier: ApprovalTtlRiskTier | string | null | undefined,
  now: Date = new Date(),
): string {
  return new Date(now.getTime() + defaultApprovalTtlSeconds(riskTier) * 1000).toISOString();
}
