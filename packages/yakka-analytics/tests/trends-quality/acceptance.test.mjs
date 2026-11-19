// Phase 10 acceptance: the signed outcome proved independently on the closing
// tree over Trends, Compare, Quality, Cost and Tools. Every case reads the
// committed P10 stub bodies (or the additive acceptance-fixture scene) and
// asserts through inspect(), table text and URL state, never pixels.
//
// No fixed sleeps, no /tmp, no animation/timing assertion, no test branch in
// product code. Chromium only, through the shared loader and named skip reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { p10Distribution, p10Phase, p10Query, p10Schema } from './fixture.mjs';
import {
  ALL_UNPRICED_SUMMARY, COHORT_A, COHORT_ARTIFACT, COHORT_B, COLON_CHECK, LONG_HISTORY_YEARS,
  PRICED_ZERO_SUMMARY, QUALITY_ARTIFACTS, QUALITY_BANDS, QUALITY_BASELINES, QUALITY_CATALOGUE,
  SPECIAL_MIX_ROWS, SECOND_CHECK, longHistoryBody, qualityScores, qualitySeries
} from './acceptance-fixture.mjs';

const environment = loadBrowserEnvironment();
const PRESETS = [
  ['/b/trends', ['trend-columns', 'trend-lines', 'trend-multiples', 'calendar', 'rhythm']],
  ['/b/compare', ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank']],
  ['/b/quality', ['score-ranges', 'score-trend', 'score-strips', 'band-mix']],
  ['/b/cost', ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf']],
  ['/b/tools', ['mix', 'treemap', 'rank', 'rhythm']]
];

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function openBoard(page, origin, path) {
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function settle(page) {
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true');
  });
}

async function panelIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
}

async function panelStates(page) {
  return page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])
  ));
}

async function textOf(page, id) {
  return page.evaluate(panelId => document.querySelector(`[data-panel="${panelId}"]`)?.textContent || '', id);
}

