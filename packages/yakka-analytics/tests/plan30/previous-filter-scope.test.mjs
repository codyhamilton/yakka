// Plan 30 rv-p1 regression: a Pulse previous-period read must keep the
// committed scope (tenant, repository, kind, timezone, excludes, cohorts) and
// replace only the time bounds. The unit cases capture the outgoing parameters
// directly; the Chromium case proves the same through the real board.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveReadContext } from '../../web/js/core/read-context.js';
import { load as loadStrips } from '../../web/js/panels/pulse-strips.js';
import { load as loadMovers } from '../../web/js/panels/movers.js';
import { makeSchema } from '../workspace/fixture.mjs';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../workspace/browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';

const DAY = 86400e3;
const NOW = Date.parse('2026-10-01T00:00:00Z');
const CURRENT = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' };
const PREVIOUS = { from: '2026-08-02T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' };
const FILTERS = { repo_id: ['repo-a'], kind: ['brief'] };

function fakeDoc() {
  return {
    documentElement: { dataset: {} },
    head: { append() {} },
    querySelector() { return null; },
    createElement() { return { append() {}, setAttribute() {}, style: {} }; }
  };
}

function summaryBody() {
  return {
    cost_usd: 12.5, priced_calls: 2, unpriced_calls: 0, model_calls: 8, conversations: 3,
    hook_events: 6, artifact_versions: 4, commits: 2, rejections: { precheck: 1, screen: 1 }
  };
}

function sideOf(call) {
  const entries = [...call.params.entries()].filter(([key]) => key !== 'from' && key !== 'to');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries;
}

