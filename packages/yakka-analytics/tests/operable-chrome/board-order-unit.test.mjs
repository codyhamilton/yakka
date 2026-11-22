// Plan 30 phase 2 board assembly unit check: every preset names its panels in
// the exact S-screen DOM order and carries the G-item defaults plus a literal
// caption key, the two-column span map implements the full-width and odd-final
// rules, and the caption key never reaches a request URL.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { assembleBoard, boardSpans } from '../../web/js/boards/board.js';
import { requestParams } from '../../web/js/panels/p10-shared.js';

const ORDER = {
  pulse: ['pulse-strips', 'river', 'movers', 'calendar', 'coverage'],
  trends: ['trend-columns', 'trend-lines', 'trend-multiples', 'calendar', 'rhythm'],
  cost: ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf'],
  quality: ['score-ranges', 'score-trend', 'score-strips', 'band-mix'],
  tools: ['mix', 'treemap', 'rank', 'rhythm'],
  workflow: ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river'],
  compare: ['dist-ranges', 'dist-hist', 'dist-ecdf', 'trend-lines', 'rank'],
  scatter: ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']
};

const CAPTIONS = {
  pulse: { 'pulse-strips': 'G-metrics', river: 'G-activity', movers: 'G-movers', calendar: 'G-calendar', coverage: 'G-coverage' },
  trends: { 'trend-columns': 'G-columns', 'trend-lines': 'G-lines', 'trend-multiples': 'G-multiples', calendar: 'G-calendar', rhythm: 'G-rhythm' },
  cost: { 'trend-columns': 'G-columns', rank: 'G-rank', treemap: 'G-costmap', 'dist-ranges': 'G-ranges', 'dist-hist': 'G-hist', 'dist-ecdf': 'G-ecdf' },
  quality: { 'score-ranges': 'G-scores', 'score-trend': 'G-scoretrend', 'score-strips': 'G-strips', 'band-mix': 'G-bands' },
  tools: { mix: 'G-mix', treemap: 'G-toolsmap', rank: 'G-toolsrank', rhythm: 'G-rhythm' },
  workflow: { 'shape-bars': 'G-shapes', 'plan-timeline': 'G-planline', rank: 'G-planrank', 'scatter-plan': 'G-planxy', river: 'G-activity' },
  compare: { 'dist-ranges': 'G-compranges', 'dist-hist': 'G-comphist', 'dist-ecdf': 'G-compecdf', 'trend-lines': 'G-complines', rank: 'G-slope' },
  scatter: { 'scatter-session': 'G-sessionxy', 'scatter-artifact': 'G-artifactxy', 'scatter-plan': 'G-planxy', 'scatter-day': 'G-dayxy' }
};

const FULL_WIDTH = {
  pulse: ['pulse-strips'], trends: [], cost: [], quality: [], tools: [], workflow: ['river'], compare: ['rank'], scatter: []
};

test('all eight presets name their panels in the exact S-screen order', () => {
  for (const [id, expected] of Object.entries(ORDER)) {
    const preset = lookupPreset(id);
    assert.ok(preset, `${id} preset is registered`);
    assert.deepEqual(preset.panels, expected, `${id} DOM order`);
  }
});

