import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { hasPanel, lookupPanel, validatePanelEntry } from '../../web/js/panels/registry.js';
import { COST_PANELS, COST_SPECS, registerCostPanels } from '../../web/js/panels/p10-cost.js';
import {
  costJoinGuard, costOmitted, costHonesty, treemapDims, TREEMAP_PANEL, buildTreemapData
} from '../../web/js/panels/treemap.js';
import { MIX_MODES, MIX_PANEL, buildMix } from '../../web/js/panels/mix.js';
import { buildTreemapModel } from '../../web/js/charts/yk-treemap.js';
import { p10Phase, p10Query, p10Schema, p10Distribution } from './fixture.mjs';

const schema = p10Schema();

test('the Cost preset registers six valid panels with canonical starting specs', () => {
  registerCostPanels();
  const preset = lookupPreset('cost');
  assert.ok(preset);
  assert.deepEqual(preset.panels, ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf']);
  assert.deepEqual(COST_PANELS.map(panel => panel.id), preset.panels);
  for (const panel of COST_PANELS) {
    assert.ok(hasPanel(panel.id), `${panel.id} is registered`);
    assert.doesNotThrow(() => validatePanelEntry(lookupPanel(panel.id)));
  }
  assert.deepEqual(Object.keys(COST_SPECS).sort(), preset.panels.slice().sort());
  for (const spec of Object.values(COST_SPECS)) assert.deepEqual(spec.measures, ['cost_usd']);
  assert.equal(COST_SPECS.treemap.scope.parent, 'harness');
  assert.equal(COST_SPECS.treemap.split, 'model');
  assert.equal(lookupPanel('treemap').charts[0], 'treemap');
  assert.equal(hasPanel('mix'), false, 'mix is shared for Tools, not part of Cost');
  assert.doesNotThrow(() => registerCostPanels());
});

test('the treemap maps two published dims into parent cells and child values', () => {
  const mapped = buildTreemapData({
    measure: 'cost_usd',
    parent: 'harness',
    child: 'model',
    rows: [
      { k: ['orca', 'claude'], v: 3 },
      { k: ['orca', 'gpt'], v: 4 },
      { k: ['claude-code', 'claude'], v: 5 },
      { k: ['orca', 'claude'], v: null }
    ]
  });
  assert.equal(mapped.twoLevel, true);
  assert.deepEqual(mapped.parents.map(parent => parent.key), ['orca', 'claude-code']);
  assert.deepEqual(mapped.data.map(row => [row.parent, row.label, row.value]), [
    ['orca', 'claude', 3], ['orca', 'gpt', 4], ['claude-code', 'claude', 5]
  ]);
  const model = buildTreemapModel({
    spec: { series: [{ key: 'cost_usd', label: 'Cost', unit: 'USD', kind: 'money' }], parents: mapped.parents },
    data: mapped.data
  });
  assert.deepEqual(model.groups.map(group => [group.key, group.total]), [['orca', 7], ['claude-code', 5]]);
  const single = buildTreemapData({ measure: 'cost_usd', parent: 'harness', child: 'model', rows: [{ k: ['orca'], v: 9 }] });
  assert.equal(single.twoLevel, false);
  assert.deepEqual(single.data.map(row => [row.parent, row.label, row.value]), [['orca', 'orca', 9]]);
});

test('cost honesty keeps lower bound, all-unpriced and a real priced zero apart', () => {
  const lower = costHonesty({ summary: { model_calls: 64, unpriced_calls: 3, cost_usd: 4.25 } });
  assert.equal(lower.state, 'lower-bound');
  assert.match(lower.text, /lower bound, 3 calls unpriced/);
  assert.match(lower.money, /\$4\.25\+/);
  const all = costHonesty({ summary: { model_calls: 5, unpriced_calls: 5, cost_usd: 0 } });
  assert.equal(all.state, 'all-unpriced');
  assert.match(all.text, /all 5 calls unpriced/);
  assert.match(all.text, /no priced cost/);
  assert.equal(all.money, 'unpriced');
  const zero = costHonesty({ summary: { model_calls: 5, unpriced_calls: 0, cost_usd: 0 } });
  assert.equal(zero.state, 'priced-zero');
  assert.match(zero.text, /real zero/);
  assert.equal(zero.money, '$0.00');
  assert.equal(costHonesty({ n: 0, unpriced: 4 }).state, 'all-unpriced');
  assert.equal(costHonesty({ n: 18, unpriced: 2 }).state, 'lower-bound');
  assert.equal(costHonesty({ n: 18, unpriced: 0 }).state, 'priced');
  assert.equal(costHonesty({ measure: 'tokens_in', summary: {} }), null);
});

test('a repo cost total and a cost-by-tool join are named unsupported with the alternative', () => {
  const repo = costJoinGuard('cost_usd', ['session_repo', 'model']);
  assert.ok(repo);
  assert.match(repo.reason, /session_repo is not served on \/query for cost/);
  assert.match(repo.try, /\/distribution\?dim=session_repo/);
  const direct = costJoinGuard('cost_usd', ['repo_id']);
  assert.ok(direct);
  assert.match(direct.reason, /direct repo_id on usage rows is empty/);
  const tool = costJoinGuard('cost_usd', ['harness', 'tool']);
  assert.ok(tool);
  assert.match(tool.try, /hook_events by tool/);
  assert.equal(costJoinGuard('model_calls', ['session_repo']), null);
  const costDims = treemapDims(TREEMAP_PANEL, 'cost_usd', schema);
  assert.equal(costDims.includes('repo_id'), false);
  assert.equal(costDims.includes('session_repo'), false);
  assert.ok(costDims.includes('model') && costDims.includes('harness'));
  assert.ok(treemapDims(TREEMAP_PANEL, 'commits', schema).includes('repo_id'));
});

test('the mix composition keeps (mixed), (none), (multi) and unknown as separate series', () => {
  assert.deepEqual(MIX_MODES, ['stacked', 'percent']);
  const rows = [
    { k: ['shell', 'orca'], v: 4 },
    { k: ['shell', '(mixed)'], v: 2 },
    { k: ['shell', '(none)'], v: 1 },
    { k: ['shell', '(multi)'], v: 1 },
    { k: ['shell', 'unknown'], v: 2 },
    { k: ['read', 'orca'], v: 3 },
    { k: ['read', 'unknown'], v: 1 }
  ];
  const stacked = buildMix({ rows, measure: 'hook_events', dims: ['tool_kind', 'harness'], mode: 'stacked' });
  const labels = stacked.series.map(series => series.label);
  for (const label of ['(mixed)', '(none)', '(multi)', 'unknown']) assert.ok(labels.includes(label), label);
  assert.equal(labels.includes('(other)'), false);
  assert.deepEqual(stacked.rows.map(row => row.label), ['shell', 'read']);
  assert.equal(stacked.rows[0].values['harness:orca'], 4);
  const percent = buildMix({ rows, measure: 'hook_events', dims: ['tool_kind', 'harness'], mode: 'percent' });
  assert.equal(MIX_PANEL.charts[0], 'bars');
  assert.equal(MIX_PANEL.caveats.includes('Special groups'), true);
  for (const row of percent.rows) {
    const total = Object.values(row.values).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${row.label} percent sums to 1`);
  }
});

test('omitted groups carry their group, row and unpriced counts separately', () => {
  const text = costOmitted({ omitted_groups: 2, omitted_n: 7, omitted_unpriced: 3 });
  assert.match(text, /2 groups omitted/);
  assert.match(text, /7 rows in omitted groups/);
  assert.match(text, /3 calls unpriced in omitted groups/);
  assert.equal(costOmitted({}), '');
});

test('the distribution fixture keeps fixed bins, unpriced calls and call units', () => {
  const body = p10Distribution({ measure: 'cost_usd', dim: 'model', to: new Date().toISOString() });
  assert.equal(body.population.unit, 'call');
  assert.ok(body.rows.length >= 2);
  const ladder = body.rows[0].bins.map(bin => `${bin.lo}:${bin.hi ?? ''}`);
  for (const row of body.rows) assert.deepEqual(row.bins.map(bin => `${bin.lo}:${bin.hi ?? ''}`), ladder);
  assert.equal(body.rows.reduce((sum, row) => sum + row.n, 0), body.population.returned_n);
  assert.ok(body.rows.some(row => row.unpriced > 0), 'a partially priced group is carried');
});

// ---------------------------------------------------------------------------
// Browser acceptance: /b/cost settles six frames, regroups on a measure/split
// change, shows the fixture values, names the unsupported cost joins and keeps
// the pricing states apart without a console, page or CSP error.
// ---------------------------------------------------------------------------

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function openBoard(page, origin, path) {
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function rowsOf(page, id) {
  return page.evaluate(panelId => {
    const root = document.querySelector(`[data-panel="${panelId}"]`);
    return [...root.querySelectorAll('table tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  }, id);
}

test('cost settles six panels, matches the fixture and names unsupported cost joins', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 3000 } });
    const diagnostics = await watchPage(page);
    harness.resetStats();
    await openBoard(page, harness.origin, '/b/cost?win=30d');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const phase = p10Phase({ to: new Date().toISOString() });
    const expectedTreemap = p10Query({ measure: 'cost_usd', dims: ['harness'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.k[0]), String(row.v)]);
    const expectedRank = p10Query({ measure: 'cost_usd', dims: ['model'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.v)]);
    assert.deepEqual(await rowsOf(page, 'treemap'), expectedTreemap);
    assert.deepEqual(await rowsOf(page, 'rank'), expectedRank);

    const treemap = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="treemap"]');
      const chart = root.querySelector('yk-treemap');
      return { text: root.textContent, series: chart.inspect().series.map(series => series.key), marks: chart.inspect().marks.length };
    });
    assert.equal(treemap.marks > 0, true);
    assert.match(treemap.text, /lower bound, 3 calls unpriced/);
    assert.match(treemap.text, /\$4\.25\+/);
    assert.match(treemap.text, /harness → model/);

    const trendText = await page.evaluate(() => document.querySelector('[data-panel="trend-columns"]').textContent);
    const rankText = await page.evaluate(() => document.querySelector('[data-panel="rank"]').textContent);
    assert.match(trendText, /bucket/);
    assert.match(rankText, /group/);

    const dist = p10Distribution({ measure: 'cost_usd', dim: 'model', to: new Date().toISOString() });
    const ranges = await rowsOf(page, 'dist-ranges');
    assert.deepEqual(ranges, dist.rows.map(row => [
      String(row.k), String(row.min), String(row.p25), String(row.median), String(row.p75), String(row.max), String(row.p95), String(row.n), String(row.unpriced)
    ]));
    assert.ok(ranges.some(row => row.at(-1) === '2'), 'the partially priced group keeps its unpriced count');
    const rangesText = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(rangesText, /unpriced/i);
    assert.match(rangesText, /call/);

    const hist = await rowsOf(page, 'dist-hist');
    const expectedCounts = dist.rows.flatMap(row => row.bins.map(bin => String(bin.n)));
    assert.deepEqual(hist.map(row => row[3]), expectedCounts);
    const ecdf = await rowsOf(page, 'dist-ecdf');
    assert.deepEqual(ecdf, dist.rows.map(row => [String(row.k), String(row.n)]));

    // A measure change regroups the treemap; the surviving parent keys keep
    // their entity style (the registry colours by key, so the key is the style).
    await page.evaluate(() => {
      const select = document.querySelector('[data-panel="treemap"] .workspace-panel-chooser select');
      select.value = 'model_calls';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p3');
      return raw && JSON.parse(raw).measures.includes('model_calls');
    });
    await openBoard(page, harness.origin, page.url().replace(harness.origin, ''));
    const regrouped = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="treemap"]');
      return { state: root.dataset.state, series: root.querySelector('yk-treemap').inspect().series.map(series => series.key) };
    });
    assert.equal(regrouped.state, 'ready');
    assert.deepEqual(regrouped.series, treemap.series, 'surviving parent keys keep their styles');

    // A split change on the shared trend panel regroups it by harness.
    await page.evaluate(() => {
      const selects = document.querySelectorAll('[data-panel="trend-columns"] .workspace-panel-chooser select');
      selects[1].value = 'harness';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).split === 'harness';
    });
    await openBoard(page, harness.origin, page.url().replace(harness.origin, ''));
    const trendSeries = await page.evaluate(() => document.querySelector('[data-panel="trend-columns"] yk-chart').inspect().series.map(series => series.key));
    assert.deepEqual(trendSeries, ['harness:orca', 'harness:claude-code']);

    const requests = harness.api.state.requests.filter(item => /distribution|query|summary/.test(item.path));
    assert.ok(requests.length > 0);

    // Unsupported cost joins are named with the alternative, never faked.
    const repoSpec = { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'treemap', scope: { parent: 'session_repo' } };
    await page.goto(`${harness.origin}/b/cost?win=30d&p3=${encodeURIComponent(JSON.stringify(repoSpec))}`);
    await page.waitForFunction(() => document.querySelector('[data-panel="treemap"]')?.dataset.idle === 'true');
    const repoText = await page.evaluate(() => document.querySelector('[data-panel="treemap"]').textContent);
    assert.equal(await page.evaluate(() => document.querySelector('[data-panel="treemap"]').dataset.state), 'unsupported');
    assert.match(repoText, /session_repo is not served on \/query for cost/);
    assert.match(repoText, /\/distribution\?dim=session_repo/);

    const toolSpec = { grain: 'time', measures: ['cost_usd'], split: 'tool', chart: 'treemap', scope: { parent: 'harness' } };
    await page.goto(`${harness.origin}/b/cost?win=30d&p3=${encodeURIComponent(JSON.stringify(toolSpec))}`);
    await page.waitForFunction(() => document.querySelector('[data-panel="treemap"]')?.dataset.idle === 'true');
    const toolText = await page.evaluate(() => document.querySelector('[data-panel="treemap"]').textContent);
    assert.match(toolText, /hook_events by tool/);

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
