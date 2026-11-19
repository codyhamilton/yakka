// Phase 13 integrated acceptance.
//
// This is the phase record, not a second implementation of the component
// proofs. It checks, from the committed artifacts, that every component unit's
// entry point is present and pins the exact counts those units reported:
//
//   13-01  the matrix runs both release targets (Pages-style and embedded)
//          over the same four shipped acceptance suites, with the measured
//          per-file test counts and a zero-skip assertion;
//   13-02  the committed browser record (75 requests, 12 scenarios, 9 all=1)
//          and the Go smoke/profiler pins (75 requests, the record SHA-256,
//          the unchanged 500 ms p95 bound, concurrency 4);
//   13-03  the eight Pages-faithful account subtests, the at-most-4-in-flight
//          gate and the local shell / remote JSON callback route test;
//   13-04  the release checks, the no-build Pages output directory and the
//          stable docs/release facts.
//
// It runs no browser and reads no tenant: the component suites are executed by
// their own commands, recorded in reports/13-05-acceptance.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../..');
const read = path => readFileSync(resolve(repoRoot, path), 'utf8');
const have = path => existsSync(resolve(repoRoot, path));

const MATRIX = 'packages/yakka-analytics/tests/release-matrix/matrix.test.mjs';
const RECORD = 'packages/yakka/internal/serve/testdata/browser-request-shapes.json';
const PAGESET = 'packages/yakka/internal/serve/analytics_pageset_test.go';
const IDENTITY = 'packages/yakka-analytics/tests/identity/browser.test.mjs';
const IDENTITY_CONTRACTS = 'packages/yakka-analytics/tests/identity/contracts.test.mjs';
const SITE_TEST = 'packages/yakka/internal/serve/site_test.go';
const README = 'packages/yakka-analytics/README.md';
const DESIGN03 = 'docs/design/03-remote-service.md';
const CONTRACTS = 'docs/plans/20-analytics-reset/CONTRACTS.md';
const DESIGN = 'docs/plans/20-analytics-reset/DESIGN.md';
const WRANGLER = 'packages/yakka-analytics/wrangler.toml';

// The exact counts the component reports record. A change here is a component
// change, not an acceptance-only drift.
const SUITE_COUNTS = {
  'packages/yakka-analytics/tests/workspace/acceptance.test.mjs': 5,
  'packages/yakka-analytics/tests/trends-quality/acceptance.test.mjs': 6,
  'packages/yakka-analytics/tests/scatter-sessions/acceptance.test.mjs': 5,
  'packages/yakka-analytics/tests/plans-artifacts/acceptance.test.mjs': 4
};
const RECORD_SHA256 = '420015134d2d3ee8861ee97e449a06e7bed3268d30492e34cdcd0b74012a5c2c';
const RECORD_REQUESTS = 75;
const RECORD_SCENARIOS = 12;
const RECORD_ALL_HISTORY = 9;

