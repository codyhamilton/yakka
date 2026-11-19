import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { adminStatus } from './fixture.mjs';
import { watchPage } from '../gallery/harness.mjs';
import {
  OPS_PANEL,
  FAILURE_CAP,
  failureCapText,
  formatBytes,
  formatUnixSeconds,
  mapStatusResponse,
  mapTenant,
  rescoreProgress
} from '../../web/js/panels/ops-footprint.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';

const environment = loadBrowserEnvironment();

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="ops-footprint"]')?.dataset.idle === 'true');
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

const FULL_STATUS = adminStatus();

test('byte, seconds and unit formatting names every unit and never fakes zero', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1073741824), '1 GB');
  assert.equal(formatBytes(null), 'not supplied');
  assert.equal(formatUnixSeconds(0), 'never');
  assert.equal(formatUnixSeconds(1700000000), '2023-11-14T22:13:20.000Z');
  assert.equal(formatUnixSeconds(null), 'not supplied');
  assert.equal(failureCapText(25), `25 shown; recent screen failures, the server caps this list at ${FAILURE_CAP}`);
  assert.match(rescoreProgress({ running: true, total: 5, done: 3, failed: 0, started: 1 }), /running: 3 content items of 5 content items scored/);
  assert.equal(rescoreProgress({ running: false, total: 0, done: 0, failed: 0, started: 0 }), 'never run');
});

test('403 maps to the administrator-only unsupported state; no tenant data is exposed', () => {
  const result = mapStatusResponse({ status: 403, body: { error: 'forbidden' } });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.reason, 'administrator only');
  assert.ok(!('tenants' in result));
});

test('a 500 keeps the server message, code and retry shape', () => {
  const result = mapStatusResponse({ status: 500, body: { error: 'status read failed', code: 'read failed' } });
  assert.equal(result.state, 'error');
  assert.equal(result.message, 'status read failed');
  assert.equal(result.code, 'read failed');
});

test('tenants stay separate: no footprint or usage is summed across tenants', () => {
  const result = mapStatusResponse({ status: 200, body: FULL_STATUS });
  assert.equal(result.state, 'ready');
  assert.equal(result.tenants.length, 2);
  assert.equal(result.tenants[0].footprint.bytes.find(item => item.key === 'ledger_bytes').value, 1000);
  assert.equal(result.tenants[1].footprint.bytes.find(item => item.key === 'ledger_bytes').value, 2000);
  assert.ok(!('footprint' in result));
  assert.ok(!('total_bytes' in result));
  assert.deepEqual(result.volume, { total_bytes: 1073741824, free_bytes: 536870912 });
});

test('one tenant error does not hide or zero another tenant', () => {
  const body = {
    version: 'v',
    scoring: { scorer: true, checks: true, rescorable: false },
    tenants: [
      { id: 'broken', name: 'Broken', error: 'ledger unreadable' },
      { id: 'fine', name: 'Fine', facts: 4, footprint: { ledger_bytes: 64 } }
    ]
  };
  const result = mapStatusResponse({ status: 200, body });
  assert.equal(result.state, 'ready');
  assert.equal(result.tenants[0].error, 'ledger unreadable');
  assert.equal(result.tenants[1].error, '');
  assert.equal(result.tenants[1].facts, 4);
  assert.equal(mapTenant(body.tenants[1]).footprint.bytes[0].value, 64);
});

test('absent fields are recorded as absent rather than invented zeroes', () => {
  const result = mapStatusResponse({ status: 200, body: { version: 'fixture', scoring: { scorer: true }, tenants: [{ id: 'only', name: 'Only' }] } });
  const tenant = result.tenants[0];
  assert.equal(tenant.facts, null);
  assert.equal(tenant.footprint, null);
  assert.equal(tenant.screens, null);
  assert.equal(tenant.rescore, null);
  assert.equal(tenant.failuresSupplied, false);
});

test('the ops panel entry is a valid, table-only registry entry for the admin status route', () => {
  assert.doesNotThrow(() => validatePanelEntry(OPS_PANEL));
  assert.equal(OPS_PANEL.grain, 'tenant');
  assert.deepEqual(OPS_PANEL.charts, []);
  assert.equal(OPS_PANEL.table, true);
  assert.throws(() => validatePanelEntry({ ...OPS_PANEL, table: false }), /table: true/);
  assert.deepEqual(OPS_PANEL.requests(), [{ route: '/v1/admin/status', method: 'GET', session: true }]);
  assert.equal(typeof OPS_PANEL.load, 'function');
});

