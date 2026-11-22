// Plan 30 phase 2 Quality unit check: the four Quality panels register the
// literal G captions selected by `scope.captionKey`, use P5 Check/Scorer with the
// catalogue-order/default-scorer rules, keep content versions and artifact files
// distinct, draw the selected scorer's all-history baseline, keep the exact band
// tokens and table order, expose scores as normalized 0–1 (never percentages),
// and refuse a repeated multi-kind scope or an unsupported filter with the exact
// sentence before any score/entity/baseline read.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPanel } from '../../web/js/panels/registry.js';
import { captionFor } from '../../web/js/panels/captions.js';
import { QUALITY_SPECS } from '../../web/js/panels/p10-quality.js';
import {
  BASELINE_LABEL,
  MULTI_KIND_REFUSAL, SCORE_CAPTIONS, SCORE_UNIT, activeKindValues, baselineBand,
  catalogueChecks, checkOptions, defaultCheck, resolveScorer, scoreCaption, scoreKind,
  scoreRangeRows, scoreRangeTableColumns, scoreRangeTableRows, scorerNames,
  load as loadRanges
} from '../../web/js/panels/score-ranges.js';
import {
  scoreTrendModel, scoreTrendTableColumns, scoreTrendTableRows, trendBucket, load as loadTrend
} from '../../web/js/panels/score-trend.js';
import {
  stripRows, stripTableColumns, stripTableRows, load as loadStrips
} from '../../web/js/panels/score-strips.js';
import {
  BAND_KEYS, BAND_LABELS, BAND_TOKENS, bandMixRows, bandMixTableRows, load as loadBands
} from '../../web/js/panels/band-mix.js';
import { p10Schema } from '../trends-quality/fixture.mjs';

const schema = p10Schema();

const CATALOGUE = { kind: 'design', checks: [{ name: 'structure' }, { name: 'clarity' }] };
const BASELINES = {
  kind: 'design', population: 'content',
  scorers: {
    zeta: { clarity: { n: 9, p25: 0.4, median: 0.6, p75: 0.8 } },
    alpha: { clarity: { n: 0, p25: null, median: null, p75: null } },
    beta: { clarity: { n: 5, p25: 0.45, median: 0.65, p75: 0.85 }, structure: { n: 3, p25: 0.3, median: 0.5, p75: 0.7 } }
  }
};

function scoresBody(check = 'clarity') {
  return {
    kind: 'design',
    checks: [{
      name: check, n: 12, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1, scorer: 'beta',
      groups: [
        { k: 'harness:orca', n: 7, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1 },
        { k: 'harness:claude-code', n: 5, min: 0.3, p25: 0.55, median: 0.75, p75: 0.9, max: 0.95 }
      ],
      omitted_groups: 1, omitted_n: 2
    }],
    population: { grain: 'content', unit: 'content_hash', scope_n: 14, eligible_n: 14, returned_n: 12 }
  };
}

const SERIES = {
  kind: 'design', bucket: 'day',
  checks: [{
    name: 'clarity',
    points: [
      { t: '2026-09-01T00:00:00Z', n: 4, p25: 0.4, median: 0.6, p75: 0.8, groups: [
        { k: 'session_model:claude', n: 3, p25: 0.4, median: 0.6, p75: 0.8 },
        { k: 'session_model:gpt', n: 1, p25: 0.3, median: 0.5, p75: 0.7 }
      ] },
      { t: '2026-09-02T00:00:00Z', n: 5, p25: 0.45, median: 0.65, p75: 0.85, groups: [
        { k: 'session_model:claude', n: 4, p25: 0.45, median: 0.65, p75: 0.85 }
      ] }
    ]
  }],
  population: { grain: 'content', unit: 'content_hash', scope_n: 9, eligible_n: 9, returned_n: 9 }
};

const ARTIFACT_ENTITIES = {
  rows: [
    { l: { path: 'docs/a.md', repo_id: 'repo-a', kind: 'design', content_hash: 'h1', scorer: 'beta', observed: '2026-09-02' }, m: { 'score:clarity': 0.82 } },
    { l: { path: 'docs/b.md', repo_id: 'repo-b', kind: 'brief', content_hash: 'h1', scorer: 'beta', observed: '2026-09-01' }, m: { 'score:clarity': 0.6 } },
    { l: { path: 'docs/a.md', repo_id: 'repo-a', kind: 'design', content_hash: 'h1', scorer: 'beta', observed: '2026-09-02' }, m: { 'score:clarity': 0.82 } }
  ],
  population: { grain: 'artifact', unit: 'file', scope_n: 2, eligible_n: 2, returned_n: 2 }
};

