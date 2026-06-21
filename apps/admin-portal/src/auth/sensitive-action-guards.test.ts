import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    buildPortalControlApiRequirement,
    evaluatePortalSensitiveActionGuard,
    portalSensitiveActions,
    type PortalSensitiveAction,
} from './sensitive-action-guards.ts';

const satisfiedBase = {
    authenticated: true,
    admin: true,
    totpVerified: true,
    freshSession: true,
    approvalSatisfied: true,
    productionAuthEnabled: true,
} as const;

describe('portal sensitive-action guards', () => {
    it('defines TOTP and fresh-session requirements for every sensitive portal action', () => {
        for (const action of portalSensitiveActions) {
            const shape = buildPortalControlApiRequirement(action);

            assert.equal(shape.target, 'control-api');
            assert.equal(shape.secretMaterialAllowed, false);
            assert.equal(shape.requestShape.dbAccess, false);
            assert.equal(shape.requestShape.bifrostAdminAccess, false);
            assert.equal(shape.requestShape.providerSecretReadable, false);
            assert.equal(shape.requestShape.credentialReferencesOnly, true);
            assert.ok(shape.requirements.includes('totp_verified'), action);
            assert.ok(shape.requirements.includes('fresh_session'), action);
        }
    });

    it('returns generic typed denials without secret-bearing detail', () => {
        const decision = evaluatePortalSensitiveActionGuard({
            action: 'provider-key-read',
            ...satisfiedBase,
            totpVerified: false,
        });

        assert.equal(decision.decision, 'deny');
        if (decision.decision === 'deny') {
            assert.deepEqual(decision.denial, {
                code: 'PORTAL_TOTP_REQUIRED',
                reason: 'totp_required',
                message: 'Additional verification is required.',
            });
            assert.equal(JSON.stringify(decision.denial).includes('sk-live'), false);
            assert.equal(JSON.stringify(decision.denial).includes('provider_secret'), false);
        }
    });

    it('allows virtual-key rotation and revocation after admin TOTP and fresh-session checks', () => {
        for (const action of ['virtual-key-rotate', 'virtual-key-revoke'] as const satisfies readonly PortalSensitiveAction[]) {
            const decision = evaluatePortalSensitiveActionGuard({
                action,
                authenticated: true,
                admin: true,
                totpVerified: true,
                freshSession: true,
            });

            assert.equal(decision.decision, 'allow', action);
            assert.deepEqual(decision.requirements, ['authenticated_admin', 'totp_verified', 'fresh_session']);
        }
    });

    it('requires approval for provider-key read and rotate actions', () => {
        for (const action of ['provider-key-read', 'provider-key-rotate'] as const satisfies readonly PortalSensitiveAction[]) {
            const decision = evaluatePortalSensitiveActionGuard({
                action,
                ...satisfiedBase,
                approvalSatisfied: false,
            });

            assert.equal(decision.decision, 'deny', action);
            if (decision.decision === 'deny') {
                assert.equal(decision.denial.code, 'PORTAL_APPROVAL_REQUIRED');
            }
        }
    });

    it('keeps break-glass status disabled or pending until production auth and approval are present', () => {
        const disabled = evaluatePortalSensitiveActionGuard({
            action: 'break-glass-token-status',
            ...satisfiedBase,
            productionAuthEnabled: false,
        });
        const pending = evaluatePortalSensitiveActionGuard({
            action: 'break-glass-token-status',
            ...satisfiedBase,
            approvalSatisfied: false,
        });

        assert.equal(disabled.decision, 'allow');
        assert.deepEqual(disabled.breakGlassStatus, {
            state: 'disabled',
            tokenMaterialAvailable: false,
            mintingAllowed: false,
        });
        assert.equal(pending.decision, 'deny');
        assert.deepEqual(pending.breakGlassStatus, {
            state: 'pending',
            tokenMaterialAvailable: false,
            mintingAllowed: false,
        });
    });

    it('fails closed for break-glass minting when production auth is disabled', () => {
        const decision = evaluatePortalSensitiveActionGuard({
            action: 'break-glass-token-mint',
            ...satisfiedBase,
            productionAuthEnabled: false,
        });

        assert.equal(decision.decision, 'deny');
        if (decision.decision === 'deny') {
            assert.equal(decision.denial.code, 'PORTAL_PRODUCTION_AUTH_DISABLED');
            assert.equal(decision.breakGlassStatus?.state, 'disabled');
        }
    });
});
