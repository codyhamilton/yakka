// Phase 11 unit 11-04: the Sessions list and bounded detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { validatePanelEntry, registerPanel, lookupPanel, hasPanel } from '../../web/js/panels/registry.js';
import { listPresets } from '../../web/js/boards/presets.js';
import {
  SESSION_FILTERS, SESSION_LIST_COLUMNS, SESSION_MEASURES, DEFAULT_SORT, artifactHref, allowedFilters,
  allowedMeasures, conversationScope, formatSessionCost, formatTotals, mapSessionListResponse,
  mergeSessionRows, parseSort, planHref, populationText, readScope, sessionArtifactLinks,
  sessionCoverageNotes, sessionListParams, sessionPageParams, sessionPlanLinks, sessionStateModel,
  unappliedFilter
} from '../../web/js/explorers/sessions.js';
import {
  SESSION_LANES_PANEL, conversationCoverage, coverageLines, conversationParams, mapConversationResponse,
  sessionLaneModel, classifyConversationEvent
} from '../../web/js/panels/session-lanes.js';
import { p11Schema, p11SessionList, p11Conversation, p11SessionListRows } from '../workspace/fixture.mjs';

const environment = loadBrowserEnvironment();
const schema = p11Schema();
const conversation = p11Conversation('conv-000');

test('sort accepts only the contract session measures and defaults to cost_usd desc', () => {
  assert.deepEqual(parseSort('', SESSION_MEASURES), { measure: 'cost_usd', dir: 'desc', raw: 'cost_usd:desc' });
  assert.deepEqual(parseSort('duration_s:asc', SESSION_MEASURES), { measure: 'duration_s', dir: 'asc', raw: 'duration_s:asc' });
  assert.deepEqual(parseSort('nope:asc', SESSION_MEASURES), { measure: 'cost_usd', dir: 'desc', raw: 'cost_usd:desc' });
  assert.equal(DEFAULT_SORT, 'cost_usd:desc');
  assert.deepEqual(allowedMeasures(schema), SESSION_MEASURES);
  assert.deepEqual(allowedMeasures({ grains: { session: { measures: ['cost_usd', 'nope'] } } }), ['cost_usd']);
  assert.deepEqual(allowedFilters(schema), SESSION_FILTERS);
});

test('the sessions list columns and T1–T3 state vocabulary are the contract', () => {
  assert.deepEqual(SESSION_LIST_COLUMNS.map(column => column.label), [
    'Select', 'Session ID', 'Harness', 'Model', 'Repository', 'Cost USD', 'Calls', 'Unpriced',
    'Hook events', 'Commits', 'Artifact versions', 'Span seconds', 'Open'
  ]);
  assert.deepEqual(SESSION_LIST_COLUMNS.map(column => column.width), [
    '32px', '180px', '90px', '140px', '180px', '100px', '70px', '70px', '80px', '70px', '80px', '90px', '70px'
  ]);
  assert.equal(sessionStateModel('loading').text, 'Loading Sessions…');
  assert.equal(sessionStateModel('empty').text, 'No records match these filters.');
  assert.deepEqual(sessionStateModel('empty').actions.map(item => item.label), ['All history', 'Reset filters']);
  assert.equal(sessionStateModel('error', { status: 403, code: '<b>x</b>' }).text, 'Could not load Sessions.');
  assert.equal(sessionStateModel('error', { status: 403, code: '<b>x</b>' }).code, 'x');
  assert.equal(sessionStateModel('error', { status: 401 }).actions[0].label, 'Sign in');
  assert.match(sessionStateModel('error', { status: 503, retry: true }).detail, /server is busy/);
  assert.equal(sessionStateModel('error', { status: 503, retry: true }).actions[0].label, 'Retry');
});

