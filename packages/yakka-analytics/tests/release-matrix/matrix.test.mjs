// Release matrix: the same four shipped acceptance entry points run unchanged
// against both release topologies.
//
//   1. Pages-style static serving: the shared harness serves web/ with the
//      committed first-party stub API.
//   2. Embedded release binary: tools/release/build.sh embeds web/ into a local
//      binary started over a temporary local data directory. The harness proxies
//      static reads to it (YAKKA_RELEASE_STATIC_ORIGIN) while the stub API stays
//      deterministic.
//
// Each suite is a separate `node --test` run with concurrency 1; counts and
// skips are compared against the tree's baseline. No fixed sleeps, no deploy,
// no tenant action and no write outside the in-worktree scratch dir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { startEmbeddedBinary, scratchRoot, repoRoot } from './origins.mjs';

// Baseline top-level test counts on the closing tree. The brief's 4/4, 4/4,
// 5/5, 4/4 is stale; the recorded baseline is measured from the same files.
const SUITES = [
  { file: 'packages/yakka-analytics/tests/workspace/acceptance.test.mjs', tests: 5 },
  { file: 'packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs', tests: 6 },
  { file: 'packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs', tests: 5 },
  { file: 'packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs', tests: 4 }
];

const NODE_PATH_HINT = '/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules';

function counts(output) {
  const read = name => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1]);
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), skipped: read('skipped') };
}

function runSuites(extraEnv) {
  const results = [];
  for (const suite of SUITES) {
    const env = {
      ...process.env,
      TMPDIR: scratchRoot(),
      NODE_PATH: process.env.NODE_PATH || NODE_PATH_HINT,
      PUBLIC_CANVAS_TEST_MODE: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
      YAKKA_RELEASE_STATIC_ORIGIN: '',
      ...extraEnv
    };
    // A nested runner must emit its own TAP, not inherit this file's test
    // child context.
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', suite.file], {
      cwd: repoRoot,
      env,
      encoding: 'utf8',
      timeout: 1_800_000,
      maxBuffer: 64 * 1024 * 1024
    });
    const output = `${run.stdout || ''}${run.stderr || ''}`;
    if (run.status !== 0) process.stderr.write(output);
    results.push({ suite, status: run.status, output, counts: counts(output) });
  }
  return results;
}

function assertMatrix(results, target) {
  assert.equal(results.length, SUITES.length);
  for (const { suite, status, counts: got, output } of results) {
    const name = suite.file.split('/').slice(-2, -1)[0];
    assert.equal(status, 0, `${target}/${name}: node --test exited ${status}`);
    assert.equal(got.tests, suite.tests, `${target}/${name}: test count changed (${output.match(/^# tests \d+$/m)})`);
    assert.equal(got.pass, suite.tests, `${target}/${name}: ${got.pass}/${suite.tests} passed`);
    assert.equal(got.fail, 0, `${target}/${name}: ${got.fail} failed`);
    assert.equal(got.skipped, 0, `${target}/${name}: ${got.skipped} skipped`);
  }
  process.stdout.write(`# matrix ${target}: ${SUITES.map(s => `${s.file.split('/').slice(-2, -1)[0]} ${s.tests}/${s.tests}`).join(', ')}\n`);
}

test('release matrix: Pages-style static serving passes every acceptance suite', { timeout: 1_900_000 }, () => {
  const results = runSuites({ YAKKA_RELEASE_STATIC_ORIGIN: '' });
  assertMatrix(results, 'pages');
});

test('release matrix: the embedded release binary serves the same acceptance suites', { timeout: 1_900_000 }, async t => {
  const embedded = await startEmbeddedBinary();
  t.after(() => embedded.stop());
  const results = runSuites({ YAKKA_RELEASE_STATIC_ORIGIN: embedded.origin });
  assertMatrix(results, 'embedded');
});
