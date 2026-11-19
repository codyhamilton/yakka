// Phase 9 acceptance: the Phase 9 outcome line proved end to end in Chromium
// over the committed fixture harness and stub. Every case records its expected
// and actual value; the final test prints one summary naming each case and its
// state. This file is external-module-only, uses no fixed sleeps, and asserts
// at most four analytics requests in flight on every page it visits.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { encodePanelSpec } from '../../web/js/core/view-spec.js';
import { cohortDefinition, encodeCohort } from '../../web/js/core/selection-model.js';

const environment = loadBrowserEnvironment();
const DAY = 86400e3;
const CASES = [];

function record(name, actual, expected) {
  const ok = actual === expected;
  CASES.push({ name, actual, expected, ok });
  assert.equal(actual, expected, `${name}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
}

function check(name, actual, expected) {
  const ok = actual === expected;
  CASES.push({ name, actual, expected, ok });
  return ok;
}

async function settleShell(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
}

async function settlePanels(page, ids) {
  await page.waitForFunction(list => list.every(id => {
    const panel = document.querySelector(`.workspace-panel[data-panel="${id}"]`);
    return panel && panel.dataset.idle === 'true';
  }), ids);
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

// Deterministic `/activity` list rows, one of each observation type, echoing the
// committed fixture. Only mode=list is intercepted; probes stay the stub's.
const ACTIVITY_ROWS = ['session_start', 'artifact_version', 'execution', 'rejection'].map((type, index) => ({
  event_time: new Date(Date.parse('2026-09-30T12:00:00Z') - index * DAY).toISOString(),
  type,
  identity: `fix-${type}`,
  conversation_id: type === 'session_start' ? 'fix-session' : 'fix-session',
  repo_id: type === 'session_start' ? '' : 'fix-repo',
  path: type === 'artifact_version' ? 'docs/plans/20-fix/PLAN.md' : '',
  harness: 'orca',
  kind: type === 'artifact_version' ? 'design' : '',
  plan: '20',
  stage: type === 'rejection' ? 'screen' : ''
}));

function queryBody(url, { effective = 'day' } = {}) {
  const measure = url.searchParams.get('measure') || 'cost_usd';
  const bucket = url.searchParams.get('bucket') || 'none';
  const dim = url.searchParams.get('dim');
  const population = { grain: 'time', unit: 'bucket', scope_n: 14, cohort_n: 14, eligible_n: 14, returned_n: 0, missing_by_reason: {}, relation: null };
  if (!dim) {
    const start = Date.parse('2026-09-01T00:00:00Z');
    const rows = Array.from({ length: 14 }, (_, index) => ({ t: new Date(start + index * DAY).toISOString(), k: [], v: index + 1 }));
    return { requested: { bucket: 'day' }, effective: { bucket: effective }, rows, population: { ...population, returned_n: rows.length } };
  }
  if (bucket === 'day') {
    const start = Date.parse('2026-09-01T00:00:00Z');
    const rows = ['orca', 'claude'].flatMap((key, group) => Array.from({ length: 7 }, (_, index) => ({
      t: new Date(start + index * DAY).toISOString(), k: [key], v: group === 0 ? index + 1 : 7 - index
    })));
    return { requested: { bucket: 'day' }, effective: { bucket: 'day' }, rows, population: { ...population, returned_n: rows.length } };
  }
  const rows = measure === 'unpriced_calls'
    ? [{ k: ['orca'], v: 1 }, { k: ['claude'], v: 0 }]
    : [{ k: ['orca'], v: 10 }, { k: ['claude'], v: 4 }];
  return { requested: { bucket: 'none' }, effective: { bucket: 'none' }, rows, population: { ...population, returned_n: rows.length } };
}

// Install the deterministic Pulse responses. `hold.summary` gates the summary
// route; the loading case releases it explicitly, never by a timer.
async function installPulseRoutes(page) {
  const state = { listRequests: 0, holdSummary: false, releaseSummary: null, summaryGate: null, effective: 'day' };
  await page.route(/\/v1\/analytics\/activity/, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('mode') !== 'list') return route.continue();
    state.listRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'list',
        rows: ACTIVITY_ROWS,
        population: { grain: 'activity', unit: 'typed_observation', scope_n: 4, cohort_n: 4, eligible_n: 4, returned_n: 4, missing_by_reason: {}, by_type: {} }
      })
    });
  });
  await page.route(/\/v1\/analytics\/query/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(queryBody(new URL(route.request().url()), { effective: state.effective }))
  }));
  await page.route(/\/v1\/analytics\/scores/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ kind: 'design', checks: [{ name: 'clarity', n: 10, median: 0.72, scorer: 'jev-1' }] })
  }));
  await page.route(/\/v1\/analytics\/summary/, async route => {
    if (!state.holdSummary) return route.continue();
    if (!state.summaryGate) state.summaryGate = new Promise(resolve => { state.releaseSummary = resolve; });
    await state.summaryGate;
    await route.continue();
  });
  return {
    state,
    holdSummary() { state.holdSummary = true; },
    releaseSummary() {
      state.holdSummary = false;
      state.releaseSummary?.();
      state.releaseSummary = null;
      state.summaryGate = null;
    }
  };
}

async function clickMark(page, panelId, tag, key) {
  await page.locator(`[data-panel="${panelId}"] ${tag}`).scrollIntoViewIfNeeded();
  await page.waitForFunction(([panel, selector]) => {
    const chart = document.querySelector(`[data-panel="${panel}"] ${selector}`);
    return chart?.dataset.state === 'ready' && chart.inspect().marks.length > 0;
  }, [panelId, tag]);
  const point = await page.evaluate(([panel, selector, markKey]) => {
    const chart = document.querySelector(`[data-panel="${panel}"] ${selector}`);
    const result = chart.inspect();
    const mark = result.marks.find(item => item.key === markKey);
    if (!mark) return null;
    return { x: result.plot.left + mark.px, y: result.plot.top + mark.py };
  }, [panelId, tag, key]);
  assert.ok(point, `mark ${key} is drawn`);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
}

test('every Start question path opens its destination or names the missing capability', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const diagnostics = await watchPage(page);
  await installPulseRoutes(page);

  await control(harness.origin, { scenario: 'default', role: 'admin' });
  await page.goto(`${harness.origin}/`);
  await settleShell(page);
  const links = await page.locator('.question-paths a').evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute('href'), text: node.textContent })));
  record('Start lists every question path', links.length, 15);
  record('Start enables every path on a full server', await page.locator('.question-paths [aria-disabled="true"]').count(), 0);

  const named = [];
  const p10Panels = {
    '/b/cost': ['trend-columns', 'rank', 'treemap', 'dist-ranges', 'dist-hist', 'dist-ecdf'],
    '/b/quality': ['score-ranges', 'score-trend', 'score-strips', 'band-mix'],
    '/b/tools': ['mix', 'treemap', 'rank', 'rhythm']
  };
  const p12Panels = {
    '/b/workflow': ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river']
  };
  for (const link of links) {
    const target = new URL(`${harness.origin}${link.href}`).pathname;
    if (p10Panels[target]) await control(harness.origin, { p10: true });
    if (p12Panels[target] || target === '/plans') await control(harness.origin, { p12: true });
    await page.goto(`${harness.origin}${link.href}`);
    await settleShell(page);
    const path = new URL(page.url()).pathname;
    if (path === '/plans') {
      await settlePanels(page, ['plans-list', 'scatter-plan']);
      await control(harness.origin, { p12: false });
    } else if (path === '/b/pulse') {
      await settlePanels(page, ['river', 'pulse-strips', 'movers', 'calendar', 'coverage']);
    } else if (path === '/ops') {
      await settlePanels(page, ['ops-footprint']);
    } else if (path === '/ledger') {
      await settlePanels(page, ['ledger-table']);
    } else if (p10Panels[path]) {
      await settlePanels(page, p10Panels[path]);
      await control(harness.origin, { p10: false });
    } else if (p12Panels[path]) {
      await settlePanels(page, p12Panels[path]);
      await control(harness.origin, { p12: false });
    }
    const heading = await page.evaluate(() => document.querySelector('#app h1')?.textContent || '');
    assert.notEqual(heading, 'Not found', `${link.text} (${link.href}) is not a dead link`);
    if (path === '/plans' || path === '/b/workflow') {
      assert.doesNotMatch(await page.locator('main').innerText(), /Delivered in Phase/, `${path} is delivered, not named`);
      named.push(path);
    }
  }
  record('both formerly named Start destinations are delivered', named.length, 2);

  await control(harness.origin, { scenario: 'legacy' });
  await page.goto(`${harness.origin}/`);
  await settleShell(page);
  const disabled = page.locator('.question-paths [aria-disabled="true"]');
  record('an old server disables the paths that need absent features', await disabled.count(), 10);
  const disabledText = (await page.locator('.question-paths').allInnerTexts()).join('\n');
  assert.match(disabledText, /does not advertise entities_session/);
  assert.match(disabledText, /does not advertise activity/);
  await control(harness.origin, { scenario: 'default' });

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('Pulse proves feed, brush, zoom, Follow, chips, tray, typed populations and the capability inspector', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);
  const routes = await installPulseRoutes(page);

  const panelIds = ['river', 'pulse-strips', 'movers', 'calendar', 'coverage'];
  const testStart = CASES.length;
  await page.goto(`${harness.origin}/b/pulse?win=30d`);
  await settlePanels(page, panelIds);
  record('Pulse settles five panels', await page.locator('.workspace-panel').count(), 5);
  for (const id of panelIds) {
    record(`Pulse ${id} is settled`, await page.locator(`[data-panel="${id}"]`).getAttribute('data-idle'), 'true');
  }

  // River feed: each observation type opens its own provenance.
  await clickMark(page, 'river', 'yk-lanes', 'session_start:fix-session_start');
  const sessionInspector = await page.locator('.workspace-inspector').innerText();
  check('the session observation names its conversation', /conversation_id\s+fix-session/.test(sessionInspector), true);
  await page.keyboard.press('Escape');
  await clickMark(page, 'river', 'yk-lanes', 'artifact_version:fix-artifact_version');
  const artifactInspector = await page.locator('.workspace-inspector').innerText();
  check('the artifact observation names its path', /docs\/plans\/20-fix\/PLAN\.md/.test(artifactInspector), true);
  await page.keyboard.press('Escape');
  await clickMark(page, 'river', 'yk-lanes', 'execution:fix-execution');
  const executionInspector = await page.locator('.workspace-inspector').innerText();
  check('the execution observation names its repo', /repo_id\s+fix-repo/.test(executionInspector), true);
  await page.keyboard.press('Escape');
  record('river inspect opens entity provenance', await page.locator('.workspace-inspector').getAttribute('data-open'), 'false');

  // Calendar: a brush previews peers with no history push and no from/to; zoom commits.
  await page.locator('[data-panel="calendar"] yk-matrix').scrollIntoViewIfNeeded();
  const points = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="calendar"] yk-matrix');
    return [1, 8].map(index => {
      const rect = chart.shadowRoot.querySelector(`[data-mark="${index}"] [data-hit]`).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
  });
  const historyBefore = await page.evaluate(() => history.length);
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  await page.mouse.move(points[1].x, points[1].y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-panel="calendar"] .pulse-preview')?.dataset.state === 'preview');
  const brushSearch = new URLSearchParams(await page.evaluate(() => location.search));
  assert.ok(brushSearch.get('sel'), 'the brush writes a transient sel');
  record('a brush does not push history', await page.evaluate(() => history.length), historyBefore);
  record('a brush leaves from uncommitted', brushSearch.get('from'), null);
  assert.match(await page.locator('[data-panel="calendar"] .pulse-preview').innerText(), /Peer preview only/);
  await page.locator('[data-panel="calendar"] .pulse-zoom').click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('from') !== null);
  await settlePanels(page, panelIds);
  const zoomSearch = new URLSearchParams(await page.evaluate(() => location.search));
  assert.ok(zoomSearch.get('from') && zoomSearch.get('to'));
  record('zoom clears the transient brush', zoomSearch.get('sel'), null);

  // Follow: off by default, counts without advancing, acknowledge advances, error holds.
  const toggle = page.locator('[data-panel="river"] .river-follow-toggle');
  record('Follow starts off', await toggle.getAttribute('aria-pressed'), 'false');
  record('Follow names no acknowledged watermark', await page.locator('[data-panel="river"] .river-follow-watermark').innerText(), 'Acknowledged watermark: none');
  await toggle.click();
  await page.waitForFunction(() => /Session start: [\d,]+ sessions?/.test(document.querySelector('[data-panel="river"] .river-follow-counts')?.textContent || ''));
  const beforeProbe = routes.state.listRequests;
  await page.locator('[data-panel="river"] .river-follow-probe').click();
  await page.waitForFunction(async () => (await (await fetch('/__test/stats')).json()).probes >= 1);
  record('a probe reports late counts without acknowledging', await page.locator('[data-panel="river"] .river-follow-watermark').innerText(), 'Acknowledged watermark: none');
  await page.locator('[data-panel="river"] .river-follow-ack').click();
  await page.waitForFunction(() => /MTAwMA/.test(document.querySelector('[data-panel="river"] .river-follow-watermark')?.textContent || ''));
  await page.waitForFunction(before => document.querySelectorAll('[data-panel="river"] .river-follow-counts li').length > 0, beforeProbe);
  assert.ok(routes.state.listRequests > beforeProbe, 'acknowledge refetches the feed');
  await diagnostics.assertClean();
  await control(harness.origin, { activityError: true });
  const probesBefore = (await (await fetch(`${harness.origin}/__test/stats`)).json()).probes;
  await page.locator('[data-panel="river"] .river-follow-probe').click();
  await page.waitForFunction(() => /Probe failed/.test(document.querySelector('[data-panel="river"] .river-follow-status')?.textContent || ''));
  record('a failed probe leaves the acknowledged watermark', await page.locator('[data-panel="river"] .river-follow-watermark').innerText(), 'Acknowledged watermark: MTAwMA');
  await control(harness.origin, { activityError: false });
  await toggle.click();
  assert.ok((await (await fetch(`${harness.origin}/__test/stats`)).json()).probes > probesBefore);

  // Chips, tray, typed populations, and an unknown URL key surviving a scope change.
  await page.goto(`${harness.origin}/b/pulse?win=30d&harness=orca&exclude=screen_verdict%3Apass&pick=s1%2Cs2%7C&future=1`);
  await settlePanels(page, panelIds);
  record('the shared filter chip is shown', await page.locator('.workspace-chip[data-kind="filter"]').count() >= 1, true);
  record('the exclusion chip is shown', await page.locator('.workspace-chip[data-kind="exclude"]').count() >= 1, true);
  record('the selection chip is shown', await page.locator('.workspace-chip[data-kind="selection"]').count() >= 1, true);
  assert.match(await page.locator('.workspace-panel[data-panel="river"] .workspace-panel-population').innerText(), /typed_observation/);
  record('the selection tray opens', await page.locator('.selection-tray').getAttribute('data-open'), 'true');
  await page.waitForFunction(() => {
    const text = document.querySelector('.selection-tray-summary')?.textContent || '';
    return /2\b/.test(text) && /in scope|typed population/.test(text);
  });
  record('the tray names the typed population', true, true);
  await page.locator('.workspace-chip[data-kind="filter"] .workspace-chip-remove').first().click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('harness'));
  const afterRemove = new URLSearchParams(await page.evaluate(() => location.search));
  record('an unknown URL key survives a scope change', afterRemove.get('future'), '1');
  assert.equal(afterRemove.get('pick'), 's1,s2|');

  // Capability inspector and the schema-driven chooser on each Pulse panel.
  for (const id of panelIds) {
    await page.locator(`[data-panel="${id}"] .capability-inspector summary`).click();
    record(`capability queries are listed for ${id}`, await page.locator(`[data-panel="${id}"] .capability-queries li`).count() > 0, true);
    assert.match(await page.locator(`[data-panel="${id}"] .capability-grain`).innerText(), /grain: .+/);
    record(`units are listed for ${id}`, await page.locator(`[data-panel="${id}"] .capability-units li`).count() > 0, true);
    assert.match(await page.locator(`[data-panel="${id}"] .capability-basis`).innerText(), /time basis: .+/);
    record(`budgets are listed for ${id}`, await page.locator(`[data-panel="${id}"] .capability-budgets li`).count() > 0, true);
    record(`coverage is listed for ${id}`, await page.locator(`[data-panel="${id}"] .capability-coverage li`).count() > 0, true);
    assert.ok((await page.locator(`[data-panel="${id}"] .capability-caveat`).innerText()).length > 0);
  }
  const moverOptions = await page.locator('[data-panel="movers"] select option').evaluateAll(nodes => [...new Set(nodes.map(node => node.value))].sort());
  record('the movers chooser offers only schema measures', JSON.stringify(moverOptions), JSON.stringify(['commits', 'cost_usd', 'model_calls']));
  const unsupported = page.locator('[data-panel="movers"] .capability-missing li[data-kind="measure"][data-name="unpriced_calls"]');
  record('an unsupported measure is kept and names the nearest choice', await unsupported.count(), 1);
  assert.match(await unsupported.innerText(), /nearest supported choice: measure cost_usd/);

  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /500/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
  assert.deepEqual(CASES.slice(testStart).filter(item => !item.ok), []);
});

test('a named board saves and reopens from its URL, and the ledger and ops prove their bounds', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);
  await installPulseRoutes(page);

  // A named board stores the URL and reopening navigates to exactly it.
  const panelSpec = encodePanelSpec({ grain: 'time', measures: ['cost_usd'], split: 'harness', chart: 'lines' });
  const saved = `/b/pulse?win=all&repo_id=r1&future=1&p1=${encodeURIComponent(panelSpec)}`;
  await page.goto(`${harness.origin}${saved}`);
  await settlePanels(page, ['river', 'pulse-strips', 'movers', 'calendar', 'coverage']);
  await page.locator('.save-board input').fill('Phase 9 acceptance');
  await page.locator('.save-board button').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('yakka-analytics-boards') || '[]').some(entry => entry.name === 'Phase 9 acceptance'));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('yakka-analytics-boards')).find(entry => entry.name === 'Phase 9 acceptance'));
  record('a saved board stores its URL', stored.url, saved);
  await page.goto(`${harness.origin}/b/pulse?win=7d`);
  await settlePanels(page, ['river', 'pulse-strips', 'movers', 'calendar', 'coverage']);
  await page.locator('.saved-board-list li', { hasText: 'Phase 9 acceptance' }).locator('button', { hasText: 'Open' }).click();
  await page.waitForFunction(url => `${location.pathname}${location.search}` === url, saved);
  await settleShell(page);
  await settlePanels(page, ['river', 'pulse-strips', 'movers', 'calendar', 'coverage']);
  record('a saved board reopens at its URL', `${new URL(page.url()).pathname}${new URL(page.url()).search}`, saved);
  record('the panel override survives the round trip', await page.evaluate(() => new URLSearchParams(location.search).get('p1') !== null), true);

  // `/ledger` cursor-pages beyond 20,000 with no duplicate and no gap.
  await page.goto(`${harness.origin}/ledger?win=all`);
  await settlePanels(page, ['ledger-table']);
  let guard = 0;
  while (await page.locator('.ledger-load-more').count() && guard++ < 200) {
    const before = await page.locator('.ledger-row').count();
    await page.locator('.ledger-load-more').click();
    await page.waitForFunction(count => document.querySelectorAll('.ledger-row').length > count, before);
    await settlePanels(page, ['ledger-table']);
  }
  const keys = await page.locator('.ledger-row').evaluateAll(rows => rows.map(row => row.dataset.rowKey));
  const times = await page.locator('.ledger-row').evaluateAll(rows => rows.map(row => row.dataset.ts));
  record('the ledger shows more than 20,000 rows', keys.length > 20000, true);
  record('ledger row keys are unique across pages', new Set(keys).size, keys.length);
  record('ledger rows are strictly non-increasing', times.every((value, index) => index === 0 || times[index - 1] >= value), true);
  assert.ok(await page.locator('.ledger-cost', { hasText: 'unpriced' }).count() > 0);
  record('an unpriced row is never $0', await page.locator('.ledger-cost', { hasText: /^\$0(\.00)?$/ }).count(), 0);
  await page.goto(`${harness.origin}/ledger?exclude=screen_verdict%3Apass`);
  await settlePanels(page, ['ledger-table']);
  assert.match(await page.locator('[data-panel="ledger-table"]').innerText(), /not applied here: screen_verdict/);

  // `/ops` renders authorised status for an admin and only the named refusal for a member.
  await control(harness.origin, { role: 'admin', statusError: false });
  await page.goto(`${harness.origin}/ops`);
  await settlePanels(page, ['ops-footprint']);
  record('ops renders the authorised status', await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'ready');
  record('ops keeps tenants separate', await page.locator('.ops-tenant').count(), 2);
  await control(harness.origin, { role: 'member' });
  await page.goto(`${harness.origin}/ops`);
  await settlePanels(page, ['ops-footprint']);
  record('a member sees only the administrator-only state', await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'unsupported');
  assert.match(await page.locator('[data-panel="ops-footprint"]').innerText(), /administrator only/i);
  record('a refused member sees no tenant values', await page.locator('.ops-tenant').count(), 0);
  await control(harness.origin, { role: 'admin' });

  // The member's 403 is the refused read the state is proving; Chromium logs it.
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /status of 403/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('every panel state and badge is reached through the harness scenes', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);
  const routes = await installPulseRoutes(page);

  // loading, held and released without a timer.
  routes.holdSummary();
  await page.goto(`${harness.origin}/b/pulse?win=30d`);
  await page.waitForFunction(() => document.querySelector('[data-panel="pulse-strips"]')?.dataset.state === 'loading');
  assert.match(await page.locator('[data-panel="pulse-strips"] .workspace-panel-status').innerText(), /Loading/);
  record('loading is held before the server answers', await page.locator('[data-panel="pulse-strips"]').getAttribute('data-idle'), 'false');
  routes.releaseSummary();
  await settlePanels(page, ['pulse-strips']);
  record('loading is released into ready', await page.locator('[data-panel="pulse-strips"]').getAttribute('data-state'), 'ready');

  // empty through the stub's explore scene.
  await control(harness.origin, { empty: true });
  await page.goto(`${harness.origin}/ledger?win=all`);
  await settlePanels(page, ['ledger-table']);
  record('empty names the state', await page.locator('[data-panel="ledger-table"]').getAttribute('data-state'), 'empty');
  assert.match(await page.locator('[data-panel="ledger-table"]').innerText(), /No rows match/);
  await control(harness.origin, { empty: false });

  // error with the server message, code and retry, then recovery.
  await control(harness.origin, { statusError: true });
  await page.goto(`${harness.origin}/ops`);
  await settlePanels(page, ['ops-footprint']);
  record('error is the frame state', await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'error');
  assert.match(await page.locator('[data-panel="ops-footprint"]').innerText(), /status read failed/);
  assert.match(await page.locator('[data-panel="ops-footprint"]').innerText(), /read failed/);
  const retry = page.locator('[data-panel="ops-footprint"] button', { hasText: 'Retry' });
  record('an error offers retry', await retry.count(), 1);
  await control(harness.origin, { statusError: false });
  await retry.click();
  await settlePanels(page, ['ops-footprint']);
  record('retry recovers the panel', await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'ready');

  // unsupported through the member scene, naming the capability.
  await control(harness.origin, { role: 'member' });
  await page.goto(`${harness.origin}/ops`);
  await settlePanels(page, ['ops-footprint']);
  record('unsupported names the missing capability', await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'unsupported');
  assert.match(await page.locator('[data-panel="ops-footprint"]').innerText(), /administrator only/i);
  await control(harness.origin, { role: 'admin' });

  // cancelled: an aborted load is cancelled, never an error, and the frame renders it.
  const cancelled = await page.evaluate(async () => {
    const { OPS_PANEL } = await import('/js/panels/ops-footprint.js');
    const { createPanelFrame } = await import('/js/panels/panel-frame.js');
    const { createScheduler } = await import('/js/core/request-scheduler.js');
    const { createTransport } = await import('/contract/transport.js');
    const scheduler = createScheduler();
    const transport = createTransport(scheduler);
    const panel = {
      ...OPS_PANEL,
      load: async context => {
        const controller = new AbortController();
        controller.abort();
        return OPS_PANEL.load({ ...context, signal: controller.signal });
      }
    };
    const frame = createPanelFrame({ panel, transport, scheduler, doc: document });
    document.body.append(frame.element);
    await frame.load();
    const result = { state: frame.element.dataset.state, idle: frame.element.dataset.idle };
    frame.destroy();
    return result;
  });
  record('cancelled is its own state, not an error', cancelled.state, 'cancelled');
  record('cancelled settles the frame', cancelled.idle, 'true');

  // coarsened: a response that answers at a coarser bucket carries the badge.
  routes.state.effective = 'week';
  await page.goto(`${harness.origin}/b/pulse?win=30d`);
  await settlePanels(page, ['calendar', 'pulse-strips', 'movers', 'river', 'coverage']);
  record('a coarsened response shows the coarsened badge', await page.locator('[data-panel="calendar"] .yk-badge[data-kind="coarsened"]').count(), 1);
  routes.state.effective = 'day';

  // The error and member scenes above deliberately return a real 500 and 403;
  // Chromium logs those failed resources. Page errors and CSP stay empty and
  // only the deliberate statuses may appear in the console.
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /status of (500|403)/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('acceptance summary names every case and its expected state', () => {
  const lines = CASES.map(item => `${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${JSON.stringify(item.actual)} (expected ${JSON.stringify(item.expected)})`);
  console.log(`\nPhase 9 acceptance summary (${CASES.filter(item => item.ok).length}/${CASES.length} cases)\n${lines.join('\n')}`);
  assert.ok(CASES.length > 0, 'the acceptance cases ran');
  assert.deepEqual(CASES.filter(item => !item.ok).map(item => item.name), []);
});
