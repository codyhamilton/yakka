// Plan 29 phase1-04: every board asks for fields its route truly serves, or
// shows the server's actionable refusal. Movers uses the time-query raw `model`
// split, session scatter uses the session grain's `scatter_fields`, score
// strips request numeric score fields only, and score trend follows the
// route-specific score-series resolution capability. The spec drives the real
// Go fixture and asserts captured requests/responses; it waits on data-idle and
// never on a fixed sleep.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser } from '../charts-time/browser.mjs';
import { startPlan29Harness } from './harness.mjs';

const PUBLISHED_BUCKETS = ['day', 'week', 'month'];

function capture(page) {
  const requests = [];
  const responses = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v1/analytics/')) return;
    requests.push({
      route: url.pathname.slice('/v1/analytics/'.length),
      params: new URLSearchParams(url.search),
      url: request.url()
    });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/v1/analytics/')) return;
    responses.push({
      route: url.pathname.slice('/v1/analytics/'.length),
      params: new URLSearchParams(url.search),
      status: response.status()
    });
  });
  return { requests, responses };
}

function panelState(page, id) {
  return page.evaluate(panelId => {
    const node = document.querySelector(`[data-panel="${panelId}"]`);
    return {
      state: node?.dataset.state || '',
      idle: node?.dataset.idle || '',
      text: node?.innerText || ''
    };
  }, id);
}

function searchOf(page) {
  return new URL(page.url()).search;
}

