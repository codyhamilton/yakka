// Deep links and Back/Forward for the Phase 9 workspace: all-history, a long
// finite window, a filtered scope, a panel override and a saved cohort survive
// direct load, reload and history navigation. Unknown paths stay in the shell.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { encodePanelSpec } from '../../web/js/core/view-spec.js';
import { cohortDefinition, encodeCohort } from '../../web/js/core/selection-model.js';

const environment = loadBrowserEnvironment();
const PANELS = ['river', 'pulse-strips', 'movers', 'calendar', 'coverage'];

async function settleShell(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
}

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
  await page.waitForFunction(ids => ids.every(id => {
    const panel = document.querySelector(`.workspace-panel[data-panel="${id}"]`);
    return panel && panel.dataset.idle === 'true';
  }), PANELS);
}

async function search(page) {
  return new URLSearchParams(await page.evaluate(() => location.search));
}

test('all-history, a long finite window, filters, a panel override and a saved cohort survive reload and history', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);

  // All-history, with compare-period disabled by a named warning.
  await page.goto(`${harness.origin}/b/pulse?win=all&cmp=period`);
  await settle(page);
  assert.match(await page.locator('.scope-bar').innerText(), /window all/);
  assert.match(await page.locator('.scope-warning').innerText(), /Choose a finite period/);
  await page.reload();
  await settle(page);
  assert.equal((await search(page)).get('win'), 'all');
  assert.match(await page.locator('.scope-bar').innerText(), /window all/);
  assert.equal(await page.locator('.workspace-panel').count(), 5);

  // A ten-year finite window plus a filtered scope, a panel override and a cohort.
  const from = '2015-01-01T00:00:00Z';
  const to = '2025-01-01T00:00:00Z';
  const spec = encodePanelSpec({ grain: 'time', measures: ['cost_usd', 'commits'], split: 'harness', chart: 'lines', scope: { harness: ['orca'] } });
  const cohort = encodeCohort(cohortDefinition({
    grain: 'session',
    scope: { from, to, tz: 'UTC', include: [{ lens: 'harness', values: ['orca'] }], exclude: [] },
    predicate: { in: { lens: 'id', values: ['s1'] } }
  }));
  const long = `/b/pulse?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=Australia%2FBrisbane&repo_id=r1&exclude=model%3Ax&p1=${encodeURIComponent(spec)}&ca=${encodeURIComponent(cohort)}`;
  await page.goto(`${harness.origin}${long}`);
  await settle(page);
  const bar = page.locator('.scope-bar');
  assert.match(await bar.innerText(), /2015-01-01T00:00:00Z → 2025-01-01T00:00:00Z/);
  assert.match(await bar.innerText(), /tz Australia\/Brisbane/);
  assert.match(await bar.innerText(), /repo_id: r1/);
  assert.match(await bar.innerText(), /exclude model:x/);
  assert.match(await bar.innerText(), /cohort A/);
  assert.equal(await page.locator('.workspace-chip[data-kind="cohort"]').count() >= 1, true);
  assert.equal(await page.locator('.workspace-panel').count(), 5);

  await page.reload();
  await settle(page);
  let params = await search(page);
  assert.equal(params.get('from'), from);
  assert.equal(params.get('to'), to);
  assert.equal(params.get('p1'), spec);
  assert.equal(params.get('ca'), cohort);
  assert.deepEqual(params.getAll('repo_id'), ['r1']);
  assert.deepEqual(params.getAll('exclude'), ['model:x']);
  assert.match(await page.locator('.scope-bar').innerText(), /cohort A/);
  assert.equal(await page.locator('.workspace-panel').count(), 5);

  // Navigating away and Back restores the full scope, cohorts and panels.
  await page.goto(`${harness.origin}/`);
  await settleShell(page);
  await page.goBack();
  await settle(page);
  params = await search(page);
  assert.equal(params.get('from'), from);
  assert.equal(params.get('to'), to);
  assert.equal(params.get('p1'), spec);
  assert.equal(params.get('ca'), cohort);
  assert.match(await page.locator('.scope-bar').innerText(), /cohort A/);
  assert.equal(await page.locator('.workspace-chip[data-kind="cohort"]').count() >= 1, true);
  assert.equal(await page.locator('.workspace-panel').count(), 5);

  // Forward leaves the restored entry intact and Back returns to it again.
  await page.goForward();
  await settleShell(page);
  assert.equal(new URL(page.url()).pathname, '/');
  await page.goBack();
  await settle(page);
  assert.equal(new URL(page.url()).pathname, '/b/pulse');
  assert.equal((await search(page)).get('ca'), cohort);

  // An unknown path is the in-shell not-found view, not a dead end.
  await page.goto(`${harness.origin}/no-such-route`);
  await settleShell(page);
  assert.equal(await page.locator('#app').getAttribute('data-route'), '/no-such-route');
  assert.match(await page.locator('#app h1').innerText(), /Page not found/);
  assert.equal(await page.locator('.not-found-routes a').count() > 0, true);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
