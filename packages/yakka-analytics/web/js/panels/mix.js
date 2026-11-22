// `mix`: a composition panel. One measure over one or two published lenses is
// drawn with `<yk-bars>` as stacked or 100-percent bars. Published special
// groups — `(mixed)`, `(none)`, `(multi)`, `unknown` — stay separate; nothing is
// folded into `(other)` here. The mode chooser picks the bar composition, and
// the cost read-out keeps unpriced/omitted populations visible.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { filterRefusal, table } from './pulse-strips.js';
import {
  ensureP10Styles, measureMeta, mountPanelViews, offeredMeasures, offeredSplit, populationLine, requestParams,
  whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import { registerCaption } from './captions.js';
import { costJoinGuard, costOmitted } from './treemap.js';

// G-mix is fixed: hook events by tool category, split by harness, stacked.
// There is no measure, split or mode chooser on the Tools board.
export const MIX_CAPTION = 'Each bar counts hook events for a tool category, split by harness; longer segments mean more events.';
export const MIX_TABLE_COLUMNS = ['Group', 'Series', 'Value (events)'];
export const MIX_FIRST = 'tool_kind';
export const MIX_SECOND = 'harness';

registerCaption('mix', () => MIX_CAPTION);

export const MIX_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions', 'commits'
];

export const MIX_LENSES = ['harness', 'model', 'tool', 'tool_kind', 'kind', 'plan', 'source', 'session_model'];

export const MIX_MODES = ['stacked', 'percent'];

export function mixMode(spec = {}) {
  return spec?.scope?.mode === 'percent' ? 'percent' : 'stacked';
}

export function mixDimsFromSpec(spec = {}) {
  return { first: spec?.split || 'tool_kind', second: spec?.scope?.second || 'harness' };
}

export function mixDims(panel, measure, schema) {
  const offered = offeredSplit(panel, measure, schema);
  if (measure !== 'cost_usd') return offered;
  return offered.filter(dim => !['repo_id', 'session_repo'].includes(dim));
}

// `/query` rows are `{k:[first]} ` or `{k:[first, second], v}`. Categories are
// the first dim; series are the second dim's published group values. With one
// dim there is one series for the measure.
export function buildMix({ rows = [], measure = '', dims = [], mode = 'stacked' } = {}) {
  const [first, second] = dims;
  const source = Array.isArray(rows) ? rows : [];
  const categories = [];
  const series = [];
  const byCategory = new Map();
  let twoLevel = false;
  for (const row of source) {
    const k = Array.isArray(row?.k) ? row.k : [];
    if (k.length >= 2) twoLevel = true;
    const value = row?.v === null || row?.v === undefined ? null : Number(row.v);
    if (value === null || !Number.isFinite(value)) continue;
    const category = String(k[0] ?? '(none)');
    const key = twoLevel && second ? `${second}:${k[1] ?? ''}` : `${first}:${category}`;
    if (twoLevel && second) {
      const label = String(k[1] ?? '(none)');
      if (!series.some(item => item.key === key)) series.push({ key, label, unit: '', kind: 'count' });
    } else if (!series.some(item => item.key === key)) {
      series.push({ key, label: measure, unit: '', kind: 'count' });
    }
    if (!byCategory.has(category)) {
      byCategory.set(category, { key: `${first}:${category}`, label: category, values: {} });
      categories.push(category);
    }
    byCategory.get(category).values[key] = value;
  }
  let data = categories.map(category => byCategory.get(category));
  if (mode === 'percent') {
    data = data.map(row => {
      const total = Object.values(row.values).reduce((sum, value) => sum + (Number(value) || 0), 0);
      const values = {};
      for (const [key, value] of Object.entries(row.values)) values[key] = total > 0 ? Number(value) / total : null;
      return { ...row, values };
    });
  }
  return { rows: data, series, twoLevel, mode };
}

