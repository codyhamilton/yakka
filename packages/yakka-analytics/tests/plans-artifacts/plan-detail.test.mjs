// Phase 12 unit 12-06: `/plans/<repo>/<plan>` — the fixed plan identity, its
// independently paged collections, and the stored design phases/brief paths
// parsed for display only. No completion or review inference is ever produced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import {
  p12Schema, p12PlanRows, p12DetailPlanRows, p12PlanDetailPage, p12PlanArtifactEntities,
  p12PlanSessions, p12SessionEntities, p12PlanEvents, p12ExecutionEntities
} from '../workspace/fixture.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { parseRoute } from '../../web/js/core/router.js';
import {
  artifactLatestDestination, artifactScoreEntries, briefObservationText, detailExecutionCost,
  detailMoney, detailPopulationText, detailSessionCost, detailWritingSessionCost, executionScores,
  pairBriefs, parseBriefPaths, parseDesignPhases, parsePlanDetailPath, planArtifactsParams,
  planCollectionParams, planDetailNotApplied, planRowParams, planSessionResolveParams
} from '../../web/js/explorers/plans.js';

const environment = loadBrowserEnvironment();
const identity = { repo_id: 'acme/widgets', plan: '20-analytics-reset' };

const DESIGN = [
  '# Design',
  '',
  'Prose mentions complete and ### Phase 5 inside a sentence.',
  '',
  '### Phase 3 — Foundations',
  '',
  '- Outcome: Reader text renders as text nodes.',
  '',
  '### Phase 7 — Unwritten',
  '',
  '- Outcome: This phase reads complete in prose only.',
  '',
  '```',
  '### Phase 99 — Fenced decoy',
  '- Outcome: never parsed',
  '```',
  '',
  '### Phase 12 — Detail',
  '',
  '- Outcome: Phases are displayed, never counted.'
].join('\n');

test('the router decodes one path segment exactly once and keeps the plan identity', () => {
  assert.equal(parseRoute('/plans').kind, 'explorer');
  assert.deepEqual(parseRoute('/plans/acme/20-analytics-reset').plan, { repo_id: 'acme', plan: '20-analytics-reset' });
  assert.deepEqual(parseRoute('/plans/acme%2Fwidgets/20-analytics-reset').plan, identity);
  assert.deepEqual(parsePlanDetailPath('/plans/acme%2Fwidgets/20-analytics-reset'), identity);
  assert.equal(parsePlanDetailPath('/plans/acme%2Fwidgets'), null);
  assert.equal(parseRoute('/plans/one-segment').kind, 'not-found');
  assert.equal(parseRoute('/plans/%E0%A4%A/plan').kind, 'not-found');
});

test('the design parser honors fences, decoys, prose and a missing outcome', () => {
  const phases = parseDesignPhases(DESIGN);
  assert.deepEqual(phases.map(phase => phase.number), [3, 7, 12]);
  assert.equal(phases[0].heading, 'Foundations');
  assert.match(phases[0].outcome, /text nodes/);
  assert.match(phases[1].outcome, /complete/);
  assert.equal(phases.some(phase => phase.number === 99), false, 'a fenced decoy is never a phase');
  assert.equal(phases.length, 3, 'prose mentioning ### Phase is not a heading');
  const missing = parseDesignPhases('### Phase 4 - No outcome here\n\nBody only.\n');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].outcome, null);
});

test('brief paths pair by phase and unpaired briefs are never assigned', () => {
  const rows = [
    { id: { repo_id: 'r', path: 'docs/plans/p/briefs/3-01-foundations.md' } },
    { id: { repo_id: 'r', path: 'docs/plans/p/briefs/12-01-detail.md' } },
    { id: { repo_id: 'r', path: 'docs/plans/p/briefs/99-01-orphan.md' } },
    { id: { repo_id: 'r', path: 'docs/plans/p/DESIGN.md' } }
  ];
  const briefs = parseBriefPaths(rows);
  assert.deepEqual(briefs.map(brief => [brief.phase, brief.unit, brief.slug]), [[3, 1, 'foundations'], [12, 1, 'detail'], [99, 1, 'orphan']]);
  const { phases, unpaired } = pairBriefs(parseDesignPhases(DESIGN), briefs);
  assert.deepEqual(phases.find(phase => phase.number === 3).briefs.map(brief => brief.path), ['docs/plans/p/briefs/3-01-foundations.md']);
  assert.deepEqual(phases.find(phase => phase.number === 7).briefs, []);
  assert.deepEqual(unpaired.map(brief => brief.phase), [99]);
  assert.equal(briefObservationText([]), 'no brief path observed in the loaded artifact rows');
  assert.equal(Object.hasOwn(phases[0], 'complete'), false);
  assert.equal(Object.hasOwn(phases[0], 'completion'), false);
});