async function rowsOf(page, id) {
  return page.evaluate(panelId => {
    const root = document.querySelector(`[data-panel="${panelId}"]`);
    return [...root.querySelectorAll('table tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  }, id);
}

// A chart paints on the frame after its panel goes idle. Wait on the public
// inspect() surface rather than sleeping.
async function chartSeries(page, panelId, selector) {
  await page.waitForFunction(({ panel, tag }) => {
    const element = document.querySelector(`[data-panel="${panel}"] ${tag}`);
    return Boolean(element && typeof element.inspect === 'function' && element.inspect().series?.length);
  }, { panel: panelId, tag: selector });
}

async function specAt(page, key) {
  return page.evaluate(panelKey => {
    const raw = new URLSearchParams(location.search).get(panelKey);
    return raw ? JSON.parse(raw) : null;
  }, key);
}

// Choose a select by index on a panel, wait for the URL spec, then reload the
// page so every panel settles on the new scope.
async function choose(page, origin, { panel, key, index, value, settled }) {
  await page.evaluate(({ panelId, selectIndex, next }) => {
    const select = document.querySelectorAll(`[data-panel="${panelId}"] .workspace-panel-chooser select`)[selectIndex];
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, { panelId: panel, selectIndex: index, next: value });
  await page.waitForFunction(({ panelKey, value }) => {
    const raw = new URLSearchParams(location.search).get(panelKey);
    if (!raw) return false;
    const spec = JSON.parse(raw);
    if (value.kind === 'measure') return (spec.measures || []).includes(value.name);
    if (value.kind === 'split') return spec.split === value.name;
    if (value.kind === 'chart') return spec.chart === value.name;
    return spec.scope?.[value.kind] === value.name;
  }, { panelKey: key, value: settled });
  await openBoard(page, origin, page.url().replace(origin, ''));
}

async function installQuality(page) {
  await page.route('**/v1/analytics/scores*', route => {
    const check = new URL(route.request().url()).searchParams.get('check');
    route.fulfill(json(check ? qualityScores(check) : QUALITY_CATALOGUE));
  });
  await page.route('**/v1/analytics/score-series*', route => {
    const check = new URL(route.request().url()).searchParams.get('check') || COLON_CHECK;
    route.fulfill(json(qualitySeries(check)));
  });
  await page.route('**/v1/baselines*', route => route.fulfill(json(QUALITY_BASELINES)));
  await page.route('**/v1/analytics/entities*', route => {
    const search = new URL(route.request().url()).searchParams;
    route.fulfill(json(search.get('mode') === 'aggregate' ? QUALITY_BANDS : QUALITY_ARTIFACTS));
  });
}

async function withPage(t, run) {
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 3200 } });
    const diagnostics = await watchPage(page);
    await run({ page, harness, diagnostics });
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
}

// 1. Completeness, grouping and refused combinations.
test('every P10 preset delivers its catalog panels and regroups on measure, lens and chart', async t => {
  await withPage(t, async ({ page, harness }) => {
    await installQuality(page);
    for (const [path, ids] of PRESETS) {
      await openBoard(page, harness.origin, `${path}?win=30d`);
      assert.deepEqual(await panelIds(page), ids, path);
      const states = await panelStates(page);
      for (const id of ids) assert.equal(states[id], 'ready', `${path} ${id} is ready`);
    }

    // Trends: a measure change keeps the surviving model series' style; a lens
    // and a chart change requery and regroup the same panel.
    await openBoard(page, harness.origin, '/b/trends?win=30d');
    const swatch = () => page.evaluate(() => document.querySelector('[data-panel="trend-columns"] yk-chart')
      .shadowRoot.querySelector('.yk-legend-item[data-key="model:claude"] .yk-legend-swatch')
      ?.style.getPropertyValue('--yk-swatch') || '');
    const before = await swatch();
    assert.ok(before);
    await choose(page, harness.origin, { panel: 'trend-columns', key: 'p1', index: 0, value: 'model_calls', settled: { kind: 'measure', name: 'model_calls' } });
    const after = await swatch();
    assert.equal(after, before, 'a surviving series keeps its colour');
    await choose(page, harness.origin, { panel: 'trend-columns', key: 'p1', index: 1, value: 'harness', settled: { kind: 'split', name: 'harness' } });
    const splitRows = p10Query({
      measure: 'model_calls', dims: ['harness'], bucket: 'day', to: new Date().toISOString()
    }).rows;
    const groups = [...new Set(splitRows.map(row => String(row.k[0])))];
    const buckets = [...new Set(splitRows.map(row => row.t))];
    assert.deepEqual(await rowsOf(page, 'trend-columns'), buckets.map(t => [
      new Date(t).toISOString(),
      ...groups.map(group => String(splitRows.find(row => row.t === t && String(row.k[0]) === group).v))
    ]));
    await choose(page, harness.origin, { panel: 'trend-columns', key: 'p1', index: 2, value: 'lines', settled: { kind: 'chart', name: 'lines' } });
    assert.equal((await specAt(page, 'p1')).chart, 'lines');

    // A schema-refused pair is a named unsupported state, not a fake split.
    const refused = { grain: 'time', measures: ['unpriced_calls'], split: 'session_model', chart: 'columns' };
    await openBoard(page, harness.origin, `/b/trends?win=30d&p1=${encodeURIComponent(JSON.stringify(refused))}`);
    assert.equal((await panelStates(page))['trend-columns'], 'unsupported');
    assert.match(await textOf(page, 'trend-columns'), /not published for this measure/);

    // Compare: a measure, lens and chart change on the shared trend panel.
    await openBoard(page, harness.origin, '/b/compare?win=30d&cmp=period');
    await choose(page, harness.origin, { panel: 'trend-lines', key: 'p4', index: 0, value: 'model_calls', settled: { kind: 'measure', name: 'model_calls' } });
    await choose(page, harness.origin, { panel: 'trend-lines', key: 'p4', index: 1, value: 'harness', settled: { kind: 'split', name: 'harness' } });
    await choose(page, harness.origin, { panel: 'trend-lines', key: 'p4', index: 2, value: 'area', settled: { kind: 'chart', name: 'area' } });
    assert.equal((await specAt(page, 'p4')).chart, 'area');

    // Quality: a check, split and scorer change regroup the hash population.
    await openBoard(page, harness.origin, '/b/quality?win=30d');
    await choose(page, harness.origin, { panel: 'score-ranges', key: 'p1', index: 1, value: SECOND_CHECK, settled: { kind: 'check', name: SECOND_CHECK } });
    assert.match(await textOf(page, 'score-ranges'), new RegExp(SECOND_CHECK));
    await choose(page, harness.origin, { panel: 'score-ranges', key: 'p1', index: 3, value: 'repo_id', settled: { kind: 'split', name: 'repo_id' } });
    await choose(page, harness.origin, { panel: 'score-ranges', key: 'p1', index: 2, value: 'jev-0', settled: { kind: 'scorer', name: 'jev-0' } });
    assert.match(await textOf(page, 'score-ranges'), /baseline_unavailable/);

    // Cost: the treemap measure change keeps the surviving parent styles, and
    // the child lens change regroups it.
    await openBoard(page, harness.origin, '/b/cost?win=30d');
    await chartSeries(page, 'treemap', 'yk-treemap');
    const treemapBefore = await page.evaluate(() => document.querySelector('[data-panel="treemap"] yk-treemap').inspect().series.map(series => series.key));
    await choose(page, harness.origin, { panel: 'treemap', key: 'p3', index: 0, value: 'model_calls', settled: { kind: 'measure', name: 'model_calls' } });
    await chartSeries(page, 'treemap', 'yk-treemap');
    const treemapAfter = await page.evaluate(() => document.querySelector('[data-panel="treemap"] yk-treemap').inspect().series.map(series => series.key));
    assert.deepEqual(treemapAfter, treemapBefore, 'surviving parent keys keep their styles');
    await choose(page, harness.origin, { panel: 'treemap', key: 'p3', index: 2, value: 'model', settled: { kind: 'split', name: 'model' } });

    // Tools: the rank lens changes from tool to tool_kind; measure and chart
    // are fixed by the preset (one hook_events measure, ranked bars).
    await openBoard(page, harness.origin, '/b/tools?win=30d');
    await choose(page, harness.origin, { panel: 'rank', key: 'p3', index: 1, value: 'tool_kind', settled: { kind: 'split', name: 'tool_kind' } });
    assert.deepEqual((await rowsOf(page, 'rank')).map(row => row[0]), ['shell', 'read']);
  });
});

// 2. Long history and linked time.
test('long-history resolution, zoom bounds and Back/Forward preserve dates and preset', async t => {
  await withPage(t, async ({ page, harness }) => {
    let longHistory = false;
    await page.route('**/v1/analytics/query*', route => {
      const search = new URL(route.request().url()).searchParams;
      const from = Date.parse(search.get('from') || '');
      const to = Date.parse(search.get('to') || '');
      const tenYears = Number.isFinite(from) && Number.isFinite(to) && (to - from) > 3000 * 86400e3;
      if (search.get('all') === '1' || tenYears) longHistory = true;
      if (!longHistory) return route.continue();
      longHistory = false;
      return route.fulfill(json(longHistoryBody({ measure: search.get('measure') || 'cost_usd', dims: search.getAll('dim') })));
    });

    for (const window of ['all', '10y']) {
      await openBoard(page, harness.origin, `/b/trends?win=${window}`);
      const basis = await textOf(page, 'trend-columns');
      assert.match(basis, /coarsened them to year/, `win=${window} names the effective bucket`);
      const table = await rowsOf(page, 'trend-columns');
      assert.deepEqual([...new Set(table.map(row => row[0]))], LONG_HISTORY_YEARS.map(t => new Date(t).toISOString()).slice(0, 11));
    }

    // A settled zoom writes absolute from/to and clears win; reload, Back and
    // Forward preserve the dates and the Trends preset.
    await openBoard(page, harness.origin, '/b/trends?win=30d');
    const from = Date.now() - 2 * 86400e3;
    const to = Date.now() - 86400e3;
    await page.evaluate(({ from, to }) => {
      document.querySelector('[data-panel="trend-columns"] yk-chart')
        .dispatchEvent(new CustomEvent('zoom', { detail: { from, to } }));
    }, { from, to });
    await page.waitForFunction(() => {
      const params = new URLSearchParams(location.search);
      return params.get('from') && params.get('to') && !params.get('win');
    });
    const zoomed = new URL(page.url());
    await page.reload();
    await settle(page);
    assert.equal(new URL(page.url()).searchParams.get('from'), zoomed.searchParams.get('from'));
    assert.equal(new URL(page.url()).pathname, '/b/trends');
    await page.goBack();
    await page.waitForFunction(previous => location.href !== previous, zoomed.href);
    assert.equal(new URL(page.url()).pathname, '/b/trends', 'Back keeps the Trends preset');
    await page.goForward();
    await page.waitForFunction(expected => new URLSearchParams(location.search).get('from') === expected, zoomed.searchParams.get('from'));
    assert.equal(new URL(page.url()).pathname, '/b/trends');
    assert.equal(new URL(page.url()).searchParams.get('to'), zoomed.searchParams.get('to'));

    // All-history period compare names the copy and issues no previous window.
    harness.resetStats();
    harness.api.state.requests.length = 0;
    await openBoard(page, harness.origin, '/b/compare?win=all&cmp=period');
    assert.match(await textOf(page, 'dist-ranges'), /Choose a finite period to compare periods/);
    const distributions = harness.api.state.requests.filter(item => /distribution/.test(item.path));
    assert.equal(distributions.some(item => /[?&]to=/.test(item.search)), false, 'no previous-window request');
  });
});

// 3. Comparison: finite periods, cohorts, typed populations and refusals.
test('finite and cohort comparisons show both populations, coverage and named refusals', async t => {
  await withPage(t, async ({ page, harness }) => {
    harness.api.state.requests.length = 0;
    await openBoard(page, harness.origin, '/b/compare?win=30d&cmp=period');
    const period = await textOf(page, 'dist-ranges');
    assert.match(period, /current and previous period/i);
    assert.match(period, /unpriced/i);
    const windows = harness.api.state.requests
      .filter(item => /distribution/.test(item.path))
      .map(item => new URLSearchParams(item.search.slice(1)))
      .filter(params => params.get('from'));
    assert.ok(windows.some(params => Date.parse(params.get('to')) < Date.now() - 20 * 86400e3), 'a previous window was requested');
    assert.ok(windows.every(params => params.get('from') && params.get('to')), 'both sides carry absolute bounds');

    const query = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: COHORT_A, cb: COHORT_B });
    harness.api.state.requests.length = 0;
    await openBoard(page, harness.origin, `/b/cost?${query}`);
    const both = await textOf(page, 'dist-ranges');
    assert.match(both, /Cohort A/);
    assert.match(both, /Cohort B/);
    assert.match(both, /call in scope/);
    assert.match(both, /resolved by the cohort/);
    assert.match(both, /unpriced/i);
    const sent = harness.api.state.requests
      .filter(item => /distribution/.test(item.path) && /[?&]cohort=/.test(item.search))
      .map(item => new URLSearchParams(item.search.slice(1)).get('cohort'));
    assert.ok(sent.includes(COHORT_A) && sent.includes(COHORT_B), 'both typed cohorts reach the wire');

    harness.api.state.requests.length = 0;
    await openBoard(page, harness.origin, `/b/cost?win=30d&cmp=cohorts&ca=${encodeURIComponent(COHORT_A)}`);
    const single = await textOf(page, 'dist-ranges');
    assert.match(single, /resolved by the cohort/);
    assert.match(single, /Cohort A/);
    assert.match(single, /all in scope/);

    harness.api.state.requests.length = 0;
    const mixed = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: COHORT_A, cb: COHORT_ARTIFACT });
    await openBoard(page, harness.origin, `/b/cost?${mixed}`);
    assert.match(await textOf(page, 'dist-ranges'), /same source grain/);
    assert.equal(
      harness.api.state.requests.some(item => /[?&]cohort=/.test(item.search) && item.search.includes(encodeURIComponent(COHORT_ARTIFACT))),
      false,
      'the mismatched cohort is never queried'
    );

    const splits = new URLSearchParams({ win: '30d', cmp: 'cohorts', ca: COHORT_A, cb: COHORT_B });
    await openBoard(page, harness.origin, `/b/compare?${splits}`);
    const groups = await page.evaluate(() => Object.fromEntries(
      ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank'].map(id => [
        id, document.querySelectorAll(`[data-panel="${id}"] [data-split]`).length
      ])
    ));
    for (const [id, count] of Object.entries(groups)) assert.ok(count > 1, `${id} is small multiples (${count})`);
  });
});

