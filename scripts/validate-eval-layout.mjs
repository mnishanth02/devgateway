import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredArtifactKeys = ['expected_gate_result', 'expected_trace_bundle', 'expected_audit_event'];
const failures = [];

function readOption(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    failures.push(`${flag} requires a value`);
    return fallback;
  }
  return value;
}

const rootDir = resolve(readOption('repo-root', defaultRootDir));
const datasetDir = resolve(rootDir, readOption('dataset-dir', 'evals/datasets'));
const fixtureDir = resolve(rootDir, readOption('fixture-dir', 'evals/fixtures'));

function repoRelative(absolutePath) {
  const path = relative(rootDir, absolutePath).split(sep).join('/');
  return path || '.';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function fail(filePath, message) {
  failures.push(`${repoRelative(filePath)}: ${message}`);
}

function readJson(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!isObject(parsed)) {
      fail(filePath, 'JSON root must be an object');
      return undefined;
    }
    return parsed;
  } catch (error) {
    fail(filePath, `invalid JSON: ${error.message}`);
    return undefined;
  }
}

function walkFiles(directory) {
  if (!existsSync(directory)) {
    failures.push(`${repoRelative(directory)} is missing`);
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files.sort((left, right) => repoRelative(left).localeCompare(repoRelative(right)));
}

function isWithin(childPath, parentPath) {
  const path = relative(parentPath, childPath);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function resolveRepoRef(filePath, ref, context) {
  if (!isNonEmptyString(ref)) {
    fail(filePath, `${context} must be a non-empty string`);
    return undefined;
  }
  if (isAbsolute(ref)) {
    fail(filePath, `${context} must be repo-relative, not absolute`);
    return undefined;
  }
  const normalizedRef = ref.replace(/\\/gu, '/');
  const parts = normalizedRef.split('/').filter((part) => part.length > 0);
  if (parts.includes('..')) {
    fail(filePath, `${context} must not traverse directories: ${ref}`);
    return undefined;
  }
  return resolve(rootDir, ...parts);
}

function assertSafeDatasetFlags(filePath, dataset) {
  if (dataset.inert_fixture_mode !== true) {
    fail(filePath, 'inert_fixture_mode must be true');
  }
  const sourcePolicy = dataset.source_data_policy;
  if (!isObject(sourcePolicy)) {
    fail(filePath, 'source_data_policy must be present');
    return;
  }
  if (sourcePolicy.synthetic_only !== true) {
    fail(filePath, 'source_data_policy.synthetic_only must be true');
  }
  const noLiveCallFlag =
    dataset.no_live_external_calls === true ||
    sourcePolicy.no_live_external_calls === true ||
    sourcePolicy.no_live_github_calls === true;
  if (!noLiveCallFlag) {
    fail(filePath, 'a no-live-call flag must be present and true');
  }
  if (dataset.production_enablement === true || dataset.production_retrieval_behavior === true) {
    fail(filePath, 'production enablement/retrieval behavior must not be true');
  }
}

function assertSafeCaseFlags(filePath, caseEntry, context) {
  if (caseEntry.expected?.no_production_enablement !== undefined && caseEntry.expected.no_production_enablement !== true) {
    fail(filePath, `${context}.expected.no_production_enablement must be true when present`);
  }
  if (isObject(caseEntry.safeguards)) {
    if (caseEntry.safeguards.fixture_only !== true) {
      fail(filePath, `${context}.safeguards.fixture_only must be true`);
    }
    if (caseEntry.safeguards.no_live_external_calls !== true) {
      fail(filePath, `${context}.safeguards.no_live_external_calls must be true`);
    }
    if (caseEntry.safeguards.synthetic_source_data !== true) {
      fail(filePath, `${context}.safeguards.synthetic_source_data must be true`);
    }
    if (caseEntry.safeguards.production_retrieval_behavior === true) {
      fail(filePath, `${context}.safeguards.production_retrieval_behavior must not be true`);
    }
  }
}

function assertSafeFixtureFlags(filePath, fixture) {
  if (fixture.synthetic !== true) {
    fail(filePath, 'synthetic must be true');
  }
  if (fixture.live_external_calls !== false) {
    fail(filePath, 'live_external_calls must be false');
  }
  if (fixture.production_enablement === true || fixture.production_retrieval_behavior === true) {
    fail(filePath, 'production enablement/retrieval behavior must not be true');
  }
}

function validateArtifactRefs(filePath, artifactRefs, context, required) {
  if (!isObject(artifactRefs)) {
    if (required) {
      fail(filePath, `${context}.artifact_refs must be present`);
    }
    return false;
  }
  for (const key of requiredArtifactKeys) {
    if (!isNonEmptyString(artifactRefs[key])) {
      fail(filePath, `${context}.artifact_refs.${key} must be present`);
    }
  }
  return true;
}

function validateAuditRequirements(filePath, caseEntry, context, required) {
  if (Array.isArray(caseEntry.audit_evidence_required)) {
    if (caseEntry.audit_evidence_required.length === 0) {
      fail(filePath, `${context}.audit_evidence_required must not be empty`);
    }
    for (const [index, field] of caseEntry.audit_evidence_required.entries()) {
      if (!isNonEmptyString(field)) {
        fail(filePath, `${context}.audit_evidence_required[${index}] must be a non-empty string`);
      }
    }
    return;
  }
  if (Array.isArray(caseEntry.audit_evidence)) {
    if (caseEntry.audit_evidence.length === 0) {
      fail(filePath, `${context}.audit_evidence must not be empty`);
    }
    for (const [index, evidence] of caseEntry.audit_evidence.entries()) {
      if (!isObject(evidence) || !isNonEmptyString(evidence.field) || !isNonEmptyString(evidence.presence)) {
        fail(filePath, `${context}.audit_evidence[${index}] must include field and presence`);
      }
    }
    return;
  }
  if (required) {
    fail(filePath, `${context} must declare audit evidence requirements`);
  }
}

function validateFixtureAgainstCase(fixturePath, fixture, caseEntry, caseContext, artifactsRequired) {
  assertSafeFixtureFlags(fixturePath, fixture);
  if (fixture.case_id !== caseEntry.case_id) {
    fail(fixturePath, `case_id must match ${caseContext}.case_id (${caseEntry.case_id})`);
  }
  if (fixture.category !== undefined && fixture.category !== caseEntry.category) {
    fail(fixturePath, `category must match ${caseContext}.category (${caseEntry.category}) when present`);
  }
  const fixtureHasArtifacts = validateArtifactRefs(fixturePath, fixture.artifact_refs, 'fixture', artifactsRequired);
  if (fixtureHasArtifacts && isObject(caseEntry.artifact_refs)) {
    for (const key of requiredArtifactKeys) {
      if (fixture.artifact_refs[key] !== caseEntry.artifact_refs[key]) {
        fail(fixturePath, `artifact_refs.${key} must match ${caseContext}.artifact_refs.${key}`);
      }
    }
  }
}

function validateDataset(filePath, referencedFixtures, fixtureOwners) {
  const dataset = readJson(filePath);
  if (!dataset) {
    return;
  }

  for (const field of ['dataset_id', 'dataset_version', 'suite']) {
    if (!isNonEmptyString(dataset[field])) {
      fail(filePath, `${field} must be present`);
    }
  }
  const expectedDatasetId = basename(filePath, '.json');
  if (isNonEmptyString(dataset.dataset_id) && dataset.dataset_id !== expectedDatasetId) {
    fail(filePath, `dataset_id must match file name (${expectedDatasetId})`);
  }
  assertSafeDatasetFlags(filePath, dataset);

  if (!Array.isArray(dataset.categories) || dataset.categories.length === 0) {
    fail(filePath, 'categories must be a non-empty array');
  }
  if (!Array.isArray(dataset.cases) || dataset.cases.length === 0) {
    fail(filePath, 'cases must be a non-empty array');
  }
  const datasetCategories = Array.isArray(dataset.categories) ? dataset.categories : [];
  const datasetCases = Array.isArray(dataset.cases) ? dataset.cases : [];

  const fixtureRootPath = resolveRepoRef(filePath, dataset.fixture_root, 'fixture_root');
  if (fixtureRootPath && !isWithin(fixtureRootPath, fixtureDir)) {
    fail(filePath, 'fixture_root must stay under evals/fixtures');
  }
  if (fixtureRootPath && !existsSync(fixtureRootPath)) {
    fail(filePath, `fixture_root does not exist: ${dataset.fixture_root}`);
  }

  const categories = new Set();
  for (const [index, category] of datasetCategories.entries()) {
    if (!isNonEmptyString(category)) {
      fail(filePath, `categories[${index}] must be a non-empty string`);
    } else if (categories.has(category)) {
      fail(filePath, `duplicate category: ${category}`);
    } else {
      categories.add(category);
    }
  }

  const categoryCaseCounts = new Map([...categories].map((category) => [category, 0]));
  const caseIds = new Set();
  const artifactsRequired = dataset.artifact_ref_policy?.required === true;
  if (dataset.artifact_ref_policy !== undefined && dataset.artifact_ref_policy.required !== true) {
    fail(filePath, 'artifact_ref_policy.required must be true when artifact_ref_policy is present');
  }

  for (const [index, caseEntry] of datasetCases.entries()) {
    const caseContext = `cases[${index}]`;
    if (!isObject(caseEntry)) {
      fail(filePath, `${caseContext} must be an object`);
      continue;
    }
    if (!isNonEmptyString(caseEntry.case_id)) {
      fail(filePath, `${caseContext}.case_id must be present`);
    } else if (caseIds.has(caseEntry.case_id)) {
      fail(filePath, `duplicate case_id: ${caseEntry.case_id}`);
    } else {
      caseIds.add(caseEntry.case_id);
    }
    if (!isNonEmptyString(caseEntry.category)) {
      fail(filePath, `${caseContext}.category must be present`);
    } else if (!categories.has(caseEntry.category)) {
      fail(filePath, `${caseContext}.category must reference a declared category`);
    } else {
      categoryCaseCounts.set(caseEntry.category, (categoryCaseCounts.get(caseEntry.category) ?? 0) + 1);
    }

    assertSafeCaseFlags(filePath, caseEntry, caseContext);
    validateArtifactRefs(filePath, caseEntry.artifact_refs, caseContext, artifactsRequired);
    validateAuditRequirements(filePath, caseEntry, caseContext, artifactsRequired);

    if (!Array.isArray(caseEntry.fixture_refs) || caseEntry.fixture_refs.length === 0) {
      fail(filePath, `${caseContext}.fixture_refs must be a non-empty array`);
      continue;
    }
    for (const [fixtureIndex, fixtureRef] of caseEntry.fixture_refs.entries()) {
      const fixtureContext = `${caseContext}.fixture_refs[${fixtureIndex}]`;
      if (!isObject(fixtureRef)) {
        fail(filePath, `${fixtureContext} must be an object`);
        continue;
      }
      const fixturePath = resolveRepoRef(filePath, fixtureRef.path, `${fixtureContext}.path`);
      if (!fixturePath) {
        continue;
      }
      const normalizedRef = fixtureRef.path.replace(/\\/gu, '/');
      if (!normalizedRef.startsWith('evals/fixtures/')) {
        fail(filePath, `${fixtureContext}.path must stay under evals/fixtures`);
      }
      if (!isWithin(fixturePath, fixtureDir)) {
        fail(filePath, `${fixtureContext}.path resolves outside evals/fixtures`);
      }
      if (fixtureRootPath && !isWithin(fixturePath, fixtureRootPath)) {
        fail(filePath, `${fixtureContext}.path must stay under fixture_root`);
      }
      if (!existsSync(fixturePath)) {
        fail(filePath, `${fixtureContext}.path does not exist: ${fixtureRef.path}`);
        continue;
      }
      if (statSync(fixturePath).isDirectory()) {
        fail(filePath, `${fixtureContext}.path must reference a file`);
        continue;
      }
      if (extname(fixturePath) !== '.json') {
        fail(filePath, `${fixtureContext}.path must reference a JSON fixture`);
        continue;
      }
      const previousOwner = fixtureOwners.get(fixturePath);
      if (previousOwner) {
        fail(filePath, `${fixtureContext}.path is already referenced by ${previousOwner}`);
      } else {
        fixtureOwners.set(fixturePath, `${repoRelative(filePath)} ${caseContext}`);
      }
      referencedFixtures.set(fixturePath, { caseEntry, caseContext, artifactsRequired });
    }
  }

  for (const [category, count] of categoryCaseCounts.entries()) {
    if (count === 0) {
      fail(filePath, `category has no cases: ${category}`);
    }
  }
}

const datasetFiles = walkFiles(datasetDir).filter((filePath) => extname(filePath) === '.json');
const allFixtureFiles = walkFiles(fixtureDir);
const referencedFixtures = new Map();
const fixtureOwners = new Map();

if (datasetFiles.length === 0) {
  failures.push(`${repoRelative(datasetDir)} must contain dataset JSON files`);
}

for (const datasetFile of datasetFiles) {
  validateDataset(datasetFile, referencedFixtures, fixtureOwners);
}

for (const fixtureFile of allFixtureFiles) {
  if (basename(fixtureFile) === '.gitkeep') {
    continue;
  }
  if (extname(fixtureFile) !== '.json') {
    fail(fixtureFile, 'fixture files must be JSON');
    continue;
  }
  const fixture = readJson(fixtureFile);
  if (!fixture) {
    continue;
  }
  const reference = referencedFixtures.get(fixtureFile);
  if (!reference) {
    fail(fixtureFile, 'fixture is not referenced by any dataset case');
    assertSafeFixtureFlags(fixtureFile, fixture);
    continue;
  }
  validateFixtureAgainstCase(fixtureFile, fixture, reference.caseEntry, reference.caseContext, reference.artifactsRequired);
}

if (failures.length > 0) {
  console.error('Eval dataset layout validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Eval dataset layout validation passed (${datasetFiles.length} datasets, ${referencedFixtures.size} fixtures).`);
