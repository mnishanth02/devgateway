import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateSensitiveActionGuard } from './sensitive-action-guards.ts';
import { createControlPlaneDeniedError } from './denied-error.ts';

describe('control-plane denial policy shapes', () => {
  it('returns stable non-success denial bodies', () => {
    const denial = createControlPlaneDeniedError('CONTROL_BUDGET_EXHAUSTED', {
      traceId: '0123456789abcdef0123456789abcdef',
      requestId: 'req_1',
    });

    assert.equal(denial.decision, 'deny');
    assert.equal(denial.successFallbackAllowed, false);
    assert.deepEqual(denial.toResponseBody(), {
      decision: 'deny',
      error: {
        code: 'CONTROL_BUDGET_EXHAUSTED',
        reason: 'budget_exhausted',
        message: 'Budget is exhausted',
      },
      traceId: '0123456789abcdef0123456789abcdef',
      requestId: 'req_1',
    });
  });

  it('requires TOTP and a fresh session for provider-key reads', () => {
    const decision = evaluateSensitiveActionGuard({
      action: 'provider-key-read',
      authenticated: true,
      admin: true,
      totpVerified: false,
      freshSession: true,
      approvalSatisfied: true,
    });

    assert.equal(decision.decision, 'deny');
    if (decision.decision === 'deny') {
      assert.equal(decision.denial.code, 'CONTROL_TOTP_REQUIRED');
    }
  });

  it('fails closed when break-glass minting is attempted before production auth enablement', () => {
    const decision = evaluateSensitiveActionGuard({
      action: 'break-glass-token-mint',
      authenticated: true,
      admin: true,
      totpVerified: true,
      freshSession: true,
      approvalSatisfied: true,
      productionAuthEnabled: false,
    });

    assert.equal(decision.decision, 'deny');
    if (decision.decision === 'deny') {
      assert.equal(decision.denial.code, 'CONTROL_PRODUCTION_DISABLED');
    }
  });
});
