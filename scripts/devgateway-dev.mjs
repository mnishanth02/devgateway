#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const composeProject = 'devgateway-local';
const composeFile = join(repoRoot, 'docker-compose.local.yml');
const localEnvExampleFile = join(repoRoot, '.env.local.example');
const localEnvFile = join(repoRoot, '.env.local');
const stateDir = join(repoRoot, '.devgateway');
const stateFile = join(stateDir, 'runtime.json');

export const LOCAL_PORTS = Object.freeze({
  controlApi: 43100,
  adminPortal: 43101,
  toolBroker: 43102,
  bifrost: 43180,
  operationalPostgres: 45432,
  knowledgePostgres: 45433,
  redis: 46379,
  minioApi: 49000,
  minioConsole: 49001,
  neo4jHttp: 47474,
  neo4jBolt: 47687,
  otelGrpc: 44317,
  otelHttp: 44318,
  otelHealth: 43133,
  prometheus: 49090,
  grafana: 43030,
});

const commandNames = ['setup', 'dev', 'stop', 'status', 'reset', 'help'];
const profileNames = ['all', 'backend', 'deps', 'frontend'];

const serviceProfiles = Object.freeze({
  backend: [
    {
      name: 'control-api',
      packageName: '@devgateway/control-api',
      port: LOCAL_PORTS.controlApi,
      healthPath: '/healthz',
    },
    {
      name: 'tool-broker',
      packageName: '@devgateway/tool-broker',
      port: LOCAL_PORTS.toolBroker,
      healthPath: '/healthz',
    },
  ],
  frontend: [
    {
      name: 'admin-portal',
      packageName: '@devgateway/admin-portal',
      port: LOCAL_PORTS.adminPortal,
      healthPath: '/healthz',
    },
  ],
});

const dependencyPorts = [
  LOCAL_PORTS.operationalPostgres,
  LOCAL_PORTS.knowledgePostgres,
  LOCAL_PORTS.redis,
  LOCAL_PORTS.minioApi,
  LOCAL_PORTS.minioConsole,
  LOCAL_PORTS.neo4jHttp,
  LOCAL_PORTS.neo4jBolt,
  LOCAL_PORTS.otelGrpc,
  LOCAL_PORTS.otelHttp,
  LOCAL_PORTS.otelHealth,
  LOCAL_PORTS.prometheus,
  LOCAL_PORTS.grafana,
];

export function parseCli(argv) {
  const [rawCommand = 'help', ...rest] = argv;
  const command = normalizeCommand(rawCommand);
  let profile = 'all';
  let yes = false;
  const extraArgs = [];

  for (const arg of rest) {
    if (arg === '--yes' || arg === '-y') {
      yes = true;
      continue;
    }
    if (arg.startsWith('-')) {
      extraArgs.push(arg);
      continue;
    }
    if (profile === 'all') {
      profile = normalizeProfile(arg);
      continue;
    }
    extraArgs.push(arg);
  }

  return { command, profile, yes, extraArgs };
}

