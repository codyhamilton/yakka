// Phase 11 unit 11-04: the Sessions list and bounded detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { validatePanelEntry, registerPanel, lookupPanel, hasPanel } from '../../web/js/panels/registry.js';
import { listPresets } from '../../web/js/boards/presets.js';
import {
  SESSION_FILTERS, SESSION_MEASURES, DEFAULT_SORT, artifactHref, allowedFilters, allowedMeasures,
  conversationScope, formatSessionCost, formatTotals, mapSessionListResponse, mergeSessionRows,
  parseSort, planHref, populationText, readScope, sessionArtifactLinks, sessionCoverageNotes,
  sessionListParams, sessionPageParams, sessionPlanLinks, unappliedFilter
} from '../../web/js/explorers/sessions.js';
import {
  SESSION_LANES_PANEL, conversationCoverage, coverageLines, conversationParams, mapConversationResponse,
  sessionLaneModel, classifyConversationEvent
} from '../../web/js/panels/session-lanes.js';
import { p11Schema, p11SessionList, p11Conversation, p11SessionListRows } from '../workspace/fixture.mjs';

const environment = loadBrowserEnvironment();
const schema = p11Schema();
const conversation = p11Conversation('conv-000');

test('sort accepts only published session measures and defaults to last_ts desc', () => {
  assert.deepEqual(parseSort('', SESSION_MEASURES), { measure: 'last_ts', dir: 'desc', raw: 'last_ts:desc' });
  assert.deepEqual(parseSort('cost_usd:asc', SESSION_MEASURES), { measure: 'cost_usd', dir: 'asc', raw: 'cost_usd:asc' });
  assert.deepEqual(parseSort('nope:asc', SESSION_MEASURES), { measure: 'last_ts', dir: 'desc', raw: 'last_ts:desc' });
  assert.equal(DEFAULT_SORT, 'last_ts:desc');
  assert.deepEqual(allowedMeasures(schema), SESSION_MEASURES);
  assert.deepEqual(allowedMeasures({ grains: { session: { measures: ['cost_usd', 'nope'] } } }), ['cost_usd']);
  assert.deepEqual(allowedFilters(schema), SESSION_FILTERS);
});

test('the list request sends only contract names, the frozen window, sort and paging', () => {
  const params = sessionListParams({
    state: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', tz: 'UTC', filters: { harness: ['orca'], tool: ['Bash'] }, exclude: ['session_model:gpt', 'screen_verdict:pass'] },
    filters: SESSION_FILTERS, measures: SESSION_MEASURES, sort: 'cost_usd:asc', limit: 500, cursor: 'abc'
  });
  assert.equal(params.get('grain'), 'session');
  assert.equal(params.get('sort'), 'cost_usd:asc');
  assert.equal(params.get('limit'), '500');
  assert.equal(params.get('cursor'), 'abc');
  assert.equal(params.get('tz'), 'UTC');
  assert.equal(params.get('from'), '2026-09-01T00:00:00.000Z');
  assert.equal(params.has('win'), false);
  assert.equal(params.has('tool'), false, 'an undeclared filter is never sent');
  assert.deepEqual(params.getAll('harness'), ['orca']);
  assert.deepEqual(params.getAll('exclude'), ['session_model:gpt']);
  assert.equal(params.has('cohort'), false);
  const next = sessionPageParams(params, { cursor: 'next', limit: 20 });
  assert.equal(next.get('cursor'), 'next');
  assert.equal(next.get('sort'), 'cost_usd:asc');
});

test('session-specific filters are folded out of the unknown URL bag without duplicating', () => {
  const state = readScope({ filters: { harness: ['orca'] }, unknown: { session_model: ['claude'], sort: ['cost_usd:asc'] }, exclude: [] }, SESSION_FILTERS);
  assert.deepEqual(state.filters.session_model, ['claude']);
  assert.equal('session_model' in state.unknown, false);
  assert.deepEqual(state.unknown.sort, ['cost_usd:asc']);
  assert.equal(unappliedFilter({ filters: {}, unknown: { session_model: ['claude'] } }, SESSION_FILTERS), 'session_model');
  assert.equal(unappliedFilter({ filters: {}, unknown: { sort: ['x'] } }, SESSION_FILTERS), '');
});