test('cost, population and score helpers keep null and lower bounds honest', () => {
  assert.equal(detailMoney(null), 'unpriced (all calls)');
  assert.equal(detailMoney(null, false, 'all_unpriced'), 'unpriced (all calls)');
  assert.equal(detailMoney(3, true), '$3.00 (lower bound)');
  assert.equal(detailExecutionCost({ m: { session_cost_usd: 2 }, flags: { session_cost_lower_bound: true } }), '$2.00 (lower bound)');
  assert.equal(detailExecutionCost({ m: { session_cost_usd: null }, flags: { session_cost_null_reason: 'all_unpriced' } }), 'unpriced (all calls)');
  assert.equal(detailSessionCost({ m: { cost_usd: 1.5 }, flags: { cost_lower_bound: true } }), '$1.50 (lower bound)');
  assert.equal(detailWritingSessionCost({ m: { writing_session_cost_usd: null }, flags: { null_reasons: { writing_session_cost_usd: 'all_unpriced' } } }), 'unpriced (all calls)');
  assert.equal(detailPopulationText({ unit: 'artifact', scope_n: 6, returned_n: 4 }, [1, 2, 3, 4]), '4 loaded; 4 on this page; 6 artifact total');
  const entries = artifactScoreEntries({ m: { 'score:clarity': 0.5, 'score_scorer:clarity': 'jev-1', 'score:structure': null }, l: { 'band:clarity': 'high' } });
  assert.deepEqual(entries, [
    { check: 'clarity', score: 0.5, scorer: 'jev-1', band: 'high' },
    { check: 'structure', score: null, scorer: '', band: null }
  ]);
  const scores = executionScores({ m: { 'brief_score:preview': 0.5, 'report_score:clean': 0.8 } });
  assert.deepEqual(scores.brief, [{ check: 'preview', score: 0.5 }]);
  assert.deepEqual(scores.report, [{ check: 'clean', score: 0.8 }]);
});

test('request builders name the plan, page independently and never send cohort to /entity', () => {
  const state = { win: 'all', tz: 'UTC', filters: { harness: ['orca'] }, cohorts: { ca: '{"v":1}' } };
  const row = planRowParams(identity, { state, limit: 1 });
  assert.equal(row.get('grain'), 'plan');
  assert.equal(row.get('repo_id'), 'acme/widgets');
  assert.equal(row.get('plan'), '20-analytics-reset');
  assert.equal(row.get('limit'), '1');
  assert.equal(row.has('cohort'), false);
  const artifacts = planArtifactsParams(identity, { state, limit: 4, cursor: 'c1' });
  assert.equal(artifacts.get('grain'), 'artifact');
  assert.equal(artifacts.get('cursor'), 'c1');
  assert.equal(artifacts.has('cohort'), false);
  const collection = planCollectionParams(identity, 'sessions', { state, limit: 4 });
  assert.equal(collection.get('collection'), 'sessions');
  assert.equal(collection.has('cohort'), false);
  const resolve = planSessionResolveParams(['a', 'b', 'a'], { state, limit: 4 });
  assert.deepEqual(resolve.getAll('id'), ['a', 'b']);
  assert.equal(resolve.has('cohort'), false);
  assert.equal(artifactLatestDestination(identity, 'docs/plans/20-analytics-reset/DESIGN.md').includes('hash='), false);
  assert.deepEqual(planDetailNotApplied({ cohorts: { ca: 'x' }, filters: { harness: ['orca'] }, exclude: ['session_model:gpt'] }), ['cohort CA', 'harness: orca', 'exclude session_model:gpt']);
  assert.deepEqual(planDetailNotApplied({}), []);
});

