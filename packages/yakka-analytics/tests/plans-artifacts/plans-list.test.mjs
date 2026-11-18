// Phase 12 unit 12-05: the `/plans` explorer — a server-sorted, cursor-paged
// ranked plan table plus the delivered `scatter-plan` panel, with inspect and a
// rectangle-to-cohort tray.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { p12Schema, p12PlanRows, p12PlanEntities, p12PlanScatter } from '../workspace/fixture.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { validatePanelEntry } from '../../web/js/panels/registry.js';
import { cohortDefinition, encodeCohort } from '../../web/js/core/selection-model.js';
import { parseRoute } from '../../web/js/core/router.js';
import {
  DEFAULT_SORT, PLAN_FILTERS, PLAN_MEASURES, PLANS_LIST_PANEL, allowedFilters, allowedMeasures,
  cohortParam, completeShareText, designScoreText, formatPlanCost, identityFromKey, isMalformedPlanRow,
  mapPlanListResponse, mergePlanRows, parseSort, planCoverageNotes, planListParams, planPageParams,
  planRowKey, planScatterSpec, populationText, readScope, scatterSampleNote, title, unappliedFilter
} from '../../web/js/explorers/plans.js';
import { planDestination, planIdentity } from '../../web/js/panels/scatter-plan.js';

const environment = loadBrowserEnvironment();
const schema = p12Schema();
const plans = p12PlanRows();

test('sort accepts only published plan measures and defaults to last_ts desc', () => {
  assert.deepEqual(parseSort('', PLAN_MEASURES), { measure: 'last_ts', dir: 'desc', raw: 'last_ts:desc' });
  assert.deepEqual(parseSort('associated_cost_usd:desc', PLAN_MEASURES), { measure: 'associated_cost_usd', dir: 'desc', raw: 'associated_cost_usd:desc' });
  assert.deepEqual(parseSort('nope:asc', PLAN_MEASURES), { measure: 'last_ts', dir: 'desc', raw: 'last_ts:desc' });
  assert.equal(DEFAULT_SORT, 'last_ts:desc');
  assert.deepEqual(allowedMeasures(schema), schema.grains.plan.measures);
  assert.ok(PLAN_MEASURES.every(name => allowedMeasures(schema).includes(name)));
  assert.deepEqual(allowedFilters(schema), PLAN_FILTERS);
  assert.equal(title, 'Plans');
});

