export const portalSensitiveActions = [
    'virtual-key-rotate',
    'virtual-key-revoke',
    'provider-key-read',
    'provider-key-rotate',
    'break-glass-token-mint',
    'break-glass-token-status',
    'production-auth-enable',
] as const;

export type PortalSensitiveAction = (typeof portalSensitiveActions)[number];

export type PortalSensitiveActionRequirement =
    | 'authenticated_admin'
    | 'totp_verified'
    | 'fresh_session'
    | 'approval_recorded'
    | 'production_auth_enabled';

export type PortalSensitiveActionDenialCode =
    | 'PORTAL_AUTH_REQUIRED'
    | 'PORTAL_TOTP_REQUIRED'
    | 'PORTAL_FRESH_SESSION_REQUIRED'
    | 'PORTAL_APPROVAL_REQUIRED'
    | 'PORTAL_PRODUCTION_AUTH_DISABLED';

export type PortalSensitiveActionDenialReason =
    | 'auth_required'
    | 'totp_required'
    | 'fresh_session_required'
    | 'approval_required'
    | 'production_auth_disabled';

export interface PortalSensitiveActionDenial {
    readonly code: PortalSensitiveActionDenialCode;
    readonly reason: PortalSensitiveActionDenialReason;
    readonly message: string;
}

export interface PortalSensitiveActionGuardInput {
    readonly action: PortalSensitiveAction;
    readonly authenticated: boolean;
    readonly admin: boolean;
    readonly totpVerified: boolean;
    readonly freshSession: boolean;
    readonly approvalSatisfied?: boolean;
    readonly productionAuthEnabled?: boolean;
}

export interface PortalControlApiRequirementShape {
    readonly target: 'control-api';
    readonly action: PortalSensitiveAction;
    readonly requirements: readonly PortalSensitiveActionRequirement[];
    readonly secretMaterialAllowed: false;
    readonly redactedFields: readonly PortalSecretFieldName[];
    readonly requestShape: {
        readonly credentialReferencesOnly: true;
        readonly providerSecretReadable: false;
        readonly bifrostAdminAccess: false;
        readonly dbAccess: false;
    };
}

export type PortalSecretFieldName =
    | 'provider_key'
    | 'provider_secret'
    | 'api_key'
    | 'raw_secret'
    | 'secret'
    | 'token'
    | 'one_time_secret';

export interface BreakGlassStatusPosture {
    readonly state: 'disabled' | 'pending' | 'approved';
    readonly tokenMaterialAvailable: false;
    readonly mintingAllowed: boolean;
}

export interface PortalSensitiveActionGuardAllowed {
    readonly decision: 'allow';
    readonly action: PortalSensitiveAction;
    readonly requirements: readonly PortalSensitiveActionRequirement[];
    readonly controlApiRequirement: PortalControlApiRequirementShape;
    readonly breakGlassStatus?: BreakGlassStatusPosture;
}

export interface PortalSensitiveActionGuardDenied {
    readonly decision: 'deny';
    readonly action: PortalSensitiveAction;
    readonly requirements: readonly PortalSensitiveActionRequirement[];
    readonly denial: PortalSensitiveActionDenial;
    readonly controlApiRequirement: PortalControlApiRequirementShape;
    readonly breakGlassStatus?: BreakGlassStatusPosture;
}

export type PortalSensitiveActionGuardDecision =
    | PortalSensitiveActionGuardAllowed
    | PortalSensitiveActionGuardDenied;

export const PORTAL_SENSITIVE_ACTION_REQUIREMENTS = {
    'virtual-key-rotate': ['authenticated_admin', 'totp_verified', 'fresh_session'],
    'virtual-key-revoke': ['authenticated_admin', 'totp_verified', 'fresh_session'],
    'provider-key-read': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
    'provider-key-rotate': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
    'break-glass-token-mint': [
        'authenticated_admin',
        'totp_verified',
        'fresh_session',
        'approval_recorded',
        'production_auth_enabled',
    ],
    'break-glass-token-status': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
    'production-auth-enable': ['authenticated_admin', 'totp_verified', 'fresh_session', 'approval_recorded'],
} as const satisfies Record<PortalSensitiveAction, readonly PortalSensitiveActionRequirement[]>;