const BAND_AGGREGATE = {
  groups: [
    { k: ['high', 'design'], n: 1 },
    { k: ['low', 'design'], n: 2 },
    { k: ['unscored', 'design'], n: 1 },
    { k: ['baseline_unavailable', 'design'], n: 1 },
    { k: ['mid', 'brief'], n: 3 }
  ],
  population: { grain: 'artifact', unit: 'file', scope_n: 8, eligible_n: 8, returned_n: 8 }
};

function fakeDoc() {
  const node = () => ({
    nodeType: 1,
    style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {} },
    append() {}, prepend() {}, replaceChildren() {}, remove() {},
    setAttribute() {}, removeAttribute() {},
    addEventListener() {}, dispatchEvent() {}
  });
  return {
    documentElement: { dataset: {} },
    head: { append() {} },
    defaultView: null,
    querySelector() { return null; },
    createElement() { return node(); },
    createTextNode() { return { nodeType: 3 }; }
  };
}

function qualityTransport() {
  const calls = [];
  return {
    calls,
    async schema() { calls.push({ name: 'schema' }); return { response: { ok: true, status: 200 }, body: schema }; },
    async request(name, { params } = {}) { calls.push({ name, params }); return { response: { ok: true, status: 200 }, body: BASELINES }; },
    async get(name, params) {
      calls.push({ name, params });
      if (name === 'scores') {
        const check = params.get('check');
        return { response: { ok: true, status: 200 }, body: check ? scoresBody(check) : CATALOGUE };
      }
      if (name === 'score-series') return { response: { ok: true, status: 200 }, body: SERIES };
      if (name === 'entities') {
        const mode = params.get('mode');
        return { response: { ok: true, status: 200 }, body: mode === 'aggregate' ? BAND_AGGREGATE : ARTIFACT_ENTITIES };
      }
      return { response: { ok: true, status: 200 }, body: {} };
    }
  };
}

const LOADERS = [
  ['score-ranges', loadRanges],
  ['score-trend', loadTrend],
  ['score-strips', loadStrips],
  ['band-mix', loadBands]
];

test('the four Quality captions are the literal G sentences selected by captionKey', () => {
  const cases = [
    ['score-ranges', 'G-scores', 'Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.', true],
    ['score-trend', 'G-scoretrend', 'Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.', true],
    ['score-strips', 'G-strips', 'Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.', false],
    ['band-mix', 'G-bands', 'Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.', false]
  ];
  for (const [id, key, literal, kindSubstitutes] of cases) {
    const panel = lookupPanel(id);
    assert.ok(panel, `${id} is registered`);
    const spec = QUALITY_SPECS[id];
    assert.equal(spec.scope.captionKey, key, `${id} names ${key}`);
    assert.equal(SCORE_CAPTIONS[key], literal, `${id} literal`);
    assert.equal(captionFor(panel, spec, { scope: { win: '30d' }, schema }), literal, `${id} default caption`);
    const alternateCheck = spec.scope.check === 'structure' ? { ...spec, scope: { ...spec.scope, check: 'clarity' } } : { ...spec, scope: { ...spec.scope, check: 'structure' } };
    const alternate = captionFor(panel, alternateCheck, { scope: { win: '30d' }, schema });
    assert.match(alternate, /structure|clarity/, `${id} names the alternate check`);
    const expected = kindSubstitutes
      ? literal.replace('design', 'brief').replace('clarity', 'structure')
      : literal.replace('clarity', 'structure');
    assert.equal(captionFor(panel, alternateCheck, { scope: { win: '30d', kind: 'brief' }, schema }), expected, `${id} alternate kind/check`);
  }
  assert.equal(scoreCaption('G-scores', { kind: 'report', check: 'reading_ease' }),
    'Each row shows report reading ease scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.');
});

test('P5 keeps catalogue order, defaults to clarity, and picks the first lexical scorer with a positive baseline', () => {
  assert.deepEqual(catalogueChecks(CATALOGUE), ['structure', 'clarity']);
  assert.equal(defaultCheck(['structure', 'clarity']), 'clarity');
  assert.equal(defaultCheck(['structure']), 'structure');
  assert.deepEqual(checkOptions(['structure', 'clarity']), [
    { value: 'structure', label: 'Structure' },
    { value: 'clarity', label: 'Clarity' }
  ]);
  assert.deepEqual(scorerNames(BASELINES), ['alpha', 'beta', 'zeta']);
  assert.equal(resolveScorer(BASELINES, 'clarity', '').scorer, 'beta');
  assert.equal(resolveScorer(BASELINES, 'clarity', 'zeta').scorer, 'zeta');
  assert.equal(resolveScorer(BASELINES, 'structure', '').scorer, 'beta');
  assert.equal(resolveScorer({ scorers: { zeta: { clarity: { n: 5 } }, alpha: { clarity: { n: 0 } } } }, 'clarity', '').scorer, 'zeta');
  assert.equal(resolveScorer({ scorers: { zeta: { clarity: { n: 0 } }, alpha: { clarity: { n: 0 } } } }, 'clarity', '').scorer, 'alpha');
  assert.equal(BASELINE_LABEL, 'All-history baseline for this scorer in this tenant');
});