function topLevelTests(source) {
  return (source.match(/^test\(/gm) || []).length;
}

test('integrated acceptance: two release targets, exact component counts, zero skips, at most 4 in flight', () => {
  // 13-01 — matrix: both release topologies over the four shipped suites.
  assert.ok(have(MATRIX), `${MATRIX} is missing`);
  const matrix = read(MATRIX);
  assert.match(matrix, /assertMatrix\(results, 'pages'\)/, 'matrix has no Pages-style target');
  assert.match(matrix, /assertMatrix\(results, 'embedded'\)/, 'matrix has no embedded-binary target');
  assert.match(matrix, /startEmbeddedBinary\(/, 'embedded target does not build/start the release binary');
  assert.match(matrix, /YAKKA_RELEASE_STATIC_ORIGIN/, 'matrix does not select the static origin');
  assert.match(matrix, /--test-concurrency=1/, 'matrix does not run the suites serially');
  assert.match(matrix, /got\.skipped, 0/, 'matrix does not assert zero skipped tests');
  assert.match(matrix, /max-old-space-size=8192/, 'matrix does not apply the 8G heap cap');

  const declared = [...matrix.matchAll(/\{ file: '([^']+)', tests: (\d+) \}/g)]
    .map(match => ({ file: match[1], tests: Number(match[2]) }));
  assert.equal(declared.length, 4, 'matrix must name the four shipped acceptance suites');
  for (const { file, tests } of declared) {
    assert.ok(have(file), `matrix suite ${file} is missing`);
    assert.equal(tests, SUITE_COUNTS[file], `${file}: matrix count ${tests} != recorded ${SUITE_COUNTS[file]}`);
    assert.equal(topLevelTests(read(file)), tests, `${file}: ${topLevelTests(read(file))} top-level tests != recorded ${tests}`);
  }
  assert.deepEqual(declared.map(entry => entry.file).sort(), Object.keys(SUITE_COUNTS).sort(), 'matrix suite set changed');

  // 13-01/13-02 — the committed request-shape record and its exact split.
  assert.ok(have(RECORD), `${RECORD} is missing`);
  const raw = readFileSync(resolve(repoRoot, RECORD));
  assert.equal(createHash('sha256').update(raw).digest('hex'), RECORD_SHA256, 'browser request-shape record drifted from the 13-02 pin');
  const record = JSON.parse(raw.toString('utf8'));
  assert.equal(record.version, 1);
  assert.equal(record.scenarios.length, RECORD_SCENARIOS);
  const requests = record.scenarios.flatMap(scenario => scenario.requests);
  assert.equal(requests.length, RECORD_REQUESTS);
  assert.equal(requests.filter(request => request.query.some(([key, value]) => key === 'all' && value === '1')).length, RECORD_ALL_HISTORY, 'all-history shapes missing');
  for (const scenario of record.scenarios) {
    assert.match(scenario.route, /^\/b\//);
    for (const request of scenario.requests) {
      assert.deepEqual(Object.keys(request).sort(), ['method', 'path', 'query']);
      assert.equal(request.method, 'GET');
      assert.match(request.path, /^\/v1\/analytics\//);
    }
  }

  // 13-02 — Go smoke/profiler pins: same record, same 500 ms contract, concurrency 4.
  const pageset = read(PAGESET);
  assert.match(pageset, /pagesetRecordRequests\s*=\s*75/, 'smoke does not pin 75 recorded requests');
  assert.match(pageset, new RegExp(`pagesetRecordSHA256\\s*=\\s*"${RECORD_SHA256}"`), 'smoke does not pin the record hash');
  assert.match(pageset, /pagesetP95MS\s*=\s*500\.0/, 'p95 contract changed');
  assert.match(pageset, /concurrency of 4/, 'profile does not run at the contract concurrency of 4');
  assert.match(pageset, /TestAnalyticsPageSetSmoke/);
  assert.match(pageset, /TestAnalyticsPageSet\b/);

  // 13-03 — eight account subtests, the <=4 in-flight gate and the route proof.
  assert.equal((read(IDENTITY).match(/await t\.test\(/g) || []).length, 8, 'account-flow subtest count changed');
  assert.match(read(IDENTITY), /maxInFlight\(\) <= 4/, 'identity rig lost its at-most-4-in-flight gate');
  assert.ok(topLevelTests(read(IDENTITY_CONTRACTS)) >= 6, 'identity contract tests below six');
  assert.match(read(SITE_TEST), /TestOAuthCallbackRouteIsShellLocallyAndJSONRemotely/);
  for (const path of ['/device', '/oauth/callback', '/login', '/profile', '/settings']) {
    assert.ok(read(SITE_TEST).includes(`"${path}`), `site route test omits ${path}`);
  }

  // 13-04 — release checks, no-build output directory and stable docs.
  for (const tool of ['tools/release/test_release.py', 'tools/release/test_layout.py', 'tools/release/test_scan_residual_names.py', 'packages/yakka-analytics/tests/static-shell.test.mjs']) {
    assert.ok(have(tool), `release/secret check ${tool} is missing`);
  }
  assert.match(read(WRANGLER), /pages_build_output_dir = "\.\/web"/, 'Pages still points at a build directory');
  const readme = read(README);
  for (const fact of [/no build step/i, /Pages serves the same static directory/, /separate release on Fly/, /\/v1\/analytics\/schema/, /No manual deploy, configuration or secrets step/]) {
    assert.match(readme, fact, `README misses release fact ${fact}`);
  }
  const design03 = read(DESIGN03);
  for (const fact of [/Pages/, /Fly/, /\/v1\/analytics\/schema/]) assert.match(design03, fact, `design 03 misses ${fact}`);
  assert.match(read(CONTRACTS), /Current \(landed in Phase 1; `wrangler\.toml` names it\)/);
  assert.match(read(CONTRACTS), /pages_build_output_dir = "\.\/web"/);
  assert.match(read(DESIGN), /Yakka-Plan: docs\/plans\/20-analytics-reset/, 'PR marker gate is not recorded');

  process.stdout.write(`# integrated acceptance: matrix targets pages+embedded, suites ${Object.values(SUITE_COUNTS).reduce((a, b) => a + b, 0)} tests, record ${RECORD_REQUESTS} requests/${RECORD_SCENARIOS} scenarios/${RECORD_ALL_HISTORY} all=1, p95<=500ms, identity 8+6, concurrency<=4\n`);
});
