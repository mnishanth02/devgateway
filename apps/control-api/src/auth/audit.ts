import type { BetterAuthOptions } from 'better-auth';

export type AuthAuditEventName =
  | 'auth.user.create_requested'
  | 'auth.user.created'
  | 'auth.user.update_requested'
  | 'auth.user.updated'
  | 'auth.user.delete_requested'
  | 'auth.user.deleted'
  | 'auth.session.create_requested'
  | 'auth.session.created'
  | 'auth.session.revoke_requested'
  | 'auth.session.revoked'
  | 'auth.account.link_requested'
  | 'auth.account.linked'
  | 'auth.account.update_requested'
  | 'auth.account.updated'
  | 'auth.account.delete_requested'
  | 'auth.account.deleted'
  | 'auth.admin_bootstrap.created'
  | 'auth.admin_bootstrap.consumed'
  | 'auth.admin_bootstrap.denied'
  | 'auth.sensitive_action.denied'
  | 'auth.provider_key.read'
  | 'auth.provider_key.rotated'
  | 'auth.break_glass_token.minted'
  | 'auth.production_enablement.requested';

export interface AuthAuditEvent {
  readonly name: AuthAuditEventName;
  readonly subjectId?: string;
  readonly actorId?: string;
  readonly traceId?: string;
  readonly requestId?: string;
  readonly occurredAt?: string;
  readonly outcome?: 'allow' | 'deny' | 'error';
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AuthAuditEmitter {
  emit(event: AuthAuditEvent): Promise<void>;
}

export interface ImmutableAuthAuditStore {
  insertAuthAuditEvent(event: PersistedAuthAuditEvent): Promise<void>;
}

export interface PersistedAuthAuditEvent extends AuthAuditEvent {
  readonly occurredAt: string;
  readonly immutable: true;
  readonly schemaVersion: 'auth-audit.v1';
}

export interface TestAuthAuditEmitter extends AuthAuditEmitter {
  readonly productionSafe: false;
  readonly events: readonly PersistedAuthAuditEvent[];
}

export const authAuditEventRequirements = [
  'User create/update/delete attempts must emit immutable pre-mutation audit events; success evidence must be transactionally coupled before production enablement.',
  'Session create/revoke attempts must emit immutable pre-mutation audit events; success evidence must be transactionally coupled before production enablement.',
  'Account link/update/delete attempts must emit immutable pre-mutation audit events; success evidence must be transactionally coupled before production enablement.',
  'Provider-key and break-glass access must be audited outside Better Auth hooks.',
  'Admin bootstrap create/consume/deny events must be immutable and request-correlated.',
] as const;

export function createDbBackedAuthAuditEmitter(store: ImmutableAuthAuditStore): AuthAuditEmitter {
  return {
    async emit(event) {
      await store.insertAuthAuditEvent(toPersistedAuthAuditEvent(event));
    },
  };
}

export function createTestAuthAuditEmitter(): TestAuthAuditEmitter {
  const events: PersistedAuthAuditEvent[] = [];
  return {
    productionSafe: false,
    get events() {
      return events;
    },
    async emit(event) {
      events.push(toPersistedAuthAuditEvent(event));
    },
  };
}

export function requireAuthAuditEmitter(auditEmitter: AuthAuditEmitter | undefined): AuthAuditEmitter {
  if (auditEmitter === undefined) {
    throw new Error('AuthAuditEmitter is required; production must use an immutable DB-backed emitter');
  }
  return auditEmitter;
}

export function createAuthDatabaseHooks(auditEmitter: AuthAuditEmitter): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    user: {
      create: {
        before: async (user) => {
          await auditEmitter.emit({
            name: 'auth.user.create_requested',
            subjectId: user.id,
            actorId: user.id,
          });
        },
      },
      update: {
        before: async (user) => {
          await auditEmitter.emit(authAuditEvent('auth.user.update_requested', user.id));
        },
      },
      delete: {
        before: async (user) => {
          await auditEmitter.emit({
            name: 'auth.user.delete_requested',
            subjectId: user.id,
            actorId: user.id,
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          await auditEmitter.emit({
            name: 'auth.session.create_requested',
            subjectId: session.userId,
            actorId: session.userId,
          });
        },
      },
      delete: {
        before: async (session) => {
          await auditEmitter.emit({
            name: 'auth.session.revoke_requested',
            subjectId: session.userId,
            actorId: session.userId,
          });
        },
      },
    },
    account: {
      create: {
        before: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.link_requested',
            ...optionalActorSubject(account.userId),
            ...providerMetadata(account.providerId),
          });
        },
      },
      update: {
        before: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.update_requested',
            ...optionalActorSubject(account.userId),
            ...providerMetadata(account.providerId),
          });
        },
      },
      delete: {
        before: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.delete_requested',
            ...optionalActorSubject(account.userId),
            ...providerMetadata(account.providerId),
          });
        },
      },
    },
  };
}

function authAuditEvent(name: AuthAuditEventName, subjectId: string | undefined): AuthAuditEvent {
  return {
    name,
    ...optionalActorSubject(subjectId),
  };
}

function optionalActorSubject(subjectId: string | undefined): Pick<AuthAuditEvent, 'subjectId' | 'actorId'> | {} {
  return subjectId === undefined ? {} : { subjectId, actorId: subjectId };
}

function providerMetadata(providerId: string | undefined): Pick<AuthAuditEvent, 'metadata'> | {} {
  return providerId === undefined ? {} : { metadata: { providerId } };
}

function toPersistedAuthAuditEvent(event: AuthAuditEvent): PersistedAuthAuditEvent {
  return {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    immutable: true,
    schemaVersion: 'auth-audit.v1',
  };
}
