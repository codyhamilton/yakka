// One recorder test: the canonical browser request-shape record must exactly
// match the committed JSON consumed by 13-02, carry the all-history `all=1`
// shape, and contain no payload or volatile timestamp.
//
// Author the file once with YAKKA_RECORD_WRITE=1; ordinary runs only compare.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, SKIP_REASON } from '../workspace/browser.mjs';
import { RECORD_PATH, canonicalJson, readCommitted, record, writeCommitted } from './recorder.mjs';

const environment = loadBrowserEnvironment();

test('the recorded analytics request shapes match the committed record and carry all=1', { skip: environment.ok ? false : SKIP_REASON }, async () => {
  const produced = await record();
  if (process.env.YAKKA_RECORD_WRITE === '1') await writeCommitted(produced);
  const committed = await readCommitted();

  assert.equal(canonicalJson(produced), canonicalJson(committed), `browser request shapes drifted from ${RECORD_PATH}; rerun the recorder and review the diff`);
  assert.ok(produced.scenarios.length >= 8, 'every shipped preset is recorded');

  const requests = produced.scenarios.flatMap(scenario => scenario.requests);
  assert.ok(requests.some(request => request.query.some(([key, value]) => key === 'all' && value === '1')), 'all-history sends all=1');

  for (const scenario of produced.scenarios) {
    assert.equal(typeof scenario.label, 'string');
    assert.match(scenario.route, /^\/b\//);
    assert.ok(scenario.requests.length > 0, `${scenario.label}: no analytics request recorded`);
    for (const request of scenario.requests) {
      assert.deepEqual(Object.keys(request).sort(), ['method', 'path', 'query']);
      assert.equal(request.method, 'GET');
      assert.match(request.path, /^\/v1\/analytics\//);
      for (const pair of request.query) {
        assert.equal(pair.length, 2);
        assert.equal(typeof pair[0], 'string');
        assert.equal(typeof pair[1], 'string');
        assert.ok(!/body|payload|secret|token/i.test(pair[0]), `${pair[0]} is not a request shape`);
        if (pair[0] === 'from' || pair[0] === 'to') assert.match(pair[1], /^2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      }
    }
  }
});