test('the fixture pages with an opaque cursor and a stable server sort', () => {
  const first = p11SessionList({ sort: 'last_ts:desc', limit: 20 });
  const second = p11SessionList({ sort: 'last_ts:desc', limit: 20, cursor: first.next });
  assert.equal(first.rows.length, 20);
  assert.equal(second.rows.length, 20);
  assert.ok(first.next && !second.next);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 40);
  assert.ok(Number(first.rows[0].m.last_ts) >= Number(first.rows[19].m.last_ts));
  const asc = p11SessionList({ sort: 'cost_usd:asc', limit: 40 });
  const desc = p11SessionList({ sort: 'cost_usd:desc', limit: 40 });
  assert.ok(asc.rows[0].m.cost_usd <= asc.rows[10].m.cost_usd);
  assert.ok(desc.rows[0].m.cost_usd >= desc.rows[10].m.cost_usd);
  const merged = mergeSessionRows(first.rows, second.rows);
  assert.equal(merged.rows.length, 40);
  assert.equal(mergeSessionRows(merged.rows, second.rows).added, 0);
  const orca = p11SessionList({ sort: 'last_ts:desc', limit: 40, filters: { harness: ['orca'] } });
  assert.ok(orca.rows.every(row => row.l.harness === 'orca'));
});

test('the list maps into the one panel-state vocabulary and unpriced is never $0', () => {
  assert.equal(mapSessionListResponse({ status: 200, body: { rows: [p11SessionListRows()[0]], population: {} } }).state, 'ready');
  assert.equal(mapSessionListResponse({ status: 200, body: { rows: [] } }).state, 'empty');
  assert.equal(mapSessionListResponse({ status: 404, body: { error: 'not found' } }).state, 'unsupported');
  const error = mapSessionListResponse({ status: 500, body: { error: 'read failed', code: 'read failed' } });
  assert.equal(error.state, 'error');
  assert.equal(error.message, 'read failed');
  const rows = p11SessionListRows();
  assert.equal(formatSessionCost(rows[4]), 'unpriced');
  assert.match(formatSessionCost(rows[9]), /lower bound/);
  assert.equal(formatSessionCost({ m: { cost_usd: 0, unpriced_calls: 0 } }), '$0.00');
  assert.match(formatSessionCost({ m: { cost_usd: 1.5, unpriced_calls: 0 } }), /^\$1\.50$/);
  const population = { unit: 'session', scope_n: 40, eligible_n: 40, returned_n: 20 };
  assert.equal(populationText(population, rows.slice(0, 20)), '20 of 40 sessions shown');
  assert.equal(populationText(population, rows), '40 loaded; 20 on this page; 40 sessions total');
  const notes = sessionCoverageNotes({ population, rows: [rows[4], rows[9], { l: { session_repo: '(none)' }, m: {} }] });
  assert.ok(notes.some(note => /all-unpriced/.test(note)));
  assert.ok(notes.some(note => /lower-bound/.test(note)));
  assert.ok(notes.some(note => /no session repo/.test(note)));
});

test('the conversation cap, returned markers and omitted unpriced calls reconcile', () => {
  const coverage = conversationCoverage(conversation);
  assert.equal(coverage.returned, 5000);
  assert.equal(coverage.total, 5123);
  assert.equal(coverage.omitted, 123);
  assert.equal(coverage.returnedUnpriced, 10);
  assert.equal(coverage.totalUnpriced, 13);
  assert.equal(coverage.omittedUnpriced, 3);
  assert.equal(coverage.truncated, true);
  const lines = coverageLines(coverage);
  assert.match(lines[0], /Returned 5,000 of 5,123 events/);
  assert.match(lines[1], /123 events are beyond the cap/);
  assert.match(lines[2], /Returned unpriced calls: 10 of 13/);
  assert.match(lines[3], /3 unpriced calls are beyond the cap/);
  const model = sessionLaneModel(conversation);
  assert.equal(model.data.length, coverage.returned, 'one marker per returned event');
  assert.equal(model.tableRows.length, coverage.returned);
  assert.equal(model.unpricedCalls, 10, 'visible hollow markers are returned unpriced calls only');
  assert.ok(model.lanes.some(lane => lane.key === 'tool:shell'));
  assert.ok(model.lanes.some(lane => lane.key === 'model_calls'));
  assert.ok(model.lanes.some(lane => lane.key === 'artifacts'));
  assert.ok(model.lanes.some(lane => lane.key === 'commits'));
  assert.ok(model.cumulativeCostUsd > 0);
  assert.equal(classifyConversationEvent(conversation.events[49]).priced, false);
  assert.equal(classifyConversationEvent(conversation.events[49]).kind, 'model_call');
  assert.equal(classifyConversationEvent(conversation.events[0]).lane, 'tool:shell');
});