// P10 stacked row: Group, Series, Value (events); group asc, series asc.
export function mixTableRows(model) {
  const groups = [...(model.rows || [])].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const series = [...(model.series || [])].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const rows = [];
  for (const group of groups) {
    for (const item of series) {
      const value = group.values[item.key];
      rows.push([group.label, item.label, value === null || value === undefined ? '—' : String(value)]);
    }
  }
  return rows;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/cost.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || MIX_PANEL;
    const measures = offeredMeasures(panel, schema);
    const measure = 'hook_events';
    const first = MIX_FIRST;
    const second = MIX_SECOND;
    const mode = 'stacked';
    if (!measures.includes(measure)) {
      return unsupportedState({ missing: measure, reason: 'not published for the time grain', source: 'server /schema' });
    }
    const guard = costJoinGuard(measure, [first, second]);
    if (guard) return unsupportedState({ missing: guard.missing, reason: guard.reason, source: 'contract 17.3', nearest: guard.try });
    const dims = mixDims(panel, measure, schema);
    for (const dim of [first, second]) {
      if (!dims.includes(dim)) {
        return unsupportedState({
          missing: `${measure} by ${first} × ${second}`,
          reason: `${dim} is not a published lens for ${measure}`,
          source: 'server /schema',
          nearest: dims[0] || 'no published lens'
        });
      }
    }
    const filterScope = { ...scope };
    delete filterScope.captionKey;
    delete filterScope.mode;
    delete filterScope.second;
    const refusal = filterRefusal({ panel, spec: { ...spec, measures: [measure] }, scope: filterScope, schema });
    if (refusal) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      whenPanelSlot(panel.id, 'chooser', doc, slot => slot.replaceChildren());
      return refusal;
    }
    const meta = measureMeta(schema, measure);
    const params = requestParams({ scope, spec: { ...spec, measures: [measure] }, measure, bucket: 'none' });
    params.append('dim', first);
    params.append('dim', second);
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'mix' });
    if (!response.ok) {
      if (response.status === 400) return unsupportedState({ missing: `${measure} by ${first} × ${second}`, reason: body?.error, source: 'server /schema' });
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || '' });
    }
    const model = buildMix({ rows: body.rows, measure, dims: [first, second], mode });
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} groups in window ${scope.win || 'all'}`, clear: null }]);
    }
    const omitted = costOmitted(body);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-cost p10-mix';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${meta.label} (${meta.unit}) by ${first} × ${second}, stacked bars, bucket=none. ${populationLine(body)}.`;
      const node = doc.createElement('yk-bars');
      node.className = 'p10-cost-chart';
      node.spec = {
        chart: 'bars',
        type: mode,
        orientation: 'horizontal',
        title: `${meta.label} by ${first} × ${second}`,
        units: meta.unit,
        series: model.series.map(series => ({ ...series, unit: meta.unit, kind: meta.kind }))
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note p10-pricing';
      note.dataset.state = 'measured';
      note.textContent = [
        model.twoLevel ? '' : `The server returned only the ${first} dimension; the ${second} composition is unavailable and a single series is shown.`,
        omitted
      ].filter(Boolean).join(' ');
      const columns = MIX_TABLE_COLUMNS.map((label, index) => ({ label, numeric: index === 2 }));
      const tableNode = table(doc, { caption: 'Hook events by tool category and harness', columns, rows: mixTableRows(model) });
      const views = mountPanelViews({ panelId: panel.id, chart: node, table: tableNode, doc, defaultView: 'chart', label: 'Hook events composition view' });
      views.element.removeAttribute('data-panel');
      wrapper.append(basis, views.element, note);
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => slot.replaceChildren());
    return {
      state: 'ready', measure, first, second, mode,
      population: body.population || null,
      twoLevel: model.twoLevel,
      omitted
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'hook_events'} composition`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The composition query failed.' });
  }
}

export const MIX_PANEL = {
  id: 'mix',
  title: 'Composition',
  grain: 'time',
  measures: MIX_MEASURES,
  lenses: MIX_LENSES,
  charts: ['bars'],
  requires: [],
  caveats: 'Hook events by tool category, split by harness, as stacked bars. Special groups stay separate and omitted populations are named. There is no measure, split or mode chooser on the Tools board.',
  measureBasis: 'hook events in the scope window at bucket=none by tool_kind × harness',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'hook_events', bucket: 'none', dim: 'tool_kind' } }],
  load
};

export default MIX_PANEL;
