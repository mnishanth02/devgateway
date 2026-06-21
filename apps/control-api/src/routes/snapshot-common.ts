import { createHash } from 'node:crypto';

import type { DenialReasonCode } from '@devgateway/policy';

export type SnapshotRouteMethod = 'GET';

export interface SnapshotRouteSchema {
  readonly operationId: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly responses: Readonly<Record<number, { readonly description: string }>>;
}

export interface SnapshotRoute {
  readonly method: SnapshotRouteMethod;
  readonly path: string;
  readonly schema: SnapshotRouteSchema;
  readonly handler: (request: Request) => Response | Promise<Response>;
}

export interface SnapshotProductionGateOptions {
  readonly runtimeEnvironment?: 'development' | 'test' | 'production';
}

export type SnapshotRouteRegistrar = (route: SnapshotRoute) => void;

export type SnapshotRouteErrorCode = 'policy_stale' | 'policy_missing' | 'route_disabled' | 'eval_gate_missing';

export interface SnapshotRouteErrorBody {
  readonly error: {
    readonly code: SnapshotRouteErrorCode;
    readonly reason: DenialReasonCode;
    readonly message: string;
    readonly fail_closed: true;
    readonly production_enabled: false;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface SnapshotFreshnessReport {
  readonly source: 'registry' | 'policy';
  readonly version: string;
  readonly created_at: string;
  readonly freshness_expires_at: string;
  readonly checked_at: string;
  readonly stale: boolean;
  readonly max_staleness_seconds: number | null;
  readonly production_enabled: false;
}

export interface SnapshotChecksumReport {
  readonly algorithm: 'sha256';
  readonly canonicalization: 'json-stable-key-sort-v0';
  readonly checksum: string;
}

export function registerSnapshotRoutes(routes: readonly SnapshotRoute[], registrar: SnapshotRouteRegistrar): void {
  for (const route of routes) registrar(route);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function notFoundResponse(): Response {
  return jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, 404);
}

export function snapshotErrorResponse(
  status: number,
  code: SnapshotRouteErrorCode,
  reason: DenialReasonCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): Response {
  return jsonResponse(snapshotErrorBody(code, reason, message, details), status);
}

export function snapshotErrorBody(
  code: SnapshotRouteErrorCode,
  reason: DenialReasonCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SnapshotRouteErrorBody {
  return {
    error: {
      code,
      reason,
      message,
      fail_closed: true,
      production_enabled: false,
      ...(details === undefined ? {} : { details }),
    },
  };
}

export function denySnapshotRouteInProduction(options: SnapshotProductionGateOptions): Response | undefined {
  if (options.runtimeEnvironment !== 'production') return undefined;
  return snapshotErrorResponse(
    503,
    'route_disabled',
    'route_disabled',
    'Snapshot/config routes require authenticated admin access before production exposure.',
    { production_enabled: false },
  );
}

export function getRequestPathname(request: Request): string {
  return new URL(request.url).pathname;
}

export function checksumSnapshot(snapshot: unknown): SnapshotChecksumReport {
  return {
    algorithm: 'sha256',
    canonicalization: 'json-stable-key-sort-v0',
    checksum: createHash('sha256').update(JSON.stringify(sortKeys(snapshot))).digest('hex'),
  };
}

export function buildFreshnessReport(input: {
  readonly source: 'registry' | 'policy';
  readonly version: string;
  readonly createdAt: string;
  readonly freshnessExpiresAt: string;
  readonly checkedAt: Date;
  readonly maxStalenessSeconds?: number | null;
}): SnapshotFreshnessReport {
  const expiresAt = Date.parse(input.freshnessExpiresAt);
  const stale = Number.isNaN(expiresAt) || expiresAt <= input.checkedAt.getTime();
  return {
    source: input.source,
    version: input.version,
    created_at: input.createdAt,
    freshness_expires_at: input.freshnessExpiresAt,
    checked_at: input.checkedAt.toISOString(),
    stale,
    max_staleness_seconds: input.maxStalenessSeconds ?? null,
    production_enabled: false,
  };
}

export function isFreshnessStale(report: SnapshotFreshnessReport): boolean {
  return report.stale;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortKeys(entry));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}
