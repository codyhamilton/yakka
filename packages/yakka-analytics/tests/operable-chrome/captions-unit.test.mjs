// Plan 30 phase 2 shared caption unit check: every chart family has one
// literal template that expands with real measure, group, bucket and unit
// labels, and an absent caption is an explicit refusal rather than generic
// basis text. This is a direct-module node test; it does not draw a chart.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPTION_TEMPLATES, LABELS, captionFor, clearCaptions, registerCaption
} from '../../web/js/panels/captions.js';

const SNAKE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;

test('the controlled label dictionary carries the exact measure and entity words', () => {
  assert.equal(LABELS.measures.model_calls, 'model calls');
  assert.equal(LABELS.measures.hook_events, 'hook events');
  assert.equal(LABELS.measures.conversations, 'sessions');
  assert.equal(LABELS.measures.artifact_versions, 'artifact versions');
  assert.equal(LABELS.measures.commits, 'commits');
  assert.equal(LABELS.measures.rejections, 'rejections');
  assert.equal(LABELS.measures.cost_usd, 'priced spend');
  assert.equal(LABELS.measures.usd, 'USD');
  assert.equal(LABELS.measures.tokens_in, 'input tokens');
  assert.equal(LABELS.measures.tokens_out, 'output tokens');
  assert.equal(LABELS.measures.tokens_cache_read, 'cached input tokens');
  assert.equal(LABELS.measures.tokens_cache_write, 'cache-write tokens');
  assert.equal(LABELS.measures.tokens_reasoning, 'reasoning tokens');
  assert.equal(LABELS.entities.model, 'model');
  assert.equal(LABELS.entities.harness, 'coding tool');
  assert.equal(LABELS.entities.session_model, 'session model');
  assert.equal(LABELS.entities.session_repo, 'repository');
  assert.equal(LABELS.entities.repo_id, 'repository');
  assert.equal(LABELS.entities.kind, 'document kind');
  assert.equal(LABELS.entities.plan, 'plan');
  assert.equal(LABELS.entities.tool, 'tool');
  assert.equal(LABELS.entities.tool_kind, 'tool category');
});

test('every chart-family template expands to one readable sentence with no snake_case', () => {
  const cases = [
    ['columns', { measure: 'cost_usd', bucket: 'day', group: 'model', unit: 'USD' }],
    ['lines/area', { measure: 'model_calls', group: 'harness', unit: 'calls' }],
    ['small multiples', { measure: 'model_calls', group: 'session_model', unit: 'calls' }],
    ['rank/bars', { measure: 'hook_events', group: 'tool', unit: 'events' }],
    ['stacked/share', { measure: 'hook_events', group: 'tool_kind', series: 'harness', unit: 'events' }],
    ['treemap', { measure: 'cost_usd', child: 'model', parent: 'harness', unit: 'USD' }],
    ['ranges', { measure: 'cost_usd', group: 'session_repo' }],
    ['slope', { measure: 'cost_usd', group: 'model', unit: 'USD' }],
    ['histogram', { population: 'model_calls', measure: 'cost_usd' }],
    ['cumulative distribution', { population: 'conversations', measure: 'cost_usd' }],
    ['scatter', { entity: 'session', x: 'priced spend', y: 'commit count', size: 'unpriced calls' }],
    ['scatter', { entity: 'file', x: 'priced spend', y: 'clarity score' }],
    ['calendar', { measure: 'cost_usd', unit: 'USD' }],
    ['rhythm', {}],
    ['score ranges/trend', { mode: 'ranges', kind: 'design', check: 'clarity', group: 'harness' }],
    ['score ranges/trend', { mode: 'trend', kind: 'design', check: 'clarity', group: 'session_model' }],
    ['strip', { check: 'clarity', group: 'kind' }],
    ['band mix', { check: 'clarity' }]
  ];
  for (const [family, vars] of cases) {
    const template = CAPTION_TEMPLATES[family];
    assert.equal(typeof template, 'function', `${family} has a template`);
    const text = template(vars);
    assert.equal(typeof text, 'string');
    assert.ok(text.trim().length > 0, `${family} is not empty`);
    assert.doesNotMatch(text, SNAKE, `${family} emitted a raw identifier: ${text}`);
    assert.match(text, /[.!]$/, `${family} is one sentence`);
  }
});

test('templates name repository and document kind through the dictionary', () => {
  assert.match(
    CAPTION_TEMPLATES.columns({ measure: 'artifact_versions', bucket: 'day', group: 'repo_id', unit: 'versions' }),
    /grouped by repository/
  );
  assert.match(
    CAPTION_TEMPLATES.columns({ measure: 'artifact_versions', bucket: 'day', group: 'kind', unit: 'versions' }),
    /grouped by document kind/
  );
  assert.match(
    CAPTION_TEMPLATES['rank/bars']({ measure: 'cost_usd', group: 'session_repo', unit: 'USD' }),
    /for one repository/
  );
});

test('an absent or malformed caption is an explicit refusal, never generic basis text', () => {
  clearCaptions();
  assert.equal(
    captionFor({ id: 'ghost' }, {}, {}),
    'No plain-language caption is registered for ghost.'
  );
  assert.equal(
    captionFor({ id: 'bad', caption: 'Each bar shows session_repo here.' }, {}, {}),
    'No plain-language caption is registered for bad.'
  );
  registerCaption('synthetic', () => 'Each bar shows priced spend for one model.');
  assert.equal(
    captionFor({ id: 'synthetic' }, {}, {}),
    'Each bar shows priced spend for one model.'
  );
  registerCaption('synthetic', ({ schema }) => `Each bar shows ${schema?.label || 'nothing'}.`);
  assert.equal(captionFor({ id: 'synthetic' }, {}, { schema: { label: 'priced spend' } }), 'Each bar shows priced spend.');
  clearCaptions();
});

test('a registered caption can be supplied by the panel entry itself', () => {
  clearCaptions();
  assert.equal(
    captionFor({ id: 'entry', caption: 'Each dot is a session.' }, {}, {}),
    'Each dot is a session.'
  );
});
