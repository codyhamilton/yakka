// Phase 10 unit 10-05: the cohort and comparison seam across the presets.
// Pure checks prove the request/plan/split rules; the browser checks prove the
// same rules reach the wire through the committed stub bodies.

import test from 'node:test';
import assert from 'node:assert/strict';

import { cohortDefinition, encodeCohort } from '../../web/js/core/selection-model.js';
import {
  cohortParams, comparisonPlan, comparisonSummary, honestJoinGuard, requestParams, scopeWithCohorts
} from '../../web/js/panels/p10-shared.js';
import { effectiveScope } from '../../web/js/core/view-spec.js';
import { splitExclude } from '../../web/js/core/selection-tray.js';
import { distributionGuard, distributionParams } from '../../web/js/panels/dist-ranges.js';

const FINITE = { from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z' };

function cohort(grain, value, op = 'include', scope = FINITE) {
  return encodeCohort(cohortDefinition({
    grain,
    scope,
    predicate: { in: { lens: grain === 'session' ? 'harness' : 'kind', values: [value] } },
    op
  }));
}

test('comparisonPlan covers none, single, period, cohorts and the named refusals', () => {
  assert.equal(comparisonPlan({}).mode, 'none');

  const one = cohort('session', 'orca');
  const single = comparisonPlan({ cohorts: { ca: one } });
  assert.equal(single.mode, 'single');
  assert.equal(single.cohort, one);

  const finite = comparisonPlan({ cmp: 'period', ...FINITE, cohorts: { ca: one } });
  assert.equal(finite.mode, 'period');
  assert.equal(finite.current.cohort, one);
  assert.equal(finite.previous.cohort, one, 'a cohort applies to both periods');

  const all = comparisonPlan({ win: 'all', cmp: 'period' });
  assert.equal(all.unsupported, 'Choose a finite period to compare periods.');
  assert.equal(all.previous, null);

  const a = cohort('session', 'orca');
  const b = cohort('session', 'claude-code');
  const pair = comparisonPlan({ cmp: 'cohorts', cohorts: { ca: a, cb: b } });
  assert.equal(pair.mode, 'cohorts');
  assert.equal(pair.a, a);
  assert.equal(pair.b, b);
  assert.equal(pair.aLabel, 'Cohort A');
  assert.equal(pair.bLabel, 'Cohort B');

  const alone = comparisonPlan({ cmp: 'cohorts', cohorts: { ca: a } });
  assert.equal(alone.b, null);
  assert.equal(alone.bLabel, 'all in scope');

  const different = comparisonPlan({ cmp: 'cohorts', cohorts: { ca: a, cb: cohort('artifact', 'design') } });
  assert.match(different.unsupported, /Cohort A is session and Cohort B is artifact/);
  assert.match(different.unsupported, /same source grain/);

  const three = comparisonPlan({ cmp: 'cohorts', cohorts: { ca: a, cb: b, cc: a } });
  assert.match(three.unsupported, /compare shows cohorts A and B; clear unused cohorts/);
});

test('the panel scope retains cohorts and the request seam never reads global location', () => {
  const a = cohort('session', 'orca');
  const b = cohort('session', 'claude-code');
  const effective = effectiveScope(
    { ...FINITE, cmp: 'cohorts', cohorts: { ca: a, cb: b } },
    { cmp: 'period' }
  );
  assert.deepEqual(effective.cohorts, { ca: a, cb: b }, 'the ca–cd slots survive cleanPanelScope');
  assert.equal(effective.cmp, 'cohorts', 'an explicit board compare mode beats the preset default');
  const params = requestParams({ scope: effective, measure: 'cost_usd' });
  assert.equal(params.get('cohort'), a);

  const had = Object.prototype.hasOwnProperty.call(globalThis, 'location');
  const prior = globalThis.location;
  try {
    globalThis.location = { search: `?ca=${encodeURIComponent(cohort('session', 'decoy'))}` };
    const bare = scopeWithCohorts({ ...FINITE });
    assert.equal(bare.cohorts, undefined, 'no cohort is recovered from location');
    assert.equal(requestParams({ scope: { ...FINITE } }).get('cohort'), null);
  } finally {
    if (had) globalThis.location = prior;
    else delete globalThis.location;
  }
});

test('cohortParams sends the first valid slot, canonical, and names a malformed one', () => {
  const one = cohort('session', 'orca');
  const params = cohortParams({ cohorts: { cb: one } });
  assert.equal(params.cohort, one);
  assert.equal(params.issues.length, 0);

  const broken = cohortParams({ cohorts: { ca: '{not json}', cb: one } });
  assert.equal(broken.cohort, one);
  assert.deepEqual(broken.issues, ['Cohort A is malformed and was not sent.']);
});

test('requestParams appends one cohort, never cmp, and preserves op', () => {
  const include = cohort('session', 'orca');
  const exclude = cohort('session', 'orca', 'exclude');
  const params = requestParams({ scope: { ...FINITE, cmp: 'cohorts', cohorts: { ca: include, cb: exclude } } });
  assert.deepEqual(params.getAll('cohort'), [include]);
  assert.equal(params.get('cmp'), null);

  const sideB = requestParams({ scope: { ...FINITE, cohorts: { ca: include, cb: exclude } }, cohort: exclude });
  assert.deepEqual(sideB.getAll('cohort'), [exclude]);
  assert.equal(JSON.parse(sideB.get('cohort')).op, 'exclude');

  const noCohort = requestParams({ scope: { ...FINITE }, cohort: null });
  assert.equal(noCohort.get('cohort'), null);
});

test('comparisonSummary prints both typed populations and never a lone delta', () => {
  const body = n => ({ population: { grain: 'session', unit: 'call', scope_n: n, cohort_n: n - 1, eligible_n: n, returned_n: n } });
  const summary = comparisonSummary({
    plan: { mode: 'cohorts', aLabel: 'Cohort A', bLabel: 'Cohort B' },
    sides: { a: body(20), b: body(12) }
  });
  assert.match(summary.text, /Cohort A: 20 call in scope/);
  assert.match(summary.text, /Cohort B: 12 call in scope/);
  assert.equal(summary.sides.length, 2);
  const missing = comparisonSummary({ plan: { mode: 'period' }, sides: { current: body(4), previous: null } });
  assert.match(missing.text, /Previous period: not reported/);
});

test('splitExclude resolves a multi-colon published lens before the first colon', () => {
  const schema = { grains: { artifact: { filters: ['band:quality', 'kind'] } } };
  assert.deepEqual(splitExclude('band:quality:low', { schema, grain: 'artifact' }), { lens: 'band:quality', value: 'low' });
  assert.deepEqual(splitExclude('repo_id:r1', { schema, grain: 'artifact' }), { lens: 'repo_id', value: 'r1' });
  assert.deepEqual(splitExclude('unknown:two:parts', { schema, grain: 'artifact' }), { lens: 'unknown', value: 'two:parts' });
});

test('the distribution grain/dim guard accepts the real pairs and refuses call-grain session lenses', () => {
  for (const [grain, dim] of [['call', 'model'], ['call', 'harness'], ['conversation', 'session_model'], ['conversation', 'session_repo']]) {
    assert.equal(distributionGuard({ grain, dim }).ok, true, `${grain}/${dim}`);
  }
  const refused = distributionGuard({ grain: 'call', dim: 'session_repo' });
  assert.equal(refused.ok, false);
  assert.equal(refused.try, 'conversation');
  const params = distributionParams({ scope: FINITE, measure: 'cost_usd', grain: 'conversation', dim: 'session_repo', cohort: null });
  assert.equal(params.get('grain'), 'conversation');
  assert.equal(params.get('dim'), 'session_repo');
});

test('the shared honest-join guard names a repo split on hook events and cost by tool', () => {
  assert.equal(honestJoinGuard('hook_events', ['repo_id']).try, 'harness');
  assert.equal(honestJoinGuard('cost_usd', ['tool']).try, 'hook_events by tool');
  assert.match(honestJoinGuard('cost_usd', ['session_repo']).try, /\/distribution\?dim=session_repo/);
  assert.equal(honestJoinGuard('hook_events', ['tool']), null);
});

// ---------------------------------------------------------------------------
// Browser acceptance: the cohort reaches the wire and the panels keep both
// typed populations. Uses only the committed stub bodies.
// ---------------------------------------------------------------------------

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function settle(page) {
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

test('a cohort drives the panel requests, both populations render and baselines stays cohort-free', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
    const diagnostics = await watchPage(page);

    const a = cohort('session', 'orca');
    const b = cohort('session', 'claude-code', 'exclude');
    const query = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: a, cb: b });
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await page.goto(`${harness.origin}/b/cost?${query}`);
    await settle(page);

    const requests = harness.api.state.requests;
    const cohortRequests = requests.filter(item => /[?&]cohort=/.test(item.search));
    assert.ok(cohortRequests.length >= 2, 'both comparison sides issued a request: ' + JSON.stringify(requests.map(r => r.path + r.search)));
    const sent = cohortRequests.map(item => new URLSearchParams(item.search.slice(1)).get('cohort'));
    assert.ok(sent.some(text => text === a));
    assert.ok(sent.some(text => text === b));
    assert.equal(sent.some(text => JSON.parse(text).op === 'exclude'), true, 'op is preserved');

    const text = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(text, /Cohort A/);
    assert.match(text, /Cohort B/);
    assert.match(text, /resolved by the cohort/);
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();

    // A single cohort restricts the panel and names the resolved session count.
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await page.goto(`${harness.origin}/b/cost?win=30d&ca=${encodeURIComponent(a)}`);
    await settle(page);
    const singleText = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(singleText, /resolved by the cohort/);

    // Different grains are named and issue no comparison request.
    harness.resetStats();
    harness.api.state.requests.length = 0;
    const mixed = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: cohort('session', 'orca'), cb: cohort('artifact', 'design') });
    await page.goto(`${harness.origin}/b/cost?${mixed}`);
    await settle(page);
    const refusal = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(refusal, /same source grain/);
    const afterMixed = harness.api.state.requests.filter(item => /distribution/.test(item.path) && /[?&]cohort=/.test(item.search));
    assert.equal(afterMixed.some(item => item.search.includes(encodeURIComponent(b))), false, 'the mismatched cohort B is never queried');

    // all-history period compare uses the existing copy and no previous window.
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await page.goto(`${harness.origin}/b/cost?win=all&cmp=period`);
    await settle(page);
    const allText = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(allText, /Choose a finite period to compare periods/);
    const distributionRequests = harness.api.state.requests.filter(item => /distribution/.test(item.path));
    assert.equal(distributionRequests.length, 0, 'no distribution request for an unbounded period compare');

    // The Quality preset's baselines route never carries a cohort.
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await page.goto(`${harness.origin}/b/quality?win=30d&ca=${encodeURIComponent(a)}`);
    await page.waitForFunction(() => document.querySelector('.workspace-panel')?.dataset.idle === 'true');
    const baselines = harness.api.state.requests.filter(item => /baselines/.test(item.path));
    assert.ok(baselines.length > 0, 'the quality panels read the contract baselines route');
    assert.equal(baselines.some(item => /[?&]cohort=/.test(item.search)), false);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});

