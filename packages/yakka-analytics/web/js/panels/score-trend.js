// `score-trend`: one content version per bucket, with p25, median and p75 of
// the selected scorer drawn as three named series. A content version may occur
// in more than one bucket, so series n is not the window version population.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table, WINDOW_MS } from './pulse-strips.js';
import {
  bucketInfo, coarsenedText, currentWindow, ensureP10Styles, mountPanelViews,
  requestParams, scoreSeriesRoute, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import { registerCaption } from './captions.js';
import {
  BASELINE_LABEL, SCORE_UNIT, baselineBand, contentPopulationText, contentSplits, defaultCheck, defaultSplit,
  fetchContentBaselines, fetchScoreCatalogue, groupName, humanCheck, multiKindRefusal,
  renderScoreControls, requestedScore, resolveScorer, scoreApplicabilityRefusal, scoreCaption,
  scoreKind, scorerNames
} from './score-ranges.js';

export const TREND_STATS = [
  { key: 'p25', label: 'p25' },
  { key: 'median', label: 'median' },
  { key: 'p75', label: 'p75' }
];

function entryFor(body, check) {
  const checks = Array.isArray(body?.checks) ? body.checks : [];
  return checks.find(entry => entry?.name === check) || checks[0] || null;
}

export function scoreTrendModel({ body = {}, check = '', split = '', baseline = null } = {}) {
  const entry = entryFor(body, check);
  const points = Array.isArray(entry?.points) ? entry.points : [];
  const groups = [];
  const byX = new Map();
  for (const point of points) {
    const x = point?.t ? Date.parse(point.t) : null;
    if (x === null || !Number.isFinite(x)) continue;
    const source = Array.isArray(point.groups) && point.groups.length
      ? point.groups
      : [{ key: split ? '' : 'all', n: point.n, p25: point.p25, median: point.median, p75: point.p75 }];
    if (!byX.has(x)) byX.set(x, { key: `t:${point.t}`, x, t: point.t, values: {}, counts: {} });
    const row = byX.get(x);
    for (const group of source) {
      const name = groupName(group);
      if (!groups.includes(name)) groups.push(name);
      row.counts[name] = group.n === null || group.n === undefined ? null : Number(group.n);
      for (const stat of TREND_STATS) {
        const key = `${name}|${stat.key}`;
        row.values[key] = group[stat.key] === null || group[stat.key] === undefined ? null : Number(group[stat.key]);
      }
    }
  }
  const series = groups.flatMap(name => TREND_STATS.map(stat => ({
    key: `${name}|${stat.key}`,
    label: split ? `${name} ${stat.label}` : stat.label,
    unit: SCORE_UNIT,
    kind: 'number',
    dash: stat.key === 'median' ? 'solid' : 'dashed'
  })));
  const rows = [...byX.values()].sort((a, b) => a.x - b.x);
  return {
    rows,
    series,
    groups,
    population: body?.population || entry?.population || null,
    baselineText: baseline
      ? `${BASELINE_LABEL}: p25 ${baseline.from}, median ${baseline.median}, p75 ${baseline.to} (n ${baseline.n}).`
      : 'Baseline unavailable: no content baseline is retained for this scorer and check.'
  };
}

export function scoreTrendTableColumns() {
  return ['Bucket', 'Group', 'Count', 'Lower quarter', 'Median', 'Upper quarter'];
}

export function scoreTrendTableRows(model) {
  const rows = [];
  const groups = [...(model.groups || [])].sort((a, b) => String(a).localeCompare(String(b)));
  const ordered = [...(model.rows || [])].sort((a, b) => a.x - b.x);
  for (const row of ordered) {
    for (const group of groups) {
      const raw = ['p25', 'median', 'p75'].map(stat => row.values?.[`${group}|${stat}`]);
      const count = row.counts?.[group];
      if (count === null || count === undefined) {
        if (raw.every(value => value === null || value === undefined)) continue;
      }
      const values = raw.map(value => value === null || value === undefined ? '—' : String(value));
      rows.push([new Date(row.x).toISOString(), group, count === null || count === undefined ? '—' : String(count), ...values]);
    }
  }
  return rows;
}

// A finite window picks day ≤90d, week ≤730d else month. All history uses the
// schema's retained span, never an invented global auto bucket.
export function trendBucket(scope = {}, schema = null) {
  const supported = scoreSeriesRoute(schema).buckets;
  const pick = name => supported.includes(name) ? name : (supported[supported.length - 1] || 'month');
  let days;
  const win = currentWindow(scope);
  if (win) {
    days = (win.to - win.from) / WINDOW_MS.d;
  } else {
    const first = Date.parse(schema?.coverage?.first_ts || '');
    const last = Date.parse(schema?.coverage?.last_ts || '');
    days = Number.isFinite(first) && Number.isFinite(last) ? (last - first) / WINDOW_MS.d : Infinity;
  }
  if (days <= 90) return pick('day');
  if (days <= 730) return pick('week');
  return pick('month');
}

registerCaption('score-trend', ({ spec = {}, scope = {} } = {}) => {
  const key = spec?.scope?.captionKey || 'G-scoretrend';
  const resolved = scoreKind(scope, spec);
  const { check } = requestedScore(spec, scope);
  return scoreCaption(key, { kind: resolved.kind || 'design', check: check || 'clarity' });
});

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
  const resolvedKind = scoreKind(scope, spec);
  if (resolvedKind.multi) return multiKindRefusal();
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCORE_TREND_PANEL;
    const refusal = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'content' });
    if (refusal) return refusal;
    const requested = requestedScore(spec, scope);
    const kind = resolvedKind.kind;
    const catalogue = await fetchScoreCatalogue(transport, kind, { tenant, signal, stateKey: 'score-trend-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: catalogue.checks[0] });
    }
    const check = requested.check || defaultCheck(catalogue.checks);
    const baselines = await fetchContentBaselines(transport, { kind, check, scorer: requested.scorer, tenant, signal, stateKey: 'score-trend-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    if (!resolved.scorer) {
      return unsupportedState({ measure: `a scorer for ${check}`, reason: 'no scorer is published for this check', source: 'server /baselines', nearest: null });
    }
    const splits = contentSplits(schema);
    const split = defaultSplit(splits, spec.split || '');
    if (spec.split && !splits.includes(spec.split)) {
      return unsupportedState({ lens: `split ${spec.split}`, reason: 'not published for the content grain', source: 'server /schema', nearest: split || null });
    }
    const route = scoreSeriesRoute(schema);
    const bucket = trendBucket(scope, schema);
    const params = requestParams({
      scope: { ...scope, kind }, spec: { ...spec, split: '' }, measure: '', bucket,
      extra: { kind, check, ...(resolved.scorer ? { scorer: resolved.scorer } : {}), ...(split ? { dim: split } : {}) }
    });
    const { response, body } = await transport.get('score-series', params, { tenant, signal, stateKey: 'score-trend' });
    if (!response.ok) {
      const code = body?.code || String(response.status || '');
      if (code === 'unsupported_resolution') {
        const buckets = Array.isArray(body?.supported_buckets) && body.supported_buckets.length
          ? body.supported_buckets
          : route.buckets;
        return unsupportedState({
          feature: `score-series ${bucket} buckets`,
          reason: `${body?.error || 'the server refused this resolution'} (supported buckets: ${buckets.join(', ')})`,
          source: 'server /score-series',
          nearest: buckets.join(', ')
        });
      }
      if (code === 'too_many_cells') {
        const details = [`max_cells: ${body?.max_cells ?? 'not supplied'}`];
        if (body?.suggested_bucket) details.push(`suggested_bucket: ${body.suggested_bucket}`);
        if (body?.suggested_action) details.push(`suggested_action: ${body.suggested_action}`);
        return unsupportedState({
          feature: `score-series ${bucket} buckets at this cell budget`,
          reason: `${body?.error || 'the server refused the cell budget'} (${details.join('; ')})`,
          source: 'server /score-series',
          nearest: body?.suggested_bucket || body?.suggested_action || null
        });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code });
    }
    const post = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'content', ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [] });
    if (post) return post;
    const band = baselineBand(resolved.entry);
    const model = scoreTrendModel({ body, check, split, baseline: band });
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${check} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(body);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const node = doc.createElement('yk-chart');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'lines', type: 'line', mode: 'absolute',
        title: `${check} median and middle half by ${split || 'bucket'}`,
        units: SCORE_UNIT,
        timeBasis: 'artifact event facts.ts bucket start; latest-known scores are not historical as-of scores',
        series: model.series,
        x: { label: 'Time', kind: 'time' },
        empty: 'no score buckets in the current window'
      };
      node.data = model.rows;
      const tableNode = table(doc, {
        caption: `${check} per ${info.effective || 'bucket'} (${SCORE_UNIT})`,
        columns: scoreTrendTableColumns().map((label, index) => ({ label, numeric: index >= 2 })),
        rows: scoreTrendTableRows(model)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: node, table: tableNode, doc,
        defaultView: 'chart', label: 'Score trend view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${coarsenedText(body)} ${check} content versions; latest known score per version. Scorer ${resolved.scorer}. ${model.baselineText} ${contentPopulationText(model.population)}.`;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        `A content version may recur in several ${info.effective || 'bucket'} buckets, so a series n is not the window version population.`,
        `The server reported ${info.effective || 'no'} buckets${info.coarsened ? ` after coarsening from ${info.requested}` : ''}.`,
        `The middle line is the median and the dashed outer lines are ${humanCheck(check)} quartiles. Scores are a ${SCORE_UNIT}.`
      ].join(' ');
      wrapper.append(views.element, basis, note);
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderScoreControls({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), split,
        splits, includeSplit: true
      }));
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split, bucket: info.effective,
      requestedBucket: bucket, supportedBuckets: route.buckets, routeAuto: route.auto,
      coarsened: info.coarsened, baseline: band || 'baseline_unavailable',
      population: model.population,
      basis: `${check} content versions per ${info.effective || 'bucket'} by ${split || 'bucket'}; ${band ? BASELINE_LABEL : 'baseline unavailable'}`,
      tableRows: scoreTrendTableRows(model)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score trend query failed.' });
  }
}

export const SCORE_TREND_PANEL = {
  id: 'score-trend',
  title: 'Design clarity over time',
  grain: 'content',
  measures: ['score'],
  lenses: contentSplits(null),
  charts: ['lines'],
  requires: ['scores_by_lens'],
  caveats: 'One content version per bucket; a version may recur in several buckets, so series n is not the window population. The all-history baseline is printed beside the series.',
  measureBasis: 'artifact event facts.ts bucket start; latest-known scores',
  requests: () => [{ route: '/v1/analytics/score-series', method: 'GET', params: { kind: 'design', check: 'clarity', dim: 'session_model', bucket: 'week' } }],
  load
};

export default SCORE_TREND_PANEL;
