import { spawnSync } from 'node:child_process';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runnerSrc = join(rootDir, 'workers', 'eval-runner', 'src');
const compileOnly = process.argv.includes('--compile-only');

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

const status = compileOnly
  ? runPython(['-B', '-c', 'import devgateway_eval_runner.cli'])
  : runPython([
      '-B',
      '-m',
      'devgateway_eval_runner',
      '--repo-root',
      rootDir,
      '--provider-mode',
      'fixture',
      '--dataset',
      'evals/datasets/acl-safety.v0.1.json',
      '--suite',
      'acl_safety',
      '--change-id',
      'phase-0.7-fixture-smoke',
      '--suite-version',
      '0.1.0',
      '--format',
      'pretty'
    ]);

process.exit(status);