test('a repeated multi-kind scope is refused verbatim with zero reads', async () => {
  for (const [id, loader] of LOADERS) {
    const server = qualityTransport();
    const result = await loader({
      scope: { win: '30d', kind: ['design', 'brief'] }, spec: QUALITY_SPECS[id],
      schema, transport: server, tenant: 'tenant-b', doc: fakeDoc()
    });
    assert.equal(result.state, 'unsupported', `${id} refuses multi-kind`);
    assert.equal(result.message, MULTI_KIND_REFUSAL, `${id} exact sentence`);
    assert.equal(server.calls.length, 0, `${id} fetched nothing`);
  }
  assert.deepEqual(activeKindValues({ kind: ['design', 'design', 'brief'] }), ['design', 'brief']);
  assert.equal(scoreKind({}, { scope: { kind: 'brief' } }).kind, 'brief');
});

test('an unsupported filter is the exact F refusal with zero reads and the caption unchanged', async () => {
  for (const [id, loader] of LOADERS) {
    const server = qualityTransport();
    const panel = lookupPanel(id);
    const scope = { win: '30d', model: ['gpt'] };
    const result = await loader({
      scope, spec: QUALITY_SPECS[id], schema, transport: server, tenant: 'tenant-b', doc: fakeDoc()
    });
    assert.equal(result.state, 'unsupported', `${id} refuses model`);
    assert.equal(result.applicability, true, `${id} is an applicability refusal`);
    assert.equal(result.message, 'This chart cannot apply model. Change the filters to view it.', `${id} exact F sentence`);
    assert.equal(server.calls.length, 0, `${id} fetched nothing`);
    assert.equal(captionFor(panel, QUALITY_SPECS[id], { scope, schema }), SCORE_CAPTIONS[QUALITY_SPECS[id].scope.captionKey], `${id} caption unchanged`);
  }
});

test('content versions and latest files stay distinct populations', () => {
  const ranges = scoreRangeRows(scoresBody(), 'clarity');
  assert.deepEqual(ranges.rows.map(row => row.key), ['harness:claude-code', 'harness:orca']);
  assert.equal(ranges.rows.reduce((sum, row) => sum + row.n, 0), 12);
  assert.equal(ranges.population.unit, 'content_hash');

  const strips = stripRows(ARTIFACT_ENTITIES, 'clarity', 'kind');
  assert.equal(strips.rows.length, 2, 'one dot per latest file');
  assert.deepEqual(strips.rows.map(row => row.identity.path), ['docs/a.md', 'docs/b.md']);
  assert.equal(strips.rows[0].identity.hash, strips.rows[1].identity.hash, 'the same bytes in two files stay two dots');
  assert.equal(strips.population.unit, 'file');
});

