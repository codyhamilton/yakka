// Plan 30 phase 2 distribution unit check: the three cost distribution panels
// register their six literal captions by `scope.captionKey`, declare the P4
// Measure/Grain/Group-by intersections and per-item defaults, keep the exact
// table columns and current-before-previous order, refuse an all-history period
// compare with zero reads, say where the shared boundary belongs, and refuse an
// unsupported filter with the exact F sentence before any distribution read.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPanel } from '../../web/js/panels/registry.js';
import { captionFor } from '../../web/js/panels/captions.js';
import { COST_SPECS } from '../../web/js/panels/p10-cost.js';
import { COMPARE_SPECS } from '../../web/js/panels/p10-compare.js';
import {
  COMPRANGES_CAPTION, DIST_DIMS, DIST_GRAIN_OPTIONS, DIST_MEASURES, DIST_RANGES_CAPTION,
  DIST_RANGES_DEFAULTS, PERIOD_UNSUPPORTED, SHARED_BOUNDARY_NOTE, boxTableRows,
  distGroupOptions, distMeasureOptions, distributionSpec, orderRangeRows, rangeTableColumns,
  load as loadRanges
} from '../../web/js/panels/dist-ranges.js';
import {
  COMPHIST_CAPTION, DIST_HIST_CAPTION, DIST_HIST_DEFAULTS, groupedHistogramCharts, histogramTableColumns,
  histogramTableRows, orderHistogramCharts, load as loadHist
} from '../../web/js/panels/dist-hist.js';
import { rangePeriodStyle } from '../../web/js/charts/yk-ranges.js';
import {
  COMPECDF_CAPTION, DIST_ECDF_CAPTION, DIST_ECDF_DEFAULTS, ecdfTableColumns, ecdfTableRows,
  load as loadEcdf
} from '../../web/js/panels/dist-ecdf.js';
import { p10Distribution, p10Schema } from '../trends-quality/fixture.mjs';

const schema = p10Schema();

function fakeDoc() {
  return {
    documentElement: { dataset: {} },
    head: { append() {} },
    defaultView: null,
    querySelector() { return null; },
    createElement() {
      return {
        append() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
        replaceChildren() {}, style: {}, dataset: {}, classList: { add() {} }
      };
    }
  };
}

function transport() {
  const calls = [];
  return {
    calls,
    async schema() { return { response: { ok: true, status: 200 }, body: schema }; },
    async get(name, params) {
      calls.push({ name, params });
      const body = p10Distribution({
        measure: params.get('measure') || 'cost_usd',
        grain: params.get('grain') || 'call',
        dim: params.get('dim') || '',
        from: params.get('from') || '',
        to: params.get('to') || ''
      });
      return { response: { ok: true, status: 200 }, body };
    }
  };
}

const PANELS = [
  ['dist-ranges', loadRanges],
  ['dist-hist', loadHist],
  ['dist-ecdf', loadEcdf]
];

test('the six distribution captions are literal and selected by captionKey', () => {
  const cases = [
    ['dist-ranges', COST_SPECS['dist-ranges'], DIST_RANGES_CAPTION, 'G-ranges'],
    ['dist-ranges', COMPARE_SPECS['dist-ranges'], COMPRANGES_CAPTION, 'G-compranges'],
    ['dist-hist', COST_SPECS['dist-hist'], DIST_HIST_CAPTION, 'G-hist'],
    ['dist-hist', COMPARE_SPECS['dist-hist'], COMPHIST_CAPTION, 'G-comphist'],
    ['dist-ecdf', COST_SPECS['dist-ecdf'], DIST_ECDF_CAPTION, 'G-ecdf'],
    ['dist-ecdf', COMPARE_SPECS['dist-ecdf'], COMPECDF_CAPTION, 'G-compecdf']
  ];
  for (const [id, spec, expected, key] of cases) {
    const panel = lookupPanel(id);
    assert.ok(panel, `${id} is registered`);
    assert.equal(spec.scope.captionKey, key, `${id} names ${key}`);
    const scope = key.startsWith('G-comp') ? { cmp: 'period' } : { cmp: 'off' };
    assert.equal(captionFor(panel, spec, { scope, schema }), expected, `${id} ${key}`);
    const other = key.startsWith('G-comp') ? { cmp: 'off' } : { cmp: 'period' };
    assert.notEqual(captionFor(panel, spec, { scope: other, schema }), expected, `${id} ${key} outside its comparison mode`);
  }
});