export function renderLocalEnv() {
  return `# DevGateway local development environment
# Generated from the local setup launcher. Safe placeholders only; replace real secrets locally.

NODE_ENV=development
APP_ENV=development
RAILWAY_ENVIRONMENT=development
PRODUCTION_PROVISIONING_ENABLED=false
PRODUCTION_DEPLOY_APPROVAL_REQUIRED=true

BETTER_AUTH_URL=http://localhost:${LOCAL_PORTS.controlApi}
BETTER_AUTH_SECRET=local-dev-better-auth-secret-32bytes-minimum
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:${LOCAL_PORTS.controlApi},http://localhost:${LOCAL_PORTS.adminPortal}
AUTH_ADMIN_BOOTSTRAP_ENABLED=false
AUTH_ADMIN_BOOTSTRAP_EMAIL=admin@example.invalid

OPERATIONAL_DATABASE_URL=postgresql://devgateway:devgateway@localhost:${LOCAL_PORTS.operationalPostgres}/devgateway_operational
KNOWLEDGE_DATABASE_URL=postgresql://devgateway:devgateway@localhost:${LOCAL_PORTS.knowledgePostgres}/devgateway_knowledge
DATABASE_MIGRATION_URL=postgresql://devgateway:devgateway@localhost:${LOCAL_PORTS.operationalPostgres}/devgateway_operational
DATABASE_READONLY_URL=postgresql://devgateway_readonly:devgateway@localhost:${LOCAL_PORTS.operationalPostgres}/devgateway_operational

RETRIEVAL_PRODUCTION_ENABLED=false
RETRIEVAL_LEXICAL_ENABLED=true
RETRIEVAL_EMBEDDINGS_ENABLED=true
RETRIEVAL_RERANKER_ENABLED=true
RETRIEVAL_GRAPH_RAG_ENABLED=true
RETRIEVAL_NEO4J_ENABLED=true
RETRIEVAL_CONTEXT_BUDGETER_ENABLED=true
RETRIEVAL_CONTEXT_COMPRESSOR_ENABLED=true
RETRIEVAL_CODE_EMBEDDINGS_ENABLED=false
RETRIEVAL_EVAL_STRATEGIES=hybrid,hybrid_graph
RETRIEVAL_MAX_CONTEXT_TOKENS=24000
RETRIEVAL_MAX_SNIPPET_TOKENS=1200
NEO4J_URI=bolt://localhost:${LOCAL_PORTS.neo4jBolt}
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=devgateway-local
NEO4J_DATABASE=neo4j

REDIS_URL=redis://localhost:${LOCAL_PORTS.redis}/0
REDIS_QUEUE_NAMESPACE=devgateway:queue:local
REDIS_RATE_LIMIT_NAMESPACE=devgateway:ratelimit:local

BIFROST_BASE_URL=http://localhost:${LOCAL_PORTS.bifrost}
BIFROST_ADMIN_TOKEN=local-bifrost-admin-token
BIFROST_VIRTUAL_KEY_SEED=local-bifrost-virtual-key-seed
BIFROST_CONFIG_PATH=infra/bifrost/bifrost.config.example.yaml
BIFROST_ROUTE_CONFIG_VERSION=local
BIFROST_BREAK_GLASS_ENABLED=false
OPENAI_API_KEY=local-provider-key-placeholder
ANTHROPIC_API_KEY=local-provider-key-placeholder

GITHUB_APP_ID=local-github-app-id
GITHUB_APP_INSTALLATION_ID=local-github-app-installation-id
GITHUB_APP_PRIVATE_KEY_BASE64=local-base64-pem-placeholder
GITHUB_APP_WEBHOOK_SECRET=local-webhook-secret-placeholder

S3_ENDPOINT=http://localhost:${LOCAL_PORTS.minioApi}
S3_BUCKET=devgateway-local-artifacts
S3_REGION=auto
S3_ACCESS_KEY_ID=devgateway
S3_SECRET_ACCESS_KEY=devgateway-local-secret
S3_FORCE_PATH_STYLE=true

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:${LOCAL_PORTS.otelHttp}
OTEL_EXPORTER_OTLP_HEADERS=
OTEL_SERVICE_NAME=devgateway-local
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=development
TRACE_SAMPLE_RATE=1.0
METRICS_EXPORT_MODE=local

EVAL_DATASET_PATH=evals/fixtures
EVAL_GATE_MODE=fixture
EVAL_ARTIFACT_BUCKET=devgateway-local-artifacts
EVAL_PROVIDER_MODE=fixture
EVAL_SMOKE_ENABLED=true

APP_ENCRYPTION_KEY_BASE64=local-32-byte-base64-key-placeholder
CREDENTIAL_KEY_VERSION=local-v1
CREDENTIAL_ROTATION_REQUIRED=false
AUDIT_CORRELATION_SALT=local-audit-correlation-salt
`;
}