test('the selected scorer and all-history baseline reach every request', async () => {
  const server = qualityTransport();
  const result = await loadRanges({
    scope: { win: '30d' }, spec: QUALITY_SPECS['score-ranges'], schema,
    transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.state, 'ready', `ranges settled (${result.state})`);
  assert.equal(result.check, 'clarity');
  assert.equal(result.scorer, 'beta');
  const baseline = server.calls.find(call => call.name === 'baselines');
  assert.ok(baseline, 'read /baselines');
  assert.equal(baseline.params.get('population'), 'content');
  assert.equal(baseline.params.get('kind'), 'design');
  assert.equal(baseline.params.get('check'), 'clarity');
  const scores = server.calls.filter(call => call.name === 'scores' && call.params.get('check'));
  assert.equal(scores.length, 1, 'one score read');
  assert.equal(scores[0].params.get('scorer'), 'beta');
  assert.equal(scores[0].params.get('kind'), 'design');
  assert.deepEqual(scoreRangeTableColumns(), [
    'Group', 'Count (content versions)', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter',
    '95th percentile', 'Maximum', 'Baseline lower quarter', 'Baseline median', 'Baseline upper quarter'
  ]);
  const band = baselineBand(BASELINES.scorers.beta.clarity);
  const rangeRows = scoreRangeRows(scoresBody()).rows;
  assert.deepEqual(scoreRangeTableRows(rangeRows, band)[0].slice(1, 4), ['5', '0.3', '0.55']);
  assert.deepEqual(scoreRangeTableRows(rangeRows, band)[0].slice(8), ['0.45', '0.65', '0.85']);
});

test('a selected global kind names itself in the caption and on the wire', async () => {
  const server = qualityTransport();
  const scope = { win: '30d', kind: 'brief' };
  const result = await loadRanges({
    scope, spec: QUALITY_SPECS['score-ranges'], schema, transport: server, tenant: 'tenant-b', doc: fakeDoc()
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.kind, 'brief');
  const scores = server.calls.filter(call => call.name === 'scores' && call.params.get('check'));
  assert.equal(scores[0].params.get('kind'), 'brief');
  assert.equal(captionFor(lookupPanel('score-ranges'), QUALITY_SPECS['score-ranges'], { scope, schema }),
    'Each row shows brief clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.');
});

test('the trend table is long by bucket and group with median solid and quartiles dashed', () => {
  const model = scoreTrendModel({ body: SERIES, check: 'clarity', split: 'session_model', baseline: baselineBand(BASELINES.scorers.beta.clarity) });
  assert.deepEqual(model.series.map(series => `${series.key}:${series.dash}`), [
    'session_model:claude|p25:dashed', 'session_model:claude|median:solid', 'session_model:claude|p75:dashed',
    'session_model:gpt|p25:dashed', 'session_model:gpt|median:solid', 'session_model:gpt|p75:dashed'
  ]);
  assert.deepEqual(scoreTrendTableColumns(), ['Bucket', 'Group', 'Count', 'Lower quarter', 'Median', 'Upper quarter']);
  const rows = scoreTrendTableRows(model);
  assert.deepEqual(rows.map(row => [row[0], row[1], row[2]]), [
    ['2026-09-01T00:00:00.000Z', 'session_model:claude', '3'],
    ['2026-09-01T00:00:00.000Z', 'session_model:gpt', '1'],
    ['2026-09-02T00:00:00.000Z', 'session_model:claude', '4']
  ]);
  assert.match(model.baselineText, /All-history baseline for this scorer in this tenant/);
});

test('all-history trend buckets use the retained schema span', () => {
  assert.equal(trendBucket({ win: 'all' }, schema), 'day');
  assert.equal(trendBucket({ win: '90d' }, schema), 'day');
  assert.equal(trendBucket({ from: '2026-01-01T00:00:00Z', to: '2026-05-01T00:00:00Z' }, schema), 'week');
  const multiYear = { ...schema, coverage: { first_ts: '2020-01-01T00:00:00Z', last_ts: '2026-01-01T00:00:00Z' } };
  assert.equal(trendBucket({ win: 'all' }, multiYear), 'month');
});

test('bands keep the fixed tokens, the published order and the file unit', () => {
  const model = bandMixRows(BAND_AGGREGATE);
  assert.deepEqual(model.series.map(series => series.key), BAND_KEYS);
  for (const series of model.series) {
    assert.equal(series.cssVar, BAND_TOKENS[series.key], `${series.key} token`);
    assert.equal(series.token, BAND_TOKENS[series.key], `${series.key} token alias`);
  }
  assert.deepEqual(BAND_KEYS, ['low', 'mid', 'high', 'unscored', 'baseline_unavailable']);
  assert.deepEqual(model.rows.map(row => row.label), ['brief', 'design']);
  assert.equal(model.rows[0].values.mid, 3);
  assert.equal(Object.hasOwn(model.rows[1].values, 'mid'), false, 'a missing band is absent, not a fake zero');
  assert.deepEqual(bandMixTableRows(model), [
    ['brief', BAND_LABELS.mid, '3'],
    ['design', BAND_LABELS.low, '2'],
    ['design', BAND_LABELS.high, '1'],
    ['design', BAND_LABELS.unscored, '1'],
    ['design', BAND_LABELS.baseline_unavailable, '1']
  ]);
  assert.equal(model.series[3].label, 'unscored');
  assert.equal(model.series[4].label, 'baseline unavailable');
  assert.equal(model.population.unit, 'file');
});

test('scores are a normalized 0–1 unit and are never multiplied into percentages', () => {
  assert.equal(SCORE_UNIT, 'normalized score (0–1)');
  assert.deepEqual(stripTableColumns(), ['Repository', 'Path', 'Kind', `Score (${SCORE_UNIT})`, 'Scorer', 'Observed']);
  const rows = stripRows(ARTIFACT_ENTITIES, 'clarity', 'kind').rows;
  const table = stripTableRows(rows);
  assert.equal(table[0][3], '0.82');
  assert.notEqual(table[0][3], '82');
  assert.equal(table[0][4], 'beta');
  assert.equal(table[0][5], '2026-09-02');
});
