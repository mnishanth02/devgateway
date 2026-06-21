import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import providerDataClassMatrixJson from '../policies/provider-data-class-matrix.v0.1.json' with { type: 'json' };
import type { ProviderPolicyMatrix } from './data-class-policy.ts';

export const defaultProviderDataClassMatrixPath = fileURLToPath(
  new URL('../policies/provider-data-class-matrix.v0.1.json', import.meta.url),
);

export interface ProviderDataClassMatrixLoadOptions {
  readonly path?: string;
}

export async function loadProviderDataClassMatrix(
  options: ProviderDataClassMatrixLoadOptions = {},
): Promise<ProviderPolicyMatrix> {
  const path = options.path ?? defaultProviderDataClassMatrixPath;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return assertProviderDataClassMatrix(parsed, path);
}

export function getBundledProviderDataClassMatrix(): ProviderPolicyMatrix {
  return cloneMatrix(assertProviderDataClassMatrix(providerDataClassMatrixJson, defaultProviderDataClassMatrixPath));
}

export function assertProviderDataClassMatrix(value: unknown, source = 'provider data-class matrix'): ProviderPolicyMatrix {
  if (!isRecord(value)) throw new Error(`${source} must be a JSON object`);
  assertString(value.schemaVersion, `${source}.schemaVersion`);
  assertString(value.matrixId, `${source}.matrixId`);
  assertString(value.status, `${source}.status`);
  assertString(value.createdAt, `${source}.createdAt`);
  assertString(value.freshnessExpiresAt, `${source}.freshnessExpiresAt`);
  if (!Array.isArray(value.providers)) throw new Error(`${source}.providers must be an array`);
  return value as unknown as ProviderPolicyMatrix;
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneMatrix(matrix: ProviderPolicyMatrix): ProviderPolicyMatrix {
  return JSON.parse(JSON.stringify(matrix)) as ProviderPolicyMatrix;
}