test('the list request sends only contract names, the frozen window, sort and paging', () => {
  const params = sessionListParams({
    state: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', tz: 'UTC', filters: { harness: ['orca'], tool: ['Bash'] }, exclude: ['session_model:gpt', 'screen_verdict:pass'] },
    filters: SESSION_FILTERS, measures: SESSION_MEASURES, sort: 'cost_usd:asc', limit: 500, cursor: 'abc'
  });
  assert.equal(params.get('grain'), 'session');
  assert.equal(params.get('fields'), 'id,l.harness,session_model,session_repo,m.cost_usd,model_calls,unpriced_calls,hook_events,commits,artifact_versions,duration_s');
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

test('detail links name observed artifacts and delivered plan and artifact destinations', () => {
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const diagnostics = await watchPage(page);
  const panel = page.locator('[data-panel="sessions-list"]');

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.deepEqual(await page.locator('.sessions-table thead th').allInnerTexts(), SESSION_LIST_COLUMNS.map(column => column.label));
  assert.equal(await page.locator('.sessions-table').evaluate(table => getComputedStyle(table).minWidth), '1416px');
  assert.equal(await page.locator('.session-row').count(), 20);
  assert.match(await panel.innerText(), /20 of 40 sessions shown/);
  assert.equal(await page.locator('.session-sort-measure').inputValue(), 'cost_usd');
  assert.equal(await page.locator('.session-sort-direction').inputValue(), 'desc');
  const heights = await page.locator('.session-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
  for (const height of heights) assert.ok(Math.abs(height - 30) <= 1, `session row height ${height}`);

  const costs = async () => page.locator('.session-row td[data-key="cost_usd"]').evaluateAll(cells => cells.map(cell => cell.textContent));
  const descValues = (await costs()).filter(text => !/unpriced/.test(text)).map(text => Number(text.replace(/[^0-9.]/g, '')));
  for (let index = 1; index < descValues.length; index += 1) assert.ok(descValues[index - 1] >= descValues[index], `cost desc at ${index}`);
  await page.selectOption('.session-sort-direction', 'asc');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'cost_usd:asc');
  await settleList(page);
  const ascValues = (await costs()).filter(text => !/unpriced/.test(text)).map(text => Number(text.replace(/[^0-9.]/g, '')));
  for (let index = 1; index < ascValues.length; index += 1) assert.ok(ascValues[index - 1] <= ascValues[index], `cost asc at ${index}`);

  const urlBeforeSelect = page.url();
  await page.locator('.session-row-check').first().check();
  await page.waitForFunction(() => document.querySelector('.selection-tray')?.dataset.open === 'true');
  assert.equal(page.url(), urlBeforeSelect, 'Select changes the tray predicate, not the query');
  assert.equal(await page.locator('.session-row').count(), 20, 'Select does not filter immediately');

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

  const firstId = await page.locator('.session-row').first().getAttribute('data-session-id');
  await page.locator('.session-row .session-open').first().click();
  await page.waitForFunction(() => /^\/sessions\/conv-\d+$/.test(location.pathname));
  const opened = new URL(page.url());
  assert.equal(decodeURIComponent(opened.pathname), `/sessions/${firstId}`);
  assert.equal(opened.searchParams.get('win'), 'all', 'Open preserves the committed scope');
  assert.equal(opened.searchParams.get('harness'), 'orca');
  assert.equal(opened.searchParams.has('sort'), false, 'sort does not ride to the detail');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a failed next session page keeps loaded rows and offers Retry next page', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  const loaded = await page.locator('.session-row').count();
  await page.route('**/v1/analytics/entities**', async route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.get('cursor')) { await route.continue(); return; }
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'page read failed', code: 'read failed' }) });
  });

  await page.locator('.sessions-load-more').click();
  await page.waitForSelector('.sessions-next-error');
  assert.equal(await page.locator('.session-row').count(), loaded, 'loaded rows are kept');
  assert.match(await page.locator('.sessions-next-error').innerText(), /Could not load the next page\./);
  assert.equal((await page.locator('.sessions-retry-next').innerText()).trim(), 'Retry next page');

  await page.unroute('**/v1/analytics/entities**');
  await page.locator('.sessions-retry-next').click();
  await page.waitForFunction(count => document.querySelectorAll('.session-row').length > count, loaded);
  assert.equal(await page.locator('.sessions-next-error').count(), 0);
  assert.equal(await page.locator('.session-row').count(), loaded + 20);
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
  assert.match(await panel.innerText(), /No records match these filters\./);
  assert.deepEqual(await panel.locator('.sessions-state-action').allInnerTexts(), ['All history', 'Reset filters']);
  assert.deepEqual(await page.locator('.sessions-table thead th').allInnerTexts(), SESSION_LIST_COLUMNS.map(column => column.label));
  assert.equal(await page.locator('.session-row').count(), 0);
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
  assert.match(await panel.innerText(), /Could not load Sessions\./);
  assert.match(await panel.innerText(), /read failed/);
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
  const loaded = await page.locator('.session-record-row').count();
  assert.ok(loaded > 0, 'the paged records table loaded its first page');
  const marks = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').inspect().marks.length);
  assert.equal(marks, loaded, 'displayed markers equal loaded records');
  const hollow = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').shadowRoot.querySelectorAll('.yk-lane-marker[data-priced="false"]').length);
  assert.ok(hollow >= 1 && hollow <= loaded, `hollow unpriced markers ${hollow} within loaded ${loaded}`);
  const text = await panel.innerText();
  assert.match(text, new RegExp(`${loaded} loaded matching events plotted`));
  assert.match(text, /Whole session exception/);
  assert.match(text, /13 unpriced/);
  const ledger = await page.locator('.session-ledger-link').getAttribute('href');
  assert.match(ledger, /\/ledger\?conversation_id=conv-000/);
  const artifact = await page.locator('.session-artifact-link').first().getAttribute('href');
  assert.match(artifact, /^\/artifact\?repo_id=repo-a&path=.*&hash=hash-design/);
  assert.match(await page.locator('.session-written').innerText(), /opens the artifact reader/);
  assert.match(await page.locator('.session-written').innerText(), /opens the plan detail/);
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