test('P4 offers the deterministic capability intersection and keeps the G defaults', () => {
  assert.deepEqual(DIST_GRAIN_OPTIONS.map(option => [option.value, option.label]), [
    ['call', 'Model call'], ['conversation', 'Session']
  ]);
  assert.deepEqual(distMeasureOptions(schema), DIST_MEASURES);
  assert.deepEqual(distGroupOptions(schema), DIST_DIMS);

  const cases = [
    [{}, DIST_RANGES_DEFAULTS, 'conversation', 'session_repo'],
    [{}, DIST_HIST_DEFAULTS, 'call', 'harness'],
    [{}, DIST_ECDF_DEFAULTS, 'conversation', 'model'],
    [COST_SPECS['dist-ranges'], DIST_RANGES_DEFAULTS, 'conversation', 'session_repo'],
    [COST_SPECS['dist-hist'], DIST_HIST_DEFAULTS, 'call', 'harness'],
    [COST_SPECS['dist-ecdf'], DIST_ECDF_DEFAULTS, 'conversation', 'model'],
    [COMPARE_SPECS['dist-ranges'], DIST_RANGES_DEFAULTS, 'call', 'model'],
    [COMPARE_SPECS['dist-hist'], DIST_HIST_DEFAULTS, 'call', 'model'],
    [COMPARE_SPECS['dist-ecdf'], DIST_ECDF_DEFAULTS, 'call', 'model']
  ];
  for (const [spec, defaults, grain, dim] of cases) {
    const resolved = distributionSpec(spec, defaults);
    assert.equal(resolved.ok, true, `${grain}/${dim}`);
    assert.equal(resolved.grain, grain);
    assert.equal(resolved.dim, dim);
  }

  const invalid = distributionSpec({ scope: { grain: 'call', dim: 'session_repo' } }, DIST_RANGES_DEFAULTS);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.try, 'conversation');
});

test('the exact table columns keep group ascending and current before previous', () => {
  assert.deepEqual(rangeTableColumns(), [
    'Group', 'Period', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter',
    '95th percentile', 'Maximum', 'Count', 'Unpriced'
  ]);
  assert.deepEqual(histogramTableColumns('USD'), ['Group', 'Period', 'From (USD)', 'To (USD)', 'Count', 'Unpriced']);
  assert.deepEqual(ecdfTableColumns('USD'), ['Group', 'Period', 'Bin upper edge (USD)', 'Cumulative count', 'Cumulative share (%)']);

  const row = (group, period) => ({ group, period, n: 1, unpriced: 0, values: { min: 0, q1: 1, median: 2, q3: 3, p95: 4, max: 5 } });
  const ranges = orderRangeRows([
    row('gpt', 'current'), row('claude', 'current'), row('gpt', 'previous'), row('claude', 'previous')
  ]);
  assert.deepEqual(ranges.map(item => `${item.group}/${item.period}`), [
    'claude/current', 'claude/previous', 'gpt/current', 'gpt/previous'
  ]);
  assert.deepEqual(boxTableRows(ranges)[0], ['claude', 'current', '0', '1', '2', '3', '4', '5', '1', '0']);

  const bin = { from: 0, to: 0.5 };
  const chart = (group, period) => ({ group, period, unpriced: 2, rows: [{ bin, values: { count: 3 }, n: 3 }] });
  const hist = orderHistogramCharts([
    chart('gpt', 'current'), chart('claude', 'current'), chart('gpt', 'previous'), chart('claude', 'previous')
  ]);
  assert.deepEqual(hist.map(item => `${item.group}/${item.period}`), [
    'claude/current', 'claude/previous', 'gpt/current', 'gpt/previous'
  ]);
  assert.deepEqual(histogramTableRows(hist)[0], ['claude', 'current', '0', '0.5', '3', '2']);

  const ecdf = ecdfTableRows([
    { group: 'gpt', period: 'current', bins: [{ lo: 0, hi: 0.5, n: 1 }, { lo: 0.5, hi: 1, n: 1 }] },
    { group: 'claude', period: 'previous', bins: [{ lo: 0, hi: 0.5, n: 2 }] },
    { group: 'claude', period: 'current', bins: [{ lo: 0, hi: 0.5, n: 4 }] }
  ]);
  assert.deepEqual(ecdf.map(item => `${item[0]}/${item[1]}/${item[2]}/${item[3]}/${item[4]}`), [
    'claude/current/0.5/4/100', 'claude/previous/0.5/2/100', 'gpt/current/0.5/1/50', 'gpt/current/1/2/100'
  ]);
});

