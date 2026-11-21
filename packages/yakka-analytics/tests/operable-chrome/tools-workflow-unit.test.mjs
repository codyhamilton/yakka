// Phase 30 unit U11: Tools and Workflow contracts that need no browser.
// G-mix, G-shapes and G-planline are fixed here: literal captions, exact
// columns, fixed dimensions, Plan-only grouping, plan precedence without
// duration inference, and a refusal that draws no marks.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIX_CAPTION, MIX_FIRST, MIX_PANEL, MIX_SECOND, MIX_TABLE_COLUMNS,
  buildMix, load as loadMix, mixTableRows
} from '../../web/js/panels/mix.js';
import {
  SHAPE_CAPTION, SHAPE_GROUPINGS, SHAPE_SERIES, SHAPE_TABLE_COLUMNS, SHAPE_TOP,
  groupingState, shapeTop, sortShapeRows
} from '../../web/js/panels/shape-bars.js';
import {
  PLANLINE_CAPTION, TIMELINE_EMPTY_TEXT, TIMELINE_TABLE_COLUMNS,
  isMissingPlan, planChoiceKey, planListLimit, resolveTimelinePlan, timelineModel
} from '../../web/js/panels/plan-timeline.js';
import { captionFor, hasCaption } from '../../web/js/panels/captions.js';
import { p10Schema, p12ExecutionEntities, p12PlanEvents } from '../workspace/fixture.mjs';

const fakeDoc = () => ({
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({}), head: { append: () => {} }
});
const usage = (rows) => ({ response: { ok: true }, body: { rows, population: { eligible_n: rows.length } } });

test('all three captions are the literal DESIGN sentences and are registered', () => {
  assert.equal(MIX_CAPTION, 'Each bar counts hook events for a tool category, split by harness; longer segments mean more events.');
  assert.equal(SHAPE_CAPTION, 'Each bar counts a plan’s complete, unreported and started executions; completion describes recorded steps, not whether the work succeeded.');
  assert.equal(PLANLINE_CAPTION, 'Each marker shows a recorded plan event at its event time; rows separate plans and do not imply continuous work between markers.');
  for (const [id, caption] of [['mix', MIX_CAPTION], ['shape-bars', SHAPE_CAPTION], ['plan-timeline', PLANLINE_CAPTION]]) {
    assert.equal(hasCaption(id), true);
    assert.equal(captionFor({ id }, {}), caption);
  }
});

test('G-mix fixes hook events by tool_kind x harness regardless of an incoming preset', async () => {
  assert.equal(MIX_FIRST, 'tool_kind');
  assert.equal(MIX_SECOND, 'harness');
  const calls = [];
  const transport = {
    get: async (route, params) => {
      calls.push({ route, params });
      return usage([{ k: ['Read', 'claude-code'], v: 2 }, { k: ['Bash', 'orca'], v: 1 }]);
    }
  };
  const result = await loadMix({
    schema: p10Schema(), transport, doc: fakeDoc(), panel: MIX_PANEL,
    spec: { measures: ['cost_usd'], split: 'repo_id', chart: 'treemap', scope: { second: 'model', mode: 'percent' } },
    scope: { win: '30d', captionKey: 'G-mix', mode: 'percent', second: 'model' }
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.measure, 'hook_events');
  assert.equal(result.first, 'tool_kind');
  assert.equal(result.second, 'harness');
  assert.equal(result.mode, 'stacked');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.get('measure'), 'hook_events');
  assert.deepEqual(calls[0].params.getAll('dim'), ['tool_kind', 'harness']);
});

test('the mix table is long format, group ASC then series ASC, with an em dash for an absent value', () => {
  const model = buildMix({
    rows: [{ k: ['Read', 'claude-code'], v: 2 }, { k: ['Bash', 'orca'], v: 1 }, { k: ['Bash', 'claude-code'], v: 3 }],
    measure: 'hook_events', dims: ['tool_kind', 'harness']
  });
  assert.deepEqual(MIX_TABLE_COLUMNS, ['Group', 'Series', 'Value (events)']);
  assert.deepEqual(mixTableRows(model), [
    ['Bash', 'claude-code', '3'],
    ['Bash', 'orca', '1'],
    ['Read', 'claude-code', '2'],
    ['Read', 'orca', '—']
  ]);
});

