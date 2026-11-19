// Phase 11 acceptance: the Scatter lab and Sessions outcome proved end to end
// in Chromium over the committed deterministic fixture and first-party stub.

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import {
  P11, p11Aggregate, p11Conversation, p11Schema, p11Scatter, p11SessionList, p11TimeAggregate
} from '../workspace/fixture.mjs';
import { canonicalJson, canonicalPredicate, decodeCohort } from '../../web/js/core/selection-model.js';
import { regionPredicate, subtractRegion, unionRegion } from '../../web/js/panels/scatter-shared.js';
import { SESSION_MEASURES } from '../../web/js/explorers/sessions.js';
import { artifactAxes } from '../../web/js/panels/scatter-artifact.js';
import { planAxes } from '../../web/js/panels/scatter-plan.js';
import { bucketInterval, bucketIntersectsWindow } from '../../web/js/panels/scatter-day.js';

const environment = loadBrowserEnvironment();
const schema = p11Schema();
const WINDOW = 'from=2026-09-01T00%3A00%3A00Z&to=2026-09-05T00%3A00%3A00Z&tz=UTC';
const CATALOGUE = { kind: 'design', checks: [{ name: 'clarity' }, { name: 'structure' }] };
const GRAINS = {
  'scatter-session': 'session', 'scatter-artifact': 'artifact',
  'scatter-plan': 'plan', 'scatter-day': 'time'
};
const REGIONS = {
  'scatter-session': { x: { min: 0.5, max: 3 }, y: { min: 1, max: 5 } },
  'scatter-artifact': { x: { min: 0.5, max: 2 }, y: { min: 0.5, max: 0.8 } },
  'scatter-plan': { x: { min: 1, max: 6 }, y: { min: 1, max: 5 } },
  'scatter-day': { x: { min: 1, max: 3 }, y: { min: 0, max: 2 } }
};
const MEASURES = {
  'scatter-session': ['cost_usd', 'commits'],
  'scatter-artifact': ['writing_session_cost_usd', 'score:clarity'],
  'scatter-plan': ['associated_cost_usd', 'artifacts'],
  'scatter-day': ['cost_usd', 'commits']
};
const DAY_SPEC = {
  grain: 'time', measures: ['cost_usd', 'commits', 'rejections'], chart: 'scatter',
  scope: { x: 'cost_usd', y: 'commits', size: 'rejections' }
};

function dayQuery() {
  return `&p4=${encodeURIComponent(JSON.stringify(DAY_SPEC))}`;
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

async function settleBoard(page) {
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length === 4 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function openBoard(page, origin, suffix = '') {
  await page.goto(`${origin}/b/scatter?${WINDOW}${suffix}`);
  await settleBoard(page);
}

async function selectRegion(page, panelId, box, { additive = false, exclude = false } = {}) {
  await page.evaluate(({ panelId: id, region, add, drop }) => {
    const chart = document.querySelector(`[data-panel="${id}"] yk-chart`);
    chart.dispatchEvent(new CustomEvent('select', {
      bubbles: true, composed: true,
      detail: { source: 'scatter-rectangle', region, additive: add, exclude: drop }
    }));
  }, { panelId, region: box, add: additive, drop: exclude });
  await page.waitForFunction(() => document.querySelector('.selection-tray')?.dataset.open === 'true');
}

async function trayText(page, selector = '.selection-tray-summary') {
  return page.evaluate(name => document.querySelector(name)?.textContent || '', selector);
}

async function trayPredicate(page) {
  return JSON.parse(await trayText(page, '.selection-tray-predicate'));
}

async function waitTray(page, pattern) {
  await page.waitForFunction(rx => new RegExp(rx).test(document.querySelector('.selection-tray')?.textContent || ''), pattern);
}

async function settleList(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="sessions-list"]')?.dataset.idle === 'true');
}

async function settleDetail(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="session-lanes"]')?.dataset.idle === 'true');
}

async function rowIds(page) {
  return page.locator('.session-row').evaluateAll(rows => rows.map(row => row.dataset.sessionId));
}

test('an unknown check is unsupported with the nearest published check', () => {
  const artifact = p11Schema();
  artifact.grains.artifact.measures.push('score:mystery');
  const artifactModel = artifactAxes(artifact, CATALOGUE);
  const artifactUnknown = artifactModel.unsupported.find(item => item.name === 'score:mystery');
  assert.ok(artifactUnknown);
  assert.match(artifactUnknown.reason, /score catalogue/);
  assert.match(artifactUnknown.try, /clarity|structure/);

  const plan = p11Schema();
  plan.grains.plan.measures.push('design_score:mystery');
  const planModel = planAxes(plan, CATALOGUE);
  const planUnknown = planModel.unsupported.find(item => item.name === 'design_score:mystery');
  assert.ok(planUnknown);
  assert.match(planUnknown.reason, /score catalogue/);
  assert.match(planUnknown.try, /clarity|structure/);
});

