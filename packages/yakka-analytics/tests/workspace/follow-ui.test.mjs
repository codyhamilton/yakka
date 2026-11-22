import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function openPulse(page, origin) {
  await page.goto(`${origin}/b/pulse?win=30d`);
  await page.evaluate(async () => { await import('/js/panels/index.js'); });
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await page.waitForFunction(() => document.querySelector('[data-panel="river"]')?.dataset.idle === 'true');
}

async function control(origin, body) {
  return fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(response => response.json());
}

async function stats(origin) {
  return fetch(`${origin}/__test/stats`).then(response => response.json());
}

test('river Follow is off at load, reports late counts, acknowledges once and keeps its watermark on error and when hidden', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  let browser;
  let listRequests = 0;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
    const diagnostics = await watchPage(page);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/v1/analytics/activity' && url.searchParams.get('mode') === 'list') listRequests += 1;
    });
    await openPulse(page, harness.origin);

    const initial = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="river"]');
      return {
        toggle: root.querySelector('.river-follow-toggle').textContent,
        pressed: root.querySelector('.river-follow-toggle').getAttribute('aria-pressed'),
        watermark: root.querySelector('.river-follow-watermark').textContent
      };
    });
    assert.match(initial.toggle, /Follow: off/);
    assert.equal(initial.pressed, 'false');
    assert.match(initial.watermark, /none/);

    // Turn Follow on; the start probe reports counts by observation type.
    await page.locator('[data-panel="river"] .river-follow-toggle').click();
    await page.waitForFunction(() => /Session start: 2 sessions/.test(document.querySelector('[data-panel="river"] .river-follow-counts')?.textContent || ''));
    const counts = await page.evaluate(() => [...document.querySelectorAll('[data-panel="river"] .river-follow-counts li')].map(item => item.textContent));
    assert.ok(counts.some(text => /Session start: 2 sessions/.test(text)), counts.join('|'));
    assert.ok(counts.some(text => /Artifact version: 5 versions/.test(text)), counts.join('|'));
    assert.ok(counts.some(text => /Brief execution: 3 executions/.test(text)), counts.join('|'));
    assert.ok(counts.some(text => /Rejection: 2 rejections/.test(text)), counts.join('|'));
    assert.match(await page.evaluate(() => document.querySelector('[data-panel="river"] .river-follow-watermark').textContent), /none/);

    const beforeProbe = await stats(harness.origin);
    await page.locator('[data-panel="river"] .river-follow-probe').click();
    await page.waitForFunction(async before => {
      const response = await fetch('/__test/stats');
      const now = await response.json();
      return now.probes > before;
    }, beforeProbe.probes);
    let after = await stats(harness.origin);
    assert.equal(after.probes, beforeProbe.probes + 1);
    // A successful probe records counts but does not move the acknowledged watermark.
    assert.match(await page.evaluate(() => document.querySelector('[data-panel="river"] .river-follow-watermark').textContent), /none/);

    // Acknowledge advances the watermark and refetches the feed exactly once.
    const listBefore = listRequests;
    await page.locator('[data-panel="river"] .river-follow-ack').click();
    await page.waitForFunction(() => /MTAwMA/.test(document.querySelector('[data-panel="river"] .river-follow-watermark').textContent));
    await page.waitForFunction(async before => {
      const response = await fetch('/__test/stats');
      const now = await response.json();
      return now.analytics > before;
    }, after.analytics);
    const acknowledged = await page.evaluate(() => document.querySelector('[data-panel="river"] .river-follow-watermark').textContent);
    assert.match(acknowledged, /MTAwMA/);
    await page.waitForFunction(before => document.querySelector('[data-panel="river"]')?.dataset.idle === 'true', listBefore);
    assert.ok(listRequests > listBefore, `feed refetched (${listBefore} -> ${listRequests})`);

    // An injected probe error leaves the acknowledged watermark unchanged.
    await diagnostics.assertClean();
    await control(harness.origin, { activityError: true });
    const beforeError = await stats(harness.origin);
    await page.locator('[data-panel="river"] .river-follow-probe').click();
    await page.waitForFunction(() => /Probe failed/.test(document.querySelector('[data-panel="river"] .river-follow-status').textContent));
    const afterError = await stats(harness.origin);
    assert.ok(afterError.probes > beforeError.probes);
    assert.match(await page.evaluate(() => document.querySelector('[data-panel="river"] .river-follow-watermark').textContent), /MTAwMA/);
    await control(harness.origin, { activityError: false });

    // While the document is hidden a check performs no request at all.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const beforeHidden = await stats(harness.origin);
    await page.locator('[data-panel="river"] .river-follow-probe').click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    const afterHidden = await stats(harness.origin);
    assert.equal(afterHidden.probes, beforeHidden.probes);

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    // The one induced 500 is the failure the product is showing; it is the only
    // console error allowed, and no page error or CSP violation may occur.
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(await diagnostics.cspViolations(), []);
    assert.ok(diagnostics.consoleErrors.every(text => /500/.test(text)), diagnostics.consoleErrors.join('|'));
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
