// Phase 11 unit 11-01: the pure scatter seam. No browser here; the panel's
// settled-state proof belongs to 11-03, when `/b/scatter` becomes a delivered
// board.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  associationLines, associationTotals, canonicalJson, canonicalPredicate, decodeCohort, timeCohortSource
} from '../../web/js/core/selection-model.js';
import {
  buildCohort, selectionTrayModel
} from '../../web/js/core/selection-tray.js';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import {
  SCATTER_DAY_PANEL, bucketInterval, bucketIntersectsWindow, timeBucketInfo, timePoint, timeScatterParams
} from '../../web/js/panels/scatter-day.js';
import {
  canonicalRowKey, countSelection, marginalModel, regionPredicate, scatterAxes, scatterCaveat,
  scatterColours, scatterParams, scatterPopulationText, scatterRows, scatterSpecFields,
  subtractRegion, unionRegion
} from '../../web/js/panels/scatter-shared.js';
import { SCATTER_SESSION_PANEL } from '../../web/js/panels/scatter-session.js';
import { registerScatterPanels } from '../../web/js/panels/p11-scatter.js';
import { hasPanel, lookupPanel } from '../../web/js/panels/registry.js';
import { lookupPreset, presetDestination } from '../../web/js/boards/presets.js';
import { P11, p11Schema, p11Scatter } from './fixture.mjs';
import {
  makeSchema, p11TimeAggregate, p11TimeRows, p11TimeScatter
} from '../workspace/fixture.mjs';

const schema = p11Schema();
const panel = SCATTER_SESSION_PANEL;
const region = { x: { min: 0.5, max: 2 }, y: { min: 1, max: 4 } };

test('numeric axes and colour come only from what the grain publishes', () => {
  const axes = scatterAxes(panel, schema);
  assert.ok(axes.axes.includes('cost_usd'));
  assert.ok(axes.axes.includes('commits'));
  assert.ok(axes.axes.includes('unpriced_calls'));
  assert.ok(axes.axes.includes('first_ts'));
  assert.ok(axes.axes.includes('last_ts'));
  assert.equal(axes.axes.includes('id'), false);
  assert.equal(axes.axes.includes('model'), false);
  assert.deepEqual(axes.unsupported, []);

  const colours = scatterColours(panel, schema);
  assert.ok(colours.colours.includes('session_model'));
  assert.ok(colours.colours.includes('harness'));
  assert.equal(colours.colours.includes('id'), false);
  assert.ok(colours.unsupported.some(item => item.name === 'id' && /identity lens/.test(item.reason)));

  const artifact = scatterAxes({ grain: 'artifact', measures: ['model', 'score:clarity'] }, schema);
  assert.deepEqual(artifact.axes, ['score:clarity']);
  assert.ok(artifact.unsupported.some(item => item.name === 'model' && /categorical/.test(item.reason)));

  const partial = scatterAxes(panel, makeSchema());
  assert.ok(partial.axes.includes('cost_usd'));
  assert.equal(partial.axes.includes('duration_s'), false);
  assert.ok(partial.unsupported.some(item => item.name === 'duration_s' && item.try));
});

test('the scatter request adds only the published grain, mode and fields', () => {
  const params = scatterParams({
    scope: { win: '30d', tz: 'UTC', harness: ['orca'] },
    spec: { grain: 'session' },
    grain: 'session',
    fields: ['cost_usd', 'commits', 'unpriced_calls']
  });
  assert.equal(params.get('grain'), 'session');
  assert.equal(params.get('mode'), 'scatter');
  assert.equal(params.get('fields'), 'cost_usd,commits,unpriced_calls');
  assert.equal(params.get('harness'), 'orca');
  assert.equal(params.get('measure'), null);
  assert.equal(params.get('dim'), null);
  assert.match(params.get('from'), /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(params.get('from')) < Date.parse(params.get('to')));

  const all = scatterParams({ scope: { win: 'all' }, grain: 'session', fields: ['cost_usd', 'commits'] });
  assert.equal(all.get('all'), '1');
  assert.equal(all.get('fields'), 'cost_usd,commits');
  assert.equal(all.get('from'), null);
});