test('cancelling the load returns cancelled, not an error', async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = {
    request: async (path, { signal } = {}) => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { response: { status: 200 }, body: {} };
    }
  };
  const result = await OPS_PANEL.load({ transport, signal: controller.signal });
  assert.equal(result.state, 'cancelled');
});

test('admin sees the full committed stub status; tenants stay separate', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await panel.getAttribute('data-chart'), 'table');
  const text = await panel.innerText();
  assert.match(text, /Version/);
  assert.match(text, /fixture-2/);
  assert.match(text, /Scorer/);
  assert.match(text, /configured/);
  assert.match(text, /Checks/);
  assert.match(text, /not configured/);
  assert.match(text, /Alpha \(alpha\)/);
  assert.match(text, /Beta \(beta\)/);
  assert.ok(!text.includes('Not supplied'), 'the committed stub supplies every contracted field');
  assert.equal(await page.locator('.ops-tenant').count(), 2);
  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('full status renders disk, screens, failures and rescore per tenant with units', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.ops-tenant').count(), 2);
  const text = await panel.innerText();
  assert.match(text, /Alpha \(alpha\)/);
  assert.match(text, /Beta \(beta\)/);
  assert.match(text, /1 GB/);
  assert.match(text, /512 MB/);
  const alpha = await page.locator('.ops-tenant[data-tenant="alpha"]').innerText();
  const beta = await page.locator('.ops-tenant[data-tenant="beta"]').innerText();
  assert.match(alpha, /1000 B/);
  assert.match(beta, /2 KB/);
  assert.ok(!text.includes('2.9 KB'), 'disk bytes are never summed across tenants');
  assert.match(text, /7 content items/);
  assert.match(text, /9 rows/);
  assert.match(text, /2 rejections/);
  assert.match(text, /docs\/01\.md/);
  assert.match(text, /3 content items of 5 content items scored/);
  assert.match(text, /server caps this list at 25/);
  await diagnostics.assertClean();
});

test('a member gets only the administrator-only state and makes no other tenant request', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  await control(harness.origin, { role: 'member' });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);
  const paths = new Set();
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v1/')) paths.add(url.pathname);
  });

  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-state'), 'unsupported');
  assert.match(await panel.innerText(), /administrator only/i);
  assert.equal(await page.locator('.ops-tenant').count(), 0);
  const appText = await page.locator('#app').innerText();
  assert.ok(!appText.includes('fixture-tenant'), 'no tenant id in the DOM');
  assert.ok(!/Fixture/.test(appText), 'no tenant name in the DOM');
  assert.deepEqual([...paths].sort(), ['/v1/admin/status', '/v1/analytics/schema', '/v1/me']);
  assert.equal(diagnostics.pageErrors.length, 0);
  assert.deepEqual(await diagnostics.cspViolations(), []);
});

test('a 500 shows the server message and code, and retry recovers after the fault is gone', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);
  await control(harness.origin, { statusError: true });

  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-state'), 'error');
  assert.match(await panel.innerText(), /status read failed/);
  assert.match(await panel.innerText(), /read failed/);
  const retry = panel.locator('button', { hasText: 'Retry' });
  assert.equal(await retry.count(), 1);

  await control(harness.origin, { statusError: false });
  await retry.click();
  await settle(page);
  assert.equal(await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'ready');
  assert.equal(diagnostics.pageErrors.length, 0);
  assert.deepEqual(await diagnostics.cspViolations(), []);
});

test('leaving /ops aborts the in-flight status request', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  await control(harness.origin, { statusDelayMs: 1000 });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/ops`);
  await page.waitForFunction(async () => (await (await fetch('/__test/control')).json()).statusRequests >= 1);
  await page.evaluate(() => {
    history.pushState({}, '', '/ledger');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(async () => (await (await fetch('/__test/control')).json()).statusAborted >= 1);
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.route === '/ledger');
  assert.equal(await page.locator('[data-panel="ops-footprint"]').count(), 0);
  assert.equal(diagnostics.pageErrors.length, 0);
  assert.deepEqual(await diagnostics.cspViolations(), []);
});

test('a real aborted status load settles cancelled in the browser', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/ops`);
  await settle(page);

  const state = await page.evaluate(async () => {
    const { OPS_PANEL } = await import('/js/panels/ops-footprint.js');
    const { createScheduler } = await import('/js/core/request-scheduler.js');
    const { createTransport } = await import('/contract/transport.js');
    const scheduler = createScheduler();
    const transport = createTransport(scheduler);
    const controller = new AbortController();
    controller.abort();
    const result = await OPS_PANEL.load({ transport, scheduler, signal: controller.signal });
    return result.state;
  });
  assert.equal(state, 'cancelled');
  await diagnostics.assertClean();
});