test('the list request sends only contract names, the frozen window, sort, paging and the first valid cohort', () => {
  const cohort = encodeCohort(cohortDefinition({
    grain: 'plan',
    scope: { from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', tz: 'UTC' },
    predicate: { in: { lens: 'repo_id', values: ['repo-a'] } }
  }));
  const state = {
    from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z', tz: 'UTC',
    filters: { harness: ['orca'], tool: ['Bash'] },
    unknown: { session_model: ['claude'], sort: ['cost_usd:asc'], future: ['x'] },
    exclude: ['session_model:gpt', 'screen_verdict:pass'],
    cohorts: { ca: cohort, cb: 'not-a-cohort' }
  };
  const params = planListParams({ state, filters: PLAN_FILTERS, measures: PLAN_MEASURES, sort: 'associated_cost_usd:asc', limit: 4, cursor: 'abc' });
  assert.equal(params.get('grain'), 'plan');
  assert.equal(params.get('sort'), 'associated_cost_usd:asc');
  assert.equal(params.get('limit'), '4');
  assert.equal(params.get('cursor'), 'abc');
  assert.equal(params.get('tz'), 'UTC');
  assert.equal(params.get('from'), '2026-09-01T00:00:00.000Z');
  assert.equal(params.has('win'), false);
  assert.equal(params.has('tool'), false, 'an undeclared filter is never sent');
  assert.deepEqual(params.getAll('harness'), ['orca']);
  assert.deepEqual(params.getAll('session_model'), ['claude']);
  assert.deepEqual(params.getAll('exclude'), ['session_model:gpt']);
  assert.equal(params.get('cohort'), cohort);
  const next = planPageParams(params, { cursor: 'next', limit: 20 });
  assert.equal(next.get('cursor'), 'next');
  assert.equal(next.get('sort'), 'associated_cost_usd:asc');
  assert.equal(cohortParam({ cohorts: { ca: 'bad', cb: cohort } }), cohort);
  assert.equal(cohortParam({ cohorts: { ca: 'bad' } }), '');
});

test('plan-specific filters fold out of the unknown URL bag without duplicating', () => {
  const state = readScope({ filters: { harness: ['orca'] }, unknown: { session_model: ['claude'], sort: ['last_ts:desc'] }, exclude: [] }, PLAN_FILTERS);
  assert.deepEqual(state.filters.session_model, ['claude']);
  assert.equal('session_model' in state.unknown, false);
  assert.deepEqual(state.unknown.sort, ['last_ts:desc']);
  assert.equal(unappliedFilter({ filters: {}, unknown: { session_model: ['claude'] } }, PLAN_FILTERS), 'session_model');
  assert.equal(unappliedFilter({ filters: {}, unknown: { sort: ['x'] } }, PLAN_FILTERS), '');
});

test('rows map null, lower-bound and no_executions without zero-filling', () => {
  const byPlan = plan => plans.find(row => row.id.plan === plan);
  assert.match(formatPlanCost(byPlan('22')), /unpriced \(all calls\)/);
  assert.match(formatPlanCost(byPlan('20')), /lower bound; 2 unpriced/);
  assert.equal(formatPlanCost(byPlan('21')), '$0.00');
  assert.equal(completeShareText(byPlan('20')), '60%');
  assert.equal(completeShareText(byPlan('21')), 'no executions');
  assert.match(designScoreText(byPlan('20')), /clarity 0\.80, structure 0\.70 \(scorer not served on plan rows\)/);
  assert.equal(designScoreText({ m: {} }), '—');
  const page = p12PlanEntities({ sort: 'last_ts:desc', limit: 4 });
  assert.equal(page.rows.length, 4);
  assert.equal(page.next !== null, true);
  const merged = mergePlanRows(page.rows, p12PlanEntities({ sort: 'last_ts:desc', limit: 4, cursor: page.next }).rows);
  assert.equal(merged.rows.length, 8);
  assert.equal(mergePlanRows(merged.rows, page.rows).added, 0);
  const population = { unit: 'plan', scope_n: 10, eligible_n: 10, returned_n: 4 };
  assert.equal(populationText(population, page.rows), '4 of 10 plans shown');
  assert.equal(populationText(population, merged.rows), '8 loaded; 4 on this page; 10 plans total');
  const notes = planCoverageNotes({ population: { missing_by_reason: { no_executions: 1 } }, rows: [byPlan('22'), byPlan('20'), byPlan('23')] });
  assert.ok(notes.some(note => /all-unpriced/.test(note)));
  assert.ok(notes.some(note => /lower-bound/.test(note)));
  assert.ok(notes.some(note => /sharing a session/.test(note)));
});

test('a malformed plan id is an error row, not a silent skip', () => {
  assert.equal(isMalformedPlanRow({ id: { repo_id: 'repo-a', plan: '20' } }), false);
  assert.equal(isMalformedPlanRow({ id: { repo_id: 'repo-a' } }), true);
  assert.equal(isMalformedPlanRow({ id: null }), true);
  assert.equal(planRowKey({ id: { repo_id: 'repo-a', plan: '20' } }), '{"plan":"20","repo_id":"repo-a"}');
  assert.deepEqual(identityFromKey(planRowKey({ id: { repo_id: 'repo-a', plan: '20' } })), { repo_id: 'repo-a', plan: '20' });
  assert.deepEqual(identityFromKey('not json'), { repo_id: '', plan: '' });
});

test('plan identity and detail destination encode slashes inside path segments', () => {
  const identity = planIdentity({ id: { repo_id: 'org/repo', plan: '20 analytics' } });
  assert.deepEqual(identity, { repo_id: 'org/repo', plan: '20 analytics' });
  assert.equal(planDestination(identity), '/plans/org%2Frepo/20%20analytics');
  assert.equal(parseRoute('/plans').explorer, 'plans');
  assert.equal(parseRoute('/plans/acme/20-analytics-reset').phase, 12);
});

test('the scatter spec and sampled caveat name what the response is', () => {
  const spec = planScatterSpec();
  assert.deepEqual(spec.measures, ['associated_cost_usd', 'artifacts']);
  assert.equal(spec.split, 'repo_id');
  assert.deepEqual(spec.scope, { x: 'associated_cost_usd', y: 'artifacts', colour: 'repo_id' });
  const whole = p12PlanScatter({ fields: spec.measures });
  assert.equal(whole.sampled, false);
  assert.equal(whole.returned_n, 10);
  assert.ok(whole.marginals.associated_cost_usd.bins.length > 0);
  assert.equal(scatterSampleNote(whole), '');
  const sampled = p12PlanScatter({ fields: spec.measures, sampled: true });
  assert.equal(sampled.sampled, true);
  assert.equal(sampled.returned_n, 5);
  assert.equal(sampled.population_n, 10);
  assert.match(scatterSampleNote(sampled), /sample of 5 of 10; marginals are the whole population/);
});

test('the list maps into the one panel-state vocabulary and the panel is valid', () => {
  assert.equal(mapPlanListResponse({ status: 200, body: { rows: [plans[0]], population: {} } }).state, 'ready');
  assert.equal(mapPlanListResponse({ status: 200, body: { rows: [] } }).state, 'empty');
  assert.equal(mapPlanListResponse({ status: 404, body: { error: 'not found' } }).state, 'unsupported');
  const error = mapPlanListResponse({ status: 500, body: { error: 'read failed', code: 'read failed' } });
  assert.equal(error.state, 'error');
  assert.equal(error.message, 'read failed');
  assert.doesNotThrow(() => validatePanelEntry(PLANS_LIST_PANEL));
  assert.equal(PLANS_LIST_PANEL.id, 'plans-list');
  assert.deepEqual(PLANS_LIST_PANEL.charts, []);
  assert.equal(PLANS_LIST_PANEL.table, true);
});

// --- Chromium ------------------------------------------------------------

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

async function settleList(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="plans-list"]')?.dataset.idle === 'true');
}