test('detail links name observed artifacts and plans with their Phase 12 destinations', () => {
  const artifacts = sessionArtifactLinks(conversation);
  assert.ok(artifacts.some(link => link.path.endsWith('DESIGN.md') && link.hash === 'hash-design'));
  const plans = sessionPlanLinks(conversation);
  assert.ok(plans.some(link => link.plan === '20-analytics-reset' && link.repo_id === 'repo-a'));
  assert.match(artifactHref(artifacts[0]), /^\/artifact\?repo_id=.+&path=.+&hash=/);
  assert.equal(planHref({ repo_id: 'repo-a', plan: '20-analytics-reset' }), '/plans/repo-a/20-analytics-reset');
  assert.deepEqual(conversationScope({ win: '30d', from: '', to: '' }), { from: '', to: '' });
  assert.deepEqual(conversationScope({ from: 'a', to: 'b' }), { from: 'a', to: 'b' });
  const params = conversationParams('conv-000', { from: '2026-09-01T00:00:00Z', to: '' });
  assert.equal(params.get('id'), 'conv-000');
  assert.equal(params.has('cohort'), false);
  assert.equal(params.has('win'), false);
  const missing = mapConversationResponse({ status: 404, body: { error: 'conversation not found' } });
  assert.equal(missing.state, 'error');
  assert.equal(missing.message, 'conversation not found');
  assert.equal(formatTotals({ model_calls: 2, cost_usd: null, unpriced_calls: 2 })[1].value, 'unpriced');
});

test('session-lanes is a valid registered panel that no preset names', () => {
  assert.doesNotThrow(() => validatePanelEntry(SESSION_LANES_PANEL));
  assert.equal(SESSION_LANES_PANEL.id, 'session-lanes');
  assert.equal(SESSION_LANES_PANEL.grain, 'session');
  assert.deepEqual(SESSION_LANES_PANEL.charts, ['lanes']);
  assert.equal(SESSION_LANES_PANEL.table, true);
  assert.equal(SESSION_LANES_PANEL.load instanceof Function, true);
  if (!hasPanel('session-lanes')) registerPanel(SESSION_LANES_PANEL);
  assert.equal(lookupPanel('session-lanes').id, 'session-lanes');
  for (const preset of listPresets()) assert.equal(preset.panels?.includes('session-lanes') || false, false, `${preset.id} must not name session-lanes`);
});

// --- Chromium ------------------------------------------------------------

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

async function settleList(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="sessions-list"]')?.dataset.idle === 'true');
}

async function settleDetail(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="session-lanes"]')?.dataset.idle === 'true');
}