test('G-comphist groups current and previous into one chart with aligned series', () => {
  const bins = [{ from: 0, to: 1 }, { from: 1, to: 2 }];
  const grouped = groupedHistogramCharts([
    { group: 'gpt', period: 'current', n: 4, rows: [{ values: { count: 3 } }, { values: { count: 1 } }] },
    { group: 'gpt', period: 'previous', n: 2, rows: [{ values: { count: 2 } }, { values: { count: 0 } }] },
    { group: 'claude', period: 'current', n: 1, rows: [{ values: { count: 1 } }, { values: { count: 0 } }] }
  ], bins);
  assert.deepEqual(grouped.map(chart => chart.group), ['gpt', 'claude']);
  assert.deepEqual(grouped[0].series.map(series => [series.key, series.align, series.outline === true]), [
    ['current', -1, false], ['previous', 1, true]
  ]);
  assert.deepEqual(grouped[0].rows.map(row => [row.x, row.values.current, row.values.previous]), [
    [0, 3, 2], [1, 1, 0]
  ]);
  assert.deepEqual(grouped[0].bins, bins);
  assert.deepEqual(grouped[1].rows.map(row => row.values.previous), [null, null], 'a missing previous period is not a fake zero');
});

test('G-compranges keeps the current row solid and the previous row dashed', () => {
  assert.equal(rangePeriodStyle('current').dash, null);
  assert.equal(rangePeriodStyle('current').fillOpacity, 0.35);
  assert.equal(rangePeriodStyle('previous').dash, '6 4');
  assert.equal(rangePeriodStyle('previous').fillOpacity, 0);
  assert.equal(rangePeriodStyle('previous').previous, true);
});

test('the G defaults reach the wire for Cost and Compare', async () => {
  const cases = [
    ['dist-ranges', loadRanges, COST_SPECS['dist-ranges'], 'conversation', 'session_repo'],
    ['dist-hist', loadHist, COST_SPECS['dist-hist'], 'call', 'harness'],
    ['dist-ecdf', loadEcdf, COST_SPECS['dist-ecdf'], 'conversation', 'model'],
    ['dist-ranges', loadRanges, COMPARE_SPECS['dist-ranges'], 'call', 'model'],
    ['dist-hist', loadHist, COMPARE_SPECS['dist-hist'], 'call', 'model'],
    ['dist-ecdf', loadEcdf, COMPARE_SPECS['dist-ecdf'], 'call', 'model']
  ];
  for (const [id, loader, spec, grain, dim] of cases) {
    const server = transport();
    const scope = { win: '30d', ...spec.scope };
    const result = await loader({ scope, spec, schema, transport: server, tenant: 'tenant-b', doc: fakeDoc() });
    assert.equal(result.state, 'ready', `${id} settled (${result.state})`);
    const call = server.calls.find(item => item.name === 'distribution');
    assert.ok(call, `${id} read /distribution`);
    assert.equal(call.params.get('measure'), 'cost_usd');
    assert.equal(call.params.get('grain'), grain);
    assert.equal(call.params.get('dim'), dim);
  }
});

test('an all-history period compare refuses with zero reads and states the shared boundary', async () => {
  for (const [id, loader] of PANELS) {
    const server = transport();
    const result = await loader({
      scope: { win: 'all', cmp: 'period' }, spec: COMPARE_SPECS[id], schema,
      transport: server, tenant: 'tenant-b', doc: fakeDoc()
    });
    assert.equal(result.state, 'unsupported', `${id} refuses all history`);
    assert.equal(result.reason, PERIOD_UNSUPPORTED);
    assert.equal(server.calls.length, 0, `${id} fetched nothing`);
  }
  assert.equal(SHARED_BOUNDARY_NOTE, 'An event exactly at the shared boundary belongs to both periods.');
  const server = transport();
  const result = await loadRanges({
    scope: { win: '30d', cmp: 'period' }, spec: COMPARE_SPECS['dist-ranges'], schema,
    transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.state, 'ready');
  assert.match(result.basis, /shared boundary belongs to both periods/);
});

test('kind and the other unsupported distribution filters refuse before any read', async () => {
  for (const [id, loader] of PANELS) {
    for (const [key, label] of [['kind', 'document kind'], ['plan', 'plan'], ['tool', 'tool'], ['source', 'source']]) {
      const server = transport();
      const result = await loader({
        scope: { win: '30d', [key]: ['x'], ...COST_SPECS[id].scope }, spec: COST_SPECS[id], schema,
        transport: server, tenant: 'tenant-b', doc: fakeDoc()
      });
      assert.equal(result.state, 'unsupported', `${id} refuses ${key}`);
      assert.equal(result.applicability, true, `${id} ${key} is an applicability refusal`);
      assert.equal(result.message, `This chart cannot apply ${label}. Change the filters to view it.`, `${id} ${key}`);
      assert.equal(server.calls.length, 0, `${id} ${key} fetched no distribution`);
    }
  }
});
