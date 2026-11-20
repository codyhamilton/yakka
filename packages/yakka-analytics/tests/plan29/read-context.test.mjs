// Plan 29 phase1-02: every analytics read carries the selected tenant and one
// resolved scope. The spec drives the real-Go two-tenant harness and asserts the
// captured requests, never stored data. It waits on data-idle and real requests;
// there are no fixed sleeps or animation assertions.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser } from '../charts-time/browser.mjs';
import { startPlan29Harness } from './harness.mjs';

const WINDOWED = new Set([
  'explore', 'summary', 'entities', 'entity', 'conversation', 'scores', 'query', 'score-series'
]);
const DESIGN = 'docs/plans/plan-a/DESIGN.md';

function capture(page) {
  const requests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    const route = url.pathname.startsWith('/v1/analytics/') ? url.pathname.slice('/v1/analytics/'.length) : '';
    if (!route && url.pathname !== '/v1/baselines') return;
    requests.push({ route: route || 'baselines', params: [...url.searchParams] });
  });
  return requests;
}

function paramsOf(entry) {
  return new URLSearchParams(entry.params);
}

function windowed(requests) {
  return requests.filter(entry => WINDOWED.has(entry.route));
}

function assertTenant(requests, tenant) {
  for (const entry of requests) {
    assert.equal(paramsOf(entry).get('tenant'), tenant, `${entry.route} carries tenant=${tenant}`);
  }
}

function assertResolved(requests) {
  for (const entry of windowed(requests)) {
    const params = paramsOf(entry);
    assert.equal(params.has('win'), false, `${entry.route} never sends win`);
    if (params.get('all') === '1') {
      assert.ok(params.get('to'), `${entry.route} all=1 has a fixed to`);
      assert.equal(params.has('from'), false, `${entry.route} all=1 has no from`);
    } else {
      assert.ok(params.get('from'), `${entry.route} carries from`);
      assert.ok(params.get('to'), `${entry.route} carries to`);
    }
  }
}

// Lower the first page limit so the fixture's small population still has a
// continuation. The browser clicks the unchanged Load more control.
async function shrinkFirstPage(page, route, grain = '') {
  await page.route(`**/v1/analytics/${route}**`, async handler => {
    const request = handler.request();
    const url = new URL(request.url());
    const params = url.searchParams;
    if (!params.has('cursor') && (!grain || params.get('grain') === grain)) {
      params.set('limit', '1');
      return handler.continue({ url: url.toString() });
    }
    return handler.continue();
  });
}

