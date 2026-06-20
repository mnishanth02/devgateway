import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedCommands = [
  'lint',
  'typecheck',
  'test',
  'build',
  'eval:smoke',
  'db:check',
  'registry:validate',
  'policy:validate'
];
const expectedWorkspaceGlobs = ['apps/*', 'packages/*', 'workers/*'];
const strictCompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true
};

const failures = [];

function readJson(relativePath) {
  const absolutePath = join(rootDir, relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    failures.push(`${relativePath} is missing or invalid JSON: ${error.message}`);
    return undefined;
  }
}

function readText(relativePath) {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath} is missing`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

const packageJson = readJson('package.json');
if (packageJson) {
  if (packageJson.private !== true) {
    failures.push('package.json must be private');
  }
  if (typeof packageJson.packageManager !== 'string' || !packageJson.packageManager.startsWith('pnpm@')) {
    failures.push('package.json must pin a pnpm packageManager');
  }
  for (const dependency of ['turbo', 'typescript']) {
    if (!packageJson.devDependencies?.[dependency]) {
      failures.push(`package.json devDependencies must include ${dependency}`);
    }
  }
  for (const command of expectedCommands) {
    const expectedScript = `turbo run ${command}`;
    if (packageJson.scripts?.[command] !== expectedScript) {
      failures.push(`package.json script "${command}" must be "${expectedScript}"`);
    }
  }
}

const workspaceYaml = readText('pnpm-workspace.yaml');
for (const workspaceGlob of expectedWorkspaceGlobs) {
  if (!workspaceYaml.includes(`"${workspaceGlob}"`) && !workspaceYaml.includes(`'${workspaceGlob}'`) && !workspaceYaml.includes(`- ${workspaceGlob}`)) {
    failures.push(`pnpm-workspace.yaml must include ${workspaceGlob}`);
  }
}

const turboJson = readJson('turbo.json');
if (turboJson) {
  for (const command of expectedCommands) {
    if (!turboJson.tasks?.[command]) {
      failures.push(`turbo.json must define task "${command}"`);
    }
  }
  for (const command of ['lint', 'typecheck', 'db:check', 'registry:validate', 'policy:validate']) {
    const dependsOn = turboJson.tasks?.[command]?.dependsOn ?? [];
    if (!dependsOn.includes('transit')) {
      failures.push(`turbo.json task "${command}" must depend on transit for dependency-aware caching`);
    }
  }
  if (!turboJson.tasks?.build?.dependsOn?.includes('^build')) {
    failures.push('turbo.json task "build" must depend on ^build');
  }
}

const tsconfig = readJson('tsconfig.base.json');
if (tsconfig) {
  for (const [option, expectedValue] of Object.entries(strictCompilerOptions)) {
    if (tsconfig.compilerOptions?.[option] !== expectedValue) {
      failures.push(`tsconfig.base.json compilerOptions.${option} must be ${expectedValue}`);
    }
  }
}

const npmrc = readText('.npmrc');
for (const requiredLine of ['engine-strict=true', 'strict-peer-dependencies=true', 'package-manager-strict=true']) {
  if (!npmrc.split(/\r?\n/u).includes(requiredLine)) {
    failures.push(`.npmrc must include ${requiredLine}`);
  }
}

if (failures.length > 0) {
  console.error('Root workspace tooling validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Root workspace tooling validation passed.');