const portalSensitiveActionDenials = {
    PORTAL_AUTH_REQUIRED: {
        code: 'PORTAL_AUTH_REQUIRED',
        reason: 'auth_required',
        message: 'Administrative authentication is required.',
    },
    PORTAL_TOTP_REQUIRED: {
        code: 'PORTAL_TOTP_REQUIRED',
        reason: 'totp_required',
        message: 'Additional verification is required.',
    },
    PORTAL_FRESH_SESSION_REQUIRED: {
        code: 'PORTAL_FRESH_SESSION_REQUIRED',
        reason: 'fresh_session_required',
        message: 'A recent session is required.',
    },
    PORTAL_APPROVAL_REQUIRED: {
        code: 'PORTAL_APPROVAL_REQUIRED',
        reason: 'approval_required',
        message: 'Approval is required before this action can continue.',
    },
    PORTAL_PRODUCTION_AUTH_DISABLED: {
        code: 'PORTAL_PRODUCTION_AUTH_DISABLED',
        reason: 'production_auth_disabled',
        message: 'Production authentication is not enabled for this action.',
    },
} as const satisfies Record<PortalSensitiveActionDenialCode, PortalSensitiveActionDenial>;

const redactedFields = [
    'provider_key',
    'provider_secret',
    'api_key',
    'raw_secret',
    'secret',
    'token',
    'one_time_secret',
] as const satisfies readonly PortalSecretFieldName[];

export function evaluatePortalSensitiveActionGuard(
    input: PortalSensitiveActionGuardInput,
): PortalSensitiveActionGuardDecision {
    const requirements = PORTAL_SENSITIVE_ACTION_REQUIREMENTS[input.action];
    const controlApiRequirement = buildPortalControlApiRequirement(input.action);
    const breakGlassStatus = buildBreakGlassStatusPosture(input);

    if (!input.authenticated || !input.admin) {
        return deny(input.action, requirements, controlApiRequirement, 'PORTAL_AUTH_REQUIRED', breakGlassStatus);
    }
    if (!input.totpVerified) {
        return deny(input.action, requirements, controlApiRequirement, 'PORTAL_TOTP_REQUIRED', breakGlassStatus);
    }
    if (!input.freshSession) {
        return deny(input.action, requirements, controlApiRequirement, 'PORTAL_FRESH_SESSION_REQUIRED', breakGlassStatus);
    }
    if (hasRequirement(requirements, 'production_auth_enabled') && input.productionAuthEnabled !== true) {
        return deny(
            input.action,
            requirements,
            controlApiRequirement,
            'PORTAL_PRODUCTION_AUTH_DISABLED',
            breakGlassStatus,
        );
    }
    if (hasRequirement(requirements, 'approval_recorded') && input.approvalSatisfied !== true) {
        return deny(input.action, requirements, controlApiRequirement, 'PORTAL_APPROVAL_REQUIRED', breakGlassStatus);
    }

    return {
        decision: 'allow',
        action: input.action,
        requirements,
        controlApiRequirement,
        ...(breakGlassStatus === undefined ? {} : { breakGlassStatus }),
    };
}

export function buildPortalControlApiRequirement(action: PortalSensitiveAction): PortalControlApiRequirementShape {
    return {
        target: 'control-api',
        action,
        requirements: PORTAL_SENSITIVE_ACTION_REQUIREMENTS[action],
        secretMaterialAllowed: false,
        redactedFields,
        requestShape: {
            credentialReferencesOnly: true,
            providerSecretReadable: false,
            bifrostAdminAccess: false,
            dbAccess: false,
        },
    };
}

function deny(
    action: PortalSensitiveAction,
    requirements: readonly PortalSensitiveActionRequirement[],
    controlApiRequirement: PortalControlApiRequirementShape,
    code: PortalSensitiveActionDenialCode,
    breakGlassStatus: BreakGlassStatusPosture | undefined,
): PortalSensitiveActionGuardDenied {
    return {
        decision: 'deny',
        action,
        requirements,
        denial: portalSensitiveActionDenials[code],
        controlApiRequirement,
        ...(breakGlassStatus === undefined ? {} : { breakGlassStatus }),
    };
}

function hasRequirement(
    requirements: readonly PortalSensitiveActionRequirement[],
    requirement: PortalSensitiveActionRequirement,
): boolean {
    return requirements.includes(requirement);
}

function buildBreakGlassStatusPosture(input: PortalSensitiveActionGuardInput): BreakGlassStatusPosture | undefined {
    if (input.action !== 'break-glass-token-status' && input.action !== 'break-glass-token-mint') return undefined;
    if (input.productionAuthEnabled !== true) {
        return { state: 'disabled', tokenMaterialAvailable: false, mintingAllowed: false };
    }
    if (input.approvalSatisfied !== true) {
        return { state: 'pending', tokenMaterialAvailable: false, mintingAllowed: false };
    }
    return { state: 'approved', tokenMaterialAvailable: false, mintingAllowed: input.action === 'break-glass-token-mint' };
}