test('row keys are canonical identities and null axes stay out of the drawn marks', () => {
  assert.equal(canonicalRowKey('conv-001', 'session'), 'conv-001');
  assert.equal(canonicalRowKey({ repo_id: 'repo-a', path: 'docs/a.md' }, 'artifact'), '{"path":"docs/a.md","repo_id":"repo-a"}');
  assert.equal(canonicalRowKey({ tz: 'UTC', t: 1700000000 }, 'time'), '{"t":1700000000,"tz":"UTC"}');

  const body = {
    grain: 'session',
    population_n: 10,
    rows: [
      { id: 'conv-001', m: { cost_usd: 1.5, commits: 2, unpriced_calls: 0 }, l: { session_model: 'claude' }, flags: { sampled: true } },
      { id: 'conv-002', m: { cost_usd: null, commits: 1, unpriced_calls: 3 }, l: { session_model: 'gpt' }, flags: { sampled: true } },
      { id: 'conv-003', m: { cost_usd: 2.5, commits: null, unpriced_calls: 1 }, l: { session_model: 'gpt' }, flags: { sampled: true } },
      { id: 'conv-004', m: { cost_usd: 0.75, commits: 0, unpriced_calls: null }, l: { session_model: '(mixed)' }, flags: { sampled: true } }
    ]
  };
  const spec = { grain: 'session', measures: ['commits', 'cost_usd', 'unpriced_calls'], split: 'session_model', scope: { x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: 'session_model' } };
  const rows = scatterRows(body, spec);
  assert.deepEqual(rows.map(row => row.key), ['conv-001', 'conv-004']);
  assert.equal(rows[0].group, 'claude');
  assert.equal(rows[0].x, 1.5);
  assert.equal(rows[0].y, 2);
  assert.equal(rows[0].sampled, true);
  assert.equal(rows[1].size, null, 'a missing size is null, never zero-filled');
  assert.equal(rows[1].values.cost_usd, 0.75);

  const fields = scatterSpecFields(spec, schema);
  assert.deepEqual(fields, { x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: 'session_model' });
});

test('marginals read the fixed whole-population bins for each field', () => {
  const body = p11Scatter({ fields: ['cost_usd', 'commits'] });
  const model = marginalModel(body.marginals, ['cost_usd', 'commits']);
  assert.deepEqual(model.map(item => item.field), ['cost_usd', 'commits']);
  assert.equal(model[0].total, P11.populationN);
  assert.equal(model[1].total, P11.eligibleN);
  assert.ok(model[0].bins.length >= 2);
  assert.equal(typeof model[0].bins[0].from, 'number');
  assert.ok(model[0].bins[model[0].bins.length - 1].to === null);
  assert.deepEqual(marginalModel(null, ['cost_usd']), []);
});

test('a rectangle is a canonical range predicate; union and subtraction stay Boolean', () => {
  const rectangle = regionPredicate(region, 'cost_usd', 'commits');
  assert.deepEqual(rectangle, canonicalPredicate({
    and: [
      { range: { measure: 'cost_usd', lo: 0.5, hi: 2 } },
      { range: { measure: 'commits', lo: 1, hi: 4 } }
    ]
  }));

  const union = unionRegion(rectangle, regionPredicate({ x: { min: 3, max: 4 }, y: { min: 0, max: 1 } }, 'cost_usd', 'commits'));
  assert.ok(union.or);
  assert.equal(union.or.length, 2);
  assert.equal(canonicalJson(union), canonicalJson(canonicalPredicate(union)));

  const subtraction = subtractRegion(rectangle, regionPredicate({ x: { min: 0.5, max: 1 }, y: { min: 1, max: 2 } }, 'cost_usd', 'commits'));
  assert.ok(subtraction.and);
  assert.ok(subtraction.and.some(node => node.not));
  assert.equal(canonicalJson(subtraction), canonicalJson(canonicalPredicate(subtraction)));

  assert.deepEqual(unionRegion(null, rectangle), rectangle);
  assert.deepEqual(subtractRegion(null, rectangle), rectangle);
});

