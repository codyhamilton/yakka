// Phase 12 unit 12-01: the workflow process-shape and plan-timeline panels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON, p12PlanEntities, p12ExecutionEntities, p12PlanEvents } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { hasPanel, listPanels } from '../../web/js/panels/registry.js';
import { listPresets } from '../../web/js/boards/presets.js';
import { buildBarsModel, stackSegments } from '../../web/js/charts/yk-bars.js';
import { buildLanesModel } from '../../web/js/charts/yk-lanes.js';
import {
  SHAPE_SERIES, SHAPE_BARS_PANEL, shapeRows, shapeTop, shapePopulationText, completeShareText,
  groupingState, observedAge
} from '../../web/js/panels/shape-bars.js';
import {
  PLAN_TIMELINE_PANEL, artifactKind, tsToMs, executionCostText, timelineModel,
  planChoiceKey, fixedPlan, chooserFallback, isMissingPlan
} from '../../web/js/panels/plan-timeline.js';
import {
  P12_WORKFLOW_PANEL_IDS, registerP12WorkflowPanels
} from '../../web/js/panels/p12-workflow.js';

const environment = loadBrowserEnvironment();
const identity20 = { repo_id: 'repo-a', plan: '20' };

function shapePanelTotal(rows, plan) {
  const model = buildBarsModel({ spec: { type: 'stacked', series: SHAPE_SERIES }, data: rows });
  const stacked = stackSegments(model.rows, model.series);
  return stacked.find(item => item.key === plan);
}

test('both panels register idempotently and 12-02 delivers the workflow board', () => {
  assert.deepEqual(P12_WORKFLOW_PANEL_IDS, ['shape-bars', 'plan-timeline']);
  assert.equal(registerP12WorkflowPanels(), true);
  assert.equal(registerP12WorkflowPanels(), true);
  assert.equal(listPanels().filter(panel => panel.id === 'shape-bars').length, 1);
  assert.equal(listPanels().filter(panel => panel.id === 'plan-timeline').length, 1);
  assert.equal(hasPanel('shape-bars'), true);
  assert.equal(hasPanel('plan-timeline'), true);
  assert.equal(SHAPE_BARS_PANEL.title, 'Process shape');
  assert.equal(SHAPE_BARS_PANEL.grain, 'plan');
  assert.deepEqual(SHAPE_BARS_PANEL.charts, ['bars']);
  assert.equal(SHAPE_BARS_PANEL.table, true);
  assert.equal(PLAN_TIMELINE_PANEL.title, 'Plan timeline');
  assert.deepEqual(PLAN_TIMELINE_PANEL.charts, ['lanes']);
  assert.equal(PLAN_TIMELINE_PANEL.table, true);
  const workflow = listPresets().find(preset => preset.id === 'workflow');
  assert.deepEqual(workflow.panels, ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river']);
});

test('plan measures map to one stacked row with complete_share null on no_executions', () => {
  const body = p12PlanEntities({ sort: 'executions_unreported:desc', limit: 100 });
  const rows = shapeRows(body);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map(row => row.key)).size, 10);
  const plan20 = rows.find(row => row.identity.plan === '20');
  assert.deepEqual(plan20.values.executions_complete, 3);
  assert.deepEqual(plan20.values.executions_unreported, 1);
  assert.deepEqual(plan20.values.executions_started, 1);
  assert.equal(plan20.complete_share, 0.6);
  const stack = shapePanelTotal(rows, plan20.key);
  assert.equal(stack.total, 5);
  assert.deepEqual(stack.segments.map(segment => segment.key), SHAPE_SERIES.map(series => series.key));
  const plan21 = rows.find(row => row.identity.plan === '21');
  assert.equal(plan21.complete_share, null);
  assert.equal(plan21.flags.complete_share_null_reason, 'no_executions');
  assert.equal(completeShareText(plan21), 'no executions');
  assert.equal(completeShareText(plan20), '60%');
});

test('a null execution measure stays out of the marks and is never drawn as zero', () => {
  const body = {
    rows: [{
      id: { repo_id: 'repo-a', plan: '20' },
      m: { executions_complete: 1, executions_unreported: null, executions_started: 0, complete_share: 1, last_ts: 1 },
      l: { repo_id: 'repo-a' }, flags: {}
    }]
  };
  const rows = shapeRows(body);
  assert.equal(rows[0].values.executions_unreported, null);
  assert.equal(rows[0].missing, 1);
  const stack = shapePanelTotal(rows, rows[0].key);
  assert.equal(stack.segments.length, 2, 'the null segment is skipped, not zero-filled');
  assert.equal(stack.total, 1);
});

