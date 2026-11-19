import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

const environment = loadBrowserEnvironment();

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
  await page.waitForFunction(() => {
    const state = document.querySelector('.workspace-panel')?.dataset.state;
    return state && state !== 'loading';
  });
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

async function mount(page, search = '/b/cap?win=30d') {
  await page.evaluate(async search => {
    const { registerPanel } = await import('/js/panels/registry.js');
    const { registerPreset } = await import('/js/boards/presets.js');
    registerPanel({
      id: 'cap-panel', grain: 'session', measures: ['cost_usd', 'nope'], lenses: ['harness', 'nope'], charts: ['bars'],
      requires: ['entities_session', 'cohort'], caveats: 'Quality is comparative, not pass/fail.',
      capabilitySources: { entities_session: 'Phase 9', cohort: 'Phase 6' },
      measureBasis: 'fixture facts.ts',
      requests: () => [{ route: '/v1/analytics/entities', params: { grain: 'session', sort: 'last_ts:desc', limit: 500 } }],
      load: async () => ({ state: 'ready', population: { grain: 'session', unit: 'session', scope_n: 3, eligible_n: 3, returned_n: 3 }, basis: 'fixture facts.ts' })
    });
    registerPreset({
      id: 'cap', title: 'Capability', phase: 9, panels: ['cap-panel'],
      specs: { 'cap-panel': { grain: 'session', measures: ['cost_usd', 'nope'], chart: 'bars' } }
    });
    history.pushState({}, '', search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, search);
  await settle(page);
}

test('the capability drawer lists provenance, grain, units, basis, budgets, coverage, caveats and the nearest choice', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/`);
  await mount(page);

  const before = (await (await fetch(`${harness.origin}/__test/stats`)).json()).analytics;
  await page.locator('.capability-inspector summary').click();
  const drawer = page.locator('.capability-inspector');
  assert.equal(await drawer.getAttribute('data-grain'), 'session');

  const queries = page.locator('.capability-queries li[data-route="/v1/analytics/entities"]');
  assert.equal(await queries.count(), 1);
  assert.match(await queries.innerText(), /grain=session/);
  assert.match(await queries.innerText(), /sort=last_ts:desc/);
  assert.match(await page.locator('.capability-grain').innerText(), /grain: session/);
  assert.match(await page.locator('.capability-units').innerText(), /cost_usd: USD/);
  assert.match(await page.locator('.capability-units').innerText(), /nope: unit not published/);
  assert.match(await page.locator('.capability-basis').innerText(), /time basis: fixture facts\.ts/);
  assert.match(await page.locator('.capability-budgets').innerText(), /max_cells: 20000/);
  assert.match(await page.locator('.capability-coverage').innerText(), /first_ts: 2020-01-01T00:00:00Z/);
  assert.match(await page.locator('.capability-caveat').innerText(), /comparative, not pass\/fail/);

  const unsupported = page.locator('.capability-missing li[data-kind="measure"][data-name="nope"]');
  assert.equal(await unsupported.count(), 1);
  assert.match(await unsupported.innerText(), /nearest supported choice: measure cost_usd/);
  assert.match(await page.locator('.capability-missing li[data-kind="lens"][data-name="nope"]').innerText(), /nearest supported choice: lens harness/);

  const after = (await (await fetch(`${harness.origin}/__test/stats`)).json()).analytics;
  assert.equal(after, before, 'the drawer issues no request of its own');
  await diagnostics.assertClean();
});

test('a missing feature names its source in the drawer and the board still renders', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/`);
  await mount(page);

  await control(harness.origin, { scenario: 'missing-feature', missingFeature: 'entities_session' });
  await page.goto(`${harness.origin}/`);
  await mount(page);
  await page.locator('.capability-inspector summary').click();
  const missing = page.locator('.capability-missing li[data-feature="entities_session"]');
  assert.equal(await missing.count(), 1);
  assert.match(await missing.innerText(), /entities_session is not supported/);
  assert.match(await missing.innerText(), /supplied by Phase 9/);
  assert.equal(await page.locator('.workspace-panel').getAttribute('data-state'), 'unsupported');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