test('plan29 field validity: movers, session scatter, score strips and score trend', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason);
    return;
  }
  const harness = await startPlan29Harness();
  let browser;
  try {
    const tenant = harness.tenantId('plan29-a');
    browser = await launchBrowser(environment);
    const context = await browser.newContext();
    harness.attach(context);
    await harness.installSession(context, 'plan29-a');
    await harness.selectTenant(context, 'plan29-a');
    const page = context.pages()[0] || await context.newPage();
    const seen = capture(page);

    await t.test('Movers splits by raw model on /query and never session_model', async () => {
      seen.requests.length = 0;
      seen.responses.length = 0;
      await page.goto(`${harness.origin}/b/pulse?win=all`);
      await harness.waitIdle(page);

      const state = await panelState(page, 'movers');
      assert.equal(state.state, 'ready', 'pulse movers settles ready');

      const queries = seen.requests.filter(entry => entry.route === 'query');
      assert.ok(queries.length >= 1, 'movers made a /query request');
      assert.ok(queries.some(entry => entry.params.get('dim') === 'model'), 'movers splits by raw model');
      assert.equal(queries.some(entry => entry.params.get('dim') === 'session_model'), false, 'movers never sends dim=session_model');
      const failures = seen.responses.filter(entry => entry.route === 'query' && entry.status >= 400);
      assert.deepEqual(failures.map(entry => `${entry.status} ${entry.params}`), [], 'movers /query responses are not 400');
    });

    await t.test('session scatter uses the session grain scatter_fields', async () => {
      seen.requests.length = 0;
      seen.responses.length = 0;
      await page.goto(`${harness.origin}/b/scatter?win=all`);
      await harness.waitIdle(page);

      const scatter = seen.requests.find(entry => entry.route === 'entities'
        && entry.params.get('grain') === 'session' && entry.params.get('mode') === 'scatter');
      assert.ok(scatter, 'session scatter made its entities request');
      assert.equal(scatter.params.get('fields'), 'cost_usd,commits,unpriced_calls', 'only published scatter fields are serialized');

      const response = seen.responses.find(entry => entry.route === 'entities'
        && entry.params.get('grain') === 'session' && entry.params.get('mode') === 'scatter');
      assert.equal(response?.status, 200, 'session scatter answers 200');

      const state = await panelState(page, 'scatter-session');
      assert.equal(state.state, 'ready', 'session scatter settles ready');
      const painted = await page.evaluate(() => {
        const chart = document.querySelector('[data-panel="scatter-session"] yk-chart');
        const marginals = document.querySelectorAll('[data-panel="scatter-session"] .scatter-marginal');
        return { marks: Array.isArray(chart?.data) ? chart.data.length : 0, marginals: marginals.length };
      });
      assert.ok(painted.marks >= 1, 'session scatter draws at least one mark');
      assert.ok(painted.marginals >= 1, 'session scatter draws whole-population marginals');
    });

    await t.test('score strips request numeric score fields only; score trend uses a published bucket', async () => {
      seen.requests.length = 0;
      seen.responses.length = 0;
      await page.goto(`${harness.origin}/b/quality?win=all`);
      await harness.waitIdle(page);

      const strips = seen.requests.find(entry => entry.route === 'entities' && entry.params.get('fields'));
      assert.ok(strips, 'score strips made a fielded artifact request');
      const fields = strips.params.get('fields');
      assert.match(fields, /^score:[A-Za-z0-9_-]+$/, `only the numeric score field is requested (saw ${fields})`);
      assert.equal(fields.includes(','), false, 'no categorical lens rides in fields');
      const stripResponse = seen.responses.find(entry => entry.route === 'entities' && entry.params.get('fields'));
      assert.equal(stripResponse?.status, 200, 'score strips answers 200');
      const stripState = await panelState(page, 'score-strips');
      assert.equal(stripState.state, 'ready', 'score strips settles ready');
      assert.doesNotMatch(stripState.text, /unsupported artifact field/, 'score strips does not report an unsupported artifact field');

      const trend = seen.requests.find(entry => entry.route === 'score-series');
      assert.ok(trend, 'score trend made a score-series request');
      const bucket = trend.params.get('bucket');
      assert.ok(PUBLISHED_BUCKETS.includes(bucket), `score trend requests a published bucket (saw ${bucket})`);
      const trendState = await panelState(page, 'score-trend');
      assert.equal(trendState.state, 'ready', 'score trend settles ready');
      assert.match(trendState.text, new RegExp(`Cells are ${bucket} buckets|coarsened them to ${bucket}`), 'the panel metadata names the effective bucket');
    });

    const session = await harness.cookie('plan29-a');
    let refusal = null;
    const directRefusal = await fetch(`${harness.origin}/v1/analytics/score-series?kind=design&bucket=auto&all=1&tenant=${encodeURIComponent(tenant)}`, {
      headers: { Accept: 'application/json', Cookie: `${session.name}=${session.value}` }
    });
    assert.equal(directRefusal.status, 400, 'the server refuses unsupported score-series resolution');
    refusal = await directRefusal.json();
    assert.equal(refusal.code, 'unsupported_resolution');
    assert.deepEqual(refusal.supported_buckets, PUBLISHED_BUCKETS, 'the refusal names the route-accepted buckets');

    await t.test('an unsupported_resolution refusal is presented without changing the URL', async () => {
      await page.route('**/v1/analytics/score-series**', route => route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify(refusal)
      }));
      try {
        await page.goto(`${harness.origin}/b/quality?win=all`);
        await harness.waitIdle(page);
        const before = searchOf(page);
        const state = await panelState(page, 'score-trend');
        assert.equal(state.state, 'unsupported', 'score trend shows unsupported');
        assert.match(state.text, /day, week, month/, 'the refusal names the supported buckets');
        assert.equal(searchOf(page), before, 'the refusal leaves the URL scope unchanged');
      } finally {
        await page.unroute('**/v1/analytics/score-series**');
      }
    });

    await t.test('a too_many_cells refusal shows max_cells and the suggested action without changing the URL', async () => {
      seen.requests.length = 0;
      seen.responses.length = 0;
      await page.route('**/v1/analytics/score-series**', route => {
        const url = new URL(route.request().url());
        url.searchParams.set('max_cells', '1');
        return route.continue({ url: url.toString() });
      });
      try {
        await page.goto(`${harness.origin}/b/quality?win=all`);
        await harness.waitIdle(page);
        const before = searchOf(page);

        const response = seen.responses.find(entry => entry.route === 'score-series');
        assert.equal(response?.status, 400, 'the forced over-budget request is refused');

        const state = await panelState(page, 'score-trend');
        assert.equal(state.state, 'unsupported', 'score trend shows the cell-budget refusal');
        assert.match(state.text, /max_cells: 1/, 'the refusal names max_cells');
        assert.match(state.text, /suggested_bucket|reduce_splits_checks_or_choose_window/, 'the refusal names an actionable suggestion');
        assert.equal(searchOf(page), before, 'the refusal leaves the URL scope unchanged');
      } finally {
        await page.unroute('**/v1/analytics/score-series**');
      }
    });

    assert.deepEqual(harness.diagnostics.filter(message => !/Failed to load resource: the server responded with a status of 400/.test(message)), []);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await harness.close();
  }
});