// 4. Quality units, baseline and artifact destination.
test('quality separates hash and file units, draws the scorer baseline and opens the artifact', async t => {
  await withPage(t, async ({ page, harness }) => {
    await installQuality(page);
    await openBoard(page, harness.origin, '/b/quality?win=30d');

    const ranges = await textOf(page, 'score-ranges');
    assert.match(ranges, /distinct content hashes/);
    assert.match(ranges, /all-time scorer baseline/);
    assert.match(ranges, /p25 0.45 – p75 0.85/);
    assert.equal(await page.evaluate(() => Boolean(
      document.querySelector('[data-panel="score-ranges"] yk-ranges')?.shadowRoot?.querySelector('[data-baseline="true"]')
    )), true);

    const trend = await textOf(page, 'score-trend');
    assert.match(trend, /Distinct content hashes/);
    assert.match(trend, /all-time scorer baseline/);

    const strips = await textOf(page, 'score-strips');
    assert.match(strips, /file-weighted/);
    assert.match(strips, /3 of 3 files/);
    assert.match(strips, /1 missing: unscored/);
    assert.match(strips, /Open this identity in the artifact reader/);

    const bands = await textOf(page, 'band-mix');
    for (const label of ['below p25', 'mid (p25–p75 inclusive)', 'above p75', 'unscored', 'baseline_unavailable']) {
      assert.ok(bands.includes(label), `band-mix names ${label}`);
    }
    assert.match(bands, /file-weighted/);

    // A grader change regroups the ranges and the chosen scorer baseline is
    // used; a missing baseline is baseline_unavailable, a null score unscored.
    await chartSeries(page, 'score-ranges', 'yk-ranges');
    const before = await page.evaluate(() => document.querySelector('[data-panel="score-ranges"] yk-ranges').inspect()
      .marks.find(mark => mark.key === 'harness:orca')?.style?.cssVar || '');
    await choose(page, harness.origin, { panel: 'score-ranges', key: 'p1', index: 1, value: SECOND_CHECK, settled: { kind: 'check', name: SECOND_CHECK } });
    await chartSeries(page, 'score-ranges', 'yk-ranges');
    const after = await page.evaluate(() => document.querySelector('[data-panel="score-ranges"] yk-ranges').inspect()
      .marks.find(mark => mark.key === 'harness:orca')?.style?.cssVar || '');
    assert.equal(after, before, 'a surviving group keeps its colour');
    await choose(page, harness.origin, { panel: 'score-ranges', key: 'p1', index: 2, value: 'jev-0', settled: { kind: 'scorer', name: 'jev-0' } });
    assert.match(await textOf(page, 'score-ranges'), /baseline_unavailable/);

    // A strip mark opens the delivered artifact reader.
    const key = JSON.stringify({ path: 'docs/a.md', repo_id: 'repo-a' });
    await page.evaluate(stripKey => {
      document.querySelector('[data-panel="score-strips"] yk-ranges')
        .dispatchEvent(new CustomEvent('inspect', { bubbles: true, composed: true, detail: { key: stripKey, values: {} } }));
    }, key);
    await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
    assert.equal(await page.evaluate(() => document.querySelector('.workspace-inspector').dataset.grain), 'artifact');
    await page.click('.workspace-inspector button:has-text("Open")');
    await page.waitForFunction(() => location.pathname === '/artifact');
    const destination = new URL(page.url());
    assert.equal(destination.searchParams.get('repo_id'), 'repo-a');
    assert.equal(destination.searchParams.get('path'), 'docs/a.md');
    assert.equal(destination.searchParams.get('hash'), 'h1');
  });
});