test('top and population text come from the server population, bounded by budgets', () => {
  assert.equal(shapePopulationText({ returned_n: 4, scope_n: 10 }), 'top 4 of 10 plans');
  assert.equal(shapeTop({ budgets: { top_max: 100, page_max: 500 } }), 12);
  assert.equal(shapeTop({ budgets: { top_max: 6, page_max: 500 } }), 6);
  assert.equal(shapeTop({ budgets: { top_max: 100, page_max: 4 } }), 4);
  assert.equal(shapeTop({ budgets: { top_max: 100, page_max: 4 } }, 50), 4);
  assert.equal(observedAge(1000, 1000 * 1000 + 3 * 86400 * 1000), '3 days ago');
});

test('harness and repo grouping name the missing execution aggregate, never a page count', () => {
  assert.equal(groupingState('plan'), null);
  for (const grouping of ['harness', 'repo']) {
    const state = groupingState(grouping);
    assert.equal(state.state, 'unsupported');
    assert.equal(state.missing, 'execution aggregate grouping');
    assert.equal(state.source, 'server /schema');
    assert.equal(state.nearest, 'plan grouping');
    assert.match(state.reason, /no execution aggregate mode/);
    assert.match(state.reason, /plan measures only/);
  }
});

test('plan events and executions map to one plan lane with marker kinds by event type', () => {
  const events = p12PlanEvents({ repo_id: 'repo-a', plan: '20', limit: 500 });
  const executions = p12ExecutionEntities({ plan: '20', repo_id: 'repo-a', limit: 500 });
  const model = timelineModel({ eventsBody: events, executionsBody: executions, identity: identity20 });
  assert.deepEqual(model.lanes.map(lane => lane.key), ['plan:repo-a:20']);
  assert.deepEqual(model.series.map(series => series.key), ['artifact_version', 'commit', 'execution']);
  assert.equal(model.versionMarkers, 9);
  assert.equal(model.executionMarkers, 5);
  assert.equal(model.otherEvents, 1);
  assert.ok(model.tableRows.every(row => row.plan === '20' && row.repo === 'repo-a'));
  assert.ok(model.tableRows.some(row => row.type === 'commit'));
  assert.ok(model.tableRows.some(row => /unpriced \(all calls\)/.test(row.cost)));
  assert.ok(model.tableRows.some(row => /\$4\.00\+/.test(row.cost)));
  const times = model.tableRows.map(row => row.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'event time ASC');
  assert.ok(model.data.every(marker => marker.start === undefined && marker.end === undefined), 'markers never carry duration');
  const lanesModel = buildLanesModel({ spec: { type: 'timeline', lanes: model.lanes, series: model.series }, data: model.data });
  assert.equal(lanesModel.state, 'ready');
  assert.equal(lanesModel.rows.length, 14);
  assert.ok(model.entities[model.data[0].key].destination.startsWith('/plans/'));
});

test('the plan chooser falls back to the first served plan and never silently switches', () => {
  const rows = p12PlanEntities({ sort: 'last_ts:desc', limit: 100 }).rows;
  assert.deepEqual(chooserFallback(rows), { repo_id: 'repo-a', plan: '23' });
  assert.deepEqual(chooserFallback(rows, planChoiceKey({ repo_id: 'repo-b', plan: '26' })), { repo_id: 'repo-b', plan: '26' });
  assert.equal(chooserFallback(rows, planChoiceKey({ repo_id: 'repo-z', plan: '99' })), null);
  assert.equal(chooserFallback([]), null);
  assert.deepEqual(fixedPlan({ plan: identity20 }), identity20);
  assert.deepEqual(fixedPlan({ scope: { p12_plan: planChoiceKey(identity20) } }), identity20);
  assert.equal(fixedPlan({ plan: 'repo-a/20' }), null, 'a bare string is never guessed into a repository');
  assert.equal(isMissingPlan({ rows: [] }, { rows: [] }), true);
  assert.equal(isMissingPlan({ rows: [{}] }, { rows: [] }), false);
});

