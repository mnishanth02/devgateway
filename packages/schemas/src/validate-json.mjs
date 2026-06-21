import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const seenIds = new Set();
const schemasById = new Map();

async function collectJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectJsonFiles(path));
    if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
  }
  return files;
}

function assertNoDefaults(value, path) {
  if (!value || typeof value !== 'object') return;
  if (Object.hasOwn(value, 'default')) {
    throw new Error(`${path} contains a JSON Schema default`);
  }
  for (const [key, child] of Object.entries(value)) {
    assertNoDefaults(child, `${path}.${key}`);
  }
}

for (const file of await collectJsonFiles(join(packageRoot, 'schemas'))) {
  const rel = relative(packageRoot, file).replaceAll('\\', '/');
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed.$schema || !parsed.$id) {
    throw new Error(`${rel} must include $schema and $id`);
  }
  if (seenIds.has(parsed.$id)) {
    throw new Error(`Duplicate $id: ${parsed.$id}`);
  }
  seenIds.add(parsed.$id);
  schemasById.set(parsed.$id, parsed);
  assertNoDefaults(parsed, rel);
}

function resolvePointer(document, pointer) {
  if (!pointer) return document;
  const parts = pointer.replace(/^#/, '').split('/').filter(Boolean);
  let current = document;
  for (const rawPart of parts) {
    const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
    current = current?.[part];
  }
  return current;
}

function assertSchemaRef(ref, label) {
  const [id, pointer = ''] = ref.split('#');
  const document = schemasById.get(id);
  if (!document) throw new Error(`${label} references unknown schema id ${id}`);
  if (!resolvePointer(document, `#${pointer}`)) {
    throw new Error(`${label} references missing JSON pointer ${ref}`);
  }
}

const catalog = schemasById.get('https://devgateway.local/schemas/index.v0.1.json');
for (const [name, ref] of Object.entries(catalog.schemas)) {
  assertSchemaRef(ref, `schemas.${name}`);
}
for (const endpoint of catalog.endpoints) {
  for (const key of ['request_schema', 'response_schema', 'stream_chunk_schema', 'stream_event_schema', 'event_schema']) {
    if (endpoint[key]) assertSchemaRef(endpoint[key], `${endpoint.method} ${endpoint.path} ${key}`);
  }
}
for (const tool of catalog.async_mcp_tools) {
  assertSchemaRef(tool.input_schema, `${tool.name} input`);
  assertSchemaRef(tool.output_schema, `${tool.name} output`);
}
for (const [name, ref] of Object.entries(catalog.shared_contracts)) {
  assertSchemaRef(ref, `shared_contracts.${name}`);
}

console.log(`Validated ${seenIds.size} schema JSON files and catalog references.`);