// 5. Cost and tools honesty.
test('cost honesty keeps lower bounds, all-unpriced, zero, special groups and refusals apart', async t => {
  await withPage(t, async ({ page, harness }) => {
    let summary = { model_calls: 64, unpriced_calls: 3, cost_usd: 4.25 };
    await page.route('**/v1/analytics/summary*', route => route.fulfill(json(summary)));
    await page.route('**/v1/analytics/query*', route => {
      const params = new URL(route.request().url()).searchParams;
      const dims = params.getAll('dim');
      if (dims.includes('tool_kind') && dims.includes('harness')) {
        return route.fulfill(json({
          measure: 'hook_events', bucket: 'none', requested_bucket: 'none', coarsened: false,
          dims, rows: SPECIAL_MIX_ROWS,
          population: { grain: 'time', unit: 'group', scope_n: 4, cohort_n: 4, eligible_n: 4, returned_n: 4, missing_by_reason: {} }
        }));
      }
      return route.continue();
    });

    await openBoard(page, harness.origin, '/b/cost?win=30d');
    const partial = await textOf(page, 'treemap');
    assert.match(partial, /lower bound, 3 calls unpriced/);
    assert.match(partial, /\$4\.25\+/);
    const ranges = await rowsOf(page, 'dist-ranges');
    assert.ok(ranges.some(row => row.at(-1) === '2'), 'the partially priced group keeps its unpriced count');

    summary = ALL_UNPRICED_SUMMARY;
    await openBoard(page, harness.origin, '/b/cost?win=30d');
    const allUnpriced = await textOf(page, 'treemap');
    assert.match(allUnpriced, /all 5 calls unpriced/);
    assert.match(allUnpriced, /no priced cost/);
    assert.match(allUnpriced, /unpriced/);
    assert.equal(/\$0\.00/.test(allUnpriced), false, 'an all-unpriced group is never $0');

    summary = PRICED_ZERO_SUMMARY;
    await openBoard(page, harness.origin, '/b/cost?win=30d');
    assert.match(await textOf(page, 'treemap'), /real zero/);
    assert.match(await textOf(page, 'treemap'), /\$0\.00/);

    // Numeric eligibility and the fixed bin ladder match the fixture.
    const histDist = p10Distribution({ measure: 'cost_usd', grain: 'call', dim: 'harness', to: new Date().toISOString() });
    const hist = await rowsOf(page, 'dist-hist');
    assert.deepEqual(hist.map(row => row[3]), histDist.rows.flatMap(row => row.bins.map(bin => String(bin.n))));
    assert.match(await textOf(page, 'dist-hist'), /call grain by harness/);

    // A repo cost total and a cost-by-tool join are named with their try.
    const repoSpec = { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'treemap', scope: { parent: 'session_repo' } };
    await openBoard(page, harness.origin, `/b/cost?win=30d&p3=${encodeURIComponent(JSON.stringify(repoSpec))}`);
    const repoText = await textOf(page, 'treemap');
    assert.match(repoText, /session_repo is not served on \/query for cost/);
    assert.match(repoText, /\/distribution\?dim=session_repo/);
    const toolSpec = { grain: 'time', measures: ['cost_usd'], split: 'tool', chart: 'treemap', scope: { parent: 'harness' } };
    await openBoard(page, harness.origin, `/b/cost?win=30d&p3=${encodeURIComponent(JSON.stringify(toolSpec))}`);
    assert.match(await textOf(page, 'treemap'), /hook_events by tool/);

    // Tools: unknown, (mixed), (none) and (multi) stay their own series; the
    // tool/kind groups and the rhythm grid match the fixture.
    await openBoard(page, harness.origin, '/b/tools?win=30d');
    await chartSeries(page, 'mix', 'yk-bars');
    const mixLabels = await page.evaluate(() => document.querySelector('[data-panel="mix"] yk-bars').inspect().series.map(series => series.label));
    for (const label of ['unknown', '(mixed)', '(none)', '(multi)']) assert.ok(mixLabels.includes(label), `${label}: ${JSON.stringify(mixLabels)}`);
    assert.equal(mixLabels.includes('(other)'), false);
    const treemapRows = p10Query({ measure: 'hook_events', dims: ['harness', 'tool'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.k[1]), String(row.v)]);
    assert.deepEqual(await rowsOf(page, 'treemap'), treemapRows);
    const rankRows = p10Query({ measure: 'hook_events', dims: ['tool'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.v)]);
    assert.deepEqual(await rowsOf(page, 'rank'), rankRows);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-panel="rhythm"] table tbody tr').length), 7 * 24);
  });
});

