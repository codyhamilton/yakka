// Plan 30 phase 2 Trends/Cost unit check: every G item registers its literal
// caption through the shared registry, declares the exact table columns, keeps
// its fixed defaults on the wire, and refuses an unsupported filter with the
// exact F sentence before any read. Pure module and loader checks.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPanel } from '../../web/js/panels/registry.js';
import { captionFor } from '../../web/js/panels/captions.js';
import { TRENDS_SPECS } from '../../web/js/panels/p10-trends.js';
import { COST_SPECS } from '../../web/js/panels/p10-cost.js';
import { COMPARE_SPECS } from '../../web/js/panels/p10-compare.js';
import { TOOLS_SPECS } from '../../web/js/panels/p10-tools.js';
import { WORKFLOW_SPECS } from '../../web/js/panels/p12-workflow.js';
import {
  CUMULATIVE_REFUSAL, TREND_COLUMNS_CAPTION, TREND_COLUMNS_PANEL, chooseColumnsSpec,
  trendTableColumns, load as loadColumns
} from '../../web/js/panels/trend-columns.js';
import {
  TREND_LINES_CAPTION, TREND_COMPLINES_CAPTION, compareRows, load as loadLines
} from '../../web/js/panels/trend-lines.js';
import {
  TREND_MULTIPLES_CAPTION, multiplesTableColumns, multiplesYRange, load as loadMultiples
} from '../../web/js/panels/trend-multiples.js';
import { RHYTHM_CAPTION, RHYTHM_TABLE_COLUMNS, load as loadRhythm } from '../../web/js/panels/rhythm.js';
import {
  RANK_CAPTION, TOOLS_RANK_CAPTION, PLAN_RANK_CAPTION, SLOPE_CAPTION,
  rankTableColumns, slopeTableColumns, planRankTableColumns, planRankOverlap, load as loadRank
} from '../../web/js/panels/rank.js';
import {
  COSTMAP_CAPTION, TOOLSMAP_CAPTION, TOOLSMAP_CATEGORY_CAPTION,
  treemapTableColumns, load as loadTreemap
} from '../../web/js/panels/treemap.js';
import { p10Schema } from '../trends-quality/fixture.mjs';

const schema = p10Schema();

const CAPTIONS = {
  'trend-columns': TREND_COLUMNS_CAPTION,
  'trend-lines': TREND_LINES_CAPTION,
  'trend-multiples': TREND_MULTIPLES_CAPTION,
  rhythm: RHYTHM_CAPTION,
  rank: RANK_CAPTION,
  treemap: COSTMAP_CAPTION
};

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

function transport({ body = { rows: [], population: null }, schemaValue = schema } = {}) {
  const calls = [];
  return {
    calls,
    async schema() { return { response: { ok: true, status: 200 }, body: schemaValue }; },
    async get(name, params) {
      calls.push({ name, params });
      return { response: { ok: true, status: 200 }, body };
    }
  };
}

function schemaWithoutRepo() {
  const clone = p10Schema();
  const hook = clone.measures.find(measure => measure.name === 'hook_events');
  hook.dims = hook.dims.filter(dim => dim !== 'repo_id');
  return clone;
}

test('the eleven G captions are literal and selected by captionKey', () => {
  const cases = [
    ['trend-columns', TRENDS_SPECS['trend-columns'], {}, CAPTIONS['trend-columns']],
    ['trend-lines', TRENDS_SPECS['trend-lines'], { scope: {} }, CAPTIONS['trend-lines']],
    ['trend-lines', COMPARE_SPECS['trend-lines'], { scope: COMPARE_SPECS['trend-lines'].scope }, TREND_COMPLINES_CAPTION],
    ['trend-multiples', TRENDS_SPECS['trend-multiples'], {}, CAPTIONS['trend-multiples']],
    ['rhythm', TRENDS_SPECS.rhythm, {}, CAPTIONS.rhythm],
    ['rank', COST_SPECS.rank, {}, CAPTIONS.rank],
    ['treemap', COST_SPECS.treemap, {}, CAPTIONS.treemap],
    ['treemap', TOOLS_SPECS.treemap, { result: { child: 'tool' } }, TOOLSMAP_CAPTION],
    ['treemap', TOOLS_SPECS.treemap, { result: { child: 'tool_kind' } }, TOOLSMAP_CATEGORY_CAPTION],
    ['rank', TOOLS_SPECS.rank, {}, TOOLS_RANK_CAPTION],
    ['rank', WORKFLOW_SPECS.rank, { scope: { grain: 'plan' } }, PLAN_RANK_CAPTION],
    ['rank', COMPARE_SPECS.rank, { scope: COMPARE_SPECS.rank.scope }, SLOPE_CAPTION]
  ];
  for (const [id, spec, context, expected] of cases) {
    const panel = lookupPanel(id);
    assert.ok(panel, `${id} is registered`);
    assert.equal(spec.scope.captionKey.includes('G-'), true, `${id} names a G key`);
    assert.equal(captionFor(panel, spec, { schema, ...context }), expected, `${id} ${spec.scope.captionKey}`);
  }
});

