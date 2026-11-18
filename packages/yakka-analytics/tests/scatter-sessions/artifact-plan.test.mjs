// Phase 11 unit 11-02: the artifact and plan scatter seam. Pure checks only;
// the browser proof of the four-panel board belongs to 11-03, when `/b/scatter`
// becomes a delivered preset.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  artifactAxes, artifactColours, artifactDestination, artifactIdentity, artifactMissing,
  artifactPoint, SCATTER_ARTIFACT_PANEL
} from '../../web/js/panels/scatter-artifact.js';
import {
  planAxes, planColours, planIdentity, planOverlap, planPoint, SCATTER_PLAN_PANEL
} from '../../web/js/panels/scatter-plan.js';
import { scatterParams } from '../../web/js/panels/scatter-shared.js';
import { registerScatterPanels } from '../../web/js/panels/p11-scatter.js';
import { hasPanel, lookupPanel } from '../../web/js/panels/registry.js';
import { lookupPreset, presetDestination } from '../../web/js/boards/presets.js';
import { P11, p11Schema } from './fixture.mjs';
import { p11ArtifactRows, p11PlanRows } from '../workspace/fixture.mjs';

const schema = p11Schema();
const CATALOGUE = { kind: 'design', checks: [{ name: 'clarity' }, { name: 'structure' }] };

test('artifact axes are published numeric measures with catalogue-validated checks', () => {
  const model = artifactAxes(schema, CATALOGUE);
  for (const name of [
    'writing_session_cost_usd', 'writing_session_model_calls', 'writing_session_tokens_in',
    'score:clarity', 'score:structure', 'versions', 'content_bytes', 'distinct_writing_sessions'
  ]) assert.ok(model.axes.includes(name), name);
  assert.equal(model.axes.includes('model'), false);
  assert.equal(model.axes.includes('id'), false);
  assert.deepEqual(model.checks, ['clarity', 'structure']);

  const partial = artifactAxes(schema, { kind: 'design', checks: [{ name: 'clarity' }] });
  assert.ok(partial.axes.includes('score:clarity'));
  assert.equal(partial.axes.includes('score:structure'), false);
  const unsupported = partial.unsupported.find(item => item.name === 'score:structure');
  assert.ok(unsupported);
  assert.match(unsupported.reason, /score catalogue/);
  assert.match(unsupported.try, /clarity/);

  const widened = p11Schema();
  widened.grains.artifact.measures.push('model', 'id');
  const guarded = artifactAxes(widened, CATALOGUE);
  assert.equal(guarded.axes.includes('model'), false);
  assert.equal(guarded.axes.includes('id'), false);
});

test('artifact colours are published categorical lenses, never model or id', () => {
  const { colours, unsupported } = artifactColours(schema);
  for (const name of [
    'kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'screen_verdict',
    'scorer', 'band:clarity', 'band:structure'
  ]) assert.ok(colours.includes(name), name);
  assert.equal(colours.includes('model'), false);
  assert.equal(colours.includes('id'), false);

  const widened = p11Schema();
  widened.grains.artifact.lenses.push('model');
  const guarded = artifactColours(widened);
  assert.equal(guarded.colours.includes('model'), false);
  assert.ok(guarded.unsupported.some(item => item.name === 'model'));
});

test('an artifact point carries the identity and never zero-fills a null axis', () => {
  const rows = p11ArtifactRows();
  const spec = {
    grain: 'artifact', split: 'session_model',
    scope: { x: 'writing_session_cost_usd', y: 'score:clarity', colour: 'session_model' }
  };
  const scored = artifactPoint(rows[0], spec);
  assert.equal(scored.drawn, true);
  assert.equal(scored.x, rows[0].m.writing_session_cost_usd);
  assert.equal(scored.y, 0.82);
  assert.equal(scored.group, 'claude');
  assert.deepEqual(scored.identity, {
    repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/DESIGN.md', hash: 'hash-a'
  });
  assert.equal(artifactIdentity(rows[0]).hash, 'hash-a');
  const destination = artifactDestination(scored.identity);
  assert.match(destination, /^\/artifact\?/);
  assert.match(destination, /repo_id=repo-a/);
  assert.match(destination, /hash=hash-a/);

  const unscored = artifactPoint(rows.find(row => row.flags?.unscored), spec);
  assert.equal(unscored.drawn, false);
  assert.equal(unscored.y, null);
  assert.notEqual(unscored.y, 0);

  const unpriced = artifactPoint(rows.find(row => row.flags?.unpriced), spec);
  assert.equal(unpriced.x, null);
  assert.equal(unpriced.drawn, false);
  assert.notEqual(unpriced.x, 0);
});

test('null, unscored, content_unavailable and lower-bound counts are labelled separately', () => {
  const rows = p11ArtifactRows();
  const missing = artifactMissing(rows, { population: { missing_by_reason: { unscored: 1, missing_axis: 1 } } }, 'clarity');
  assert.ok(missing.unscored >= 1);
  assert.ok(missing.contentUnavailable >= 1);
  assert.ok(missing.nullCost >= 1);
  assert.ok(missing.lowerBound >= 1);
  assert.ok(missing.unpriced >= 1);
  assert.match(missing.text, /unscored/);
  assert.match(missing.text, /content_unavailable/);
  assert.match(missing.text, /null writing-session cost/);
  assert.match(missing.text, /lower-bound/);
  assert.match(missing.text, /unpriced/);
  assert.doesNotMatch(missing.text, /\$0/);
});

