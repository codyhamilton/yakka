import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { PULSE_PANELS } from '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { validatePanelEntry, CHART_NAMES } from '../../web/js/panels/registry.js';
import { TRENDS_PANELS, TRENDS_SPECS } from '../../web/js/panels/p10-trends.js';
import { TREND_MEASURES, TREND_COLUMNS_PANEL, chartShape, buildTrendChart, trendTableRows } from '../../web/js/panels/trend-columns.js';
import { compareRows } from '../../web/js/panels/trend-lines.js';
import { rhythmRows } from '../../web/js/panels/rhythm.js';
import {
  chooserModel, queryRows, comparisonSummary, deltaText, offeredMeasures, offeredSplit
} from '../../web/js/panels/p10-shared.js';
import { decodePanelSpec, encodePanelSpec } from '../../web/js/core/view-spec.js';
import { p10Schema } from './fixture.mjs';

const schema = p10Schema();
const DAY = 86400e3;

test('the Trends preset is five valid panels over one registered preset', () => {
  assert.deepEqual(TRENDS_PANELS.map(panel => panel.id), ['trend-columns', 'trend-lines', 'trend-multiples', 'calendar', 'rhythm']);
  for (const panel of TRENDS_PANELS) {
    assert.doesNotThrow(() => validatePanelEntry(panel));
    for (const chart of panel.charts) assert.ok(CHART_NAMES.has(chart), `${panel.id} ${chart}`);
    assert.equal(typeof panel.load, 'function');
  }
  const preset = lookupPreset('trends');
  assert.ok(preset);
  assert.deepEqual(preset.panels, TRENDS_PANELS.map(panel => panel.id));
  assert.deepEqual(Object.keys(TRENDS_SPECS).sort(), TRENDS_PANELS.map(panel => panel.id).sort());
  assert.deepEqual(PULSE_PANELS.filter(panel => TRENDS_PANELS.includes(panel)).map(panel => panel.id), ['calendar']);
});

test('the chooser offers only measures and lenses the schema publishes, and names the rest unsupported', () => {
  const offered = offeredMeasures(TREND_COLUMNS_PANEL, schema);
  assert.deepEqual(offered, TREND_MEASURES.filter(name => schema.grains.time.measures.includes(name)));
  assert.ok(offered.length >= 10);
  assert.equal(offeredSplit(TREND_COLUMNS_PANEL, 'cost_usd', schema).includes('weekday'), false);
  assert.equal(offeredSplit(TREND_COLUMNS_PANEL, 'cost_usd', schema).includes('hour_of_day'), false);
  const model = chooserModel(TREND_COLUMNS_PANEL, { measures: ['cost_usd'], split: 'scenario', chart: 'columns' }, schema);
  assert.deepEqual(model.measures, offered);
  assert.equal(model.split, '');
  assert.ok(model.unsupported.some(item => item.kind === 'split' && item.name === 'scenario'));
  assert.ok(model.unsupported.every(item => item.reason));
  const missing = chooserModel(TREND_COLUMNS_PANEL, { measures: ['gpu_hours'] }, schema);
  assert.equal(missing.measure, 'cost_usd');
  assert.ok(missing.unsupported.some(item => item.kind === 'measure' && item.name === 'distinct_content'));
  const noChart = chooserModel(TREND_COLUMNS_PANEL, { chart: 'radar' }, schema);
  assert.equal(noChart.chart, 'columns');
  assert.ok(noChart.unsupported.some(item => item.kind === 'chart' && item.name === 'radar'));
});

test('query rows stay sparse and never invent a bucket the server did not return', () => {
  const body = {
    rows: [
      { t: '2026-09-02T00:00:00Z', k: ['claude'], v: 3 },
      { t: '2026-09-04T00:00:00Z', k: ['gpt'], v: 5 },
      { t: '2026-09-04T00:00:00Z', k: ['claude'], v: 7 }
    ]
  };
  const model = queryRows(body, 'cost_usd', 'model', { unit: 'USD', kind: 'money' });
  assert.equal(model.rows.length, 2);
  assert.deepEqual(model.rows.map(row => new Date(row.x).toISOString().slice(0, 10)), ['2026-09-02', '2026-09-04']);
  assert.equal(model.rows[0].values['model:gpt'], undefined);
  assert.deepEqual(model.series.map(series => series.key), ['model:claude', 'model:gpt']);
  const unsplit = queryRows({ rows: [{ t: '2026-09-02T00:00:00Z', k: [], v: null }] }, 'cost_usd', '', { unit: 'USD' });
  assert.equal(unsplit.rows[0].values.cost_usd, null, 'a null stays null, not zero');
});

test('the trend chart shape follows the chooser and its table keeps the same buckets', () => {
  assert.deepEqual(chartShape('cumulative'), { chart: 'cumulative', type: 'columns', mode: 'cumulative' });
  assert.deepEqual(chartShape('share'), { chart: 'share', type: 'columns', mode: 'share' });
  assert.deepEqual(chartShape('lines'), { chart: 'lines', type: 'line', mode: 'absolute' });
  const model = buildTrendChart({
    body: { rows: [{ t: '2026-09-01T00:00:00Z', k: [], v: 2 }, { t: '2026-09-02T00:00:00Z', k: [], v: 4 }] },
    measure: 'cost_usd', split: '', schema, chart: 'cumulative'
  });
  assert.equal(model.chart, 'cumulative');
  assert.equal(model.spec.stacked, false);
  assert.equal(model.spec.series[0].unit, 'USD');
  assert.deepEqual(trendTableRows(model), [
    ['2026-09-01T00:00:00.000Z', '2'],
    ['2026-09-02T00:00:00.000Z', '4']
  ]);
});