test('artifact kind, timestamps and execution cost text stay honest', () => {
  assert.equal(artifactKind('docs/plans/20-analytics-reset/DESIGN.md'), 'design');
  assert.equal(artifactKind('docs/plans/20-analytics-reset/briefs/12-01.md'), 'brief');
  assert.equal(artifactKind('docs/plans/20-analytics-reset/reports/12-01.md'), 'report');
  assert.equal(tsToMs(10), 10000);
  assert.equal(tsToMs('2026-09-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(executionCostText({ m: { session_cost_usd: null }, flags: { session_cost_null_reason: 'all_unpriced' } }), 'unpriced (all calls)');
  assert.equal(executionCostText({ m: { session_cost_usd: 4 }, flags: { session_cost_lower_bound: true } }), '$4.00+');
  assert.equal(executionCostText({ m: { session_cost_usd: 0.25 }, flags: {} }), '$0.25');
});

test('the P12 scene pages on opaque cursors without duplicate identities', () => {
  const first = p12PlanEntities({ sort: 'executions_unreported:desc', limit: 4 });
  const second = p12PlanEntities({ sort: 'executions_unreported:desc', limit: 4, cursor: first.next });
  assert.equal(first.rows.length, 4);
  assert.equal(second.rows.length, 4);
  assert.ok(first.next && second.next);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => `${row.id.repo_id}|${row.id.plan}`)).size, 8);
  const events = p12PlanEvents({ repo_id: 'repo-a', plan: '20', limit: 4 });
  assert.equal(events.rows.length, 4);
  assert.ok(events.next);
  const events2 = p12PlanEvents({ repo_id: 'repo-a', plan: '20', limit: 4, cursor: events.next });
  assert.equal(events2.rows.length, 4);
  assert.equal(new Set([...events.rows, ...events2.rows].map(row => `${row.ts}|${row.event_type}|${row.path}`)).size, 8);
});

// --- Chromium ------------------------------------------------------------