async function settleScatter(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="scatter-plan"]')?.dataset.idle === 'true');
}

test('the plans list sorts server-side, appends a unique page and shows the overlap banner on cost sort', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);
  const panel = page.locator('[data-panel="plans-list"]');

  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.plan-row').count(), 4);
  assert.match(await panel.innerText(), /4 of 10 plans shown/);
  const firstOrder = await page.locator('.plan-row').evaluateAll(rows => rows.map(row => row.dataset.entityKey));
  assert.equal(new Set(firstOrder).size, 4);

  await page.selectOption('.plans-sort-measure', 'associated_cost_usd');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'associated_cost_usd:desc');
  await settleList(page);
  assert.equal(await page.locator('.plans-overlap-banner').count(), 1);
  assert.match(await page.locator('.plans-overlap-banner').innerText(), /non-additive across plans/);
  const costs = await page.locator('.plan-row td[data-key="associated_cost_usd"]').evaluateAll(cells => cells.map(cell => cell.textContent));
  const values = costs.filter(text => !/unpriced/.test(text)).map(text => Number(text.replace(/[^0-9.]/g, '')));
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index - 1] >= values[index], `cost desc at ${index}`);

  await page.locator('.plans-load-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.plan-row').length === 8);
  const keys = await page.locator('.plan-row').evaluateAll(rows => rows.map(row => row.dataset.entityKey));
  assert.equal(new Set(keys).size, 8);
  await page.locator('.plans-load-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.plan-row').length === 10);
  const all = await page.locator('.plan-row').evaluateAll(rows => rows.map(row => row.dataset.entityKey));
  assert.equal(new Set(all).size, 10);
  assert.equal(await page.locator('.plans-load-more').count(), 0);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('the scatter settles with whole-population marginals and labels its sampled state', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true, planSampled: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  await settleScatter(page);
  const scatter = page.locator('[data-panel="scatter-plan"]');
  assert.equal(await scatter.getAttribute('data-state'), 'ready');
  assert.match(await scatter.innerText(), /sample of 5 of 10; marginals are the whole population/);
  assert.equal(await scatter.locator('.yk-badge[data-kind="sampled"]').count(), 1);
  const marginals = await page.locator('[data-panel="scatter-plan"] .scatter-marginal').count();
  assert.ok(marginals >= 2, `whole-population marginals drawn: ${marginals}`);
  const marks = await page.evaluate(() => document.querySelector('[data-panel="scatter-plan"] yk-chart').inspect().marks.length);
  assert.equal(marks, 4, 'the null-axis plan stays in the population but out of the marks');

  await control(harness.origin, { planSampled: false });
  await page.goto(`${harness.origin}/plans?win=all`);
  await settleScatter(page);
  assert.equal(await page.locator('[data-panel="scatter-plan"] .yk-badge[data-kind="sampled"]').count(), 0);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a mark inspects and Open reaches the plan destination, and a rectangle makes a ca cohort the table refetches', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  await settleScatter(page);

  const point = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="scatter-plan"] yk-chart');
    const result = chart.inspect();
    const mark = result.marks[0];
    if (!mark) return null;
    return { x: result.plot.left + mark.px, y: result.plot.top + mark.py };
  });
  assert.ok(point, 'a plan mark is drawn');
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => /^\/plans\/[^/]+\/[^/]+$/.test(location.pathname));
  const detailPath = await page.evaluate(() => location.pathname);
  assert.match(detailPath, /^\/plans\/[^/]+\/[^/]+$/);
  assert.doesNotMatch(await page.locator('main').innerText(), /Not found/);

  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  await settleScatter(page);
  const before = harness.api.state.requests.filter(item => /\/entities$/.test(item.path)).length;
  const rect = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="scatter-plan"] yk-chart');
    const { plot } = chart.inspect();
    return {
      x0: plot.left + plot.width * 0.1, y0: plot.top + plot.height * 0.1,
      x1: plot.left + plot.width * 0.9, y1: plot.top + plot.height * 0.9
    };
  });
  await page.mouse.move(rect.x0, rect.y0);
  await page.mouse.down();
  await page.mouse.move(rect.x1, rect.y1, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.selection-tray')?.dataset.open === 'true');
  assert.match(await page.locator('.selection-tray-summary').innerText(), /3 plans of 10 in scope/);
  await page.locator('.selection-tray-action[data-action="make-cohort"][data-slot="A"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.search).has('ca'));
  await settleList(page);
  const requests = harness.api.state.requests.filter(item => /\/entities$/.test(item.path));
  assert.ok(requests.length > before);
  assert.ok(requests.slice(before).some(item => item.search.includes('cohort=')), 'the table refetched under the cohort');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('empty and error states are named, and a legacy server names the missing capability', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const diagnostics = await watchPage(page);
  const panel = page.locator('[data-panel="plans-list"]');

  await control(harness.origin, { p12: true, empty: true });
  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'empty');
  assert.match(await panel.innerText(), /No rows match/);
  await control(harness.origin, { empty: false });

  await control(harness.origin, { p12: true, planError: true });
  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'error');
  assert.match(await panel.innerText(), /plans read failed/);
  assert.ok(await panel.locator('button', { hasText: 'Retry' }).count() > 0);
  await control(harness.origin, { planError: false });

  await control(harness.origin, { p12: false, scenario: 'legacy' });
  await page.goto(`${harness.origin}/plans?win=all`);
  await settleList(page);
  assert.equal(await panel.getAttribute('data-state'), 'unsupported');
  assert.match(await panel.innerText(), /entities_plan/);
  await control(harness.origin, { scenario: 'default' });

  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*(500|404)/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