export function decidePortAction({ port, busyPid, recordedProcess }) {
  if (busyPid === null || busyPid === undefined) {
    return { action: 'use', reason: `port ${port} is free` };
  }

  if (recordedProcess?.pid === busyPid && isDevgatewayCommand(recordedProcess.command)) {
    return {
      action: 'cleanup',
      pid: busyPid,
      reason: `port ${port} is held by a previous DevGateway ${recordedProcess.profile} process`,
    };
  }

  return {
    action: 'block',
    pid: busyPid,
    reason: `port ${port} is busy by an unknown process; refusing to kill unrelated work`,
  };
}

function normalizeCommand(rawCommand) {
  if (!commandNames.includes(rawCommand)) {
    throw new Error(`Unknown command "${rawCommand}". Expected one of: ${commandNames.join(', ')}`);
  }
  return rawCommand;
}

function normalizeProfile(rawProfile) {
  if (!profileNames.includes(rawProfile)) {
    throw new Error(`Unknown profile "${rawProfile}". Expected one of: ${profileNames.join(', ')}`);
  }
  return rawProfile;
}

function isDevgatewayCommand(command) {
  return typeof command === 'string' && /(@devgateway\/|devgateway-dev\.mjs|docker compose)/u.test(command);
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 2;
    return;
  }

  try {
    switch (options.command) {
      case 'setup':
        await setup();
        break;
      case 'dev':
        await dev(options.profile);
        break;
      case 'stop':
        await stop(options.profile);
        break;
      case 'status':
        await status(options.profile);
        break;
      case 'reset':
        await reset(options.profile, options.yes);
        break;
      case 'help':
        printHelp();
        break;
      default:
        throw new Error(`Unhandled command: ${options.command}`);
    }
  } catch (error) {
    console.error(`devgateway local launcher failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function setup() {
  ensureLocalEnvFiles();
  ensureCommand('pnpm', 'pnpm is required. Install pnpm 11+ or enable Corepack for this repo.');
  runChecked('corepack', ['enable'], { optional: true });
  runChecked('pnpm', ['install', '--frozen-lockfile']);
  ensureDockerAvailable({ required: false });
  if (dockerAvailable()) {
    runCompose(['pull'], { optional: true });
  }
  runChecked('pnpm', ['workspace:validate']);
  console.log('Local setup complete. Next: pnpm local:dev deps | backend | frontend | all');
}

async function dev(profile) {
  ensureLocalEnvFiles();
  if (profile === 'deps') {
    ensureDockerAvailable({ required: true });
    await ensureDependencyPorts();
    runCompose(['up', '-d', '--remove-orphans']);
    writeState({ ...readState(), composeProject });
    await status('deps');
    return;
  }

  if (profile === 'all' || profile === 'backend' || profile === 'frontend') {
    ensureDockerAvailable({ required: true });
    await ensureDependencyPorts();
    runCompose(['up', '-d', '--remove-orphans']);
  }

  await cleanupRecordedProcesses(profile);
  await ensureProfilePorts(profile);

  const services = selectedServices(profile);
  if (services.length === 0) {
    console.log(`No host hot-reload services are configured for profile ${profile}. Dependency containers are running.`);
    return;
  }

  const childProcesses = services.map((service) => spawnServiceDev(service, profile));
  writeState({
    composeProject,
    processes: childProcesses.map(({ child, service }) => ({
      pid: child.pid,
      command: `pnpm --filter ${service.packageName} dev`,
      profile,
      service: service.name,
      port: service.port,
      startedAt: new Date().toISOString(),
    })),
  });

  console.log('DevGateway local services started. Press Ctrl+C to stop host processes.');
  for (const service of services) {
    console.log(`- ${service.name}: http://localhost:${service.port}${service.healthPath}`);
  }

  await waitForChildren(childProcesses.map(({ child }) => child));
}