test('fixed defaults and exact table column lists', () => {
  assert.deepEqual(TREND_COLUMNS_PANEL.charts, ['columns', 'lines', 'area']);
  assert.deepEqual(TRENDS_SPECS['trend-columns'], { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'columns', scope: { captionKey: 'G-columns' } });
  assert.deepEqual(TRENDS_SPECS['trend-lines'].measures, ['cost_usd']);
  assert.equal(TRENDS_SPECS['trend-lines'].split, 'model');
  assert.equal(TRENDS_SPECS['trend-lines'].chart, 'lines');
  assert.deepEqual(lookupPanel('trend-multiples').charts, ['lines']);
  assert.deepEqual(lookupPanel('rhythm').measures, ['hook_events']);
  assert.deepEqual(lookupPanel('rhythm').charts, ['heatmap']);
  assert.equal(LOOKUP_TREES('cost').split, 'model');
  assert.equal(LOOKUP_TREES('cost').scope.parent, 'harness');
  assert.equal(LOOKUP_TREES('tools').measures[0], 'hook_events');
  assert.equal(LOOKUP_TREES('tools').split, 'tool');
  assert.equal(WORKFLOW_SPECS.rank.grain, 'plan');
  assert.deepEqual(WORKFLOW_SPECS.rank.measures, ['associated_cost_usd']);
  assert.equal(COMPARE_SPECS.rank.chart, 'slope');
  assert.deepEqual(trendTableColumns('USD'), ['Bucket', 'Group', 'Value (USD)']);
  assert.deepEqual(multiplesTableColumns('USD'), ['Group', 'Bucket', 'Value (USD)']);
  assert.deepEqual(RHYTHM_TABLE_COLUMNS, ['Weekday (Mon=1)', 'Hour (0–23)', 'Hook events']);
  assert.deepEqual(rankTableColumns('USD'), ['Group', 'Value (USD)']);
  assert.deepEqual(slopeTableColumns('USD'), ['Group', 'Previous (USD)', 'Current (USD)', 'Change (USD)']);
  assert.deepEqual(planRankTableColumns('USD'), ['Group', 'Value (USD)']);
  assert.deepEqual(treemapTableColumns('USD'), ['Parent', 'Child', 'Value (USD)']);
  assert.deepEqual(treemapTableColumns('events'), ['Parent', 'Child', 'Value (events)']);
});

function LOOKUP_TREES(name) {
  return name === 'cost' ? COST_SPECS.treemap : TOOLS_SPECS.treemap;
}

test('defaults reach the wire as the G contracts require', async () => {
  const cases = [
    ['trend-columns', loadColumns, TRENDS_SPECS['trend-columns'], params => {
      assert.equal(params.get('measure'), 'cost_usd');
      assert.deepEqual(params.getAll('dim'), ['model']);
      assert.equal(params.get('bucket'), 'auto');
    }],
    ['trend-lines', loadLines, TRENDS_SPECS['trend-lines'], params => {
      assert.equal(params.get('measure'), 'cost_usd');
      assert.deepEqual(params.getAll('dim'), ['model']);
      assert.equal(params.get('bucket'), 'auto');
    }],
    ['trend-multiples', loadMultiples, TRENDS_SPECS['trend-multiples'], params => {
      assert.equal(params.get('measure'), 'cost_usd');
      assert.deepEqual(params.getAll('dim'), ['model']);
      assert.equal(params.get('bucket'), 'auto');
    }],
    ['rhythm', loadRhythm, TRENDS_SPECS.rhythm, params => {
      assert.equal(params.get('measure'), 'hook_events');
      assert.deepEqual(params.getAll('dim'), ['weekday', 'hour_of_day']);
      assert.equal(params.get('bucket'), 'none');
    }],
    ['rank', loadRank, COST_SPECS.rank, params => {
      assert.equal(params.get('measure'), 'cost_usd');
      assert.deepEqual(params.getAll('dim'), ['model']);
      assert.equal(params.get('bucket'), 'none');
    }],
    ['treemap', loadTreemap, COST_SPECS.treemap, params => {
      assert.equal(params.get('measure'), 'cost_usd');
      assert.deepEqual(params.getAll('dim'), ['harness', 'model']);
      assert.equal(params.get('bucket'), 'none');
    }],
    ['tools treemap', loadTreemap, TOOLS_SPECS.treemap, params => {
      assert.equal(params.get('measure'), 'hook_events');
      assert.deepEqual(params.getAll('dim'), ['harness', 'tool']);
      assert.equal(params.get('bucket'), 'none');
    }],
    ['tools rank', loadRank, TOOLS_SPECS.rank, params => {
      assert.equal(params.get('measure'), 'hook_events');
      assert.deepEqual(params.getAll('dim'), ['tool']);
      assert.equal(params.get('bucket'), 'none');
    }]
  ];
  for (const [name, loader, spec, check] of cases) {
    const server = transport();
    const result = await loader({ scope: { win: '30d' }, spec, schema, transport: server, tenant: 'tenant-b', doc: fakeDoc() });
    assert.ok(['ready', 'empty'].includes(result.state), `${name} settled (${result.state})`);
    const query = server.calls.find(call => call.name === 'query');
    assert.ok(query, `${name} queried`);
    check(query.params);
  }

  const planServer = transport();
  await loadRank({ scope: { win: 'all' }, spec: WORKFLOW_SPECS.rank, schema, transport: planServer, tenant: 'tenant-b', doc: fakeDoc() });
  const entities = planServer.calls.find(call => call.name === 'entities');
  assert.ok(entities, 'plan rank used the entities route');
  assert.equal(entities.params.get('grain'), 'plan');
  assert.equal(entities.params.get('sort'), 'associated_cost_usd:desc');
});