test('an explicit predicate builds a canonical cohort with a frozen absolute scope', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const predicate = regionPredicate(region, 'cost_usd', 'commits');
  const cohort = buildCohort({
    state: { win: '7d', tz: 'UTC', filters: { harness: ['orca'] } },
    grain: 'session',
    schema,
    predicate,
    now
  });
  assert.equal(cohort.op, 'include');
  assert.equal(cohort.scope.from, '2026-09-24T00:00:00.000Z');
  assert.equal(cohort.scope.to, '2026-10-01T00:00:00.000Z');
  assert.equal(cohort.scope.tz, 'UTC');
  assert.deepEqual(cohort.scope.include, [{ lens: 'harness', values: ['orca'] }]);
  assert.deepEqual(cohort.predicate, predicate);
  assert.ok(decodeCohort(JSON.stringify(cohort)));

  const excluded = buildCohort({ state: { win: '7d', tz: 'UTC' }, grain: 'session', schema, predicate, op: 'exclude', now });
  assert.equal(excluded.op, 'exclude');

  assert.throws(() => buildCohort({ state: {}, grain: 'session', schema, predicate: null, pick: { include: [], exclude: [] } }), /non-empty selection/);
});

test('the tray prefers an explicit predicate and keeps key-selection text unchanged', () => {
  const predicate = regionPredicate(region, 'cost_usd', 'commits');
  const model = selectionTrayModel({
    state: { win: '30d', pick: 's1|' },
    grain: 'session',
    unit: 'session',
    population: { scope_n: P11.populationN, sampled: true, returned_n: 38 },
    selection: { grain: 'session', unit: 'session', predicate, counts: { selected: 143, scope: P11.populationN }, sampled: 38 }
  });
  assert.equal(model.text, '143 sessions of 1,880 in scope; 38 sampled marks visible');
  assert.deepEqual(model.predicate, predicate);
  assert.equal(model.selected, 143);

  const keyed = selectionTrayModel({ state: { win: '30d', pick: 's1,s2|' }, grain: 'session', unit: 'session', population: { scope_n: 1880 } });
  assert.equal(keyed.text, '2 sessions of 1,880 in scope');
  assert.deepEqual(keyed.predicate, { in: { lens: 'id', values: ['s1', 's2'] } });
});

