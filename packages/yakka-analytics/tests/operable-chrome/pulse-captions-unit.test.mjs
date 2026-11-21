// Plan 30 phase 2 Pulse unit check: each G item registers its literal caption
// through the shared registry, declares the exact table columns, and refuses an
// unsupported active filter before any read with the exact F sentence and no
// body marks. Pure module and loader checks; no browser is required.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPanel } from '../../web/js/panels/registry.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { PULSE_SPECS } from '../../web/js/panels/index.js';
import { captionFor } from '../../web/js/panels/captions.js';
import {
  STRIP_MEASURES, STRIP_COLUMNS, PULSE_CAPTIONS, stripModel, load as loadStrips
} from '../../web/js/panels/pulse-strips.js';
import {
  ACTIVITY_CAPTION, ACTIVITY_COLUMNS, ACTIVITY_TYPE_LABELS, RIVER_DEFAULT_VIEW,
  activityTableRows, load as loadRiver
} from '../../web/js/panels/river.js';
import {
  MOVERS_CAPTION, MOVER_COLUMNS, MOVER_DEFAULT_MEASURE, buildMoverModel, combinedMoverRows,
  moverLenses, load as loadMovers
} from '../../web/js/panels/movers.js';
import {
  CALENDAR_CAPTION, calendarTableColumns, suggestedMeasures, load as loadCalendar
} from '../../web/js/panels/calendar.js';
import {
  COVERAGE_CAPTION, COVERAGE_COLUMNS, COVERAGE_METADATA_WARNING, coverageModel
} from '../../web/js/panels/coverage.js';
import { makeSchema, summary, COUNTS } from '../workspace/fixture.mjs';

const CAPTIONS = {
  'pulse-strips': 'These totals describe the selected period; each label names its own unit and the values must not be added together.',
  river: 'Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.',
  movers: 'Each bar shows priced spend for a harness or model; longer bars mean more dollars spent in the selected period.',
  calendar: 'Each square shows priced spend on one day; use the labelled colour scale to compare dollars spent.',
  coverage: 'These rows show the latest retained records and missing prices or scores; missing data is not zero activity.'
};

const KEYS = {
  'pulse-strips': 'G-metrics', river: 'G-activity', movers: 'G-movers', calendar: 'G-calendar', coverage: 'G-coverage'
};

function fakeDoc() {
  return {
    documentElement: { dataset: {} },
    head: { append() {} },
    defaultView: null,
    querySelector() { return null; },
    createElement() { return { append() {}, setAttribute() {}, style: {} }; }
  };
}

function transport({ schema = makeSchema() } = {}) {
  const calls = [];
  return {
    calls,
    async schema() { return { response: { ok: true, status: 200 }, body: schema }; },
    async get(name, params) {
      calls.push({ name, params });
      return { response: { ok: true, status: 200 }, body: {} };
    }
  };
}

test('Pulse declares metrics first and every panel carries its literal G caption key', () => {
  assert.deepEqual(lookupPreset('pulse').panels, ['pulse-strips', 'river', 'movers', 'calendar', 'coverage']);
  for (const [id, key] of Object.entries(KEYS)) {
    const panel = lookupPanel(id);
    assert.ok(panel, `${id} is registered`);
    assert.equal(PULSE_SPECS[id].scope.captionKey, key, `${id} caption key`);
    assert.equal(captionFor(panel, PULSE_SPECS[id]), CAPTIONS[id], `${id} literal caption`);
  }
});

test('the five literal captions are exported unchanged', () => {
  assert.equal(PULSE_CAPTIONS['G-metrics'], CAPTIONS['pulse-strips']);
  assert.equal(ACTIVITY_CAPTION, CAPTIONS.river);
  assert.equal(MOVERS_CAPTION, CAPTIONS.movers);
  assert.equal(CALENDAR_CAPTION, CAPTIONS.calendar);
  assert.equal(COVERAGE_CAPTION, CAPTIONS.coverage);
});

test('G-activity defaults to its table and offers lanes as the chart alternative', () => {
  assert.equal(RIVER_DEFAULT_VIEW, 'table');
  assert.deepEqual(lookupPanel('river').charts, ['lanes']);
  assert.deepEqual(ACTIVITY_COLUMNS, ['Time', 'Type', 'Repository', 'Plan', 'Kind', 'Path', 'Conversation', 'Stage', 'Open']);
  const [row] = activityTableRows([{
    event_time: '2026-10-01T00:00:00Z', type: 'execution', identity: 'b1',
    repo_id: 'r1', plan: '30', kind: 'brief', path: 'docs/PLAN.md', conversation_id: 'c1', stage: 'screen'
  }], 'UTC');
  assert.equal(row[1], 'Brief execution');
  assert.equal(row.length, 8);
  assert.equal(ACTIVITY_TYPE_LABELS.rejection, 'Rejection');
});

