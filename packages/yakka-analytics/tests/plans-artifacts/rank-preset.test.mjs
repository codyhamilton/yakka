// Phase 12 unit 12-02: plan-grain rank and the delivered Workflow preset.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBrowserEnvironment, launchBrowser, SKIP_REASON, p12PlanEntities, p12Schema
} from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { hasPanel, listPanels } from '../../web/js/panels/registry.js';
import { listPresets, presetDestination, validatePresets } from '../../web/js/boards/presets.js';
import {
  PLAN_RANK_MEASURES, isPlanRank, publishedPlanMeasures, planRankMeasure, planComparisonUnsupported,
  planRankParams, planRankLimit, planRankRows, planRankOverlap, planRankCostText, planRankEntities
} from '../../web/js/panels/rank.js';
import {
  WORKFLOW_PANEL_IDS, WORKFLOW_PRESET_ID, WORKFLOW_SPECS, registerP12WorkflowPanels
} from '../../web/js/panels/p12-workflow.js';

const environment = loadBrowserEnvironment();

test('the workflow preset is a five-panel board once Phase 12 registers', () => {
  assert.equal(registerP12WorkflowPanels(), true);
  assert.equal(registerP12WorkflowPanels(), true);
  for (const id of WORKFLOW_PANEL_IDS) assert.equal(hasPanel(id), true, `${id} is registered`);
  for (const id of WORKFLOW_PANEL_IDS) {
    assert.equal(listPanels().filter(panel => panel.id === id).length, 1, `${id} is registered once`);
  }
  assert.deepEqual(WORKFLOW_PANEL_IDS, ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river']);
  const preset = listPresets().find(item => item.id === WORKFLOW_PRESET_ID);
  assert.deepEqual(preset.panels, WORKFLOW_PANEL_IDS);
  assert.deepEqual(Object.keys(WORKFLOW_SPECS), WORKFLOW_PANEL_IDS);
  assert.equal(WORKFLOW_SPECS.rank.grain, 'plan');
  assert.deepEqual(WORKFLOW_SPECS.rank.measures, ['associated_cost_usd']);
  assert.equal(presetDestination('workflow').kind, 'board');
  assert.equal(presetDestination('workflow').phase, undefined);
  assert.equal(validatePresets(), true);
});

test('plan params carry the shared window and filters but no time-only keys', () => {
  assert.equal(isPlanRank({ grain: 'plan' }), true);
  assert.equal(isPlanRank({ scope: { grain: 'plan' } }), true);
  assert.equal(isPlanRank({ grain: 'time' }), false);
  assert.equal(isPlanRank({ measures: ['associated_cost_usd'] }), false, 'a measure name never infers plan mode');

  const params = planRankParams({
    scope: {
      win: '30d', tz: 'Australia/Brisbane', repo_id: ['repo-a', 'repo-b'], harness: 'orca',
      session_model: ['claude'], exclude: ['kind:report']
    },
    measure: 'associated_cost_usd', limit: 4
  });
  assert.equal(params.get('grain'), 'plan');
  assert.equal(params.get('sort'), 'associated_cost_usd:desc');
  assert.equal(params.get('limit'), '4');
  assert.equal(params.get('tz'), 'Australia/Brisbane');
  assert.equal(params.get('all'), null);
  assert.ok(params.get('from') && params.get('to'));
  assert.deepEqual(params.getAll('repo_id'), ['repo-a', 'repo-b']);
  assert.equal(params.get('harness'), 'orca');
  assert.equal(params.get('session_model'), 'claude');
  assert.deepEqual(params.getAll('exclude'), ['kind:report']);
  for (const key of ['measure', 'dim', 'bucket']) assert.equal(params.has(key), false, `${key} is time-grain only`);

  const open = planRankParams({ scope: {}, measure: 'associated_cost_usd', limit: 4 });
  assert.equal(open.get('all'), '1');
  assert.equal(open.get('from'), null);
});

test('only published plan measures are offered and comparison is refused', () => {
  const schema = p12Schema();
  const offered = publishedPlanMeasures(schema);
  for (const name of ['associated_cost_usd', 'artifacts', 'span_days', 'design_score:clarity']) {
    assert.ok(offered.includes(name), `${name} is offered`);
  }
  assert.equal(offered.includes('id'), false);
  assert.equal(offered.includes('repo_id'), false);
  assert.deepEqual(planRankMeasure(schema, {}), { measure: 'associated_cost_usd', offered, requested: '', unsupported: false });
  assert.equal(planRankMeasure(schema, { measures: ['versions'] }).measure, 'versions');
  const missing = planRankMeasure(schema, { measures: ['cost_usd'] });
  assert.equal(missing.unsupported, true);
  assert.equal(missing.measure, '');
  assert.equal(planRankLimit(schema), 4);
  assert.equal(planRankLimit({ budgets: { top_max: 6, page_max: 500 } }), 6);
  assert.equal(planRankLimit({ budgets: {} }), 12);
  assert.equal(PLAN_RANK_MEASURES.includes('associated_cost_usd'), true);
  assert.equal(planComparisonUnsupported({ cmp: 'period' }), 'period comparison is time-grain only');
  assert.equal(planComparisonUnsupported({ cmp: 'cohorts' }), 'period comparison is time-grain only');
  assert.equal(planComparisonUnsupported({}), null);
});

test('plan rows keep nulls out of the marks and name overlap and lower bounds', () => {
  const body = p12PlanEntities({ sort: 'associated_cost_usd:desc', limit: 100 });
  const mapped = planRankRows(body, 'associated_cost_usd');
  assert.equal(mapped.rows.length, 10);
  assert.equal(mapped.drawn.length, 9);
  assert.equal(mapped.nulls.length, 1);
  const unpriced = mapped.nulls[0];
  assert.deepEqual(unpriced.identity, { repo_id: 'repo-b', plan: '22' });
  assert.equal(unpriced.allUnpriced, true);
  assert.equal(planRankCostText(unpriced.values.associated_cost_usd, { allUnpriced: true }), 'all unpriced');

  const lower = mapped.rows.find(row => row.identity.plan === '27');
  assert.equal(lower.lowerBound, true);
  assert.equal(planRankCostText(lower.values.associated_cost_usd, { lowerBound: true }), '$2.00+');

  const plan20 = mapped.rows.find(row => row.identity.plan === '20');
  assert.equal(plan20.label, 'repo-a/20');
  assert.equal(plan20.values.shared_sessions, 1);
  assert.equal(plan20.values.sessions, 3);
  assert.match(plan20.values.executions, /3 complete/);
  assert.equal(plan20.values['plan identity'], 'repo-a/20');

  const overlap = planRankOverlap(mapped.rows);
  assert.equal(overlap.plans, 10);
  assert.equal(overlap.shared, 2);
  assert.equal(overlap.lower, 1);
  assert.equal(overlap.unpriced, 1);
  assert.match(overlap.text, /overlaps across plans/);
  assert.match(overlap.text, /2 shared-session reports/);
  assert.match(overlap.text, /touch more than one plan/);
  assert.match(overlap.lowerText, /lower bounds/);
  assert.match(overlap.unpricedText, /all unpriced/);

  const entities = planRankEntities(mapped.drawn);
  assert.equal(entities[plan20.key].destination, '/plans/repo-a/20');
  assert.equal(entities[plan20.key].entity.grain, 'plan');
});

// --- Chromium ------------------------------------------------------------

test('the workflow board settles five panels, shows plan ranks and opens a plan', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1400, height: 2200 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/b/workflow?win=all`);
  await page.waitForFunction(() => {
    const ids = ['shape-bars', 'plan-timeline', 'rank', 'scatter-plan', 'river'];
    return ids.every(id => document.querySelector(`[data-panel="${id}"]`)?.dataset.idle === 'true');
  });
  const rank = page.locator('[data-panel="rank"]');
  assert.equal(await rank.getAttribute('data-state'), 'ready');
  assert.match(await rank.innerText(), /Associated cost sums sessions and overlaps across plans/);
  assert.match(await rank.innerText(), /shared-session reports?/);

  const bars = await page.evaluate(() => {
    const element = document.querySelector('[data-panel="rank"] yk-bars');
    const view = element.inspect();
    return {
      marks: view.marks.length,
      series: view.series.map(series => series.key),
      labels: element.shadowRoot.textContent
    };
  });
  assert.equal(bars.marks, 4);
  assert.deepEqual(bars.series, ['associated_cost_usd']);
  assert.match(bars.labels, /repo-b\/26/, 'the bar chart labels each plan');
  const firstRow = await page.locator('[data-panel="rank"] table.pulse-table tbody tr').first().innerText();
  assert.match(firstRow, /repo-b/);
  assert.match(firstRow, /\b26\b/, 'the rank table names the plan identity');

  const point = await page.evaluate(() => {
    const element = document.querySelector('[data-panel="rank"] yk-bars');
    const hit = element.shadowRoot.querySelector('[data-mark="0"] [data-hit]');
    hit.scrollIntoView({ block: 'center' });
    const rect = hit.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  const facts = await page.locator('.workspace-inspector').innerText();
  assert.match(facts, /plan identity/);
  assert.match(facts, /repo-b\/26/);
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => /^\/plans\//.test(location.pathname));
  assert.equal(new URL(page.url()).pathname, '/plans/repo-b/26');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