async function stop(profile) {
  await cleanupRecordedProcesses(profile);
  if (profile === 'all' || profile === 'deps') {
    if (dockerAvailable()) runCompose(['down', '--remove-orphans'], { optional: true });
  }
  const state = readState();
  const remaining = state.processes.filter((processInfo) => !profileMatches(profile, processInfo.profile));
  writeState({ ...state, processes: remaining });
  console.log(`Stopped DevGateway local profile: ${profile}`);
}

async function status(profile) {
  const state = readState();
  console.log(`DevGateway local status (${profile})`);
  console.log(`Compose project: ${composeProject}`);
  console.log('Ports:');
  for (const [name, port] of Object.entries(LOCAL_PORTS)) {
    console.log(`- ${name}: ${port}`);
  }
  if (state.processes.length > 0) {
    console.log('Tracked host processes:');
    for (const processInfo of state.processes) {
      console.log(`- ${processInfo.service ?? processInfo.profile}: pid=${processInfo.pid} port=${processInfo.port ?? 'n/a'} profile=${processInfo.profile}`);
    }
  } else {
    console.log('Tracked host processes: none');
  }
  if (dockerAvailable()) {
    runCompose(['ps'], { optional: true });
  } else {
    console.log('Docker Compose status skipped: Docker is unavailable.');
  }
}

async function reset(profile, yes) {
  if (!yes) {
    throw new Error('reset is destructive. Re-run with --yes to remove local containers and volumes.');
  }
  await stop(profile);
  if (dockerAvailable()) runCompose(['down', '--volumes', '--remove-orphans'], { optional: true });
  writeState({ composeProject, processes: [] });
  console.log(`Reset DevGateway local profile: ${profile}`);
}

function ensureLocalEnvFiles() {
  if (!existsSync(localEnvExampleFile)) {
    writeFileSync(localEnvExampleFile, renderLocalEnv(), 'utf8');
    console.log('Created .env.local.example');
  }
  if (!existsSync(localEnvFile)) {
    writeFileSync(localEnvFile, readFileSync(localEnvExampleFile, 'utf8'), 'utf8');
    console.log('Created .env.local from .env.local.example');
  }
}

function selectedServices(profile) {
  if (profile === 'backend') return serviceProfiles.backend;
  if (profile === 'frontend') return serviceProfiles.frontend;
  if (profile === 'all') return [...serviceProfiles.backend, ...serviceProfiles.frontend];
  return [];
}

async function ensureDependencyPorts() {
  await ensurePorts(dependencyPorts);
}

async function ensureProfilePorts(profile) {
  await ensurePorts(selectedServices(profile).map((service) => service.port));
}

async function ensurePorts(ports) {
  const state = readState();
  for (const port of ports) {
    const busyPid = await findListeningPid(port);
    const recordedProcess = state.processes.find((processInfo) => processInfo.port === port) ?? null;
    const decision = decidePortAction({ port, busyPid, recordedProcess });
    if (decision.action === 'cleanup') {
      killPid(decision.pid);
      continue;
    }
    if (decision.action === 'block') {
      throw new Error(decision.reason);
    }
  }
}

async function cleanupRecordedProcesses(profile) {
  const state = readState();
  for (const processInfo of state.processes) {
    if (!profileMatches(profile, processInfo.profile)) continue;
    if (!isDevgatewayCommand(processInfo.command)) continue;
    if (isProcessAlive(processInfo.pid)) {
      killPid(processInfo.pid);
    }
  }
}

function profileMatches(requestedProfile, recordedProfile) {
  return requestedProfile === 'all' || requestedProfile === recordedProfile;
}