test('every preset spec is the G-item default and carries its literal caption key', () => {
  for (const [id, order] of Object.entries(ORDER)) {
    const preset = lookupPreset(id);
    for (const panelId of order) {
      const spec = preset.specs?.[panelId];
      assert.ok(spec, `${id}/${panelId} has a starting spec`);
      assert.equal(spec.scope?.captionKey, CAPTIONS[id][panelId], `${id}/${panelId} caption key`);
    }
  }

  const trends = lookupPreset('trends').specs;
  assert.deepEqual(trends['trend-columns'], { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'columns', scope: { captionKey: 'G-columns' } });
  assert.equal(trends['trend-lines'].chart, 'lines');
  assert.equal(trends['trend-multiples'].chart, 'lines');
  assert.deepEqual(trends.calendar.measures, ['cost_usd']);
  assert.deepEqual(trends.rhythm.measures, ['hook_events']);

  const cost = lookupPreset('cost').specs;
  assert.equal(cost.rank.chart, 'rank');
  assert.equal(cost.rank.split, 'model');
  assert.equal(cost.treemap.chart, 'treemap');
  assert.equal(cost.treemap.scope.parent, 'harness');
  assert.equal(cost['dist-ranges'].scope.grain, 'conversation');
  assert.equal(cost['dist-ranges'].scope.dim, 'session_repo');
  assert.equal(cost['dist-hist'].scope.grain, 'call');
  assert.equal(cost['dist-hist'].scope.dim, 'harness');
  assert.equal(cost['dist-ecdf'].scope.grain, 'conversation');
  assert.equal(cost['dist-ecdf'].scope.dim, 'model');

  const quality = lookupPreset('quality').specs;
  assert.equal(quality['score-ranges'].split, 'harness');
  assert.equal(quality['score-ranges'].chart, 'ranges');
  assert.equal(quality['score-trend'].split, 'session_model');
  assert.equal(quality['score-trend'].chart, 'lines');
  assert.equal(quality['score-strips'].split, 'kind');
  assert.equal(quality['score-strips'].chart, 'strip');
  assert.equal(quality['band-mix'].split, 'kind');
  assert.equal(quality['band-mix'].chart, 'stacked');

  const tools = lookupPreset('tools').specs;
  assert.equal(tools.mix.split, 'tool_kind');
  assert.equal(tools.mix.chart, 'bars');
  assert.equal(tools.mix.scope.second, 'harness');
  assert.equal(tools.mix.scope.mode, 'stacked');
  assert.equal(tools.treemap.split, 'tool');
  assert.equal(tools.treemap.chart, 'treemap');
  assert.equal(tools.treemap.scope.parent, 'harness');
  assert.equal(tools.rank.split, 'tool');
  assert.equal(tools.rank.chart, 'rank');
  assert.deepEqual(tools.rhythm.measures, ['hook_events']);
  assert.equal(tools.rhythm.chart, 'heatmap');

  const workflow = lookupPreset('workflow').specs;
  assert.equal(workflow['shape-bars'].chart, 'bars');
  assert.equal(workflow['plan-timeline'].chart, 'lanes');
  assert.deepEqual(workflow.rank.measures, ['associated_cost_usd']);
  assert.equal(workflow.rank.chart, 'rank');
  assert.deepEqual(workflow['scatter-plan'].measures, ['associated_cost_usd', 'artifacts']);
  assert.equal(workflow['scatter-plan'].chart, 'scatter');
  assert.equal(workflow.river.chart, 'lanes');

  const compare = lookupPreset('compare').specs;
  for (const spec of Object.values(compare)) assert.equal(spec.scope.cmp, 'period');
  assert.equal(compare['dist-ranges'].chart, 'ranges');
  assert.equal(compare['dist-hist'].chart, 'histogram');
  assert.equal(compare['dist-ecdf'].chart, 'ecdf');
  assert.equal(compare['trend-lines'].chart, 'lines');
  assert.equal(compare.rank.chart, 'slope');
});

test('the span map gives Pulse metrics the first full row and the odd final panel the last', () => {
  const spans = id => {
    const map = boardSpans(ORDER[id], FULL_WIDTH[id]);
    return ORDER[id].map(panelId => map[panelId]);
  };
  assert.deepEqual(spans('pulse'), ['12', '6', '6', '6', '6']);
  assert.deepEqual(spans('trends'), ['6', '6', '6', '6', '12']);
  assert.deepEqual(spans('cost'), ['6', '6', '6', '6', '6', '6']);
  assert.deepEqual(spans('quality'), ['6', '6', '6', '6']);
  assert.deepEqual(spans('tools'), ['6', '6', '6', '6']);
  assert.deepEqual(spans('workflow'), ['6', '6', '6', '6', '12']);
  assert.deepEqual(spans('compare'), ['6', '6', '6', '6', '12']);
  assert.deepEqual(spans('scatter'), ['6', '6', '6', '6']);

  for (const id of Object.keys(ORDER)) {
    const board = assembleBoard({ presetId: id });
    assert.deepEqual(Object.keys(board.spans), ORDER[id], `${id} span map covers its panel order`);
  }
});

test('scope.captionKey stays in the spec and never reaches a request URL', () => {
  for (const id of Object.keys(ORDER)) {
    const board = assembleBoard({ presetId: id, state: { win: '30d' } });
    for (const entry of board.panels) {
      if (!entry.panel) continue;
      const spec = entry.spec || {};
      assert.equal(entry.scope.captionKey, undefined, `${id}/${entry.panelId} runtime scope has no caption key`);
      const params = requestParams({
        scope: { ...entry.scope, ...(spec.scope || {}) },
        spec,
        measure: spec.measures?.[0] || 'cost_usd',
        split: spec.split || '',
        bucket: 'auto'
      });
      const text = params.toString();
      assert.doesNotMatch(text, /captionKey/i, `${id}/${entry.panelId} request carries no caption key`);
    }
  }
});