test('a bucket is half-open at the source-window edges', () => {
  const day = second => bucketInterval({ t: Date.parse(second) / 1000 }, { bucket: 'day', step: 1 });
  const window = { from: '2026-09-02T00:00:00Z', to: '2026-09-05T00:00:00Z' };
  assert.equal(bucketIntersectsWindow(day('2026-09-01T00:00:00Z'), window), false);
  assert.equal(bucketIntersectsWindow(day('2026-09-02T00:00:00Z'), window), true);
  assert.equal(bucketIntersectsWindow(day('2026-09-05T00:00:00Z'), window), true);
  assert.equal(bucketIntersectsWindow(day('2026-09-06T00:00:00Z'), window), false);
});

test('the Scatter board proves schema choices, exact grain selections, peer cohorts and time associations', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 3000 } });
  const diagnostics = await watchPage(page);

  await openBoard(page, harness.origin);
  const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
  assert.deepEqual(ids, ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']);
  const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
  for (const id of ids) assert.equal(states[id], 'ready', `${id} settles ready`);

  const options = await page.evaluate(() => Object.fromEntries(
    ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day'].map(id => [
      id,
      Object.fromEntries([...document.querySelectorAll(`[data-panel="${id}"] .p11-chooser select`)]
        .map(select => [select.getAttribute('aria-label'), [...select.options].map(option => option.value)]))
    ])
  ));
  for (const [id, grain] of Object.entries(GRAINS)) {
    const measures = new Set(schema.grains[grain].measures);
    const lenses = new Set(schema.grains[grain].lenses);
    for (const role of ['X measure', 'Y measure', 'Size']) {
      for (const value of options[id][role].filter(Boolean)) assert.ok(measures.has(value), `${id} ${role} ${value} is a published measure`);
      assert.equal(options[id][role].includes('model'), false, `${id} ${role} never offers model as numeric`);
    }
    for (const value of options[id].Colour.filter(Boolean)) assert.ok(lenses.has(value), `${id} colour ${value} is a published lens`);
  }
  assert.ok(options['scatter-session'].Colour.includes('session_model'));
  assert.ok(options['scatter-artifact'].Colour.includes('session_model'));
  assert.ok(options['scatter-artifact'].Colour.includes('band:clarity'));
  assert.ok(options['scatter-artifact']['Y measure'].includes('score:clarity'));
  assert.ok(options['scatter-plan'].Colour.includes('session_model'));
  assert.ok(options['scatter-plan'].Colour.includes('repo_id'));
  assert.deepEqual(options['scatter-day'].Colour, ['']);

  const sessionChart = await page.evaluate(() => document.querySelector('[data-panel="scatter-session"] yk-chart').spec.sample);
  assert.deepEqual(sessionChart, { n: 38, total: P11.populationN, rule: p11Scatter({ fields: ['cost_usd'] }).sample_rule });
  const sessionText = await page.locator('[data-panel="scatter-session"]').innerText();
  assert.match(sessionText, /sample of 38 of 1,880/);

  const fields = ['cost_usd', 'commits', 'unpriced_calls'];
  const marginalSums = await page.evaluate(names => Object.fromEntries(names.map(field => {
    const figure = document.querySelector(`[data-panel="scatter-session"] .scatter-marginal[data-field="${field}"]`);
    const rows = [...figure.querySelectorAll('table tbody tr')];
    return [field, rows.reduce((sum, row) => sum + Number(row.lastElementChild.textContent.replace(/,/g, '')), 0)];
  })), fields);
  const fixtureMarginals = p11Scatter({ fields });
  for (const field of fields) {
    assert.equal(marginalSums[field], fixtureMarginals.marginals[field].bins.reduce((n, bin) => n + bin.n, 0), `${field} marginal is the whole population`);
  }
  assert.match(await page.locator('[data-panel="scatter-session"] .scatter-marginal[data-field="cost_usd"]').innerText(), /whole population/);

  const units = await page.evaluate(() => Object.fromEntries(
    ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']
      .map(id => [id, document.querySelector(`[data-panel="${id}"] .workspace-panel-population`)?.textContent || ''])
  ));
  assert.match(units['scatter-session'], /session/);
  assert.match(units['scatter-artifact'], /artifact/);
  assert.match(units['scatter-plan'], /plan/);
  assert.match(units['scatter-day'], /bucket/);

  const planText = await page.locator('[data-panel="scatter-plan"]').innerText();
  assert.match(planText, /non-additive across plans/);
  assert.match(planText, /not plan-exact spend/);
  assert.match(planText, /unpriced calls/);
  assert.match(planText, /shared-session/);

  const artifactText = await page.locator('[data-panel="scatter-artifact"]').innerText();
  assert.match(artifactText, /unscored/);
  assert.match(artifactText, /content_unavailable/);
  assert.match(artifactText, /lower-bound/);
  assert.match(artifactText, /unpriced/);
  assert.match(artifactText, /Score clarity \(score\)/);
  assert.doesNotMatch(artifactText, /\$0(?:\.00)?(?![\d.])/);
  const planCells = await page.evaluate(() => [...document.querySelectorAll('[data-panel="scatter-plan"] .p11-scatter > table tbody tr')]
    .map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
  assert.ok(planCells.some(row => row.includes('unpriced')), 'the all-unpriced plan point is labelled, not $0');
  assert.ok(planCells.flat().every(cell => !/^\$0(?:\.00)?$/.test(cell)));

  for (const [id, box] of Object.entries(REGIONS)) {
    await selectRegion(page, id, box);
    const expected = canonicalPredicate({
      and: [
        { range: { measure: MEASURES[id][0], lo: box.x.min, hi: box.x.max } },
        { range: { measure: MEASURES[id][1], lo: box.y.min, hi: box.y.max } }
      ]
    });
    assert.deepEqual(await trayPredicate(page), expected, `${id} rectangle is the canonical data-space predicate`);
  }

  await openBoard(page, harness.origin);
  const first = REGIONS['scatter-session'];
  await selectRegion(page, 'scatter-session', first);
  await page.waitForFunction(() => /143 sessions/.test(document.querySelector('.selection-tray-summary')?.textContent || ''));
  assert.equal(await trayText(page), '143 sessions of 1,880 in scope; 38 sampled marks visible');
  assert.equal(143, p11Aggregate({ grain: 'session' }).population.cohort_n, 'the bounded aggregate count is the tray count');
  const second = { x: { min: 3, max: 4 }, y: { min: 0, max: 2 } };
  await selectRegion(page, 'scatter-session', second, { additive: true });
  await waitTray(page, '"or"');
  const union = await trayPredicate(page);
  assert.deepEqual(union, canonicalPredicate(unionRegion(
    regionPredicate(first, 'cost_usd', 'commits'),
    regionPredicate(second, 'cost_usd', 'commits')
  )));
  const third = { x: { min: 0.5, max: 1 }, y: { min: 1, max: 2 } };
  await selectRegion(page, 'scatter-session', third, { exclude: true });
  await waitTray(page, '"not"');
  const subtracted = await trayPredicate(page);
  assert.deepEqual(subtracted, canonicalPredicate(subtractRegion(
    unionRegion(regionPredicate(first, 'cost_usd', 'commits'), regionPredicate(second, 'cost_usd', 'commits')),
    regionPredicate(third, 'cost_usd', 'commits')
  )));

  await openBoard(page, harness.origin, dayQuery());
  await selectRegion(page, 'scatter-day', REGIONS['scatter-day']);
  await page.waitForFunction(() => /7 contributing sessions/.test(document.querySelector('.selection-tray-summary')?.textContent || ''));
  assert.match(await trayText(page), /^7 contributing sessions of 1,880 in scope/);
  assert.equal(7, p11TimeAggregate({}).population.relation.target_sessions.cohort_n);
  const associationText = (await page.locator('.selection-tray-association').allInnerTexts()).join('\n');
  assert.match(associationText, /source rejection associations: 5 associated, 2 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  assert.match(associationText, /target rejection associations: 8 associated, 1 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  assert.match(associationText, /contributing sessions/);
  assert.match(associationText, /target applies its own window and expands/);
  const timeTotals = await page.evaluate(() => {
    const text = [...document.querySelectorAll('.selection-tray-association')].map(node => node.textContent).join('\n');
    return text;
  });
  assert.ok(timeTotals.length > 0);

  await page.locator('.selection-tray button', { hasText: 'Make cohort A' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('ca') !== null);
  await settleBoard(page);
  let search = new URLSearchParams(await page.evaluate(() => location.search));
  const a = decodeCohort(search.get('ca'));
  assert.equal(a.grain, 'time');
  assert.equal(a.op, 'include');
  assert.deepEqual(a.source, { fields: ['cost_usd', 'commits', 'rejections'], bucket: 'day', bucket_step: 1 });
  assert.equal(a.scope.from, '2026-09-01T00:00:00Z');
  assert.equal(a.scope.to, '2026-09-05T00:00:00Z');
  assert.equal(a.scope.win, undefined);

  await selectRegion(page, 'scatter-day', REGIONS['scatter-day']);
  await waitTray(page, 'contributing sessions');
  await page.locator('.selection-tray button', { hasText: 'Filter all panels to this' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('cb') !== null);
  await settleBoard(page);
  search = new URLSearchParams(await page.evaluate(() => location.search));
  const b = decodeCohort(search.get('cb'));
  assert.equal(b.op, 'include');
  assert.equal(canonicalJson(b.predicate), canonicalJson(a.predicate));
  assert.equal(b.scope.from, a.scope.from);
  assert.equal(b.scope.to, a.scope.to);

  await selectRegion(page, 'scatter-day', REGIONS['scatter-day']);
  await waitTray(page, 'contributing sessions');
  await page.locator('.selection-tray button', { hasText: 'Exclude this' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('cc') !== null);
  await settleBoard(page);
  search = new URLSearchParams(await page.evaluate(() => location.search));
  const c = decodeCohort(search.get('cc'));
  assert.equal(c.op, 'exclude');
  assert.equal(canonicalJson(c.predicate), canonicalJson(a.predicate));
  assert.equal(search.get('cmp'), 'cohorts');
  for (const slot of ['ca', 'cb', 'cc']) assert.ok(search.get(slot), `${slot} is its own slot`);
  assert.deepEqual([a.grain, b.grain, c.grain], ['time', 'time', 'time']);

  const peers = harness.api.state.requests
    .filter(item => /\/entities$/.test(item.path) && /[?&]cohort=/.test(item.search));
  assert.ok(peers.length > 0);
  for (const item of peers) assert.equal(new URLSearchParams(item.search).getAll('cohort').length, 1, 'one cohort per peer request');

  await openBoard(page, harness.origin, dayQuery());
  await selectRegion(page, 'scatter-day', { x: { min: 9, max: 10 }, y: { min: 0, max: 1 } });
  await page.waitForFunction(() => /valid empty selection/.test(document.querySelector('.selection-tray-summary')?.textContent || ''));
  assert.match(await trayText(page), /^0 contributing sessions/);
  const emptyAssociations = (await page.locator('.selection-tray-association').allInnerTexts()).join('\n');
  assert.match(emptyAssociations, /0 associated, 2 missing \(no_conversation_id\), 2 orphan/);

  await page.route('**/v1/analytics/entities*', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('grain') === 'time' && url.searchParams.get('mode') === 'aggregate' && (url.searchParams.get('fields') || '').includes('rejections')) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unsupported_join: rejections is not defined for this time pairing', code: 'unsupported_join' })
      });
    }
    return route.continue();
  });
  await openBoard(page, harness.origin, dayQuery());
  assert.equal(await page.locator('[data-panel="scatter-day"]').getAttribute('data-state'), 'unsupported');
  assert.match(await page.locator('[data-panel="scatter-day"]').innerText(), /unsupported_join: rejections is not defined for this time pairing/);
  await page.unroute('**/v1/analytics/entities*');

  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /status of 400/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  await control(harness.origin, { p11: false });
});

