// Plan 30 unit U9: the plan and session detail screens. These checks pin the
// exact region order, table columns/widths, sources, scope-preserving links,
// the two session measure strips, the G-sessionlanes caption and its mark
// sentence, and the per-region F refusals. No browser is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_DETAIL_REGIONS, PLAN_DETAIL_COLUMNS, planRegionRefusal, planArtifactsParams,
  planExecutionsParams, planCollectionParams, planSessionResolveParams,
  planBackDestination, planSessionDestination, artifactLatestDestination
} from '../../web/js/explorers/plans.js';
import {
  SESSION_LANES_CAPTION, SESSION_LANES_TABLE_COLUMNS, SESSION_RECORD_COLUMNS,
  SESSION_MARK_LIMIT, plottedStatement, sessionRecordsModel, sessionRecordCells
} from '../../web/js/panels/session-lanes.js';
import {
  sessionExploreParams, sessionWindowParams, sessionWholeParams,
  sessionRecordsRefusal, sessionSelectedRefusal, sessionBackDestination,
  sessionLedgerDestination, SESSION_RECORDS_MORE, SESSION_RECORDS_EMPTY
} from '../../web/js/explorers/sessions.js';

const identity = { repo_id: 'acme/widgets', plan: '20-analytics-reset' };

test('plan detail lists the exact regions and the four tables in contract order', () => {
  assert.deepEqual(PLAN_DETAIL_REGIONS, ['summary', 'planline', 'artifacts', 'executions', 'sessions', 'events']);
  assert.deepEqual(PLAN_DETAIL_COLUMNS.artifacts.map(c => c.label),
    ['Kind', 'Path', 'Latest version', 'Score/scorer/band', 'Content', 'Screen verdict', 'Writing session cost USD', 'Open']);
  assert.deepEqual(PLAN_DETAIL_COLUMNS.executions.map(c => c.label),
    ['Shape', 'Brief path', 'Time', 'Session cost USD', 'Brief/report scores', 'Session']);
  assert.deepEqual(PLAN_DETAIL_COLUMNS.sessions.map(c => c.label),
    ['Conversation', 'Last observed', 'Cost USD', 'Unpriced calls']);
  assert.deepEqual(PLAN_DETAIL_COLUMNS.events.map(c => c.label),
    ['Time', 'Type', 'Event', 'Path', 'Conversation']);
  for (const columns of Object.values(PLAN_DETAIL_COLUMNS)) {
    for (const column of columns) {
      if (column.identity) assert.equal(column.width, 240, `${column.label} identity is 240px`);
      if (column.time) assert.equal(column.width, 150, `${column.label} time is 150px`);
    }
  }
});

test('plan detail sends the exact collection sources and the region F refusal', () => {
  const state = { win: 'all', tz: 'UTC' };
  const artifacts = planArtifactsParams(identity, { state, limit: 4 });
  assert.equal(artifacts.get('grain'), 'artifact');
  assert.equal(artifacts.get('repo_id'), 'acme/widgets');
  assert.equal(artifacts.get('plan'), '20-analytics-reset');
  const executions = planExecutionsParams(identity, { state, limit: 4 });
  assert.equal(executions.get('grain'), 'execution');
  const sessions = planCollectionParams(identity, 'sessions', { state, limit: 4 });
  assert.equal(sessions.get('grain'), 'plan');
  assert.equal(sessions.get('collection'), 'sessions');
  const events = planCollectionParams(identity, 'events', { state, limit: 4 });
  assert.equal(events.get('collection'), 'events');
  const resolve = planSessionResolveParams(['a', 'b'], { state, limit: 4 });
  assert.equal(resolve.get('grain'), 'session');
  assert.deepEqual(resolve.getAll('id'), ['a', 'b']);
  for (const params of [artifacts, executions, sessions, events, resolve]) assert.equal(params.has('cohort'), false);

  assert.equal(planRegionRefusal('artifacts', identity, { filters: { kind: ['brief'] } }), null, 'kind applies to artifacts');
  const kindRefusal = planRegionRefusal('executions', identity, { filters: { kind: ['brief'] } });
  assert.ok(kindRefusal);
  assert.deepEqual(kindRefusal.labels, ['document kind']);
  assert.equal(kindRefusal.message, 'This chart cannot apply document kind. Change the filters to view it.');
  const repoRefusal = planRegionRefusal('artifacts', identity, { filters: { repo_id: ['other/repo'] } });
  assert.deepEqual(repoRefusal.labels, ['repository']);
  assert.equal(planRegionRefusal('artifacts', identity, { filters: { repo_id: ['acme/widgets'] } }), null);
  const sessionFilter = planRegionRefusal('sessions', identity, { filters: { harness: ['orca'] } });
  assert.deepEqual(sessionFilter.labels, ['harness']);
  const cohort = planRegionRefusal('events', identity, { cohorts: { ca: '{"v":1}' } });
  assert.deepEqual(cohort.labels, ['cohort']);
});

test('plan detail filters ride only where the region can apply them', () => {
  const state = { win: 'all', tz: 'UTC', filters: { kind: ['brief'], harness: ['orca'], session_model: ['claude'] } };
  const artifacts = planArtifactsParams(identity, { state, limit: 4 });
  assert.deepEqual(artifacts.getAll('kind'), ['brief']);
  assert.deepEqual(artifacts.getAll('harness'), ['orca']);
  assert.deepEqual(artifacts.getAll('session_model'), ['claude']);
  const executions = planExecutionsParams(identity, { state, limit: 4 });
  assert.equal(executions.has('kind'), false, 'execution grain never receives kind');
  assert.deepEqual(executions.getAll('harness'), ['orca']);
  const sessions = planCollectionParams(identity, 'sessions', { state, limit: 4 });
  assert.equal(sessions.has('harness'), false, 'exact collection receives identity and window only');
});