test('a second compare panel issues both cohort requests and compare plus split is small multiples', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
    const diagnostics = await watchPage(page);

    const a = cohort('session', 'orca');
    const b = cohort('session', 'claude-code');
    const query = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: a, cb: b });
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await page.goto(`${harness.origin}/b/compare?${query}`);
    await settle(page);

    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank']) assert.equal(states[id], 'ready', `${id} is ready`);

    const requests = harness.api.state.requests;
    const callDistributions = requests.filter(item => /distribution/.test(item.path) && /grain=call/.test(item.search) && /dim=model/.test(item.search));
    assert.ok(callDistributions.length >= 4, 'both distribution panels issued both sides: ' + JSON.stringify(callDistributions.map(r => r.search)));
    const values = callDistributions.map(item => new URLSearchParams(item.search.slice(1)).get('cohort'));
    assert.ok(values.includes(a), 'Cohort A is requested for a second panel');
    assert.ok(values.includes(b), 'Cohort B is requested for a second panel');

    const hist = await page.evaluate(() => document.querySelector('[data-panel="dist-hist"]').textContent);
    assert.match(hist, /Cohort A/, 'the histogram names the first population');
    assert.match(hist, /Cohort B/, 'the histogram names the second population');
    assert.match(hist, /call in scope/, 'the histogram carries the typed population');

    const splits = await page.evaluate(() => Object.fromEntries(
      ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank'].map(id => [
        id, document.querySelectorAll(`[data-panel="${id}"] [data-split]`).length
      ])
    ));
    for (const [id, count] of Object.entries(splits)) assert.ok(count > 1, `${id} renders one small multiple per split value, saw ${count}`);

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});