function withLocation(fn) {
  const previous = globalThis.location;
  globalThis.location = { hostname: 'localhost' };
  const restore = () => { globalThis.location = previous; };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('pulse summary keeps repository and kind on the previous-period read', () => withLocation(async () => {
  const calls = [];
  const transport = {
    async get(name, params, options = {}) {
      calls.push({ name, params: new URLSearchParams(params), tenant: options.tenant || '' });
      if (name === 'summary') return { response: { ok: true, status: 200 }, body: summaryBody() };
      if (name === 'scores') return { response: { ok: true, status: 200 }, body: { checks: [] } };
      throw new Error(`unexpected read ${name}`);
    }
  };
  const state = { win: '30d', tz: 'UTC', filters: FILTERS };
  const readContext = resolveReadContext({ tenant: 'tenant-b', state, now: NOW });
  await loadStrips({ scope: state, transport, tenant: 'tenant-b', doc: fakeDoc(), readContext });

  const summaries = calls.filter(call => call.name === 'summary');
  assert.equal(summaries.length, 2, 'one current and one previous summary request');
  const [current, previous] = summaries;
  for (const call of summaries) {
    assert.equal(call.tenant, 'tenant-b');
    assert.equal(call.params.get('tz'), 'UTC');
    assert.equal(call.params.get('repo_id'), 'repo-a');
    assert.equal(call.params.get('kind'), 'brief');
    assert.equal(call.params.has('all'), false);
    assert.equal(call.params.has('win'), false);
  }
  assert.equal(current.params.get('from'), CURRENT.from);
  assert.equal(current.params.get('to'), CURRENT.to);
  assert.equal(previous.params.get('from'), PREVIOUS.from);
  assert.equal(previous.params.get('to'), PREVIOUS.to);
  assert.deepEqual(sideOf(previous), sideOf(current), 'the previous read adds no unrelated filter');
}));

test('movers current, series, previous and unpriced reads keep the same filters', () => withLocation(async () => {
  const calls = [];
  const schema = makeSchema();
  schema.grains.time.measures = [...schema.grains.time.measures, 'unpriced_calls'];
  const transport = {
    async schema(tenant) {
      assert.equal(tenant, 'tenant-b');
      return { response: { ok: true, status: 200 }, body: schema };
    },
    async get(name, params, options = {}) {
      calls.push({ name, params: new URLSearchParams(params), tenant: options.tenant || '' });
      assert.equal(name, 'query');
      return {
        response: { ok: true, status: 200 },
        body: { rows: [{ t: '2026-09-10T00:00:00Z', k: ['orca'], v: 1 }], population: null }
      };
    }
  };
  const scope = { ...CURRENT, tz: 'UTC', filters: FILTERS };
  await loadMovers({ scope, transport, tenant: 'tenant-b', doc: fakeDoc() });

  const currentCalls = calls.filter(call => call.params.get('from') === CURRENT.from);
  const previousCalls = calls.filter(call => call.params.get('from') === PREVIOUS.from);
  assert.equal(currentCalls.length, 6, 'two lenses: current totals, daily series and unpriced counts');
  assert.equal(previousCalls.length, 2, 'one previous-period read per lens');
  assert.ok(currentCalls.some(call => call.params.get('measure') === 'unpriced_calls'));

  for (const call of calls) {
    assert.equal(call.tenant, 'tenant-b');
    assert.equal(call.params.get('tz'), 'UTC');
    assert.equal(call.params.get('repo_id'), 'repo-a');
    assert.equal(call.params.get('kind'), 'brief');
    assert.equal(call.params.has('all'), false);
    assert.equal(call.params.has('win'), false);
  }
  for (const call of currentCalls) {
    assert.equal(call.params.get('to'), CURRENT.to);
  }
  for (const call of previousCalls) {
    assert.equal(call.params.get('to'), PREVIOUS.to);
    assert.equal(call.params.get('bucket'), 'none', 'G-movers previous read is a bucket total');
    const match = currentCalls.find(current => current.params.get('measure') === call.params.get('measure') &&
      current.params.get('dim') === call.params.get('dim') && current.params.get('bucket') === call.params.get('bucket'));
    assert.ok(match, `no current peer for ${call.params.get('measure')}/${call.params.get('dim')}`);
    assert.deepEqual(sideOf(call), sideOf(match), 'the previous read adds no unrelated filter');
  }
}));

const environment = loadBrowserEnvironment();
const SKIP = environment.ok ? false : (environment.reason || SKIP_REASON);

test('a filtered Pulse view keeps repository and kind on comparison reads in Chromium', { skip: SKIP }, async () => {
  const harness = await startWorkspaceHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const requests = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/v1/analytics/')) requests.push(url);
    });
    await page.goto(`${harness.origin}/b/pulse?win=7d&repo_id=fixture-repo&kind=brief`);
    await page.waitForFunction(() => {
      const panels = [...document.querySelectorAll('.workspace-panel')];
      return panels.length === 5 && panels.every(panel => panel.dataset.idle === 'true');
    });
    const tenant = await page.evaluate(() => new URL(location.href).searchParams.get('tenant'));
    assert.ok(tenant, 'the view resolved a tenant');

    const summaries = requests.filter(url => url.pathname.endsWith('/v1/analytics/summary'));
    const queries = requests.filter(url => url.pathname.endsWith('/v1/analytics/query'));
    assert.ok(summaries.length >= 2, 'summary current and previous reads were observed');
    assert.ok(queries.length >= 2, 'movers comparison reads were observed');

    const currentTo = Math.max(...summaries.map(url => Date.parse(url.searchParams.get('to'))).filter(Number.isFinite));
    const currentFrom = currentTo - 7 * DAY;
    const previousFrom = currentTo - 14 * DAY;
    const at = value => new Date(value).toISOString();

    for (const url of [...summaries, ...queries]) {
      assert.equal(url.searchParams.get('tenant'), tenant);
      assert.equal(url.searchParams.get('repo_id'), 'fixture-repo', `${url.pathname} dropped the repository`);
      assert.equal(url.searchParams.get('kind'), 'brief', `${url.pathname} dropped the document kind`);
      assert.equal(url.searchParams.has('win'), false);
    }

    assert.ok(summaries.some(url => url.searchParams.get('from') === at(currentFrom) && url.searchParams.get('to') === at(currentTo)), 'current summary bounds');
    const previousSummaries = summaries.filter(url => url.searchParams.get('from') === at(previousFrom));
    assert.equal(previousSummaries.length, 1, 'exactly one previous summary read');
    assert.equal(previousSummaries[0].searchParams.get('to'), at(currentFrom));

    const previousQueries = queries.filter(url => url.searchParams.get('from') === at(previousFrom));
    assert.ok(previousQueries.length >= 1, 'movers issued a previous-period query');
    for (const previous of previousQueries) {
      assert.equal(previous.searchParams.get('to'), at(currentFrom));
      assert.equal(previous.searchParams.get('bucket'), 'none');
      const peer = queries.find(url => url.searchParams.get('from') === at(currentFrom) &&
        url.searchParams.get('measure') === previous.searchParams.get('measure') &&
        url.searchParams.get('dim') === previous.searchParams.get('dim') &&
        url.searchParams.get('bucket') === previous.searchParams.get('bucket'));
      assert.ok(peer, 'a current peer read exists');
      const nonTime = url => [...url.searchParams.entries()]
        .filter(([key]) => key !== 'from' && key !== 'to')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      assert.deepEqual(nonTime(previous), nonTime(peer), 'the previous read adds no unrelated filter');
    }
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
