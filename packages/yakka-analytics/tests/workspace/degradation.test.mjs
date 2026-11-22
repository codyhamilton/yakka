// Old-server degradation: the `legacy` stub scene answers every non-schema
// request with `range too wide` and advertises none of the Phase 9 features.
// The river must gate on the absent capability before asking; the panels that
// do ask must show the server's limit verbatim, offer retry, and never clip or
// rewrite the window. Page errors and CSP violations must stay empty.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

const environment = loadBrowserEnvironment();
const PANELS = ['river', 'pulse-strips', 'movers', 'calendar', 'coverage'];

async function settle(page) {
  await page.waitForFunction(ids => ids.every(id => {
    const panel = document.querySelector(`.workspace-panel[data-panel="${id}"]`);
    return panel && panel.dataset.idle === 'true';
  }), PANELS);
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

test('a legacy server names the missing feature and shows range too wide verbatim with retry', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);

  await control(harness.origin, { scenario: 'legacy' });
  await page.goto(`${harness.origin}/b/pulse?win=30d`);
  await settle(page);

  const panels = await page.evaluate(ids => Object.fromEntries(ids.map(id => {
    const panel = document.querySelector(`[data-panel="${id}"]`);
    return [id, {
      state: panel?.dataset.state,
      status: panel?.querySelector('.workspace-panel-status')?.textContent || '',
      retry: Boolean(panel?.querySelector('.workspace-panel-status button'))
    }];
  })), PANELS);

  const problems = [];
  const river = panels.river;
  if (!river) problems.push('river: no panel frame rendered');
  else {
    if (river.state !== 'unsupported') problems.push(`river: expected unsupported when activity is absent, saw ${river.state}`);
    if (!/activity/.test(river.status)) problems.push(`river: the missing feature is not named (saw ${JSON.stringify(river.status)})`);
    if (!/supplied by/i.test(river.status)) problems.push('river: the capability source is not named');
  }
  for (const id of PANELS.filter(id => id !== 'river')) {
    const panel = panels[id];
    if (!panel) { problems.push(`${id}: no panel frame rendered`); continue; }
    if (panel.state !== 'error') problems.push(`${id}: expected error, saw ${panel.state}`);
    if (!/range too wide/.test(panel.status)) problems.push(`${id}: the old limit is not shown verbatim (saw ${JSON.stringify(panel.status)})`);
    if (!panel.retry) problems.push(`${id}: the error offers no retry`);
  }

  // No clip or rewrite: the window stays exactly what the URL asked for.
  const settings = await page.evaluate(() => ({ search: location.search, bar: document.querySelector('.scope-bar')?.textContent || '' }));
  const scopeParams = new URLSearchParams(settings.search);
  if (scopeParams.get('win') !== '30d' || [...scopeParams.keys()].some(key => !['win', 'tenant'].includes(key))) problems.push(`the panel rewrote the window: ${settings.search}`);
  if (!/window 30d/.test(settings.bar)) problems.push(`the scope bar was rewritten: ${JSON.stringify(settings.bar)}`);

  // The deliberate 4xx is the server's honest answer; Chromium logs one
  // failed-resource entry per request. Page errors and CSP violations stay empty.
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*status of 4\d\d/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);

  assert.deepEqual(problems, []);
});
