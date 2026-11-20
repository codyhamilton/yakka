// Plan 29 phase1-03: a schema/adapter failure cannot abort a route. Against the
// real Go API each board mounts panel frames with no page error; forcing one
// panel route to 500 leaves the route rendered, that panel in `error` with
// retry, and the other panels settled. No fixed sleeps: the spec waits on the
// real idle/state attributes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser } from '../charts-time/browser.mjs';
import { startPlan29Harness } from './harness.mjs';

const BOARDS = ['/b/trends', '/b/cost', '/b/quality', '/b/scatter'];

function watchErrors(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  return { pageErrors, consoleErrors };
}

function iterableError(text) {
  return /object is not iterable|is not iterable/i.test(text);
}

test('plan29 boards mount every panel and contain a failing panel route', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason);
    return;
  }
  const harness = await startPlan29Harness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const context = await browser.newContext();
    harness.attach(context);
    await harness.installSession(context, 'plan29-a');
    await harness.selectTenant(context, 'plan29-a');
    const page = context.pages()[0] || await context.newPage();
    const errors = watchErrors(page);

    for (const path of BOARDS) {
      errors.pageErrors.length = 0;
      errors.consoleErrors.length = 0;
      await page.goto(`${harness.origin}${path}?win=all`);
      await harness.waitIdle(page);

      const frames = await page.locator('[data-panel]').count();
      assert.ok(frames > 0, `${path} mounted at least one panel frame`);
      const allSettled = await page.evaluate(() => Array.from(document.querySelectorAll('[data-panel]'))
        .every(panel => panel.getAttribute('data-idle') === 'true'));
      assert.equal(allSettled, true, `${path} settles every panel`);

      assert.deepEqual(errors.pageErrors, [], `${path} raised no page error`);
      const bad = errors.consoleErrors.filter(iterableError);
      assert.deepEqual(bad, [], `${path} has no unhandled iterable TypeError`);
    }

    // Force only the rhythm panel's time query to fail; the route and its
    // sibling panels must still render and settle.
    errors.pageErrors.length = 0;
    errors.consoleErrors.length = 0;
    await page.route('**/v1/analytics/query**', async handler => {
      const url = new URL(handler.request().url());
      if (url.searchParams.get('measure') === 'hook_events') {
        return handler.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'forced panel failure', code: 'forced' })
        });
      }
      return handler.continue();
    });
    await page.goto(`${harness.origin}/b/trends?win=all`);
    await harness.waitIdle(page);

    const panels = await page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('[data-panel]')).map(panel => [
      panel.dataset.panel,
      {
        state: panel.dataset.state,
        idle: panel.dataset.idle,
        status: panel.querySelector('.workspace-panel-status')?.textContent || '',
        retry: Boolean(panel.querySelector('.workspace-panel-status button'))
      }
    ])));
    const ids = Object.keys(panels);
    assert.ok(ids.includes('rhythm'), 'the rhythm panel frame is still mounted');
    assert.equal(panels.rhythm.state, 'error', 'the forced panel shows error');
    assert.equal(panels.rhythm.retry, true, 'the error offers retry');
    assert.match(panels.rhythm.status, /forced panel failure/, 'the error names the server failure');
    assert.ok(documentRouteRendered(await page.locator('h1').count()), 'the route still renders its heading');

    for (const id of ids) {
      if (id === 'rhythm') continue;
      assert.notEqual(panels[id].state, 'error', `${id} settled without the forced failure`);
      assert.ok(['ready', 'empty', 'unsupported', 'unauthorized', 'busy', 'timeout'].includes(panels[id].state), `${id} settled to ${panels[id].state}`);
    }

    assert.deepEqual(errors.pageErrors, [], 'the forced failure raised no page error');
    assert.deepEqual(errors.consoleErrors.filter(iterableError), [], 'the forced failure has no unhandled iterable TypeError');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await harness.close();
  }
});

function documentRouteRendered(headings) {
  return headings >= 1;
}
