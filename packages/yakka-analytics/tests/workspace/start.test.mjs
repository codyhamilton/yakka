import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { encodePanelSpec } from '../../web/js/core/view-spec.js';

const environment = loadBrowserEnvironment();

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

const panelSpec = encodePanelSpec({ grain: 'session', measures: ['cost_usd', 'commits'], split: 'harness', chart: 'lines' });

test('workspace Start, routes, deep links, saved boards and Follow', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/`);
  await settle(page);
  assert.equal(await page.locator('.question-paths a').count(), 15);
  assert.match(await page.locator('main').innerText(), /Where did the money go this week against last\?/);
  assert.equal(await page.locator('.question-paths [aria-disabled="true"]').count(), 0);

  await page.goto(`${harness.origin}/b/trends`);
  await settle(page);
  assert.doesNotMatch(await page.locator('main').innerText(), /Delivered in Phase 10: Trends/);
  assert.ok(await page.locator('.workspace-panel[data-panel="trend-columns"]').count() === 1);

  await page.goto(`${harness.origin}/b/pulse`);
  await settle(page);
  const pulseIds = ['river', 'pulse-strips', 'movers', 'calendar', 'coverage'];
  await page.waitForFunction(ids => ids.every(id => {
    const panel = document.querySelector(`.workspace-panel[data-panel="${id}"]`);
    return panel && panel.getAttribute('data-idle') === 'true';
  }), pulseIds);
  assert.doesNotMatch(await page.locator('main').innerText(), /Delivered in Phase 9: Pulse/);
  for (const id of pulseIds) {
    assert.equal(await page.locator(`.workspace-panel[data-panel="${id}"]`).count(), 1, `${id} panel renders`);
  }

  // win=all survives reload and Back.
  await page.goto(`${harness.origin}/b/trends?win=all&repo_id=r1&exclude=model%3Ax&p1=${encodeURIComponent(panelSpec)}`);
  await settle(page);
  assert.match(await page.locator('.scope-bar').innerText(), /window all/);
  assert.match(await page.locator('.scope-bar').innerText(), /repo_id: r1/);
  assert.match(await page.locator('.scope-bar').innerText(), /exclude model:x/);
  await page.reload();
  await settle(page);
  assert.match(page.url(), /win=all/);
  assert.match(page.url(), /p1=/);
  await page.goto(`${harness.origin}/`);
  await settle(page);
  await page.goBack();
  await settle(page);
  assert.match(page.url(), /win=all/);
  assert.match(page.url(), /repo_id=r1/);
  assert.match(await page.locator('.scope-bar').innerText(), /window all/);

  // A ten-year finite window survives reload.
  const from = '2015-01-01T00:00:00Z';
  const to = '2025-01-01T00:00:00Z';
  await page.goto(`${harness.origin}/b/trends?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Australia%2FBrisbane`);
  await settle(page);
  await page.reload();
  await settle(page);
  assert.match(page.url(), /from=2015-01-01T00%3A00%3A00Z/);
  assert.match(page.url(), /to=2025-01-01T00%3A00%3A00Z/);
  assert.match(await page.locator('.scope-bar').innerText(), /tz Australia\/Brisbane/);

  // Register a delivered demo panel/preset through the public registry, then
  // open it in place so a board with frames exists for saved boards and Follow.
  await page.evaluate(async () => {
    const { registerPanel } = await import('/js/panels/registry.js');
    const { registerPreset } = await import('/js/boards/presets.js');
    registerPanel({
      id: 'demo-panel', grain: 'session', measures: ['cost_usd'], lenses: ['harness'], charts: ['lines'],
      requires: [], caveats: 'Demo only.',
      load: async () => ({ state: 'ready', population: { unit: 'session', scope_n: 3, eligible_n: 3, returned_n: 3 }, basis: 'fixture facts.ts' })
    });
    registerPreset({ id: 'demo', title: 'Demo', phase: 9, panels: ['demo-panel'] });
    history.pushState({}, '', '/b/demo?win=all&repo_id=r1');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => document.querySelector('.workspace-panel')?.dataset.state === 'ready');
  await settle(page);
  assert.equal(await page.locator('.workspace-panel').getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.workspace-panel').getAttribute('data-idle'), 'true');
  assert.match(await page.locator('.workspace-panel-population').innerText(), /3 of 3 session/);

  await diagnostics.assertClean();

  // Follow is off by default; toggling probes once and acknowledge advances the watermark.
  const followToggle = page.locator('.follow-bar button', { hasText: 'Follow' });
  assert.match(await followToggle.innerText(), /Follow: off/);
  assert.equal(await page.locator('.follow-status').getAttribute('data-watermark'), '');
  await followToggle.click();
  await page.waitForFunction(async () => (await (await fetch('/__test/stats')).json()).probes >= 1);
  await followToggle.click();
  await page.locator('.follow-bar button', { hasText: 'Acknowledge' }).click();
  await page.waitForFunction(() => document.querySelector('.follow-status')?.dataset.watermark === 'MTAwMA');

  // A failed probe leaves the acknowledged watermark unchanged.
  await control(harness.origin, { activityError: true });
  const probesBefore = (await (await fetch(`${harness.origin}/__test/stats`)).json()).probes;
  await followToggle.click();
  await page.waitForFunction(async value => (await (await fetch('/__test/stats')).json()).probes > value, probesBefore);
  assert.equal(await page.locator('.follow-status').getAttribute('data-watermark'), 'MTAwMA');
  await followToggle.click();
  await control(harness.origin, { activityError: false });

  // Saving stores the current URL; reopening navigates to that stored URL.
  const savedUrl = await page.evaluate(() => `${location.pathname}${location.search}`);
  await page.locator('.save-board input').fill('Deep board');
  await page.locator('.save-board button').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('yakka-analytics-boards') || '[]').some(entry => entry.name === 'Deep board'));
  await page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await settle(page);
  await page.evaluate(async () => {
    const { openBoard } = await import('/js/core/saved-boards.js');
    openBoard('Deep board', { navigate: url => { history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate')); } });
  });
  await page.waitForFunction(() => document.querySelector('.workspace-panel')?.dataset.state === 'ready');
  await settle(page);
  assert.equal(await page.evaluate(() => `${location.pathname}${location.search}`), savedUrl);

  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
  // The induced probe failure is the only expected console entry: the browser
  // logs the 500 the product is showing. Page errors and CSP violations stay empty.
  assert.equal(diagnostics.pageErrors.length, 0);
  assert.deepEqual(await diagnostics.cspViolations(), []);
});

test('an older or partial server disables paths with the reason and names missing features', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await control(harness.origin, { scenario: 'missing-feature', missingFeature: 'entities_session' });
  await page.goto(`${harness.origin}/`);
  await settle(page);
  assert.ok(await page.locator('.question-paths a').count() > 0);
  assert.ok(await page.locator('.question-paths [aria-disabled="true"]').count() > 0);
  assert.match(await page.locator('main').innerText(), /does not advertise entities_session/);

  await control(harness.origin, { scenario: 'legacy' });
  await page.goto(`${harness.origin}/b/scatter?win=all`);
  await settle(page);
  assert.equal(await page.locator('#app h1').innerText(), 'Scatter');
  const legacyScatter = await page.locator('main').innerText();
  assert.doesNotMatch(legacyScatter, /Delivered in Phase 11: Scatter/);
  assert.equal(await page.locator('.workspace-panel').count(), 4);
  assert.match(legacyScatter, /does not advertise/);
  await diagnostics.assertClean();
});

test('Start regions, table columns and the two-column board geometry match phase 2', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const diagnostics = await watchPage(page);

  await control(harness.origin, { scenario: 'default' });
  await page.goto(`${harness.origin}/`);
  await settle(page);

  const regionOrder = await page.evaluate(() => [...document.querySelector('#app').children].map(node => {
    if (node.classList.contains('scope-controls')) return 'scope-controls';
    if (node.classList.contains('question-paths')) return 'question-paths';
    if (node.classList.contains('saved-boards')) return 'saved-boards';
    return node.tagName.toLowerCase();
  }));
  assert.deepEqual(regionOrder.slice(0, 4), ['h1', 'scope-controls', 'question-paths', 'saved-boards']);

  assert.equal(await page.locator('table.question-paths').count(), 1);
  assert.deepEqual(await page.locator('.question-paths thead th').allInnerTexts(), ['Area', 'Question', 'Explanation']);
  assert.deepEqual(await page.locator('.question-paths tbody tr td:first-child').allInnerTexts(), [
    'Cost', 'Cost', 'Cost',
    'Quality', 'Quality', 'Quality', 'Quality', 'Quality',
    'Plans', 'Plans', 'Plans',
    'Activity', 'Activity', 'Activity',
    'Health'
  ]);
  const explanations = await page.locator('.question-paths tbody tr td:nth-child(3)').allInnerTexts();
  assert.equal(explanations.length, 15);
  assert.ok(explanations.every(text => text.trim().length > 0), 'every question path explains itself');
  assert.equal(await page.locator('.question-paths a').count(), 15);
  assert.equal(await page.locator('.question-paths [aria-disabled="true"]').count(), 0);
  assert.equal(await page.locator('.coverage-strip').count(), 0, 'Start has no standalone coverage strip');
  assert.equal(await page.locator('.workspace-panel').count(), 0, 'Start has no chart');

  assert.equal(await page.locator('table.saved-board-list').count(), 1);
  assert.deepEqual(await page.locator('.saved-board-list thead th').allInnerTexts(), ['Name', 'Open', 'Delete', 'URL summary']);
  assert.match(await page.locator('.saved-board-list tbody').innerText(), /No saved boards yet\./);
  assert.equal(await page.locator('.save-board input').inputValue(), '');

  await page.goto(`${harness.origin}/b/pulse?win=30d`);
  await page.waitForFunction(() => document.querySelectorAll('.workspace-panel').length === 5);
  const pulse = await page.evaluate(() => {
    const rect = id => document.querySelector(`[data-panel="${id}"]`).getBoundingClientRect();
    const metrics = rect('pulse-strips');
    const river = rect('river');
    const movers = rect('movers');
    const coverage = rect('coverage');
    return {
      grid: document.querySelector('.panel-grid').getBoundingClientRect().width,
      metrics: metrics.width,
      river: river.width,
      movers: movers.width,
      gap: movers.left - river.right,
      coverage: coverage.width,
      spans: Object.fromEntries(['pulse-strips', 'river', 'movers', 'calendar', 'coverage'].map(id => [id, document.querySelector(`[data-panel="${id}"]`).dataset.span]))
    };
  });
  assert.ok(Math.abs(pulse.grid - 1416) <= 1, `grid ${pulse.grid}`);
  assert.ok(Math.abs(pulse.metrics - 1416) <= 1, `metrics ${pulse.metrics}`);
  assert.ok(Math.abs(pulse.river - 704) <= 1, `river ${pulse.river}`);
  assert.ok(Math.abs(pulse.movers - 704) <= 1, `movers ${pulse.movers}`);
  assert.ok(Math.abs(pulse.gap - 8) <= 1, `gap ${pulse.gap}`);
  assert.deepEqual(pulse.spans, { 'pulse-strips': '12', river: '6', movers: '6', calendar: '6', coverage: '6' });

  await page.goto(`${harness.origin}/b/trends?win=30d`);
  await page.waitForFunction(() => document.querySelectorAll('.workspace-panel').length === 5);
  const rhythm = await page.evaluate(() => {
    const node = document.querySelector('[data-panel="rhythm"]');
    return { span: node.dataset.span, width: node.getBoundingClientRect().width };
  });
  assert.equal(rhythm.span, '12', 'the odd final panel spans the full width');
  assert.ok(Math.abs(rhythm.width - 1416) <= 1, `rhythm ${rhythm.width}`);

  await page.goto(`${harness.origin}/b/compare?win=7d`);
  await page.waitForFunction(() => document.querySelector('#comparison-select'));
  assert.deepEqual(await page.locator('#comparison-select option').evaluateAll(nodes => nodes.map(node => [node.value, node.textContent, node.disabled])), [
    ['period', 'Previous equal period', false],
    ['off', 'No comparison', false],
    ['cohorts', 'Saved cohorts', true]
  ]);
  assert.equal(await page.locator('#comparison-select').inputValue(), 'period');
  await page.locator('#comparison-select').selectOption('off');
  await page.waitForFunction(() => {
    const raw = new URLSearchParams(location.search).get('p1');
    if (!raw) return false;
    try { return JSON.parse(raw).scope?.cmp === 'off'; } catch { return false; }
  });
  const compareState = await page.evaluate(() => {
    const params = new URLSearchParams(location.search);
    return {
      cmp: params.get('cmp'),
      specs: ['p1', 'p2', 'p3', 'p4', 'p5'].map(key => JSON.parse(params.get(key) || '{}').scope?.cmp)
    };
  });
  assert.equal(compareState.cmp, null, 'off is not a URL cmp key');
  assert.deepEqual(compareState.specs, ['off', 'off', 'off', 'off', 'off']);
  await page.waitForFunction(() => document.querySelector('#comparison-select')?.value === 'off');

  await diagnostics.assertClean();
});
