import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import registrySnapshotJson from '../registry/model-aliases.v0.1.json' with { type: 'json' };
import type { ModelProviderRegistrySnapshot } from './schema.ts';

export const defaultRegistrySnapshotPath = fileURLToPath(new URL('../registry/model-aliases.v0.1.json', import.meta.url));

export interface RegistrySnapshotLoadOptions {
  readonly path?: string;
}

export async function loadRegistrySnapshot(
  options: RegistrySnapshotLoadOptions = {},
): Promise<ModelProviderRegistrySnapshot> {
  const path = options.path ?? defaultRegistrySnapshotPath;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  return assertRegistrySnapshot(parsed, path);
}

export function getBundledRegistrySnapshot(): ModelProviderRegistrySnapshot {
  return cloneSnapshot(assertRegistrySnapshot(registrySnapshotJson, defaultRegistrySnapshotPath));
}

export function assertRegistrySnapshot(value: unknown, source = 'registry snapshot'): ModelProviderRegistrySnapshot {
  if (!isRecord(value)) throw new Error(`${source} must be a JSON object`);
  assertString(value.contract_version, `${source}.contract_version`);
  assertString(value.registry_version, `${source}.registry_version`);
  assertString(value.created_at, `${source}.created_at`);
  assertString(value.freshness_expires_at, `${source}.freshness_expires_at`);
  if (!Array.isArray(value.model_aliases)) throw new Error(`${source}.model_aliases must be an array`);
  return value as unknown as ModelProviderRegistrySnapshot;
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneSnapshot(snapshot: ModelProviderRegistrySnapshot): ModelProviderRegistrySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ModelProviderRegistrySnapshot;
}