test('G-metrics fixes the seven cells and shows no previous period for all history', () => {
  assert.deepEqual(STRIP_MEASURES.map(row => row.key), [
    'cost_usd', 'model_calls', 'hook_events', 'artifact_versions', 'commits', 'conversations', 'unpriced_calls'
  ]);
  assert.deepEqual(STRIP_COLUMNS, ['Metric', 'Selected period', 'Previous period', 'Change', 'Unit']);
  const all = stripModel({ summary: summary(), previous: null, scope: { win: 'all' } });
  assert.equal(all.rows.length, 7);
  assert.equal(all.hasPrevious, false);
  assert.ok(all.rows.every(row => row.previousDisplay === 'no previous period'));
  assert.ok(all.rows.every(row => row.change === 'no previous period'));
  const kindGated = stripModel({ summary: summary(), previous: summary(), scope: { filters: { kind: ['brief'] } } });
  const byKey = Object.fromEntries(kindGated.rows.map(row => [row.key, row]));
  assert.equal(byKey.cost_usd.available, false);
  assert.equal(byKey.hook_events.available, false);
  assert.equal(byKey.model_calls.available, true);
});

test('G-movers fixes priced spend, harness then model, and the exact table columns', () => {
  assert.equal(MOVER_DEFAULT_MEASURE, 'cost_usd');
  assert.deepEqual(MOVER_COLUMNS, ['Harness/model', 'Current priced spend (USD)', 'Previous priced spend (USD)', 'Change (USD)', 'Unpriced calls']);
  const schema = makeSchema();
  assert.deepEqual(moverLenses(schema), ['harness', 'model']);
  const harness = buildMoverModel({
    lens: 'harness', current: new Map([['b', 9], ['a', 5]]), previous: new Map([['a', 2]])
  });
  const model = buildMoverModel({ lens: 'model', current: new Map([['x', 7]]), previous: new Map() });
  const rows = combinedMoverRows([harness, model]);
  assert.deepEqual(rows.map(row => row.group), ['Harness', 'Harness', 'Model']);
  assert.deepEqual(rows.map(row => row.label), ['b', 'a', 'x']);
});

test('G-calendar defaults to priced spend with Date and Value (USD)', () => {
  assert.deepEqual(suggestedMeasures(makeSchema()), ['cost_usd', 'model_calls', 'commits']);
  assert.deepEqual(calendarTableColumns('cost_usd'), ['Date', 'Value (USD)']);
  assert.deepEqual(lookupPanel('calendar').measures, ['cost_usd', 'model_calls', 'commits']);
});

test('G-coverage is one table in its own units with the metadata warning', () => {
  assert.deepEqual(COVERAGE_COLUMNS, ['Source', 'Latest retained timestamp', 'Age', 'Missing-data count', 'Unit']);
  const model = coverageModel({ coverage: makeSchema().coverage, summary: summary() });
  assert.deepEqual(model.columns, COVERAGE_COLUMNS);
  const sources = model.rows.map(row => row.source);
  assert.deepEqual([...sources].sort(), sources, 'source codepoint ascending');
  const usage = model.rows.find(row => row.source === 'usage');
  assert.ok(usage, 'usage row exists');
  assert.equal(usage.unit, 'unpriced calls');
  assert.match(COVERAGE_METADATA_WARNING, /all retained data/);
  assert.match(COVERAGE_METADATA_WARNING, /not zero activity/);
  assert.equal(JSON.stringify(model).includes('%'), false, 'no blended percentage');
});

test('an unsupported filter is refused before any read with the exact F sentence', async () => {
  const doc = fakeDoc();
  const movers = transport();
  const moversResult = await loadMovers({ scope: { kind: ['brief'] }, transport: movers, tenant: 'tenant-b', doc });
  assert.equal(moversResult.state, 'unsupported');
  assert.equal(moversResult.applicability, true);
  assert.equal(moversResult.message, 'This chart cannot apply document kind. Change the filters to view it.');
  assert.equal(movers.calls.length, 0, 'movers fetched no data');

  const calendar = transport();
  const calendarResult = await loadCalendar({ scope: { kind: ['brief'] }, transport: calendar, tenant: 'tenant-b', doc });
  assert.equal(calendarResult.message, 'This chart cannot apply document kind. Change the filters to view it.');
  assert.equal(calendar.calls.length, 0, 'calendar fetched no data');

  const strips = transport();
  const stripsResult = await loadStrips({ scope: { source: ['worktree'] }, transport: strips, tenant: 'tenant-b', doc, schema: makeSchema() });
  assert.equal(stripsResult.message, 'This chart cannot apply source. Change the filters to view it.');
  assert.equal(strips.calls.length, 0, 'metrics fetched no data');

  const river = transport();
  const riverResult = await loadRiver({ scope: { source: ['worktree'] }, transport: river, tenant: 'tenant-b', doc, schema: makeSchema() });
  assert.equal(riverResult.message, 'This chart cannot apply source. Change the filters to view it.');
  assert.equal(river.calls.length, 0, 'activity fetched no data');
});

test('a declared filter is accepted and reaches the read', async () => {
  const doc = fakeDoc();
  const accepted = transport();
  const readContext = { paramsFor: () => new URLSearchParams({ repo_id: 'repo-a' }), window: null };
  await loadStrips({ scope: { repo_id: ['repo-a'] }, transport: accepted, tenant: 'tenant-b', doc, readContext, schema: makeSchema() });
  assert.ok(accepted.calls.some(call => call.name === 'summary'));
  assert.ok(COUNTS.sessions_one_repo > 0);
});
