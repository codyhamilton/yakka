// `dist-ranges`: box and whisker per lens value with p95, n and unpriced.
// Compare-period renders one row per group for both periods, labelled with the
// period, so both populations are always visible. The opt-in entity legend
// names and colours the groups; the tooltip still reports the summaries.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, previousWindow, table } from './pulse-strips.js';
import {
  coverageFacts, ensureP10Styles, measureMeta, populationLine, requestParams, whenPanelBody,
  whenPanelSlot, renderChooser, windowParams
} from './p10-shared.js';

export const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

export const DIST_MEASURES = ['cost_usd', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'tokens_reasoning'];
export const DIST_DIMS = ['model'];
export const DIST_GRAINS = ['call', 'conversation'];

export function distributionParams({ scope = {}, measure, grain = 'call', dim = '' }) {
  return requestParams({ scope, measure, split: dim, extra: { grain } });
}

export function previousDistributionParams({ scope = {}, measure, grain = 'call', dim = '' }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = distributionParams({ scope, measure, grain, dim });
  const window = windowParams(previous);
  params.set('from', window.get('from'));
  params.set('to', window.get('to'));
  return params;
}

export function boxRow(row, { dim = '', period = '', measure = '', kind = 'money', unit = 'USD' } = {}) {
  const group = String(row.k ?? 'all');
  const suffix = period ? `::${period}` : '';
  return {
    key: dim ? `${dim}:${group}${suffix}` : `${measure}${suffix || '::all'}`,
    label: period ? `${group} · ${period}` : group,
    group,
    period,
    n: row.n,
    unpriced: row.unpriced,
    values: {
      min: row.min, q1: row.p25 ?? row.q1, median: row.median, q3: row.p75 ?? row.q3,
      max: row.max, p95: row.p95, n: row.n,
      ...(row.unpriced !== undefined ? { unpriced: row.unpriced } : {})
    }
  };
}

export function boxTableRows(rows) {
  return rows.map(row => [
    row.label,
    ...['min', 'q1', 'median', 'q3', 'max', 'p95'].map(key => row.values[key] === null || row.values[key] === undefined ? '—' : String(row.values[key])),
    row.n === null || row.n === undefined ? '—' : String(row.n),
    row.unpriced === null || row.unpriced === undefined ? '—' : String(row.unpriced)
  ]);
}

export async function fetchDistribution(transport, params, { tenant, signal, stateKey }) {
  const { response, body } = await transport.get('distribution', params, { tenant, signal, stateKey });
  if (!response.ok) {
    const error = new Error(body?.error || `The server returned ${response.status}.`);
    error.code = body?.code || String(response.status || '');
    error.status = response.status;
    throw error;
  }
  return body;
}

function unitKindFor(meta) {
  return { unit: meta.unit, kind: meta.kind === 'money' ? 'money' : meta.kind };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const compare = scope.cmp === 'period';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || DIST_RANGES_PANEL;
    const measure = (spec.measures || [])[0] && DIST_MEASURES.includes((spec.measures || [])[0]) ? spec.measures[0] : 'cost_usd';
    const dim = (spec.split && DIST_DIMS.includes(spec.split)) ? spec.split : 'model';
    const grain = spec.scope?.grain === 'conversation' ? 'conversation' : 'call';
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    const meta = measureMeta(schema, measure);
    const unit = unitKindFor(meta);
    const body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ranges' });
    let previous = null;
    if (compare) {
      previous = await fetchDistribution(transport, previousDistributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ranges-previous' });
    }
    const rows = [
      ...(body.rows || []).map(row => boxRow(row, { dim, period: compare ? 'current' : '', measure, ...unit })),
      ...((previous?.rows || []).map(row => boxRow(row, { dim, period: 'previous', measure, ...unit })))
    ];
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} distributions in window ${scope.win || 'all'}`, clear: null }]);
    }
    const omittedGroups = (body.omitted_groups || 0) + (previous?.omitted_groups || 0);
    const omittedN = (body.omitted_n || 0) + (previous?.omitted_n || 0);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${measure} over ${grain} grain by ${dim}. ${populationLine(body)}. Unpriced ${body.unpriced ?? 0}${previous ? `; previous period unpriced ${previous.unpriced ?? 0}` : ''}.`;
      const node = doc.createElement('yk-ranges');
      node.className = 'p10-dist-chart';
      node.spec = {
        chart: 'ranges',
        type: 'box',
        legend: 'entities',
        title: `${measure} by ${dim}${compare ? ' (current and previous period)' : ''}`,
        timeBasis: 'priced calls only; the current scope window',
        units: meta.unit,
        series: [{ key: measure, label: meta.label, unit: meta.unit, kind: meta.kind }],
        ...(spec.baseline ? { baseline: spec.baseline } : {})
      };
      node.data = rows;
      const columns = [{ label: 'Group' }, ...['Min', 'Q1', 'Median', 'Q3', 'Max', 'p95', 'n', 'Unpriced'].map(label => ({ label, numeric: true }))];
      const facts = coverageFacts({ ...body, omitted_groups: omittedGroups, omitted_n: omittedN });
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        `${meta.unit === 'USD' ? 'Unpriced cost is a lower bound, never $0.' : 'Priced values only; unpriced calls are counted separately.'}`,
        omittedGroups ? `${omittedGroups} groups omitted (${omittedN} rows).` : '',
        ...facts
      ].filter(Boolean).join(' ');
      wrapper.append(basis, node, note, table(doc, { caption: `${measure} distribution by ${dim}`, columns, rows: boxTableRows(rows) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split: dim, chart: 'ranges' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split: dim, grain, compare,
      population: body.population || null,
      previousPopulation: previous?.population || null,
      omittedGroups, omittedN,
      basis: `${measure} distribution over ${grain} grain by ${dim}${compare ? '; current and previous period' : ''}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} distribution`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The distribution query failed.' });
  }
}

export const DIST_RANGES_PANEL = {
  id: 'dist-ranges',
  title: 'Distribution ranges',
  grain: 'session',
  measures: DIST_MEASURES,
  lenses: [...DIST_DIMS],
  charts: ['ranges'],
  requires: [],
  caveats: 'Priced calls only; unpriced is a separate count and never $0. Compare renders both periods side by side; the legend names groups.',
  measureBasis: 'call or conversation priced values in the scope window',
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'call', dim: 'model' } }],
  load
};

export default DIST_RANGES_PANEL;
