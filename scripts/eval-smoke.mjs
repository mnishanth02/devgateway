import { spawnSync } from 'node:child_process';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runnerSrc = join(rootDir, 'workers', 'eval-runner', 'src');
const compileOnly = process.argv.includes('--compile-only');
const smokeSuites = [
  {
    dataset: 'evals/datasets/acl-safety.v0.1.json',
    suite: 'acl_safety',
    changeId: 'phase-0.7-fixture-smoke'
  },
  {
    dataset: 'evals/datasets/gateway-model-smoke.v0.1.json',
    suite: 'gateway_model_smoke',
    changeId: 'phase-1.7-gateway-model-smoke'
  },
  {
    dataset: 'evals/datasets/cost-latency.v0.1.json',
    suite: 'cost_latency',
    changeId: 'phase-1.7-cost-latency'
  },
  {
    dataset: 'evals/datasets/degraded-mode.v0.1.json',
    suite: 'degraded_mode',
    changeId: 'phase-1.7-degraded-mode'
  },
  {
    dataset: 'evals/datasets/agent-workflow.v0.1.json',
    suite: 'agent_workflow',
    changeId: 'phase-2.10-agent-workflow'
  },
  {
    dataset: 'evals/datasets/tool-safety.v0.1.json',
    suite: 'tool_safety',
    changeId: 'phase-2.10-tool-safety'
  },
  {
    dataset: 'evals/datasets/prompt-injection-tainted-context.v0.1.json',
    suite: 'prompt_injection_tainted_context',
    changeId: 'phase-2.10-prompt-injection-tainted-context'
  }
];

function pythonCandidates() {
  const candidates = [];
  if (process.env.PYTHON) {
    candidates.push({ command: process.env.PYTHON, args: [] });
  }
  candidates.push({ command: 'python', args: [] });
  if (process.platform === 'win32') {
    candidates.push({ command: 'py', args: ['-3'] });
  }
  return candidates;
}

function runPython(args) {
  const env = {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH ? `${runnerSrc}${delimiter}${process.env.PYTHONPATH}` : runnerSrc
  };
  const attempted = [];
  for (const candidate of pythonCandidates()) {
    attempted.push([candidate.command, ...candidate.args].join(' '));
    const result = spawnSync(candidate.command, [...candidate.args, ...args], {
      cwd: rootDir,
      env,
      stdio: 'inherit'
    });
    if (result.error?.code === 'ENOENT') {
      continue;
    }
    if (result.error) {
      throw result.error;
    }
    return result.status ?? 1;
  }
  console.error(`No Python 3 interpreter found. Tried: ${attempted.join(', ')}`);
  return 127;
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

function runFixtureSmoke() {
  const layoutStatus = runNode(['scripts/validate-eval-layout.mjs']);
  if (layoutStatus !== 0) {
    return layoutStatus;
  }

  for (const suite of smokeSuites) {
    const status = runPython([
      '-B',
      '-m',
      'devgateway_eval_runner',
      '--repo-root',
      rootDir,
      '--provider-mode',
      'fixture',
      '--dataset',
      suite.dataset,
      '--suite',
      suite.suite,
      '--change-id',
      suite.changeId,
      '--suite-version',
      '0.1.0',
      '--format',
      'pretty'
    ]);
    if (status !== 0) {
      return status;
    }
  }
  return 0;
}

const status = compileOnly ? runPython(['-B', '-c', 'import devgateway_eval_runner.cli']) : runFixtureSmoke();

process.exit(status);