test('the exact population count is one bounded aggregate request over the frozen window', async () => {
  const calls = [];
  const transport = {
    async get(path, params, options) {
      calls.push({ path, params, options });
      return {
        response: { ok: true, status: 200 },
        body: {
          grain: 'session',
          mode: 'aggregate',
          stat: 'count',
          population: {
            grain: 'session', unit: 'session', scope_n: 143, cohort_n: 143, eligible_n: 143, returned_n: 1,
            missing_by_reason: {}, relation: { associations: [{ side: 'target', contributor: 'rejection', unit: 'rejection', total_n: 2, associated_n: 1 }] }
          }
        }
      };
    }
  };
  const predicate = regionPredicate(region, 'cost_usd', 'commits');
  const result = await countSelection({
    transport,
    grain: 'session',
    scope: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z', tz: 'UTC' },
    predicate,
    tenant: 'fixture-tenant'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'entities');
  assert.equal(calls[0].params.get('grain'), 'session');
  assert.equal(calls[0].params.get('mode'), 'aggregate');
  assert.equal(calls[0].params.get('stat'), 'count');
  assert.equal(calls[0].params.get('predicate'), canonicalJson(predicate));
  assert.equal(Date.parse(calls[0].params.get('from')), Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(Date.parse(calls[0].params.get('to')), Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(calls[0].options.tenant, 'fixture-tenant');
  assert.equal(result.count, 143);
  assert.equal(result.associations.length, 1);
});

test('the sample sentence and the typed population name their unit', () => {
  const body = p11Scatter({ fields: ['cost_usd', 'commits'] });
  const caveat = scatterCaveat({ grain: 'session' }, body);
  assert.match(caveat.sample, /sample of 38 of 1,880; marginals are the whole population/);
  assert.match(caveat.association, /association, not cause/);
  assert.match(caveat.text, /marginals are the whole population/);
  const population = scatterPopulationText(body);
  assert.match(population, /1,700 eligible session/);
  assert.match(population, /38 sampled marks of 1,880/);
  const whole = scatterCaveat({}, { population: { unit: 'session', scope_n: 10 }, rows: [{}] });
  assert.match(whole.sample, /every eligible session in scope is drawn/);
});

test('the time scatter offers published time measures and one shared bucket request', () => {
  const axes = scatterAxes(SCATTER_DAY_PANEL, schema);
  for (const name of ['cost_usd', 'commits', 'rejections', 'conversations']) assert.ok(axes.axes.includes(name), name);
  assert.equal(axes.axes.includes('id'), false);

  const params = timeScatterParams({ scope: { win: '7d', tz: 'UTC' }, spec: { grain: 'time' }, fields: ['cost_usd', 'commits'] });
  assert.equal(params.get('grain'), 'time');
  assert.equal(params.get('mode'), 'aggregate');
  assert.equal(params.get('fields'), 'cost_usd,commits');
  assert.equal(params.get('bucket'), 'auto');
  assert.equal(params.get('measure'), null);
  assert.equal(params.get('dim'), null);

  const narrowed = timeScatterParams({
    scope: { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', bucket: 'week' },
    spec: { grain: 'time' }, fields: ['cost_usd', 'commits']
  });
  assert.equal(narrowed.get('bucket'), 'week');
  assert.equal(narrowed.get('from'), '2026-09-01T00:00:00.000Z');
  assert.equal(narrowed.get('to'), '2026-09-05T00:00:00.000Z');
});

test('the time source freezes the response bucket, step and window', () => {
  const body = p11TimeScatter({ fields: ['cost_usd', 'commits'] });
  const info = timeBucketInfo(body);
  assert.equal(info.bucket, 'day');
  assert.equal(info.bucket_step, 1);
  assert.equal(info.coarsened, false);
  assert.deepEqual(info.window, { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', tz: 'UTC' });
  assert.deepEqual(timeCohortSource(body, ['cost_usd', 'commits']), {
    fields: ['cost_usd', 'commits'], bucket: 'day', bucket_step: 1
  });
  assert.equal(timeCohortSource({ ...body, bucket: '' }, ['cost_usd']), null);

  const first = timePoint(p11TimeRows()[0], { grain: 'time', scope: { x: 'cost_usd', y: 'commits' } }, body);
  assert.equal(first.x, 1);
  assert.equal(first.y, 2);
  assert.equal(first.partial, true);
  const middle = timePoint(p11TimeRows()[1], { grain: 'time', scope: { x: 'cost_usd', y: 'commits' } }, body);
  assert.equal(middle.partial, false);
});

test('a bucket interval is half-open and intersected with the inclusive window', () => {
  const sep1 = bucketInterval({ t: Date.parse('2026-09-01T00:00:00Z') / 1000 }, { bucket: 'day', step: 1 });
  const sep2 = bucketInterval({ t: Date.parse('2026-09-02T00:00:00Z') / 1000 }, { bucket: 'day', step: 1 });
  const sep5 = bucketInterval({ t: Date.parse('2026-09-05T00:00:00Z') / 1000 }, { bucket: 'day', step: 1 });
  const sep6 = bucketInterval({ t: Date.parse('2026-09-06T00:00:00Z') / 1000 }, { bucket: 'day', step: 1 });
  assert.equal(sep2.end - sep2.start, 86400);
  const window = { from: '2026-09-02T00:00:00Z', to: '2026-09-05T00:00:00Z' };
  assert.equal(bucketIntersectsWindow(sep1, window), false, 'a bucket ending exactly at from is outside');
  assert.equal(bucketIntersectsWindow(sep2, window), true);
  assert.equal(bucketIntersectsWindow(sep5, window), true, 'a bucket starting exactly at the inclusive to is inside');
  assert.equal(bucketIntersectsWindow(sep6, window), false, 'the next bucket starts after the inclusive to');
});

test('a time selection carries a frozen source into the canonical cohort', () => {
  const now = Date.parse('2026-09-05T00:00:00Z');
  const predicate = regionPredicate(region, 'cost_usd', 'commits');
  const source = timeCohortSource(p11TimeScatter({ fields: ['cost_usd', 'commits'] }), ['cost_usd', 'commits']);
  const cohort = buildCohort({
    state: {
      from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', tz: 'UTC',
      filters: { harness: ['orca'] }
    },
    grain: 'time', schema, predicate, source, now
  });
  assert.deepEqual(cohort.source, source);
  assert.equal(cohort.scope.from, '2026-09-01T00:00:00Z');
  assert.equal(cohort.scope.to, '2026-09-05T00:00:00Z');
  assert.equal(cohort.scope.tz, 'UTC');
  assert.deepEqual(decodeCohort(JSON.stringify(cohort)).source, source);

  const plain = buildCohort({ state: { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', tz: 'UTC' }, grain: 'time', schema, predicate, now });
  assert.equal('source' in plain, false);
});

test('association totals reconcile separately from contributing sessions and bucket units', () => {
  const body = p11TimeAggregate({});
  const relation = body.population.relation;
  assert.equal(body.population.unit, 'bucket');
  assert.equal(relation.target_sessions.unit, 'session');
  assert.equal(relation.resolved_unit, 'session');
  const totals = associationTotals(relation.associations);
  assert.deepEqual(totals, { total_n: 20, associated_n: 13, no_conversation_id: 3, orphan_conversation_id: 4 });
  for (const item of relation.associations) {
    assert.equal(item.total_n, item.associated_n + item.missing_by_reason.no_conversation_id + item.missing_by_reason.orphan_conversation_id);
  }

  const withSource = associationLines(relation.associations, { sourceFields: ['cost_usd', 'commits', 'rejections'] });
  assert.equal(withSource.length, 2);
  assert.match(withSource.find(line => line.startsWith('source')), /5 associated, 2 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  assert.match(withSource.find(line => line.startsWith('target')), /8 associated, 1 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  const muted = associationLines(relation.associations, { sourceFields: ['cost_usd', 'commits'] });
  assert.equal(muted.length, 1);
  assert.match(muted[0], /^target/);

  const empty = p11TimeAggregate({ predicate: JSON.stringify({ and: [{ range: { measure: 'cost_usd', lo: 9, hi: 10 } }] }) });
  assert.equal(empty.population.relation.target_sessions.cohort_n, 0);
  const emptyTotals = associationTotals(empty.population.relation.associations);
  assert.equal(emptyTotals.associated_n, 0);
  assert.ok(emptyTotals.no_conversation_id > 0 && emptyTotals.orphan_conversation_id > 0);

  const source = timeCohortSource(p11TimeScatter(), ['cost_usd', 'commits', 'rejections']);
  const model = selectionTrayModel({
    state: { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', tz: 'UTC' },
    grain: 'time', unit: 'session',
    selection: {
      grain: 'time', unit: 'session', predicate: regionPredicate(region, 'cost_usd', 'commits'),
      counts: { selected: 7, scope: P11.populationN }, sampled: 0,
      associations: relation.associations, source, relation
    }
  });
  assert.equal(model.unit, 'session');
  assert.equal(model.selected, 7);
  assert.match(model.text, /^7 contributing sessions of 1,880 in scope/);
  assert.equal(model.associationTotals.total_n, 20);
  assert.equal(model.associationLines.length, 2);
  assert.match(model.relationText, /contributing sessions/);
  assert.notEqual(model.text, body.population.cohort_n);
});

test('the four scatter panels register and deliver the scatter preset', () => {
  registerScatterPanels();
  for (const id of ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']) assert.ok(hasPanel(id), id);
  assert.equal(lookupPanel('scatter-session'), panel);
  const preset = lookupPreset('scatter');
  assert.ok(preset);
  assert.deepEqual(preset.panels, ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']);
  assert.equal(presetDestination('scatter').kind, 'board');
});

const environment = loadBrowserEnvironment();

async function settleScatterBoard(page) {
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length === 4 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function openScatter(page, origin, suffix = '') {
  await page.goto(`${origin}/b/scatter?from=2026-09-01T00%3A00%3A00Z&to=2026-09-05T00%3A00%3A00Z&tz=UTC${suffix}`);
  await settleScatterBoard(page);
}

const DAY_SPEC = {
  grain: 'time', measures: ['cost_usd', 'commits', 'rejections'], chart: 'scatter',
  scope: { x: 'cost_usd', y: 'commits', size: 'rejections' }
};

function dayQuery(spec = DAY_SPEC) {
  return `&p4=${encodeURIComponent(JSON.stringify(spec))}`;
}

async function selectRegion(page, panelId, region, { additive = false, exclude = false } = {}) {
  await page.evaluate(({ panelId: id, region: box, additive: add, exclude: drop }) => {
    const chart = document.querySelector(`[data-panel="${id}"] yk-chart`);
    chart.dispatchEvent(new CustomEvent('select', {
      bubbles: true, composed: true,
      detail: { source: 'scatter-rectangle', region: box, additive: add, exclude: drop }
    }));
  }, { panelId, region, additive, exclude });
  await page.waitForFunction(() => document.querySelector('.selection-tray')?.dataset.open === 'true');
}

async function trayText(page, selector = '.selection-tray-summary') {
  return page.evaluate(name => document.querySelector(name)?.textContent || '', selector);
}

async function waitTray(page, pattern) {
  await page.waitForFunction(rx => new RegExp(rx).test(document.querySelector('.selection-tray')?.textContent || ''), pattern);
}

test('the delivered Scatter board proves the four panels, rectangles, time cohorts and associations', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  // p10 supplies the content baseline catalogue the artifact P5 scorer reads.
  harness.api.set({ p11: true, p10: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 2800 } });
  const diagnostics = await watchPage(page);

  await openScatter(page, harness.origin);
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
  assert.ok(options['scatter-session']['X axis'].includes('cost_usd'));
  assert.ok(options['scatter-session'].Colour.includes('session_model'));
  assert.ok(options['scatter-session'].Size.includes('unpriced_calls'));
  assert.ok(options['scatter-artifact']['X axis'].includes('writing_session_cost_usd'));
  assert.ok(options['scatter-artifact'].Colour.includes('session_model'));
  assert.ok(options['scatter-plan'].Colour.includes('repo_id'));
  assert.ok(options['scatter-day']['X axis'].includes('cost_usd'));
  assert.ok(options['scatter-day']['Y axis'].includes('commits'));
  assert.deepEqual(options['scatter-day'].Colour, ['']);

  const sessionText = await page.locator('[data-panel="scatter-session"]').innerText();
  assert.match(sessionText, /sample of 38 of 1,880/);
  const marginalMarks = await page.evaluate(() => [...document.querySelectorAll('[data-panel="scatter-session"] .scatter-marginals > table tbody tr')]
    .filter(row => row.firstElementChild?.textContent === 'Priced spend')
    .map(row => Number(row.children[3].textContent.replace(/,/g, ''))));
  assert.equal(marginalMarks.reduce((sum, value) => sum + value, 0), 1_880, 'the price marginal is the whole scope population');

  const tableRows = await page.evaluate(() => Object.fromEntries(
    ['scatter-artifact', 'scatter-plan', 'scatter-day'].map(id => [
      id,
      [...document.querySelectorAll(`[data-panel="${id}"] .p10-views table tbody tr`)].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))
    ])
  ));
  assert.equal(tableRows['scatter-artifact'].length, 6);
  assert.equal(tableRows['scatter-plan'].length, 2);
  const dayRows = tableRows['scatter-day'];
  assert.equal(dayRows.length, 5);
  assert.equal(dayRows[0][0], '2026-09-01T00:00:00.000Z · incomplete');
  assert.equal(dayRows[0][1], '$1.00');
  assert.equal(dayRows[0][2], '2');
  assert.equal(dayRows[3][1], '—');
  assert.match(dayRows[3][0], / · incomplete$/, 'a price-missing bucket is marked, not zero-filled');
  assert.match(dayRows[4][0], / · incomplete$/, 'a price-missing bucket stays marked, never zero-filled');
  assert.match(await page.locator('[data-panel="scatter-day"]').innerText(), /day grid/);
  assert.match(await page.locator('[data-panel="scatter-day"]').innerText(), /buckets without prices remain marked as incomplete/i);

  await selectRegion(page, 'scatter-session', { x: { min: 0.5, max: 3 }, y: { min: 1, max: 5 } });
  await page.waitForFunction(() => /143 sessions/.test(document.querySelector('.selection-tray-summary')?.textContent || ''));
  assert.equal(await trayText(page), '143 sessions of 1,880 in scope; 38 sampled marks visible');
  await selectRegion(page, 'scatter-session', { x: { min: 3, max: 4 }, y: { min: 0, max: 2 } }, { additive: true });
  await waitTray(page, '"or"');
  await selectRegion(page, 'scatter-session', { x: { min: 0.5, max: 1 }, y: { min: 1, max: 2 } }, { exclude: true });
  await waitTray(page, '"not"');

  const ranges = {
    'scatter-artifact': { x: { min: 0.5, max: 2 }, y: { min: 0.5, max: 0.8 } },
    'scatter-plan': { x: { min: 1, max: 6 }, y: { min: 1, max: 5 } },
    'scatter-day': { x: { min: 1, max: 3 }, y: { min: 0, max: 2 } }
  };
  const measures = { 'scatter-artifact': ['writing_session_cost_usd', 'score:clarity'], 'scatter-plan': ['associated_cost_usd', 'artifacts'], 'scatter-day': ['cost_usd', 'commits'] };
  for (const [id, region] of Object.entries(ranges)) {
    await selectRegion(page, id, region);
    await page.waitForFunction(measure => (document.querySelector('.selection-tray-predicate')?.textContent || '').includes(measure), measures[id][0]);
    const predicate = await trayText(page, '.selection-tray-predicate');
    for (const name of measures[id]) assert.ok(predicate.includes(JSON.stringify(name)), `${id} predicate names ${name}`);
  }

  await openScatter(page, harness.origin, dayQuery());
  await selectRegion(page, 'scatter-day', { x: { min: 1, max: 3 }, y: { min: 0, max: 2 } });
  await page.waitForFunction(() => /7 contributing sessions/.test(document.querySelector('.selection-tray-summary')?.textContent || ''));
  assert.match(await trayText(page), /^7 contributing sessions of 1,880 in scope/);
  const associationText = (await page.locator('.selection-tray-association').allInnerTexts()).join('\n');
  assert.match(associationText, /source rejection associations: 5 associated, 2 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  assert.match(associationText, /target rejection associations: 8 associated, 1 missing \(no_conversation_id\), 2 orphan \(orphan_conversation_id\)/);
  assert.match(associationText, /contributing sessions/);
  assert.match(associationText, /target applies its own window and expands/);
  assert.doesNotMatch(await trayText(page), /bucket/);

  await page.locator('.selection-tray button', { hasText: 'Make cohort A' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('ca') !== null);
  await settleScatterBoard(page);
  const firstCohort = decodeCohort(new URLSearchParams(await page.evaluate(() => location.search)).get('ca'));
  assert.equal(firstCohort.grain, 'time');
  assert.equal(firstCohort.op, 'include');
  assert.deepEqual(firstCohort.source, { fields: ['cost_usd', 'commits', 'rejections'], bucket: 'day', bucket_step: 1 });
  assert.equal(firstCohort.scope.from, '2026-09-01T00:00:00Z');
  assert.equal(firstCohort.scope.to, '2026-09-05T00:00:00Z');
  const peers = harness.api.state.requests
    .filter(item => /\/entities$/.test(item.path) && /[?&]cohort=/.test(item.search))
    .map(item => new URLSearchParams(item.search).getAll('cohort'));
  assert.ok(peers.length > 0);
  for (const values of peers) assert.equal(values.length, 1, 'one cohort is sent per peer request');

  await selectRegion(page, 'scatter-day', { x: { min: 1, max: 3 }, y: { min: 0, max: 2 } });
  await waitTray(page, 'contributing sessions');
  await page.locator('.selection-tray button', { hasText: 'Filter all panels to this' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('cb') !== null);
  const filtered = decodeCohort(new URLSearchParams(await page.evaluate(() => location.search)).get('cb'));
  assert.equal(filtered.op, 'include');
  assert.equal(canonicalJson(filtered.predicate), canonicalJson(firstCohort.predicate));

  await settleScatterBoard(page);
  await selectRegion(page, 'scatter-day', { x: { min: 1, max: 3 }, y: { min: 0, max: 2 } });
  await waitTray(page, 'contributing sessions');
  await page.locator('.selection-tray button', { hasText: 'Exclude this' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('cc') !== null);
  const excluded = decodeCohort(new URLSearchParams(await page.evaluate(() => location.search)).get('cc'));
  assert.equal(excluded.op, 'exclude');
  assert.equal(canonicalJson(excluded.predicate), canonicalJson(firstCohort.predicate));
  assert.equal(new URLSearchParams(await page.evaluate(() => location.search)).get('cmp'), 'cohorts');

  await openScatter(page, harness.origin, dayQuery());
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
  await openScatter(page, harness.origin, dayQuery());
  assert.equal(await page.locator('[data-panel="scatter-day"]').getAttribute('data-state'), 'unsupported');
  assert.match(await page.locator('[data-panel="scatter-day"]').innerText(), /unsupported_join: rejections is not defined for this time pairing/);
  await page.unroute('**/v1/analytics/entities*');

  assert.ok(harness.stats.maxInFlight <= 4, `max in flight ${harness.stats.maxInFlight}`);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /status of 400/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
});