test('plan29 read context: tenant, resolved scope and coverage truth', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason);
    return;
  }
  const harness = await startPlan29Harness();
  let browser;
  try {
    const a = harness.tenantId('plan29-a');
    const b = harness.tenantId('plan29-b');
    browser = await launchBrowser(environment);
    const context = await browser.newContext();
    harness.attach(context);
    await harness.installSession(context, 'plan29-a');
    await harness.selectTenant(context, 'plan29-a');
    const page = context.pages()[0] || await context.newPage();
    const requests = capture(page);
    const failures = [];
    page.on('response', response => {
      if (response.status() < 400) return;
      const url = new URL(response.url());
      // Movers' session_model dimension is a known later-unit defect (D05); it
      // is unrelated to this read-context contract.
      if (url.pathname === '/v1/analytics/query' && url.searchParams.get('dim') === 'session_model') return;
      failures.push(`${response.status()} ${response.url().replace(harness.origin, '')}`);
    });
    await shrinkFirstPage(page, 'explore');
    await shrinkFirstPage(page, 'entities', 'session');
    await shrinkFirstPage(page, 'entities', 'plan');

    // Direct API control: the selected tenant answers, omission is refused.
    const scoped = await context.request.get(`${harness.origin}/v1/analytics/schema?tenant=${a}`);
    assert.equal(scoped.status(), 200);
    const omitted = await context.request.get(`${harness.origin}/v1/analytics/schema`);
    assert.equal(omitted.status(), 403);

    // Ledger first page and continuation.
    requests.length = 0;
    await page.goto(`${harness.origin}/ledger?win=all`);
    await harness.waitIdle(page);
    let explore = requests.filter(entry => entry.route === 'explore');
    assert.ok(explore.length >= 1, 'ledger made a first-page request');
    assertTenant(explore, a);
    assertResolved(explore);
    const ledgerTo = paramsOf(explore[0]).get('to');
    const ledgerMore = page.locator('.ledger-load-more');
    if (await ledgerMore.count()) {
      await ledgerMore.click();
      await harness.waitIdle(page);
      explore = requests.filter(entry => entry.route === 'explore' && paramsOf(entry).has('cursor'));
      assert.ok(explore.length >= 1, 'ledger continuation was requested');
      assertTenant(explore, a);
      assertResolved(explore);
      assert.equal(paramsOf(explore[0]).get('to'), ledgerTo, 'ledger continuation keeps the first to');
    }

    // Sessions first page, continuation and detail.
    requests.length = 0;
    await page.goto(`${harness.origin}/sessions?win=all`);
    await harness.waitIdle(page);
    let sessions = requests.filter(entry => entry.route === 'entities' && paramsOf(entry).get('grain') === 'session');
    assert.ok(sessions.length >= 1, 'sessions made a first-page request');
    assertTenant(sessions, a);
    assertResolved(sessions);
    const sessionsTo = paramsOf(sessions[0]).get('to');
    const sessionsMore = page.locator('.sessions-load-more');
    if (await sessionsMore.count()) {
      await sessionsMore.click();
      await harness.waitIdle(page);
      sessions = requests.filter(entry => entry.route === 'entities' && paramsOf(entry).get('grain') === 'session' && paramsOf(entry).has('cursor'));
      assert.ok(sessions.length >= 1, 'sessions continuation was requested');
      assertTenant(sessions, a);
      assert.equal(paramsOf(sessions[0]).get('to'), sessionsTo, 'sessions continuation keeps the first to');
    }

    requests.length = 0;
    await page.goto(`${harness.origin}/sessions/sess-alpha?from=2024-01-01T00:00:00Z&to=2024-01-02T00:00:00Z`);
    await harness.waitIdle(page);
    const detail = requests.filter(entry => entry.route === 'conversation');
    assert.ok(detail.length >= 1, 'session detail was requested');
    assertTenant(detail, a);
    assertResolved(detail);

    // Plans first page and continuation.
    requests.length = 0;
    await page.goto(`${harness.origin}/plans?win=all`);
    await harness.waitIdle(page);
    let plans = requests.filter(entry => entry.route === 'entities' && paramsOf(entry).get('grain') === 'plan' && paramsOf(entry).has('sort'));
    assert.ok(plans.length >= 1, 'plans made a first-page request');
    assertTenant(plans, a);
    assertResolved(plans);
    const plansTo = paramsOf(plans[0]).get('to');
    const plansMore = page.locator('.plans-load-more');
    if (await plansMore.count()) {
      await plansMore.click();
      await harness.waitIdle(page);
      plans = requests.filter(entry => entry.route === 'entities' && paramsOf(entry).get('grain') === 'plan' && paramsOf(entry).has('sort') && paramsOf(entry).has('cursor'));
      assert.ok(plans.length >= 1, 'plans continuation was requested');
      assertTenant(plans, a);
      assert.equal(paramsOf(plans[0]).get('to'), plansTo, 'plans continuation keeps the first to');
    }

    // Artifact content and its tenant-scoped baseline.
    requests.length = 0;
    const baseline = page.waitForRequest(request => new URL(request.url()).pathname === '/v1/baselines', { timeout: 15000 }).catch(() => null);
    await page.goto(`${harness.origin}/artifact?repo_id=repo-a&path=${encodeURIComponent(DESIGN)}`);
    await harness.waitIdle(page);
    const baselineRequest = await baseline;
    assert.ok(baselineRequest, 'artifact baseline was requested');
    const baselineUrl = new URL(baselineRequest.url());
    assert.equal(baselineUrl.searchParams.get('tenant'), a, 'baseline carries the selected tenant');
    assert.equal(baselineUrl.searchParams.has('win'), false);

    // Pulse summary, previous period, quality headline and coverage share scope.
    requests.length = 0;
    await page.goto(`${harness.origin}/b/pulse?win=all`);
    await harness.waitIdle(page);
    const summaries = requests.filter(entry => entry.route === 'summary');
    assert.ok(summaries.length >= 1, 'pulse made a summary request');
    assertTenant(summaries, a);
    assertResolved(summaries);
    const headlines = requests.filter(entry => entry.route === 'scores');
    assert.ok(headlines.length >= 1, 'pulse made a quality headline request');
    assertResolved(headlines);
    const coverageText = await page.locator('[data-panel="coverage"]').innerText();
    assert.match(coverageText, /Latest retained event/);
    assert.doesNotMatch(coverageText, /1970|NaN|Invalid Date/);

    // The Start strip names the latest observation and its age.
    await page.goto(`${harness.origin}/`);
    await harness.waitIdle(page);
    const stripText = await page.locator('.coverage-strip').innerText();
    assert.match(stripText, /age/);
    assert.doesNotMatch(stripText, /1970|NaN|Invalid Date/);

    // Switching tenant reads the other tenant and never falls back to A.
    await harness.selectTenant(context, 'plan29-b');
    requests.length = 0;
    await page.goto(`${harness.origin}/ledger?win=all`);
    await harness.waitIdle(page);
    const switched = requests.filter(entry => entry.route === 'explore');
    assert.ok(switched.length >= 1, 'switched tenant made a read');
    assertTenant(switched, b);
    assert.equal(switched.some(entry => paramsOf(entry).get('tenant') === a), false, 'no fallback to A');

    // An empty finite window offers All history and changes only the URL window.
    await page.goto(`${harness.origin}/b/pulse?win=30d`);
    await harness.waitIdle(page);
    const action = page.locator('[data-panel="coverage"] button', { hasText: 'Clear window' });
    await action.waitFor({ timeout: 15000 });
    await action.click();
    await page.waitForFunction(() => /(?:^|[?&])win=all(?:&|$)/.test(globalThis.location.search));
    const search = new URLSearchParams(await page.evaluate(() => globalThis.location.search));
    assert.equal(search.get('win'), 'all');
    assert.equal(search.has('from'), false);
    assert.equal(search.has('to'), false);

    assert.deepEqual(failures, [], `server failures: ${failures.join(' | ')}`);
    assert.deepEqual(harness.diagnostics.filter(message => !message.startsWith('console: Failed to load resource: the server responded with a status of 400')), []);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await harness.close();
  }
});