test('the fixture detail scene is additive and independently paged', () => {
  assert.equal(p12PlanRows().length, 10, 'the list population is unchanged');
  const page = p12PlanDetailPage({ repo_id: identity.repo_id, plan: identity.plan, limit: 1 });
  assert.equal(page.rows.length, 1);
  assert.deepEqual(page.rows[0].id, identity);
  assert.equal(p12PlanDetailPage({ repo_id: 'repo-a', plan: 'absent', limit: 1 }).rows.length, 0);
  const artifacts = p12PlanArtifactEntities({ repo_id: identity.repo_id, plan: identity.plan, limit: 4 });
  assert.equal(artifacts.rows.length, 4);
  assert.ok(artifacts.next);
  assert.equal(new Set(artifacts.rows.map(row => row.l.kind)).size, 2);
  const sessions = p12PlanSessions({ repo_id: identity.repo_id, plan: identity.plan, limit: 4 });
  assert.equal(sessions.rows.length, 2);
  assert.equal(p12SessionEntities({ ids: ['conv-detail-a', 'conv-detail-b'], limit: 4 }).rows.length, 1);
  assert.equal(p12PlanEvents({ repo_id: identity.repo_id, plan: identity.plan, limit: 4 }).rows.length, 4);
  assert.equal(p12ExecutionEntities({ repo_id: identity.repo_id, plan: identity.plan, limit: 4 }).rows.length, 4);
  assert.equal(p12Schema().budgets.page_max, 4);
});

// --- Chromium ------------------------------------------------------------

async function settleDetail(page) {
  await page.waitForFunction(() => {
    const sections = [...document.querySelectorAll('.plans-detail-section')];
    return sections.length > 0 && sections.every(section => section.dataset.state !== 'loading');
  });
}