test('the sessions list sorts server-side, appends a unique second page and narrows by a lens chip', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const diagnostics = await watchPage(page);
  const panel = page.locator('[data-panel="sessions-list"]');

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.session-row').count(), 20);
  assert.match(await panel.innerText(), /20 of 40 sessions shown/);

  await page.selectOption('.session-sort-measure', 'cost_usd');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'cost_usd:desc');
  await settleList(page);
  const costs = async () => page.locator('.session-row td[data-key="cost_usd"]').evaluateAll(cells => cells.map(cell => cell.textContent));
  const descValues = (await costs()).filter(text => !/unpriced/.test(text)).map(text => Number(text.replace(/[^0-9.]/g, '')));
  for (let index = 1; index < descValues.length; index += 1) assert.ok(descValues[index - 1] >= descValues[index], `cost desc at ${index}`);
  await page.selectOption('.session-sort-direction', 'asc');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'cost_usd:asc');
  await settleList(page);
  const ascValues = (await costs()).filter(text => !/unpriced/.test(text)).map(text => Number(text.replace(/[^0-9.]/g, '')));
  for (let index = 1; index < ascValues.length; index += 1) assert.ok(ascValues[index - 1] <= ascValues[index], `cost asc at ${index}`);

  await page.locator('.sessions-load-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 40);
  const ids = await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.dataset.sessionId));
  assert.equal(new Set(ids).size, 40);
  assert.equal(await page.locator('.sessions-load-more').count(), 0);

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  await page.locator('.session-lens', { hasText: 'harness: orca' }).first().click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('harness') === 'orca');
  await settleList(page);
  const harnesses = await page.locator('.session-row td[data-key="harness"]').allInnerTexts();
  assert.ok(harnesses.length > 0 && harnesses.every(value => value === 'orca'));
  assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 1);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('the list names an empty result and the server error verbatim', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);
  const panel = page.locator('[data-panel="sessions-list"]');

  await control(harness.origin, { empty: true });
  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'empty');
  assert.match(await panel.innerText(), /No rows match/);
  await control(harness.origin, { empty: false });

  await control(harness.origin, { p11: false, scenario: 'legacy' });
  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'unsupported');
  assert.match(await panel.innerText(), /entities_session/);

  await control(harness.origin, { p11: true, scenario: 'default', sessionError: true });
  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'error');
  assert.match(await panel.innerText(), /sessions read failed/);
  assert.ok(await page.locator('[data-panel="sessions-list"] button', { hasText: 'Retry' }).count() > 0);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*500/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  await control(harness.origin, { p11: true, scenario: 'default', sessionError: false });
});

test('the detail draws returned markers, states the cap and links artifacts, plans and the ledger', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/sessions/conv-000`);
  await settleDetail(page);
  const panel = page.locator('[data-panel="session-lanes"]');
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.session-event-row').count(), 5000);
  const marks = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').inspect().marks.length);
  assert.equal(marks, 5000, 'displayed markers equal returned events');
  const hollow = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').shadowRoot.querySelectorAll('.yk-lane-marker[data-priced="false"]').length);
  assert.equal(hollow, 10);
  const text = await panel.innerText();
  assert.match(text, /Returned 5,000 of 5,123 events/);
  assert.match(text, /123 events are beyond the cap/);
  assert.match(text, /Returned unpriced calls: 10 of 13/);
  assert.match(text, /3 unpriced calls are beyond the cap/);
  assert.equal(await page.locator('.session-event-row[data-priced="false"]').count(), 10);
  const ledger = await page.locator('.session-ledger-link').getAttribute('href');
  assert.match(ledger, /\/ledger\?conversation_id=conv-000/);
  const artifact = await page.locator('.session-artifact-link').first().getAttribute('href');
  assert.match(artifact, /^\/artifact\?repo_id=repo-a&path=.*&hash=hash-design/);
  assert.match(await page.locator('.session-written').innerText(), /artifact reader is Phase 12/);
  assert.match(await page.locator('.session-written').innerText(), /plan detail is Phase 12/);
  const plan = await page.locator('.session-plan-link').first().getAttribute('href');
  assert.match(plan, /^\/plans\/repo-a\/20-analytics-reset$/);
  const conversations = harness.api.state.requests.filter(item => /\/conversation$/.test(item.path));
  assert.ok(conversations.length > 0);
  for (const request of conversations) assert.equal(request.search.includes('cohort'), false);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('an unknown conversation renders the server message with retry', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/sessions/conv-999`);
  await settleDetail(page);
  const panel = page.locator('[data-panel="session-lanes"]');
  assert.equal(await panel.getAttribute('data-state'), 'error');
  assert.match(await panel.innerText(), /conversation not found/);
  assert.ok(await page.locator('[data-panel="session-lanes"] button', { hasText: 'Retry' }).count() > 0);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*404/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
});