test('the Cost preset mounts repo, harness and model investigations and Tools refuses a repo split', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/b/cost?win=30d`);
    await settle(page);
    const cost = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    assert.equal(cost['dist-ranges'], 'ready');
    assert.equal(cost['dist-hist'], 'ready');
    const repo = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(repo, /conversation grain by session_repo/);
    assert.match(repo, /unpriced/i);
    const harnessView = await page.evaluate(() => document.querySelector('[data-panel="dist-hist"]').textContent);
    assert.match(harnessView, /call grain by harness/);
    const schema = await page.evaluate(async () => (await fetch('/v1/analytics/schema')).json());
    assert.deepEqual(schema.grains.time.lenses, ['id']);
    await diagnostics.assertClean();

    const override = encodeURIComponent(JSON.stringify({
      grain: 'time', measures: ['hook_events'], split: 'repo_id', chart: 'bars', scope: { second: 'harness', mode: 'stacked' }
    }));
    await page.goto(`${harness.origin}/b/tools?win=30d&p1=${override}`);
    await settle(page);
    const tools = await page.evaluate(() => ({
      state: document.querySelector('[data-panel="mix"]')?.dataset.state,
      text: document.querySelector('[data-panel="mix"]')?.textContent || ''
    }));
    assert.equal(tools.state, 'unsupported');
    assert.match(tools.text, /harness/);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