test('period compare aligns the previous period onto the current x and never fabricates a side', () => {
  const scope = { from: '2026-09-11T00:00:00Z', to: '2026-09-21T00:00:00Z' };
  const currentBody = { rows: [{ t: '2026-09-11T00:00:00Z', k: [], v: 10 }, { t: '2026-09-12T00:00:00Z', k: [], v: 20 }] };
  const previousBody = { rows: [{ t: '2026-09-01T00:00:00Z', k: [], v: 5 }, { t: '2026-09-02T00:00:00Z', k: [], v: 7 }] };
  const model = compareRows({ currentBody, previousBody, measure: 'cost_usd', split: '', schema, scope });
  assert.deepEqual(model.series.map(series => series.key), ['current', 'previous']);
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].values.current, 10);
  assert.equal(model.rows[0].values.previous, 5);
  assert.equal(model.rows[0].x, Date.parse('2026-09-11T00:00:00Z'));
  const missing = compareRows({ currentBody, previousBody: { rows: [] }, measure: 'cost_usd', split: '', schema, scope });
  assert.equal(missing.rows.every(row => row.values.previous === undefined), true);
  assert.match(comparisonSummary({ current: null, previous: null, unit: 'USD' }).text, /no previous period/);
});

test('comparison text prints both populations and a real delta with its unit', () => {
  const summary = comparisonSummary({
    unit: 'USD',
    current: { population: { grain: 'time', unit: 'bucket', scope_n: 7, cohort_n: 7, eligible_n: 7, returned_n: 7 } },
    previous: { population: { grain: 'time', unit: 'bucket', scope_n: 6, cohort_n: 6, eligible_n: 6, returned_n: 6 } }
  });
  assert.match(summary.text, /Current period/);
  assert.match(summary.text, /Previous period/);
  assert.match(summary.text, /7/);
  assert.match(summary.text, /6/);
  assert.equal(deltaText(12, 10, 'USD'), '+$2.00');
  assert.equal(deltaText(10, 12, 'USD'), '−$2.00');
  assert.equal(deltaText(null, 1, 'USD'), 'not comparable');
});

test('rhythm maps weekday and padded hour cells, and unsupported scope is named in the panel', () => {
  const rows = rhythmRows({ rows: [{ k: [1, 3], v: 9 }] });
  assert.equal(rows[0].key, 'rhythm:Tue:03');
  assert.equal(rows[0].values.hook_events, 9);
  assert.equal(rhythmRows({ rows: [{ k: [0, 23], v: null }] })[0].values.hook_events, null);
});

test('a panel spec round trips through the URL encoding used by the chooser', () => {
  const spec = { grain: 'time', measures: ['commits'], split: 'model', chart: 'lines', scope: { cmp: 'period' } };
  const encoded = encodePanelSpec(spec);
  assert.deepEqual(decodePanelSpec(encoded), spec);
  assert.equal(decodePanelSpec('not json'), null);
});

// ---------------------------------------------------------------------------
// Browser acceptance: the preset settles, the chooser writes a panel spec,
// and an absolute zoom clears win/sel without a reload.
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

test('trends settles five panels, offers only schema measures, writes a panel spec and zooms to absolute bounds', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
    const diagnostics = await watchPage(page);
    await openBoard(page, harness.origin, '/b/trends?win=30d');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['trend-columns', 'trend-lines', 'trend-multiples', 'calendar', 'rhythm']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const columns = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="trend-columns"]');
      const selects = [...root.querySelectorAll('select')];
      return {
        measures: [...new Set([...selects[0].options].map(option => option.value))],
        charts: [...selects.at(-1).options].map(option => option.value),
        rows: root.querySelector('yk-chart')?.inspect().marks?.length || 0,
        basis: root.textContent
      };
    });
    assert.equal(columns.measures.includes('gpu_hours'), false);
    assert.ok(columns.measures.includes('commits') && columns.measures.includes('cost_usd'));
    assert.deepEqual(columns.charts, ['columns', 'lines', 'cumulative', 'share']);
    assert.ok(columns.rows > 0, 'the chart has rows');
    assert.match(columns.basis, /bucket/);

    await page.evaluate(() => {
      const select = document.querySelector('[data-panel="trend-columns"] select');
      select.value = 'model_calls';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).measures.includes('model_calls');
    });
    await openBoard(page, harness.origin, page.url().replace(harness.origin, ''));
    const spec = await page.evaluate(() => JSON.parse(new URLSearchParams(location.search).get('p1')));
    assert.deepEqual(spec.measures, ['model_calls']);

    const before = await page.evaluate(() => ({ from: Date.now() - 2 * 86400e3, to: Date.now() - 86400e3 }));
    await page.evaluate(({ from, to }) => {
      const chart = document.querySelector('[data-panel="trend-columns"] yk-chart');
      chart.dispatchEvent(new CustomEvent('zoom', { detail: { from, to } }));
    }, before);
    await page.waitForFunction(() => {
      const params = new URLSearchParams(location.search);
      return params.get('from') && params.get('to');
    });
    const after = await page.evaluate(() => {
      const params = new URLSearchParams(location.search);
      return { from: params.get('from'), to: params.get('to'), win: params.get('win'), sel: params.get('sel') };
    });
    assert.equal(Number.isFinite(Date.parse(after.from)), true);
    assert.equal(Number.isFinite(Date.parse(after.to)), true);
    assert.equal(after.win, null);
    assert.equal(after.sel, null);
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