function spawnServiceDev(service, profile) {
  const env = {
    ...process.env,
    ...readDotEnv(localEnvFile),
    PORT: String(service.port),
    DEV_GATEWAY_PROFILE: profile,
  };
  const child = spawn('pnpm', ['--filter', service.packageName, 'dev'], {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return { child, service };
}

function waitForChildren(children) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const stopChildren = () => {
      for (const child of children) {
        if (child.pid && !child.killed) child.kill('SIGTERM');
      }
    };
    process.once('SIGINT', () => {
      stopChildren();
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    });
    process.once('SIGTERM', () => {
      stopChildren();
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    });
    for (const child of children) {
      child.once('exit', (code) => {
        if (settled) return;
        settled = true;
        stopChildren();
        if (code === 0 || code === null) resolvePromise();
        else rejectPromise(new Error(`local service process exited with code ${code}`));
      });
    }
  });
}

async function findListeningPid(port) {
  if (await canListen(port)) return null;
  if (process.platform === 'win32') return findListeningPidWindows(port);
  return findListeningPidUnix(port);
}

function canListen(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer();
    server.once('error', () => resolvePromise(false));
    server.once('listening', () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function findListeningPidWindows(port) {
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const line = result.stdout
    .split(/\r?\n/u)
    .find((candidate) => candidate.includes(`:${port}`) && /LISTENING/u.test(candidate));
  if (!line) return null;
  const pid = Number.parseInt(line.trim().split(/\s+/u).at(-1) ?? '', 10);
  return Number.isFinite(pid) ? pid : null;
}

function findListeningPidUnix(port) {
  const lsof = spawnSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (lsof.status === 0 && lsof.stdout.trim()) {
    const pid = Number.parseInt(lsof.stdout.trim().split(/\s+/u)[0], 10);
    return Number.isFinite(pid) ? pid : null;
  }
  const ss = spawnSync('ss', ['-ltnp'], { encoding: 'utf8' });
  if (ss.status !== 0) return null;
  const line = ss.stdout.split(/\r?\n/u).find((candidate) => candidate.includes(`:${port}`));
  const match = /pid=(\d+)/u.exec(line ?? '');
  return match ? Number.parseInt(match[1], 10) : null;
}

function ensureCommand(command, message) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', shell: shouldUseShell(command) });
  if (result.error || result.status !== 0) throw new Error(message);
}

function ensureDockerAvailable({ required }) {
  if (dockerAvailable()) return;
  const message = 'Docker is unavailable. Start Docker Desktop or install Docker Compose to run local dependency containers.';
  if (required) throw new Error(message);
  console.warn(`${message} Continuing without pulling containers.`);
}

function dockerAvailable() {
  const docker = spawnSync('docker', ['--version'], { encoding: 'utf8', shell: shouldUseShell('docker') });
  if (docker.error || docker.status !== 0) return false;
  const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', shell: shouldUseShell('docker') });
  return !compose.error && compose.status === 0;
}

function runCompose(args, options = {}) {
  runChecked('docker', ['compose', '--project-name', composeProject, '-f', composeFile, ...args], options);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: shouldUseShell(command),
  });
  if (result.status !== 0 && !options.optional) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function shouldUseShell(command) {
  return process.platform === 'win32' && (command === 'pnpm' || command === 'corepack');
}

function readState() {
  if (!existsSync(stateFile)) return { composeProject, processes: [] };
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8'));
    return {
      composeProject: parsed.composeProject ?? composeProject,
      processes: Array.isArray(parsed.processes) ? parsed.processes : [],
    };
  } catch {
    return { composeProject, processes: [] };
  }
}

function writeState(state) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8');
}

function readDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return env;
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The process already exited. That is fine for stale-run cleanup.
  }
}

function printHelp() {
  console.log(`DevGateway local launcher

Usage:
  pnpm local:setup
  pnpm local:dev [deps|backend|frontend|all]
  pnpm local:stop [deps|backend|frontend|all]
  pnpm local:status [deps|backend|frontend|all]
  pnpm local:reset [deps|backend|frontend|all] --yes

Profiles:
  deps      Start or stop only dependency containers.
  backend   Start dependency containers and backend host hot-reload processes.
  frontend  Start dependency containers and frontend host hot-reload process.
  all       Start dependencies plus backend and frontend processes.
`);
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await main();
}