test('plan links preserve the committed scope and never invent a hash', () => {
  assert.equal(planBackDestination('?win=1d&repo_id=acme%2Fwidgets'), '/plans?win=1d&repo_id=acme%2Fwidgets');
  assert.equal(planSessionDestination('conv a', '?win=1d'), '/sessions/conv%20a?win=1d');
  const artifact = artifactLatestDestination(identity, 'docs/plans/20-analytics-reset/DESIGN.md', '?win=1d');
  assert.match(artifact, /^\/artifact\?/);
  assert.equal(artifact.includes('hash='), false);
  assert.match(artifact, /path=docs%2Fplans%2F20-analytics-reset%2FDESIGN.md/);
  assert.match(artifact, /win=1d/);
});

test('G-sessionlanes keeps the exact caption, table columns and mark sentence', () => {
  assert.equal(SESSION_LANES_CAPTION,
    'Each marker shows a retained event in this session matching the filters; gaps between markers do not prove the session was idle.');
  assert.deepEqual(SESSION_LANES_TABLE_COLUMNS,
    ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)']);
  assert.deepEqual(SESSION_RECORD_COLUMNS.map(c => c.label),
    ['Time', 'Event type', 'Repository', 'Path/event', 'Cost USD']);
  assert.deepEqual(SESSION_RECORD_COLUMNS.map(c => c.width),
    [150, 120, 180, null, 110]);
  assert.equal(SESSION_MARK_LIMIT, 5000);
  assert.equal(plottedStatement(3), '3 loaded matching events plotted');
  assert.equal(plottedStatement(6000), '5,000 loaded matching events plotted');
});

test('session records sort event time DESC then type and identity ASC', () => {
  const rows = [
    { ts: '2026-09-01T00:00:02Z', type: 'hook', path: 'b.md', conversation_id: 'conv' },
    { ts: '2026-09-01T00:00:01Z', type: 'commit', path: '', conversation_id: 'conv' },
    { ts: '2026-09-01T00:00:02Z', type: 'artifact_version', path: 'a.md', conversation_id: 'conv' }
  ];
  const sorted = sessionRecordsModel(rows);
  assert.deepEqual(sorted.map(row => row.type), ['artifact_version', 'hook', 'commit']);
  const cells = sessionRecordCells({ ts: '2026-09-01T00:00:00Z', type: 'hook_event', path: '', event: 'PostToolUse', repo_id: 'r', cost_usd: null, priced: false });
  assert.equal(cells[3], 'PostToolUse', 'path/event falls back to the stored event');
  assert.equal(cells[4], 'unpriced');
});

test('the two session strips use distinct sources and applicable scope', () => {
  const state = { win: '1d', tz: 'UTC', filters: { harness: ['orca'], kind: ['brief'] } };
  const explore = sessionExploreParams('sess-1', state, { limit: 100 });
  assert.equal(explore.get('conversation_id'), 'sess-1');
  assert.equal(explore.get('limit'), '100');
  assert.deepEqual(explore.getAll('harness'), ['orca']);
  assert.deepEqual(explore.getAll('kind'), ['brief']);
  assert.equal(explore.has('cohort'), false);
  const window = sessionWindowParams('sess-1', state, { window: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' } });
  assert.equal(window.get('grain'), 'session');
  assert.equal(window.get('id'), 'sess-1');
  assert.deepEqual(window.getAll('harness'), ['orca']);
  assert.equal(window.has('kind'), false, 'kind is not a session-grain filter');
  const whole = sessionWholeParams('sess-1', { win: '1d', tz: 'UTC' }, { window: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' } });
  assert.equal(whole.get('id'), 'sess-1');
  assert.equal(whole.get('from'), '2026-09-01T00:00:00.000Z');
  assert.equal(whole.has('cohort'), false);

  assert.equal(sessionRecordsRefusal({ filters: { kind: ['brief'] } }), null, 'explore applies kind');
  assert.deepEqual(sessionRecordsRefusal({ filters: { session_model: ['claude'] } }).labels, ['session model']);
  assert.deepEqual(sessionRecordsRefusal({ cohorts: { ca: 'x' } }).labels, ['cohort']);
  assert.equal(sessionSelectedRefusal({ filters: { harness: ['orca'] } }), null);
  assert.deepEqual(sessionSelectedRefusal({ filters: { repo_id: ['r'] } }).labels, ['repository']);
  assert.deepEqual(sessionSelectedRefusal({ filters: { kind: ['brief'] } }).labels, ['document kind']);
});

test('session links preserve scope and add the exact conversation', () => {
  assert.equal(sessionBackDestination('?win=1d&repo_id=r'), '/sessions?win=1d&repo_id=r');
  assert.equal(sessionLedgerDestination('conv a', '?win=1d'), '/ledger?conversation_id=conv+a&win=1d');
  assert.equal(SESSION_RECORDS_MORE, 'Load more session events');
  assert.equal(SESSION_RECORDS_EMPTY, 'No records match these filters.');
});
