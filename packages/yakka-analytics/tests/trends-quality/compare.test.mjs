import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';
import { COMPARE_PANELS, COMPARE_SPECS, registerComparePanels } from '../../web/js/panels/p10-compare.js';
import {
  PERIOD_UNSUPPORTED, DIST_MEASURES, distributionParams, previousDistributionParams, boxRow, boxTableRows, fetchDistribution
} from '../../web/js/panels/dist-ranges.js';
import { fixedBins, histogramRows } from '../../web/js/panels/dist-hist.js';
import { slopeRows } from '../../web/js/panels/rank.js';
import { p10Distribution } from './fixture.mjs';

test('the Compare preset registers five valid panels and asks for a period compare by default', () => {
  registerComparePanels();
  assert.deepEqual(COMPARE_PANELS.map(panel => panel.id), ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank']);
  for (const panel of COMPARE_PANELS) assert.doesNotThrow(() => validatePanelEntry(panel));
  const preset = lookupPreset('compare');
  assert.deepEqual(preset.panels, COMPARE_PANELS.map(panel => panel.id));
  for (const id of ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank']) {
    assert.equal(COMPARE_SPECS[id].scope.cmp, 'period');
  }
});

test('distribution params carry the absolute window and never treat all-history as a period', () => {
  const absolute = distributionParams({ scope: { from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z' }, measure: 'cost_usd', grain: 'call', dim: 'model' });
  assert.equal(absolute.get('measure'), 'cost_usd');
  assert.equal(absolute.get('dim'), 'model');
  assert.equal(absolute.get('grain'), 'call');
  assert.equal(Date.parse(absolute.get('from')), Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(Date.parse(absolute.get('to')), Date.parse('2026-09-15T00:00:00Z'));
  assert.equal(absolute.get('cmp'), null, 'cmp is a scope input, not a request parameter');
  const all = distributionParams({ scope: { win: 'all' }, measure: 'cost_usd' });
  assert.equal(all.get('from'), null);
  assert.equal(all.get('to'), null);
  assert.equal(all.get('all'), '1');
  assert.equal(previousDistributionParams({ scope: { win: 'all' }, measure: 'cost_usd' }), null);
  const previous = previousDistributionParams({ scope: { from: '2026-09-11T00:00:00Z', to: '2026-09-21T00:00:00Z' }, measure: 'cost_usd' });
  assert.equal(Date.parse(previous.get('to')), Date.parse('2026-09-11T00:00:00Z'));
  assert.equal(Date.parse(previous.get('from')), Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(PERIOD_UNSUPPORTED, 'Choose a finite period to compare periods.');
});

test('box rows expose quartiles, sample size and unpriced calls without blending them', () => {
  const row = boxRow({ k: 'claude', n: 18, unpriced: 2, min: 0, p25: 1, median: 2, p75: 3, p95: 4, max: 5 }, { dim: 'model', period: 'current', measure: 'cost_usd', kind: 'money', unit: 'USD' });
  assert.equal(row.key, 'model:claude::current');
  assert.equal(row.label, 'claude · current');
  assert.deepEqual([row.values.min, row.values.q1, row.values.median, row.values.q3, row.values.p95], [0, 1, 2, 3, 4]);
  assert.equal(row.values.unpriced, 2);
  assert.deepEqual(boxTableRows([row])[0].slice(0, 3), ['claude', 'current', '0']);
  assert.deepEqual(boxTableRows([row])[0].slice(2, 8), ['0', '1', '2', '3', '4', '5']);
  assert.equal(boxTableRows([row])[0].at(-2), '18');
  assert.equal(boxTableRows([row])[0].at(-1), '2');
});

test('the histogram names its bins once and fills an absent bin with zero, not with a guess', () => {
  const rows = [{ k: 'claude', n: 10, bins: [{ lo: 0, hi: 0.1, n: 3 }, { lo: 0.1, hi: 0.2, n: 4 }] }];
  const bins = fixedBins(rows);
  assert.deepEqual(bins, [{ from: 0, to: 0.1 }, { from: 0.1, to: 0.2 }]);
  const hist = histogramRows(rows[0], bins);
  assert.deepEqual(hist.map(row => row.values.count), [3, 4]);
  const absent = histogramRows({ bins: [{ lo: 0, hi: 1, n: 2 }] }, bins);
  assert.deepEqual(absent.map(row => row.values.count), [2, 0]);
});

test('the slope pairs a previous and current value per group and marks missing sides undefined', () => {
  const current = { rows: [{ k: ['claude'], v: 16 }, { k: ['gpt'], v: 9 }] };
  const previous = { rows: [{ k: ['claude'], v: 12 }, { k: ['gpt'], v: 12 }, { k: ['gemini'], v: 4 }] };
  const model = slopeRows(current, previous, 'cost_usd', 'model');
  assert.deepEqual(model.series.map(series => series.key), ['previous', 'current']);
  const claude = model.rows.find(row => row.label === 'claude');
  assert.equal(claude.values.current, 16);
  assert.equal(claude.values.previous, 12);
  const gemini = model.rows.find(row => row.label === 'gemini');
  assert.equal(gemini.values.current, undefined);
  assert.equal(gemini.values.previous, 4);
});

test('the distribution fixture keeps one fixed bin ladder and both population sides', () => {
  const rows = Object.fromEntries(DIST_MEASURES.map(measure => [measure, p10Distribution({ measure, dim: 'model' })]));
  for (const body of Object.values(rows)) {
    assert.ok(Array.isArray(body.rows) && body.rows.length > 0);
    const ladder = body.rows[0].bins.map(bin => `${bin.lo}:${bin.hi ?? ''}`);
    for (const row of body.rows) assert.deepEqual(row.bins.map(bin => `${bin.lo}:${bin.hi ?? ''}`), ladder);
    assert.equal(typeof body.population.scope_n, 'number');
  }
  const first = p10Distribution({ measure: 'cost_usd', dim: 'model', from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z' });
  assert.ok(first.rows.some(row => row.unpriced > 0), 'unpriced calls are carried, not folded into the zero-cost bin');
});

test('fetchDistribution walks pages through the transport and stops on a short page', async () => {
  const seen = [];
  const transport = {
    async get(route, params, options) {
      seen.push({ route, params, options });
      return { response: { ok: true, status: 200 }, body: { rows: [], population: { grain: 'session', unit: 'call', scope_n: 0, cohort_n: 0, eligible_n: 0, returned_n: 0 } } };
    }
  };
  const params = new URLSearchParams({ measure: 'cost_usd' });
  const result = await fetchDistribution(transport, params, { tenant: 'fixture-tenant', stateKey: 'dist-ranges' });
  assert.deepEqual(result.rows, []);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].route, 'distribution');
  assert.equal(seen[0].options.tenant, 'fixture-tenant');
});

// ---------------------------------------------------------------------------
// Browser acceptance: the compare preset renders both periods, the slope is a
// two-sided change, and an all-history scope names the unsupported comparison
// instead of fetching a fake previous period.
// ---------------------------------------------------------------------------

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function openCompare(page, origin, path) {
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

test('compare renders both periods, a two-sided slope and names an unsupported all-history compare', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
    const diagnostics = await watchPage(page);
    harness.resetStats();
    await openCompare(page, harness.origin, '/b/compare?win=30d&cmp=period');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const ranges = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="dist-ranges"] yk-ranges');
      const text = document.querySelector('[data-panel="dist-ranges"]').textContent;
      return { series: chart.inspect().series.map(series => series.key), marks: chart.inspect().marks.length, text };
    });
    assert.ok(ranges.series.length > 0 && ranges.marks > 0);
    assert.match(ranges.text, /current and previous period/i);
    assert.match(ranges.text, /unpriced/i);

    const slope = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="rank"] yk-bars');
      const root = chart.shadowRoot;
      return {
        deltas: [...root.querySelectorAll('[data-delta]')].map(node => node.dataset.delta),
        strokes: [...root.querySelectorAll('[data-delta]')].map(node => node.getAttribute('stroke')),
        marks: chart.inspect().marks.length
      };
    });
    assert.ok(slope.marks >= 2);
    assert.ok(slope.deltas.includes('up') && slope.deltas.includes('down'));
    assert.ok(slope.strokes.some(stroke => /--yk-div-pos-2/.test(stroke)));
    assert.ok(slope.strokes.some(stroke => /--yk-div-neg-2/.test(stroke)));

    const requests = harness.api.state.requests.filter(item => /distribution|query/.test(item.path));
    assert.ok(requests.length > 0);
    assert.equal(requests.every(item => !/[?&]cmp=/.test(item.search)), true, 'cmp never reaches the API');

    await page.goto(`${harness.origin}/b/compare?win=all`);
    await page.waitForFunction(() => document.querySelector('[data-panel="dist-ranges"]')?.dataset.idle === 'true');
    const allHistory = await page.evaluate(() => document.querySelector('[data-panel="dist-ranges"]').textContent);
    assert.match(allHistory, /Choose a finite period to compare periods/);
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
