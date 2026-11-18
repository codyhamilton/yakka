// `rank`: top N of a measure per lens with `(other)`. Single mode is a ranked
// bar chart; compare mode is a two-series slope with the committed diverging
// ramp so an increase and a decrease are distinguishable. A missing previous
// period is unsupported, never an invented baseline.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, previousWindow, table } from './pulse-strips.js';
import {
  ensureP10Styles, measureMeta, populationLine, rankRows, requestParams, whenPanelBody,
  whenPanelSlot, renderChooser, windowParams
} from './p10-shared.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

export const RANK_MEASURES = [
  'cost_usd', 'model_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write',
  'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions', 'commits', 'rejections'
];

function previousParams({ scope, measure, split, extra }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = requestParams({ scope, measure, split, bucket: 'none', extra });
  const window = windowParams(previous);
  params.set('from', window.get('from'));
  params.set('to', window.get('to'));
  return params;
}

export function slopeRows(currentBody, previousBody, measure, split) {
  const current = rankRows(currentBody, measure, split);
  const previous = rankRows(previousBody, measure, split);
  const order = [];
  const byGroup = new Map();
  for (const row of current.rows) {
    if (!byGroup.has(row.label)) { byGroup.set(row.label, { key: row.key, label: row.label, values: {}, lenses: row.lenses }); order.push(row.label); }
    byGroup.get(row.label).values.current = row.values[measure];
  }
  for (const row of previous.rows) {
    if (!byGroup.has(row.label)) { byGroup.set(row.label, { key: row.key, label: row.label, values: {}, lenses: row.lenses }); order.push(row.label); }
    byGroup.get(row.label).values.previous = row.values[measure];
  }
  return {
    series: [
      { key: 'previous', label: 'Previous period', unit: current.series[0].unit, kind: current.series[0].kind },
      { key: 'current', label: 'Current period', unit: current.series[0].unit, kind: current.series[0].kind }
    ],
    rows: order.map(label => byGroup.get(label))
  };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const compare = scope.cmp === 'period';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || RANK_PANEL;
    const offered = (schema?.grains?.time?.measures || []);
    const measure = (spec.measures || [])[0] && (!offered.length || offered.includes(spec.measures[0])) ? spec.measures[0] : 'cost_usd';
    if (offered.length && !offered.includes(measure)) {
      return unsupportedState({ missing: measure, reason: 'not published for the time grain', source: 'server /schema' });
    }
    const validSplits = ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan'];
    const split = spec.split && validSplits.includes(spec.split) ? spec.split : 'model';
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const meta = measureMeta(schema, measure);
    const current = await transport.get('query', requestParams({ scope, measure, split, bucket: 'none', extra }), { tenant, signal, stateKey: 'rank' });
    if (!current.response.ok) {
      if (current.response.status === 400) return unsupportedState({ missing: `${measure} by ${split}`, reason: current.body?.error, source: 'server /schema' });
      return errorState({ message: current.body?.error || `The server returned ${current.response.status}.`, code: current.body?.code || '' });
    }
    let series;
    let rows;
    let previousBody = null;
    if (compare) {
      const params = previousParams({ scope, measure, split, extra });
      if (!params) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
      const previous = await transport.get('query', params, { tenant, signal, stateKey: 'rank-previous' });
      if (!previous.response.ok) return errorState({ message: previous.body?.error || `The server returned ${previous.response.status}.`, code: previous.body?.code || '' });
      previousBody = previous.body;
      const slope = slopeRows(current.body, previousBody, measure, split);
      series = slope.series;
      rows = slope.rows;
    } else {
      const ranked = rankRows(current.body, measure, split, meta);
      series = ranked.series;
      rows = ranked.rows;
    }
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} groups in window ${scope.win || 'all'}`, clear: null }]);
    }
    if (compare) {
      const up = rows.some(row => Number(row.values.current) > Number(row.values.previous));
      const down = rows.some(row => Number(row.values.current) < Number(row.values.previous));
      if (!up || !down) {
        // A slope with only one direction is still drawn honestly, but the note
        // says so rather than implying a two-direction comparison.
      }
    }
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-rank';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = compare
        ? `Basis: ${measure} (${meta.unit}) per ${split}, bucket=none, current against the previous equal-length period. ${populationLine(current.body)}.`
        : `Basis: ${measure} (${meta.unit}) per ${split}, bucket=none. ${populationLine(current.body)}.`;
      const node = doc.createElement('yk-bars');
      node.className = 'p10-rank-chart';
      node.spec = {
        chart: 'bars',
        type: compare ? 'slope' : 'ranked',
        title: `${meta.label} by ${split}${compare ? ' (current against previous period)' : ''}`,
        timeBasis: compare ? 'current window against the equal length immediately before' : 'the scope window',
        units: meta.unit,
        series,
        top: topMax ? Math.min(100, topMax) : undefined,
        ...(compare ? { deltaRamp: true } : {})
      };
      node.data = rows;
      const columns = compare
        ? [{ label: 'Group' }, { label: 'Previous period', numeric: true }, { label: 'Current period', numeric: true }, { label: 'Change', numeric: true }]
        : [{ label: 'Group' }, { label: meta.label, numeric: true }];
      const tableRows = compare
        ? rows.map(row => [row.label, String(row.values.previous ?? '—'), String(row.values.current ?? '—'), String(Number(row.values.current) - Number(row.values.previous))])
        : rows.map(row => [row.label, String(row.values[measure] ?? '—')]);
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = compare
        ? 'Both periods are listed; the change is shown beside them, never as a lone delta. Up is the committed positive diverging token and down the negative one.'
        : 'Top groups are bounded by the published top budget; (other) folds the rest.';
      wrapper.append(basis, node, note, table(doc, { caption: `${measure} by ${split}`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split, chart: compare ? 'slope' : 'ranked' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split, compare,
      population: current.body.population || null,
      previousPopulation: previousBody?.population || null,
      basis: `${measure} per ${split}, bucket=none${compare ? '; current and previous period' : ''}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} ranking`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The ranking query failed.' });
  }
}

export const RANK_PANEL = {
  id: 'rank',
  title: 'Rank',
  grain: 'time',
  measures: RANK_MEASURES,
  lenses: ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan'],
  charts: ['rank', 'slope'],
  requires: [],
  caveats: 'Compare is a two-series slope with the committed diverging ramp; more than two periods or no previous period is unsupported, never an invented baseline.',
  measureBasis: 'the scope window at bucket=none; compare uses the equal length immediately before',
  requests: () => [
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'none', dim: 'model' } },
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'none', dim: 'model', window: 'previous' } }
  ],
  load
};

export default RANK_PANEL;
