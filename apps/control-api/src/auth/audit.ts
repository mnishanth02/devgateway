import type { BetterAuthOptions } from 'better-auth';

export type AuthAuditEventName =
  | 'auth.user.created'
  | 'auth.user.updated'
  | 'auth.user.deleted'
  | 'auth.session.created'
  | 'auth.session.revoked'
  | 'auth.account.linked'
  | 'auth.account.updated'
  | 'auth.account.deleted';

export interface AuthAuditEvent {
  readonly name: AuthAuditEventName;
  readonly subjectId?: string;
  readonly actorId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface AuthAuditEmitter {
  emit(event: AuthAuditEvent): Promise<void>;
}

export const authAuditEventRequirements = [
  'User create/update/delete must emit immutable audit events.',
  'Session create/revoke must emit immutable audit events.',
  'Account link/update/delete must emit immutable audit events.',
  'Provider-key and break-glass access must be audited outside Better Auth hooks.',
] as const;

export const noopAuthAuditEmitter: AuthAuditEmitter = {
  async emit() {
    return undefined;
  },
};

export function createAuthDatabaseHooks(
  auditEmitter: AuthAuditEmitter = noopAuthAuditEmitter,
): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    user: {
      create: {
        after: async (user) => {
          await auditEmitter.emit({
            name: 'auth.user.created',
            subjectId: user.id,
            actorId: user.id,
          });
        },
      },
      update: {
        after: async (user) => {
          await auditEmitter.emit({
            name: 'auth.user.updated',
            subjectId: user.id,
            actorId: user.id,
          });
        },
      },
      delete: {
        after: async (user) => {
          await auditEmitter.emit({
            name: 'auth.user.deleted',
            subjectId: user.id,
            actorId: user.id,
          });
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await auditEmitter.emit({
            name: 'auth.session.created',
            subjectId: session.userId,
            actorId: session.userId,
          });
        },
      },
      delete: {
        after: async (session) => {
          await auditEmitter.emit({
            name: 'auth.session.revoked',
            subjectId: session.userId,
            actorId: session.userId,
          });
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.linked',
            subjectId: account.userId,
            actorId: account.userId,
            metadata: { providerId: account.providerId },
          });
        },
      },
      update: {
        after: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.updated',
            subjectId: account.userId,
            actorId: account.userId,
            metadata: { providerId: account.providerId },
          });
        },
      },
      delete: {
        after: async (account) => {
          await auditEmitter.emit({
            name: 'auth.account.deleted',
            subjectId: account.userId,
            actorId: account.userId,
            metadata: { providerId: account.providerId },
          });
        },
      },
    },
  };
}