test('Sessions sorts and pages server-side and narrows through the pushed URL', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  assert.equal(await page.locator('[data-panel="sessions-list"]').getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.session-row').count(), 20);
  assert.match(await page.locator('[data-panel="sessions-list"]').innerText(), /20 of 40 sessions shown/);

  const offered = await page.locator('.session-sort-measure option').evaluateAll(options => options.map(option => option.value));
  assert.deepEqual(offered, SESSION_MEASURES);
  for (const measure of offered) {
    await page.selectOption('.session-sort-measure', measure);
    await page.waitForFunction(value => new URLSearchParams(location.search).get('sort') === value, `${measure}:desc`);
    const expected = p11SessionList({ sort: `${measure}:desc`, limit: 500 }).rows.map(row => row.id);
    await page.waitForFunction(list => JSON.stringify([...document.querySelectorAll('.session-row')].map(row => row.dataset.sessionId)) === JSON.stringify(list), expected);
    assert.equal((await rowIds(page)).length, 20, `${measure}:desc renders the server page`);
    assert.match(await page.locator('[data-panel="sessions-list"]').innerText(), /20 of 40 sessions shown/, `${measure} does not sum a partial page`);
  }

  await page.selectOption('.session-sort-measure', 'cost_usd');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'cost_usd:desc');
  await page.selectOption('.session-sort-direction', 'asc');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'cost_usd:asc');
  const asc = p11SessionList({ sort: 'cost_usd:asc', limit: 500 }).rows.map(row => row.id);
  await page.waitForFunction(list => JSON.stringify([...document.querySelectorAll('.session-row')].map(row => row.dataset.sessionId)) === JSON.stringify(list), asc);

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  const firstPage = p11SessionList({ sort: 'last_ts:desc', limit: 20 });
  assert.deepEqual(await rowIds(page), firstPage.rows.map(row => row.id));
  await page.locator('.sessions-load-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.session-row').length === 40);
  const ids = await rowIds(page);
  assert.equal(new Set(ids).size, 40, 'Load-more appends with no duplicate identity');
  const secondPage = p11SessionList({ sort: 'last_ts:desc', limit: 20, cursor: firstPage.next });
  assert.deepEqual(ids.slice(20), secondPage.rows.map(row => row.id));
  assert.match(await page.locator('[data-panel="sessions-list"]').innerText(), /40 loaded; 20 on this page; 40 sessions total/);
  assert.equal(await page.locator('.sessions-load-more').count(), 0);

  await page.goto(`${harness.origin}/sessions?win=all`);
  await settleList(page);
  await page.locator('.session-lens', { hasText: 'harness: orca' }).first().click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('harness') === 'orca');
  await settleList(page);
  const harnesses = await page.locator('.session-row td[data-key="harness"]').allInnerTexts();
  assert.ok(harnesses.length > 0 && harnesses.every(value => value === 'orca'));
  assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 1);
  assert.match(await page.locator('[data-panel="sessions-list"]').innerText(), /20 of 20 sessions shown/);
  await page.locator('.workspace-chip[data-kind="filter"] .workspace-chip-remove').first().click();
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('harness'));
  await settleList(page);
  assert.match(await page.locator('[data-panel="sessions-list"]').innerText(), /20 of 40 sessions shown/);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a session detail reconciles returned markers and the capped whole run', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p11: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const diagnostics = await watchPage(page);
  const conversation = p11Conversation('conv-000');

  await page.goto(`${harness.origin}/sessions/conv-000`);
  await settleDetail(page);
  const panel = page.locator('[data-panel="session-lanes"]');
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.session-event-row').count(), conversation.returned_events);
  const marks = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').inspect().marks.length);
  assert.equal(marks, conversation.returned_events, 'displayed markers reconcile only to returned events');
  assert.notEqual(marks, conversation.total_events);
  const hollow = await page.evaluate(() => document.querySelector('[data-panel="session-lanes"] yk-lanes').shadowRoot.querySelectorAll('.yk-lane-marker[data-priced="false"]').length);
  assert.equal(hollow, conversation.returned_unpriced_calls);
  assert.equal(await page.locator('.session-event-row[data-priced="false"]').count(), conversation.returned_unpriced_calls);

  const text = await panel.innerText();
  assert.match(text, /Returned 5,000 of 5,123 events/);
  assert.match(text, /123 events are beyond the cap/);
  assert.match(text, /Returned unpriced calls: 10 of 13/);
  assert.match(text, /3 unpriced calls are beyond the cap/);
  assert.match(text, /keeps? the whole run|whole-run totals|whole run/);

  const ledger = await page.locator('.session-ledger-link').getAttribute('href');
  assert.equal(ledger, '/ledger?conversation_id=conv-000');
  const artifact = await page.locator('.session-artifact-link').first().getAttribute('href');
  assert.match(artifact, /^\/artifact\?repo_id=repo-a&path=.*&hash=hash-design/);
  const written = await page.locator('.session-written').innerText();
  assert.match(written, /opens the artifact reader/);
  assert.match(written, /opens the plan detail/);
  const plan = await page.locator('.session-plan-link').first().getAttribute('href');
  assert.equal(plan, '/plans/repo-a/20-analytics-reset');

  const conversations = harness.api.state.requests.filter(item => /\/conversation$/.test(item.path));
  assert.ok(conversations.length > 0);
  for (const request of conversations) {
    assert.equal(request.search.includes('cohort'), false, 'no cohort= is sent to /conversation');
  }

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