test('the artifact scatter request names the published grain, mode and fields', () => {
  const params = scatterParams({
    scope: { win: '30d', tz: 'UTC', kind: 'design' },
    spec: { grain: 'artifact' },
    grain: 'artifact',
    fields: ['writing_session_cost_usd', 'score:clarity']
  });
  assert.equal(params.get('grain'), 'artifact');
  assert.equal(params.get('mode'), 'scatter');
  assert.equal(params.get('fields'), 'writing_session_cost_usd,score:clarity');
  assert.equal(params.get('kind'), 'design');
  assert.equal(params.get('dim'), null);
  assert.equal(params.get('measure'), null);
});

test('plan axes are only published plan measures with catalogue-validated design scores', () => {
  const model = planAxes(schema, CATALOGUE);
  for (const name of [
    'associated_cost_usd', 'artifacts', 'versions', 'sessions', 'shared_sessions', 'unpriced_calls',
    'complete_share', 'design_score:clarity', 'span_days', 'first_ts', 'last_ts'
  ]) assert.ok(model.axes.includes(name), name);
  assert.equal(model.axes.includes('id'), false);

  const partial = planAxes(schema, { kind: 'design', checks: [{ name: 'clarity' }] });
  assert.ok(partial.axes.includes('design_score:clarity'));
  assert.equal(partial.axes.includes('design_score:structure'), false);
  assert.ok(partial.unsupported.some(item => item.name === 'design_score:structure'));

  const narrowed = p11Schema();
  narrowed.grains.plan.measures = ['associated_cost_usd', 'artifacts'];
  const offered = planAxes(narrowed, null);
  assert.deepEqual(offered.axes, ['associated_cost_usd', 'artifacts']);
  assert.equal(offered.axes.includes('complete_share'), false);
});

test('plan colours are the published plan lenses, never id', () => {
  const { colours } = planColours(schema);
  assert.deepEqual(colours, ['repo_id', 'harness', 'session_model']);
  assert.equal(colours.includes('id'), false);
});

test('a plan point keeps null complete_share/design_score out of the marks and exposes overlap', () => {
  const rows = p11PlanRows();
  const spec = {
    grain: 'plan', split: 'repo_id',
    scope: { x: 'associated_cost_usd', y: 'artifacts', colour: 'repo_id' }
  };
  const drawn = planPoint(rows[0], spec);
  assert.equal(drawn.drawn, true);
  assert.equal(drawn.x, rows[0].m.associated_cost_usd);
  assert.equal(drawn.y, rows[0].m.artifacts);
  assert.equal(drawn.shared_sessions, 1);
  assert.equal(drawn.unpriced_calls, 2);
  assert.deepEqual(drawn.identity, { repo_id: 'repo-a', plan: '20' });
  assert.equal(planIdentity(rows[0]).plan, '20');

  const unpriced = planPoint(rows[1], spec);
  assert.equal(unpriced.x, null);
  assert.equal(unpriced.drawn, false);
  assert.notEqual(unpriced.x, 0);

  const noExecutions = planPoint(rows[1], { ...spec, scope: { ...spec.scope, y: 'complete_share' } });
  assert.equal(noExecutions.y, null);
  assert.equal(noExecutions.drawn, false);

  const overlap = planOverlap(rows);
  assert.equal(overlap.shared, 2);
  assert.equal(overlap.unpriced, 7);
  assert.match(overlap.text, /non-additive across plans/);
  assert.match(overlap.text, /not plan-exact spend/);
  assert.match(overlap.text, /shared/);
  assert.match(overlap.text, /unpriced/);
});

test('both panels register and the scatter preset names all four panels', () => {
  assert.equal(SCATTER_ARTIFACT_PANEL.grain, 'artifact');
  assert.deepEqual(SCATTER_ARTIFACT_PANEL.requires, ['entities_artifact', 'scores_by_lens']);
  assert.equal(SCATTER_PLAN_PANEL.grain, 'plan');
  assert.deepEqual(SCATTER_PLAN_PANEL.requires, ['entities_plan']);

  registerScatterPanels();
  assert.ok(hasPanel('scatter-artifact'));
  assert.ok(hasPanel('scatter-plan'));
  assert.equal(lookupPanel('scatter-artifact'), SCATTER_ARTIFACT_PANEL);
  assert.equal(lookupPanel('scatter-plan'), SCATTER_PLAN_PANEL);

  const preset = lookupPreset('scatter');
  assert.ok(preset);
  assert.deepEqual(preset.panels, ['scatter-session', 'scatter-artifact', 'scatter-plan', 'scatter-day']);
  assert.equal(presetDestination('scatter').kind, 'board');
  assert.ok(P11.populationN > 0);
});
