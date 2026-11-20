// Plan 29 phase 1 smoke: the real-Go, cookie-session, two-tenant harness is
// alive and tenant-scoped reads go through the real handlers. Browser proof
// uses Chromium only and waits on data-idle; it has no fixed sleeps.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadBrowserEnvironment, launchBrowser } from '../charts-time/browser.mjs';
import { startPlan29Harness } from './harness.mjs';

test('plan29 real-Go two-tenant browser harness', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason);
    return;
  }

  const harness = await startPlan29Harness();
  let browser;
  try {
    assert.deepEqual(harness.tenants.map(tenant => tenant.name).sort(), ['plan29-a', 'plan29-b']);
    const a = harness.tenantId('plan29-a');
    const b = harness.tenantId('plan29-b');
    assert.ok(a && b && a !== b);

    browser = await launchBrowser(environment);
    const context = await browser.newContext();
    harness.attach(context);
    await harness.installSession(context, 'plan29-a');
    await harness.selectTenant(context, 'plan29-a');

    const me = await context.request.get(`${harness.origin}/v1/me`);
    assert.equal(me.status(), 200);
    const meBody = await me.json();
    const meIds = meBody.tenants.map(tenant => tenant.id);
    assert.ok(meIds.includes(a) && meIds.includes(b), 'session owns both fixture tenants');

    const scoped = await context.request.get(`${harness.origin}/v1/analytics/schema?tenant=${a}`);
    assert.equal(scoped.status(), 200);

    const omitted = await context.request.get(`${harness.origin}/v1/analytics/schema`);
    assert.equal(omitted.status(), 403);
    assert.equal((await omitted.json()).error, 'no such tenant');

    const fresh = await context.request.get(`${harness.origin}/v1/analytics/schema?tenant=${b}`);
    assert.notEqual(fresh.status(), 403);
    const freshBody = await fresh.json();
    assert.ok(freshBody && typeof freshBody === 'object');

    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${harness.origin}/`);
    await harness.waitIdle(page);
    assert.equal(await page.locator('#app').count(), 1);
    assert.ok(await page.locator('.question-paths a').count() > 0);
    assert.deepEqual(harness.diagnostics, []);

    const created = [...harness.dataRoots];
    await harness.close();
    assert.ok(created.length > 0, 'harness created a .scratch data root');
    for (const dir of created) assert.equal(existsSync(dir), false, `leftover harness data root ${dir}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await harness.close();
  }
});