// 6. Linked actions, tray, cohort chip and table/population parity.
test('linked actions emit chips, a pick reaches the tray and a cohort requeries every panel', async t => {
  await withPage(t, async ({ page, harness }) => {
    await openBoard(page, harness.origin, '/b/trends?win=30d');

    // Legend focus on a published lens becomes a board filter chip.
    await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="trend-columns"] yk-chart');
      const button = [...chart.shadowRoot.querySelectorAll('[data-action="focus"]')]
        .find(node => /claude/.test(node.getAttribute('aria-label') || ''));
      button.click();
    });
    await page.waitForFunction(() => new URLSearchParams(location.search).get('session_model') === 'claude');
    const filterChip = await page.evaluate(() => [...document.querySelectorAll('.workspace-chips .workspace-chip[data-kind="filter"]')].map(node => node.textContent));
    assert.ok(filterChip.some(label => /(?:session_)?model: claude/.test(label)), JSON.stringify(filterChip));

    // An unmapped key is named, never silently applied.
    await page.evaluate(() => {
      document.querySelector('[data-panel="trend-columns"]').dispatchEvent(new CustomEvent('filter', {
        bubbles: true, composed: true, detail: { key: 'mystery:value' }
      }));
    });
    await page.waitForFunction(() => document.querySelector('.workspace-chip[data-kind="unmapped"]'));
    assert.match(await page.evaluate(() => document.querySelector('.workspace-chip[data-kind="unmapped"]').textContent), /not applied here: mystery:value/);

    // A pick updates the tray.
    await page.evaluate(() => {
      document.querySelector('[data-panel="trend-columns"] yk-chart').dispatchEvent(new CustomEvent('select', {
        bubbles: true, composed: true, detail: { selection: { include: ['model:claude'], exclude: [] } }
      }));
    });
    await page.waitForFunction(() => (new URLSearchParams(location.search).get('pick') || '').length > 0);
    const tray = await page.evaluate(() => document.querySelector('.selection-tray')?.textContent || '');
    assert.match(tray, /model:claude/);
    assert.ok(tray.trim().length > 0);

    // A cohort chip exists and every P10 panel's request carries the cohort.
    harness.api.state.requests.length = 0;
    await openBoard(page, harness.origin, `/b/cost?win=30d&ca=${encodeURIComponent(COHORT_A)}`);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.workspace-chip[data-kind="cohort"]')].map(node => node.textContent));
    assert.ok(chips.length > 0, 'a cohort chip is shown');
    const analytics = harness.api.state.requests.filter(item => /query|distribution/.test(item.path));
    assert.ok(analytics.length >= 4, `panel requests: ${analytics.length}`);
    assert.equal(analytics.every(item => /[?&]cohort=/.test(item.search)), true, 'every panel request carries cohort=');

    // Table parity and a population unit on every panel.
    const populations = await page.evaluate(() => Object.fromEntries(
      [...document.querySelectorAll('.workspace-panel')].map(panel => [
        panel.dataset.panel, panel.querySelector('.workspace-panel-population')?.textContent || ''
      ])
    ));
    for (const [id, text] of Object.entries(populations)) assert.ok(text.trim().length > 0, `${id} shows a population unit`);
    const costTreemap = await rowsOf(page, 'treemap');
    assert.deepEqual(costTreemap, p10Query({ measure: 'cost_usd', dims: ['harness', 'model'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.k[1]), String(row.v)]));
    assert.equal(p10Schema().grains.time.lenses.length, 1);
    assert.equal(p10Phase({ to: new Date().toISOString() }) >= 0, true);
  });
});