test('an unsupported mix filter is refused before any query and draws no marks', async () => {
  const calls = [];
  const transport = { get: async (...args) => { calls.push(args); return usage([]); } };
  const result = await loadMix({
    schema: p10Schema(), transport, doc: fakeDoc(), panel: MIX_PANEL,
    spec: { measures: ['hook_events'] }, scope: { win: '30d', plan: '20' }
  });
  assert.equal(result.state, 'unsupported');
  assert.deepEqual(result.labels, ['plan']);
  assert.equal(result.applicability, true);
  assert.equal(calls.length, 0, 'no read is issued for a refused filter');
});

test('G-shapes is Plan-only and orders top plans by unreported desc then identity asc', () => {
  assert.deepEqual(SHAPE_GROUPINGS, [{ value: 'plan', label: 'Plan' }]);
  assert.equal(groupingState('plan'), null);
  assert.equal(groupingState('harness').state, 'unsupported');
  assert.match(groupingState('harness').reason, /no execution aggregate mode/);
  assert.deepEqual(SHAPE_TABLE_COLUMNS, [
    'Repository', 'Plan', 'Complete executions', 'Unreported executions',
    'Started executions', 'Complete share (%)', 'Last observed'
  ]);
  assert.deepEqual(SHAPE_SERIES.map(series => series.status), ['good', 'warn', 'info']);
  const rows = sortShapeRows([
    { identity: { repo_id: 'repo-b', plan: '9' }, values: { executions_unreported: 1 } },
    { identity: { repo_id: 'repo-a', plan: '3' }, values: { executions_unreported: 3 } },
    { identity: { repo_id: 'repo-a', plan: '2' }, values: { executions_unreported: 3 } },
    { identity: { repo_id: 'repo-b', plan: '1' }, values: { executions_unreported: null } }
  ]);
  assert.deepEqual(rows.map(row => `${row.identity.repo_id}/${row.identity.plan}`), ['repo-a/2', 'repo-a/3', 'repo-b/9', 'repo-b/1']);
});

test('the top plan page is 12 bounded by the published budgets', () => {
  assert.equal(SHAPE_TOP, 12);
  assert.equal(shapeTop({ budgets: { top_max: 40, page_max: 100 } }, 12), 12);
  assert.equal(shapeTop({ budgets: { top_max: 5, page_max: 100 } }, 12), 5);
  assert.equal(shapeTop({ budgets: { page_max: 7 } }, 12), 7);
  assert.equal(shapeTop({}, 12), 12);
});

test('G-planline has one plan lane, exact columns, event-time ASC rows and no duration', () => {
  const events = p12PlanEvents({ repo_id: 'repo-a', plan: '20', limit: 500 });
  const executions = p12ExecutionEntities({ plan: '20', repo_id: 'repo-a', limit: 500 });
  const model = timelineModel({ eventsBody: events, executionsBody: executions, identity: { repo_id: 'repo-a', plan: '20' } });
  assert.deepEqual(model.lanes.map(lane => lane.key), ['plan:repo-a:20']);
  assert.deepEqual(TIMELINE_TABLE_COLUMNS, ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)']);
  const times = model.tableRows.map(row => row.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(model.data.every(marker => marker.start === undefined && marker.end === undefined));
  assert.equal(model.data.length, events.rows.length + executions.rows.length);
});

test('a global plan wins, a fixed plan wins over it, and an empty plan pair is T2', () => {
  const rows = [
    { id: { repo_id: 'repo-a', plan: '23' }, m: { executions_unreported: 2 } },
    { id: { repo_id: 'repo-a', plan: '20' }, m: { executions_unreported: 1 } }
  ];
  assert.equal(resolveTimelinePlan({ rows, scope: { plan: '20', repo_id: 'repo-a' } }).identity.plan, '20');
  assert.equal(resolveTimelinePlan({ rows, scope: { plan: '20', repo_id: 'repo-a' } }).source, 'global');
  const fixed = resolveTimelinePlan({ rows, spec: { plan: { repo_id: 'repo-a', plan: '23' } }, scope: { plan: '20' } });
  assert.equal(fixed.identity.plan, '23');
  assert.equal(fixed.source, 'fixed');
  assert.equal(resolveTimelinePlan({ rows, scope: {} }).identity.plan, '23');
  assert.equal(resolveTimelinePlan({ rows, scope: {} }).source, 'default');
  assert.equal(planListLimit({ budgets: { page_max: 250 } }), 100);
  assert.equal(planListLimit({ budgets: { page_max: 50 } }), 50);
  assert.equal(isMissingPlan({ rows: [] }, { rows: [] }), true);
  assert.equal(TIMELINE_EMPTY_TEXT, 'No records match these filters.');
  assert.equal(planChoiceKey({ repo_id: 'repo-a', plan: '20' }), JSON.stringify({ repo_id: 'repo-a', plan: '20' }));
});
