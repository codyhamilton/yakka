import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalJson, canonicalPredicate, cohortDefinition, encodeCohort, decodeCohort, validateCohort,
  selectionPredicate, encodePick, decodePick, selectionObject, formatSelection
} from '../../web/js/core/selection-model.js';
import {
  addFilterChip, chipModel, legendFocusFilter, removeFilterChip, removeCohortChip, filterApplies
} from '../../web/js/core/chips.js';
import {
  absoluteScope, buildCohort, nextCohortSlot, selectionTrayModel, writeCohort, openListDestination
} from '../../web/js/core/selection-tray.js';
import { makeSchema } from './fixture.mjs';

test('predicates canonicalise keys, numbers, commutative children and in values', () => {
  const input = {
    or: [
      { in: { values: ['b', 'a', 'b'], lens: 'harness' } },
      { range: { measure: 'cost_usd', hi: null, lo: 1.0 } }
    ]
  };
  const canonical = canonicalPredicate(input);
  assert.deepEqual(canonical, {
    or: [
      { in: { lens: 'harness', values: ['a', 'b'] } },
      { range: { hi: null, lo: 1, measure: 'cost_usd' } }
    ]
  });
  assert.equal(canonicalJson(canonical), canonicalJson(canonicalPredicate(canonical)));
  assert.throws(() => canonicalPredicate({ between: [] }), /exactly one of/);
});

test('cohort JSON is canonical, defaults op to include and round-trips', () => {
  const cohort = cohortDefinition({
    grain: 'session',
    scope: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', tz: 'UTC', include: [{ lens: 'harness', values: ['orca', 'claude'] }, { lens: 'harness', values: ['claude'] }], exclude: [] },
    predicate: { in: { lens: 'id', values: ['b', 'a'] } }
  });
  assert.equal(cohort.op, 'include');
  assert.deepEqual(cohort.scope.include, [{ lens: 'harness', values: ['claude', 'orca'] }]);
  const text = encodeCohort(cohort);
  assert.match(text, /"grain":"session"/);
  assert.deepEqual(decodeCohort(text), cohort);
  assert.equal(encodeCohort(decodeCohort(text)), text);
  assert.equal(decodeCohort('{'), null);
});

test('cohort budgets name leaves, values, depth, scope and bytes without clipping', () => {
  const base = { grain: 'session', scope: { include: [], exclude: [] }, predicate: { is_null: { measure: 'cost_usd' } } };
  const leaves = cohortDefinition({ ...base, predicate: { and: Array.from({ length: 65 }, () => ({ is_null: { measure: 'cost_usd' } })) } });
  assert.equal(validateCohort(leaves).reason, 'leaves');
  const values = cohortDefinition({ ...base, predicate: { in: { lens: 'harness', values: Array.from({ length: 65 }, (_, i) => `h${i}`) } } });
  assert.equal(validateCohort(values).reason, 'values');
  let deep = { is_null: { measure: 'cost_usd' } };
  for (let i = 0; i < 9; i += 1) deep = { not: deep };
  assert.equal(validateCohort(cohortDefinition({ ...base, predicate: deep })).reason, 'depth');
  const scopeElements = cohortDefinition({ ...base, scope: { include: Array.from({ length: 65 }, (_, i) => ({ lens: `lens${i}`, values: [`h${i}`] })), exclude: [] } });
  assert.equal(validateCohort(scopeElements).reason, 'scope_elements');
  const scopeValues = cohortDefinition({ ...base, scope: { include: [{ lens: 'harness', values: Array.from({ length: 65 }, (_, i) => `h${i}`) }], exclude: [] } });
  assert.equal(validateCohort(scopeValues).reason, 'scope_values');
  const valueBytes = cohortDefinition({ ...base, scope: { include: [{ lens: 'harness', values: ['x'.repeat(257)] }], exclude: [] } });
  assert.equal(validateCohort(valueBytes).reason, 'value_bytes');
  const bytes = cohortDefinition({ ...base, scope: { include: Array.from({ length: 40 }, (_, i) => ({ lens: `lens${i}`, values: ['y'.repeat(200)] })), exclude: [] } });
  assert.equal(validateCohort(bytes).reason, 'bytes');
  assert.equal(validateCohort(cohortDefinition(base)).ok, true);
});