test('an unsupported filter is refused before any read with the exact F sentence', async () => {
  const noRepo = schemaWithoutRepo();
  const server = transport({ schemaValue: noRepo });
  const result = await loadColumns({
    scope: { win: '30d', repo_id: ['repo-a'] },
    spec: { ...TRENDS_SPECS['trend-columns'], measures: ['hook_events'], split: 'model' },
    schema: noRepo, transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.applicability, true);
  assert.equal(result.message, 'This chart cannot apply repository. Change the filters to view it.');
  assert.equal(server.calls.length, 0, 'no marks and no query');

  const tools = transport({ schemaValue: noRepo });
  const toolsResult = await loadTreemap({
    scope: { win: '30d', repo_id: ['repo-a'] }, spec: TOOLS_SPECS.treemap,
    schema: noRepo, transport: tools, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(toolsResult.message, 'This chart cannot apply repository. Change the filters to view it.');
  assert.equal(tools.calls.length, 0, 'tools treemap fetched no data');
});

test('cumulative deep links refuse with the exact sentence and choose columns', async () => {
  const server = transport();
  const result = await loadColumns({
    scope: { win: '30d' }, spec: { ...TRENDS_SPECS['trend-columns'], chart: 'cumulative' },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.refused, 'cumulative');
  assert.equal(result.message, CUMULATIVE_REFUSAL);
  assert.equal(server.calls.length, 0);
  const chosen = chooseColumnsSpec({ ...TRENDS_SPECS['trend-columns'], chart: 'cumulative' });
  assert.equal(chosen.chart, 'columns');
  assert.deepEqual(chosen.measures, ['cost_usd']);
  assert.equal(chosen.split, 'model');

  const lines = await loadLines({
    scope: { win: '30d' }, spec: { ...TRENDS_SPECS['trend-lines'], chart: 'share' },
    schema, transport: transport(), tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(lines.message, CUMULATIVE_REFUSAL);
});

test('slope refuses without cmp=period and a finite window', async () => {
  const server = transport();
  const result = await loadRank({
    scope: { win: '30d' }, spec: { ...COST_SPECS.rank, chart: 'slope' },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.reason, 'Choose a finite period to compare periods.');
  assert.equal(server.calls.length, 0);

  const all = transport();
  const allResult = await loadRank({
    scope: { win: 'all', cmp: 'period' }, spec: COMPARE_SPECS.rank,
    schema, transport: all, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(allResult.reason, 'Choose a finite period to compare periods.');
  assert.equal(all.calls.length, 0);
});

test('small multiples share one Y domain across every group and both periods', () => {
  const charts = [
    {
      groupKey: 'alpha',
      series: [{ key: 'current' }, { key: 'previous' }],
      rows: [
        { values: { current: 3, previous: 5 } },
        { values: { current: 1, previous: null } }
      ]
    },
    {
      groupKey: 'beta',
      series: [{ key: 'current' }, { key: 'previous' }],
      rows: [{ values: { current: 9, previous: 2 } }]
    }
  ];
  assert.deepEqual(multiplesYRange(charts), { min: 0, max: 9 });
  assert.equal(multiplesYRange([{ series: [{ key: 'x' }], rows: [{ values: { x: null } }] }]), null);
});

test('the previous compare line is dashed for G-complines', () => {
  const measured = compareRows({
    currentBody: { rows: [{ t: '2026-09-10T00:00:00Z', k: [], v: 2 }] },
    previousBody: { rows: [{ t: '2026-08-10T00:00:00Z', k: [], v: 1 }] },
    measure: 'cost_usd',
    split: '',
    schema,
    scope: { win: '30d' }
  });
  assert.deepEqual(measured.series.map(series => [series.key, series.dash ?? 'solid']), [
    ['current', 'solid'], ['previous', 'dashed']
  ]);
});

test('plan rank keeps its non-additive and lower-bound language', () => {
  assert.match(PLAN_RANK_CAPTION, /shared sessions can contribute to more than one plan/);
  assert.match(PLAN_RANK_CAPTION, /do not add the bars/);
  const overlap = planRankOverlap([
    { values: { shared_sessions: 2 }, lowerBound: true },
    { values: { shared_sessions: 0 }, allUnpriced: true }
  ]);
  assert.match(overlap.text, /overlaps across plans/);
  assert.match(overlap.lowerText, /lower bounds/);
  assert.match(overlap.unpricedText, /all unpriced/);
});
