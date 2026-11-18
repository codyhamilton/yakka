// `score-trend`: distinct content hashes per time bucket, with the p25, median
// and p75 of the selected scorer drawn as three named series. A hash may occur
// in more than one bucket, so series n is not the window hash population.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import {
  bucketForWindow, bucketInfo, coarsenedText, ensureP10Styles, populationLine, requestParams,
  whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import {
  BASELINE_LABEL, QUALITY_KINDS, baselineBand, catalogueChecks, contentSplits, groupName, qualityScope,
  renderQualityChooser, resolveScorer, scorerNames
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
    if (!byX.has(x)) byX.set(x, { key: `t:${point.t}`, x, values: {}, t: point.t });
    const row = byX.get(x);
    for (const group of source) {
      const name = groupName(group);
      if (!groups.includes(name)) groups.push(name);
      for (const stat of TREND_STATS) {
        const key = `${name}|${stat.key}`;
        row.values[key] = group[stat.key] === null || group[stat.key] === undefined ? null : Number(group[stat.key]);
      }
    }
  }
  const series = groups.flatMap(name => TREND_STATS.map(stat => ({
    key: `${name}|${stat.key}`,
    label: split ? `${name} ${stat.label}` : stat.label,
    unit: 'score',
    kind: 'number'
  })));
  const rows = [...byX.values()].sort((a, b) => a.x - b.x);
  return {
    rows,
    series,
    groups,
    population: body?.population || entry?.population || null,
    baselineText: baseline
      ? `${BASELINE_LABEL}: p25 ${baseline.from}, median ${baseline.median}, p75 ${baseline.to} (n ${baseline.n}).`
      : 'baseline_unavailable: no content baseline is retained for this scorer and check.'
  };
}

export function scoreTrendTableRows(model) {
  return (model.rows || []).map(row => [
    new Date(row.x).toISOString(),
    ...(model.series || []).map(series => row.values[series.key] === null || row.values[series.key] === undefined ? '—' : String(row.values[series.key]))
  ]);
}

async function fetchCatalogue(transport, kind, options) {
  const { response, body } = await transport.get('scores', new URLSearchParams({ kind }), options);
  return { response, body, checks: catalogueChecks(body) };
}

async function fetchBaselines(transport, { kind, check, tenant, signal, stateKey }) {
  const params = new URLSearchParams({ population: 'content', kind, check });
  if (tenant) params.set('tenant', tenant);
  return transport.request('baselines', { params, signal, stateKey });
}

function defaultTrendSplit(splits, requested = '') {
  if (requested && splits.includes(requested)) return requested;
  for (const name of ['session_model', 'harness', 'repo_id']) if (splits.includes(name)) return name;
  return splits[0] || '';
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCORE_TREND_PANEL;
    const requested = qualityScope(spec);
    const kind = QUALITY_KINDS.includes(requested.kind) ? requested.kind : 'design';
    const catalogue = await fetchCatalogue(transport, kind, { tenant, signal, stateKey: 'score-trend-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: catalogue.checks[0] });
    }
    const check = requested.check || catalogue.checks[0];
    const baselines = await fetchBaselines(transport, { kind, check, tenant, signal, stateKey: 'score-trend-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    const splits = contentSplits(schema);
    const split = defaultTrendSplit(splits, spec.split || '');
    if (spec.split && !splits.includes(spec.split)) {
      return unsupportedState({ lens: `split ${spec.split}`, reason: 'not published for the content grain', source: 'server /schema', nearest: split || null });
    }
    const bucket = bucketForWindow(scope, schema);
    const params = requestParams({
      scope: { ...scope, kind }, spec: { ...spec, split: '' }, measure: '', bucket,
      extra: { kind, check, ...(resolved.scorer ? { scorer: resolved.scorer } : {}), ...(split ? { dim: split } : {}) }
    });
    const { response, body } = await transport.get('score-series', params, { tenant, signal, stateKey: 'score-trend' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
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
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${coarsenedText(body)} Distinct content hashes; latest known score per hash/check. Check ${check}, scorer ${resolved.scorer || 'none'}. ${model.baselineText} ${populationLine({ population: model.population })}.`;
      const node = doc.createElement('yk-chart');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'lines', type: 'line', mode: 'absolute',
        title: `${check} p25 / median / p75 by ${split || 'bucket'}`,
        units: 'score',
        timeBasis: 'artifact event facts.ts bucket start; latest-known scores are not historical as-of scores',
        series: model.series,
        x: { label: 'Time', kind: 'time' },
        empty: 'no score buckets in the current window'
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        `A content hash may recur in several ${info.effective || 'bucket'} buckets, so a series n is not the window hash population.`,
        `The server reported ${info.effective || 'no'} buckets${info.coarsened ? ` after coarsening from ${info.requested}` : ''}.`,
        model.baselineText
      ].join(' ');
      const columns = [{ label: 'Bucket' }, ...model.series.map(series => ({ label: series.label, numeric: true }))];
      wrapper.append(basis, node, note, table(doc, { caption: `${check} per ${info.effective || 'bucket'}`, columns, rows: scoreTrendTableRows(model) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderQualityChooser({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), lens: split,
        lenses: splits, chart: 'lines'
      });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split, bucket: info.effective,
      coarsened: info.coarsened, baseline: band || 'baseline_unavailable',
      population: model.population,
      basis: `${check} hashes per ${info.effective || 'bucket'} by ${split || 'bucket'}; ${band ? 'all-time scorer baseline' : 'baseline_unavailable'}`,
      tableRows: scoreTrendTableRows(model)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score trend query failed.' });
  }
}

export const SCORE_TREND_PANEL = {
  id: 'score-trend',
  title: 'Score trend',
  grain: 'content',
  measures: ['score'],
  lenses: contentSplits(null),
  charts: ['lines'],
  requires: ['scores_by_lens'],
  caveats: 'Distinct content hashes per bucket; a hash may recur in several buckets, so series n is not the window population. The all-time scorer baseline is printed beside the series.',
  measureBasis: 'artifact event facts.ts bucket start; latest-known scores',
  requests: () => [{ route: '/v1/analytics/score-series', method: 'GET', params: { kind: 'design', check: 'clarity', dim: 'session_model', bucket: 'day' } }],
  load
};

export default SCORE_TREND_PANEL;