test('selection objects and the tray model format counts with units and sample marks', () => {
  const predicate = selectionPredicate({ include: ['s2', 's1'], exclude: [] });
  assert.deepEqual(predicate, { in: { lens: 'id', values: ['s1', 's2'] } });
  assert.equal(encodePick({ include: ['s2', 's1'] }), 's1,s2|');
  assert.deepEqual(decodePick('s1,s2|s9'), { include: ['s1', 's2'], exclude: ['s9'] });
  const selection = selectionObject({ grain: 'session', predicate, unit: 'session', counts: { selected: 2, scope: 1880 }, sampled: 38 });
  assert.equal(selection.counts.scope, 1880);
  assert.equal(formatSelection({ unit: 'session', selected: 2, scope: 1880, sampled: 38 }), '2 sessions of 1,880 in scope; 38 sampled marks visible');
  const model = selectionTrayModel({ state: { win: '30d', pick: 's1,s2|' }, grain: 'session', unit: 'session', population: { scope_n: 1880, sampled: true, returned_n: 38 } });
  assert.equal(model.text, '2 sessions of 1,880 in scope; 38 sampled marks visible');
  assert.equal(model.time, false);
});

test('chip model marks unapplied filters, keeps unknown keys and removes/Adds values', () => {
  const schema = makeSchema();
  const state = { win: 'all', filters: { harness: ['orca'], 'band:design': ['low'] }, exclude: ['model:atlas'], cohorts: { ca: encodeCohort(cohortDefinition({ grain: 'session', scope: { include: [], exclude: [] }, predicate: { is_null: { measure: 'cost_usd' } } })) }, pick: 'a,b|' };
  const chips = chipModel({ state, schema, grain: 'session' });
  assert.ok(chips.some(chip => chip.kind === 'scope'));
  const harness = chips.find(chip => chip.kind === 'filter' && chip.key === 'harness');
  assert.equal(harness.applied, true);
  const band = chips.find(chip => chip.kind === 'filter' && chip.key === 'band:design');
  assert.equal(band.applied, false);
  assert.ok(chips.some(chip => chip.kind === 'cohort' && chip.slot === 'A'));
  assert.equal(chips.find(chip => chip.kind === 'selection').label, 'selection (2 marks)');
  assert.equal(filterApplies('harness', { schema, grain: 'session' }), true);
  assert.equal(filterApplies('band:design', { schema, grain: 'session' }), false);
  const added = addFilterChip(state, 'harness', 'claude');
  assert.deepEqual(added.filters.harness, ['claude', 'orca']);
  const removed = removeFilterChip(added, 'harness', 'orca');
  assert.deepEqual(removed.filters.harness, ['claude']);
  assert.equal(removeCohortChip(state, 'ca').cohorts.ca, '');
  assert.deepEqual(state.filters.harness, ['orca'], 'chip helpers do not mutate the input state');
});

test('legend focus maps a series lens to a contract filter and refuses a measure-only series', () => {
  assert.deepEqual(legendFocusFilter({ key: 'orca' }, { series: [{ key: 'orca', lens: 'harness' }] }), { filter: 'harness', value: 'orca' });
  assert.deepEqual(legendFocusFilter({ key: 'harness:orca' }, { series: [] }), { filter: 'harness', value: 'orca' });
  assert.equal(legendFocusFilter({ key: 'cost_usd' }, { series: [{ key: 'cost_usd' }] }), null);
  assert.equal(legendFocusFilter({ key: 'calls', filter: null, value: null }, { series: [{ key: 'calls' }] }), null);
});

test('a promoted selection freezes absolute bounds and the applied scope elements', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const frozen = absoluteScope({ win: '7d', tz: 'UTC' }, now);
  assert.equal(frozen.to, '2026-10-01T00:00:00.000Z');
  assert.equal(frozen.from, '2026-09-24T00:00:00.000Z');
  assert.equal(absoluteScope({ win: 'all' }, now).from, null);
  const cohort = buildCohort({
    state: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', tz: 'UTC', filters: { harness: ['orca'], 'band:design': ['low'] }, exclude: ['model:atlas'] },
    pick: { include: ['s1'], exclude: [] },
    grain: 'session',
    schema: makeSchema(),
    now
  });
  assert.equal(cohort.scope.from, '2026-01-01T00:00:00Z');
  assert.deepEqual(cohort.scope.include, [{ lens: 'harness', values: ['orca'] }]);
  assert.deepEqual(cohort.scope.exclude, [{ lens: 'model', values: ['atlas'] }]);
  assert.deepEqual(cohort.predicate, { in: { lens: 'id', values: ['s1'] } });
  const excluded = buildCohort({ state: {}, pick: { include: ['s1'] }, grain: 'session', schema: makeSchema(), op: 'exclude', now });
  assert.equal(excluded.op, 'exclude');
  assert.equal(nextCohortSlot({ cohorts: { ca: 'x', cb: 'y', cc: 'z' } }), 'cd');
  assert.equal(nextCohortSlot({ cohorts: { ca: 'a', cb: 'b', cc: 'c', cd: 'd' } }), null);
  const written = writeCohort({ cohorts: {} }, 'ca', cohort);
  assert.equal(decodeCohort(written.cohorts.ca).grain, 'session');
  assert.equal(openListDestination('session'), '/sessions');
  assert.equal(openListDestination('time'), '/ledger');
});