test('a fixed plan detail shows all collections, the timeline and stored design phases for an encoded repo', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2800 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans/acme%2Fwidgets/20-analytics-reset?win=all`);
  await settleDetail(page);
  await page.waitForFunction(() => document.querySelector('[data-panel="plan-timeline"]')?.dataset.idle === 'true');

  assert.match(await page.locator('.plans-detail-identity').innerText(), /acme\/widgets \/ 20-analytics-reset/);
  assert.equal(await page.locator('[data-section="summary"]').getAttribute('data-state'), 'ready');
  assert.match(await page.locator('[data-section="summary"]').innerText(), /non-additive and overlapping/);
  assert.match(await page.locator('[data-section="summary"]').innerText(), /process completion, not success/);

  const artifacts = page.locator('[data-section="artifacts"]');
  assert.equal(await artifacts.getAttribute('data-state'), 'ready');
  assert.equal(await artifacts.locator('tbody tr').count(), 4);
  const artifactText = await artifacts.innerText();
  assert.match(artifactText, /design/);
  assert.match(artifactText, /brief/);
  assert.match(artifactText, /latest version/i);

  const executions = page.locator('[data-section="executions"]');
  assert.equal(await executions.getAttribute('data-state'), 'ready');
  assert.match(await executions.innerText(), /complete/);
  assert.match(await executions.innerText(), /unreported/);
  assert.match(await executions.innerText(), /started/);
  assert.match(await executions.innerText(), /Execution completion, not success/);

  const sessions = page.locator('[data-section="sessions"]');
  assert.equal(await sessions.getAttribute('data-state'), 'ready');
  assert.match(await sessions.innerText(), /conv-detail-a/);
  assert.match(await sessions.innerText(), /conv-detail-b/);
  assert.match(await sessions.innerText(), /session detail unavailable/);
  assert.match(await sessions.innerText(), /non-additive across plans/);

  const events = page.locator('[data-section="events"]');
  assert.equal(await events.getAttribute('data-state'), 'ready');
  assert.match(await events.innerText(), /not only plan files/);
  assert.match(await events.innerText(), /commit|hook/);

  const design = page.locator('[data-section="design"]');
  assert.equal(await design.getAttribute('data-state'), 'ready');
  const phaseText = await design.locator('.plans-phases').innerText();
  assert.match(phaseText, /Phase 3/);
  assert.match(phaseText, /Phase 7/);
  assert.match(phaseText, /Phase 12/);
  assert.match(phaseText, /Outcome:/);
  assert.match(phaseText, /complete/, 'the prose word complete is rendered as text');
  assert.doesNotMatch(phaseText, /Fenced decoy/);
  assert.equal(await design.locator('.plans-phase[data-phase="99"]').count(), 0);
  assert.match(await design.locator('.plans-phase[data-phase="7"] .plans-phase-briefs').innerText(), /no brief path observed/);
  assert.match(await design.locator('.plans-unpaired-briefs').innerText(), /99-01-orphan\.md/);
  const completionMarkers = await page.evaluate(() => {
    const node = document.querySelector('.plans-phase[data-phase="7"]');
    if (!node) return 1;
    return [node, ...node.querySelectorAll('*')].filter(element =>
      /complete|completion/i.test(element.className || '') ||
      element.hasAttribute('data-complete') ||
      /complete|completion/i.test(element.getAttribute('data-state') || '')
    ).length;
  });
  assert.equal(completionMarkers, 0, 'a "complete" outcome never becomes a completion marker or state');

  assert.equal(await page.locator('[data-section="design"] .plans-design-open').count(), 1);
  assert.equal((await page.locator('.plans-design-open').getAttribute('href')).includes('hash='), false);

  const requests = harness.api.state.requests;
  const entityRequests = requests.filter(item => /\/analytics\/(entity|entities)$/.test(item.path));
  assert.ok(entityRequests.length > 0);
  assert.ok(entityRequests.every(item => !item.search.includes('cohort=')), 'the fixed plan page never sends cohort=');
  const sessionResolve = requests.filter(item => /\/entities$/.test(item.path) && /grain=session/.test(item.search));
  assert.ok(sessionResolve.some(item => new URLSearchParams(item.search).getAll('id').length >= 1));

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('each Load more appends its own section without resetting another', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2800 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans/acme%2Fwidgets/20-analytics-reset?win=all`);
  await settleDetail(page);
  const artifactRows = () => page.locator('[data-section="artifacts"] tbody tr').count();
  const eventRows = () => page.locator('[data-section="events"] tbody tr').count();
  const executionRows = () => page.locator('[data-section="executions"] tbody tr').count();
  assert.equal(await artifactRows(), 4);
  assert.equal(await eventRows(), 4);
  const executionsBefore = await executionRows();

  await page.locator('.plans-detail-more-artifacts').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-section="artifacts"] tbody tr').length === 6);
  assert.equal(await eventRows(), 4, 'the events section keeps its page');
  assert.equal(await executionRows(), executionsBefore, 'the executions section keeps its page');

  await page.locator('.plans-detail-more-events').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-section="events"] tbody tr').length === 8);
  assert.equal(await artifactRows(), 6, 'the artifacts section keeps its appended page');

  assert.equal(await page.locator('[data-section="artifacts"] .plans-detail-more-artifacts').count(), 0);
  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('an unavailable design shows its exact reason and empty collections are named', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans/repo-a/21-empty?win=all`);
  await settleDetail(page);
  const design = page.locator('[data-section="design"]');
  assert.equal(await design.getAttribute('data-state'), 'ready');
  assert.match(await design.innerText(), /content unavailable: not_stored/);
  assert.equal(await page.locator('[data-section="executions"]').getAttribute('data-state'), 'empty');
  assert.equal(await page.locator('[data-section="sessions"]').getAttribute('data-state'), 'empty');
  assert.equal(await page.locator('[data-section="events"]').getAttribute('data-state'), 'empty');
  assert.match(await page.locator('[data-section="executions"]').innerText(), /No executions/);

  // The design content route answers a deliberate 404 for the unavailable
  // version; Chromium records that failed resource as a console error.
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*(404|413|500)/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('an absent plan is named, links back to /plans and never falls back to another plan', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const diagnostics = await watchPage(page);

  await page.goto(`${harness.origin}/plans/repo-a/no-such-plan?win=all`);
  await settleDetail(page);
  const summary = page.locator('[data-section="summary"]');
  assert.equal(await summary.getAttribute('data-state'), 'empty');
  assert.match(await summary.innerText(), /No served plan \(repo-a, no-such-plan\)/);
  assert.equal(await page.locator('.plans-detail-back').getAttribute('href'), '/plans');
  assert.doesNotMatch(await page.locator('main').innerText(), /acme\/widgets/);
  assert.equal(await page.locator('[data-section="artifacts"] tbody tr').count(), 0);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
