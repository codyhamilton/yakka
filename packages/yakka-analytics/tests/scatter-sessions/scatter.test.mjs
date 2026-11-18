// Phase 11 unit 11-01: the pure scatter seam. No browser here; the panel's
// settled-state proof belongs to 11-03, when `/b/scatter` becomes a delivered
// board.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson, canonicalPredicate, decodeCohort
} from '../../web/js/core/selection-model.js';
import {
  buildCohort, selectionTrayModel
} from '../../web/js/core/selection-tray.js';
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
import { makeSchema } from '../workspace/fixture.mjs';

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

test('the session scatter registers without delivering the scatter preset', () => {
  registerScatterPanels();
  assert.ok(hasPanel('scatter-session'));
  assert.equal(lookupPanel('scatter-session'), panel);
  const preset = lookupPreset('scatter');
  assert.ok(preset);
  assert.equal(preset.panels.length, 0);
  assert.equal(presetDestination('scatter').kind, 'named');
  assert.equal(presetDestination('scatter').phase, 11);
});