async function mountWorkflow(page, origin) {
  await page.goto(`${origin}/`);
  await page.evaluate(async () => {
    await import('/js/panels/index.js');
    const { registerPreset } = await import('/js/boards/presets.js');
    registerPreset({ id: 'p12workflowtest', title: 'Workflow test', panels: ['shape-bars', 'plan-timeline'] });
    history.pushState({}, '', '/b/p12workflowtest?win=all');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => {
    const shape = document.querySelector('[data-panel="shape-bars"]');
    const timeline = document.querySelector('[data-panel="plan-timeline"]');
    return shape?.dataset.idle === 'true' && shape.dataset.state === 'ready'
      && timeline?.dataset.idle === 'true' && timeline.dataset.state === 'ready';
  });
}

test('the stacked process shape opens the plan and names unsupported groupings', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1800 } });
  const diagnostics = await watchPage(page);

  await mountWorkflow(page, harness.origin);
  const shapePanel = page.locator('[data-panel="shape-bars"]');
  assert.match(await shapePanel.innerText(), /top 4 of 10 plans/);
  assert.match(await shapePanel.innerText(), /Execution completion, not success/);
  const bars = await page.evaluate(() => {
    const element = document.querySelector('[data-panel="shape-bars"] yk-bars');
    const view = element.inspect();
    return { marks: view.marks.length, series: view.series.map(series => series.key) };
  });
  assert.equal(bars.marks, 4);
  assert.deepEqual(bars.series.slice().sort(), ['executions_complete', 'executions_started', 'executions_unreported']);

  const point = await page.evaluate(() => {
    const element = document.querySelector('[data-panel="shape-bars"] yk-bars');
    const hit = element.shadowRoot.querySelector('[data-mark="0"] [data-hit]');
    hit.scrollIntoView({ block: 'center' });
    const rect = hit.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => /^\/plans\//.test(location.pathname));
  assert.equal(new URL(page.url()).pathname, '/plans/repo-a/23');

  await page.evaluate(() => {
    history.pushState({}, '', '/b/p12workflowtest?win=all');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => document.querySelector('[data-panel="shape-bars"]')?.dataset.idle === 'true');
  const groupingOptions = await page.$$eval('[data-panel="shape-bars"] .p12-grouping option', options => options.map(option => option.value));
  assert.deepEqual(groupingOptions, ['plan'], 'P7 offers Plan only; harness and repo are absent');
  const groupingText = await page.locator('[data-panel="shape-bars"]').innerText();
  assert.match(groupingText, /Showing the top \d+ plans by unreported executions/);
  assert.doesNotMatch(groupingText, /execution aggregate mode/);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('the timeline draws version and execution markers, keeps non-version events in its table and pages', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1400, height: 2000 } });
  const diagnostics = await watchPage(page);

  await mountWorkflow(page, harness.origin);
  const timeline = page.locator('[data-panel="plan-timeline"]');
  await page.selectOption('[data-panel="plan-timeline"] .p12-plan-chooser', planChoiceKey(identity20));
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-panel="plan-timeline"]');
    return panel?.dataset.idle === 'true' && panel.dataset.state === 'ready' && /repo-a · 20/.test(panel.textContent);
  });
  assert.equal(await timeline.getAttribute('data-state'), 'ready');
  assert.match(await timeline.innerText(), /Each marker shows a recorded plan event at its event time/);
  assert.match(await timeline.innerText(), /4 of 9 events; 4 of 5 executions/);
  const lanes = await page.evaluate(() => {
    const element = document.querySelector('[data-panel="plan-timeline"] yk-lanes');
    const view = element.inspect();
    return { marks: view.marks.length, series: view.series.map(series => series.key) };
  });
  assert.ok(lanes.series.includes('artifact_version'));
  assert.ok(lanes.series.includes('commit'));
  assert.ok(lanes.series.includes('execution'));
  assert.ok(lanes.marks > 0);
  const columns = await page.$$eval('[data-panel="plan-timeline"] table.pulse-table thead th', cells => cells.map(cell => cell.textContent));
  assert.deepEqual(columns, ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)']);
  const firstRows = await page.locator('[data-panel="plan-timeline"] table.pulse-table tbody tr').count();
  assert.equal(firstRows, 8);
  const rowText = await page.$$eval('[data-panel="plan-timeline"] table.pulse-table tbody tr', rows => rows.map(row => row.textContent));
  assert.ok(rowText.some(text => /commit/.test(text)), 'the commit event stays in the table');

  await page.locator('.p12-load-more-events').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel="plan-timeline"] table.pulse-table tbody tr').length === 12);
  const moreSeries = await page.evaluate(() => document.querySelector('[data-panel="plan-timeline"] yk-lanes').inspect().series.map(series => series.key));
  assert.deepEqual(moreSeries, ['artifact_version', 'commit', 'execution'], 'a later page never invents another lane');
  await page.locator('.p12-load-more-events').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel="plan-timeline"] table.pulse-table tbody tr').length === 13);
  await page.locator('.p12-load-more-executions').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-panel="plan-timeline"] table.pulse-table tbody tr').length === 14);
  assert.match(await timeline.innerText(), /4 of 9 events; 4 of 5 executions/, 'paging never relabels the population');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a fixed unknown plan is a named empty state with a Plans link, never a fallback', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/`);
  await page.evaluate(async () => {
    const { PLAN_TIMELINE_PANEL } = await import('/js/panels/plan-timeline.js');
    const { createPanelFrame } = await import('/js/panels/panel-frame.js');
    const { createScheduler } = await import('/js/core/request-scheduler.js');
    const { createTransport } = await import('/contract/transport.js');
    const scheduler = createScheduler();
    const transport = createTransport(scheduler);
    const schema = await transport.schema('');
    const frame = createPanelFrame({
      panel: PLAN_TIMELINE_PANEL, spec: { plan: { repo_id: 'repo-z', plan: '99' } }, scope: {},
      transport, scheduler, tenant: '', schema: schema.body
    });
    document.getElementById('app').replaceChildren(frame.element);
    await frame.load();
  });
  await page.waitForFunction(() => document.querySelector('[data-panel="plan-timeline"]')?.dataset.idle === 'true');
  const panel = page.locator('[data-panel="plan-timeline"]');
  assert.equal(await panel.getAttribute('data-state'), 'empty');
  assert.match(await panel.innerText(), /no served plan \(repo-z, 99\)/);
  assert.match(await panel.innerText(), /Plans/);

  // The plan detail's fixed-plan path still draws a served plan.
  await page.evaluate(async () => {
    const { PLAN_TIMELINE_PANEL } = await import('/js/panels/plan-timeline.js');
    const { createPanelFrame } = await import('/js/panels/panel-frame.js');
    const { createScheduler } = await import('/js/core/request-scheduler.js');
    const { createTransport } = await import('/contract/transport.js');
    const scheduler = createScheduler();
    const transport = createTransport(scheduler);
    const schema = await transport.schema('');
    const frame = createPanelFrame({
      panel: PLAN_TIMELINE_PANEL, spec: { plan: { repo_id: 'repo-a', plan: '20' } }, scope: {},
      transport, scheduler, tenant: '', schema: schema.body
    });
    document.getElementById('app').replaceChildren(frame.element);
    await frame.load();
  });
  await page.waitForFunction(() => document.querySelector('[data-panel="plan-timeline"]')?.dataset.idle === 'true');
  assert.equal(await page.locator('[data-panel="plan-timeline"]').getAttribute('data-state'), 'ready');
  assert.ok(await page.evaluate(() => document.querySelector('[data-panel="plan-timeline"] yk-lanes').inspect().marks.length > 0));

  await diagnostics.assertClean();
});
