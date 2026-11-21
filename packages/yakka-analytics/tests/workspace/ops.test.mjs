import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import {
  ADMIN_ONLY_TEXT, FOOTPRINT_CAPTION, OPS_PANEL, footprintRows, formatBytes, formatUnixSeconds,
  mapStatusResponse
} from '../../web/js/panels/ops-footprint.js';
import { healthRows, recordCells } from '../../web/js/ops.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';

const environment = loadBrowserEnvironment();

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="ops-footprint"]')?.dataset.idle === 'true');
  await page.waitForFunction(() => document.querySelector('.ops-health tbody td'));
  await page.waitForFunction(() => document.querySelectorAll('.ops-records tbody tr').length > 0);
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

test('byte and time formatting names every unit and never fakes zero', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(1073741824), '1 GiB');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatUnixSeconds(0), 'never');
  assert.equal(formatUnixSeconds(1700000000), '2023-11-14T22:13:20.000Z');
  assert.equal(formatUnixSeconds(null), '—');
});

test('403 maps to the exact administrator-only text; no tenant data is exposed', () => {
  const result = mapStatusResponse({ status: 403, body: { error: 'forbidden' } });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.message, ADMIN_ONLY_TEXT);
  assert.equal(ADMIN_ONLY_TEXT, 'Storage information is available to server administrators only.');
  assert.ok(!('tenants' in result));
});

test('a 500 keeps the server message, code and retry shape', () => {
  const result = mapStatusResponse({ status: 500, body: { error: 'status read failed', code: 'read failed' } });
  assert.equal(result.state, 'error');
  assert.equal(result.message, 'status read failed');
  assert.equal(result.code, 'read failed');
});

test('the selected tenant is found by exact id; footprint bytes are never summed', () => {
  const result = mapStatusResponse({
    status: 200, tenant: 'beta',
    body: {
      tenants: [
        { id: 'alpha', name: 'Alpha', footprint: { ledger_bytes: 1000 } },
        { id: 'beta', name: 'Beta', footprint: { ledger_bytes: 2000, blob_bytes: 4 } }
      ]
    }
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.selected.id, 'beta');
  assert.deepEqual(footprintRows(result.selected).map(row => [row.label, row.bytes]), [['Ledger', 2000], ['Blobs', 4], ['Archive', null], ['Other', null], ['Pending', null], ['WAL', null]]);
  assert.ok(!('footprint' in result));
  assert.ok(!('total_bytes' in result));
});

test('absent fields are unavailable rather than invented zeroes', () => {
  const result = mapStatusResponse({ status: 200, tenant: 'only', body: { tenants: [{ id: 'only', name: 'Only' }] } });
  assert.equal(result.tenantFound, true);
  assert.deepEqual(footprintRows(result.selected).map(row => row.bytes), [null, null, null, null, null, null]);
});

test('the four health rows map the exact sources and carry the metadata notice', () => {
  const rows = healthRows({
    summary: { unpriced_calls: 12 },
    eventCounts: { matched: { rejections: 4 } },
    schema: { coverage: { scored_content_by_kind: { design: { total: 10, scored: 8 } }, sessions: { without_session_repo: 6 } } },
    kind: 'design'
  });
  assert.equal(rows[0].measure, 'Unpriced calls');
  assert.equal(rows[1].measure, 'Unscored design content versions (all history)');
  assert.equal(rows[3].measure, 'Sessions without repository attribution (all history)');
  assert.deepEqual(rows.map(row => row.count), [12, 2, 4, 6]);
  assert.match(rows[1].meaning, /All retained data in selected tenant; analytics time and repository filters do not apply\./);
  assert.equal(rows[3].meaning, 'All retained data in selected tenant; analytics time and repository filters do not apply.');
  assert.deepEqual(healthRows({ kind: 'design' }).map(row => row.count), [null, null, null, null]);
});

test('recent records use Time/Type/Path-event/Stage and open only stored identities', () => {
  const rejected = recordCells({ ts: '2026-10-01T00:00:00Z', type: 'rejection', path: '', event: '', rejection_stage: 'Precheck' });
  assert.deepEqual(rejected, { time: '2026-10-01 00:00:00', type: 'Rejection', path: '—', stage: 'Precheck', link: '' });
  const stored = recordCells({ ts: '2026-10-01T00:00:00Z', type: 'rejection', repo_id: 'repo-a', path: 'docs/01.md' });
  assert.match(stored.link, /^\/artifact\?/);
});

test('the ops panel entry is a valid administrator bars/table entry', () => {
  assert.doesNotThrow(() => validatePanelEntry(OPS_PANEL));
  assert.equal(OPS_PANEL.grain, 'tenant');
  assert.deepEqual(OPS_PANEL.charts, ['bars']);
  assert.equal(OPS_PANEL.table, true);
  assert.deepEqual(OPS_PANEL.requests(), [{ route: '/v1/admin/status', method: 'GET', session: true }]);
  assert.equal(OPS_PANEL.caption, FOOTPRINT_CAPTION);
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

test('admin sees health, the exact-tenant storage state and recent records', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-chart'), 'bars');
  assert.match(await panel.innerText(), /Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used\./);
  assert.equal(await page.locator('.ops-tenant').count(), 0, 'all-tenant panels are removed');
  const health = await page.locator('.ops-health').innerText();
  assert.match(health, /Tenant health/);
  assert.match(health, /Unpriced calls/);
  assert.match(health, /Unscored design content versions \(all history\)/);
  assert.match(health, /Rejected submissions/);
  assert.match(health, /Sessions without repository attribution \(all history\)/);
  const records = await page.locator('.ops-records').innerText();
  assert.match(records, /Recent retained records/);
  assert.match(records, /Load more events/);
  assert.equal(await page.locator('.ops-records tbody tr').count(), 100);
  assert.match(records, /100 rows shown; more rows remain\./);
  await page.locator('.ops-records-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.ops-records tbody tr').length === 200);
  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('the selected tenant being absent is stated, never replaced with another tenant', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/ops`);
  await settle(page);
  const panel = page.locator('[data-panel="ops-footprint"]');
  assert.equal(await panel.getAttribute('data-state'), 'empty');
  assert.match(await panel.innerText(), /No records match these filters\./);
  assert.equal(await page.locator('.ops-footprint-table').count(), 0);
  await diagnostics.assertClean();
});

test('a member gets only the exact administrator-only state and no storage values', { skip: environment.ok ? false : SKIP_REASON }, async t => {
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
  assert.match(await panel.innerText(), /Storage information is available to server administrators only\./);
  assert.equal(await page.locator('.ops-footprint-table').count(), 0);
  assert.equal(await page.locator('.ops-tenant').count(), 0);
  assert.ok(paths.has('/v1/admin/status'));
  assert.equal(diagnostics.pageErrors.length, 0);
  assert.deepEqual(await diagnostics.cspViolations(), []);
});

test('a status error shows the server message and code, and retry recovers after the fault is gone', { skip: environment.ok ? false : SKIP_REASON }, async t => {
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
  assert.notEqual(await page.locator('[data-panel="ops-footprint"]').getAttribute('data-state'), 'error');
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
