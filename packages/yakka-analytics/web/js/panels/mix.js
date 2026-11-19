// `mix`: a composition panel. One measure over one or two published lenses is
// drawn with `<yk-bars>` as stacked or 100-percent bars. Published special
// groups — `(mixed)`, `(none)`, `(multi)`, `unknown` — stay separate; nothing is
// folded into `(other)` here. The mode chooser picks the bar composition, and
// the cost read-out keeps unpriced/omitted populations visible.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import {
  ensureP10Styles, measureMeta, offeredMeasures, offeredSplit, populationLine, requestParams,
  whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { costHonesty, costJoinGuard, costOmitted } from './treemap.js';

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

export function mixTableRows(model) {
  return model.rows.map(row => [row.label, ...model.series.map(series => {
    const value = row.values[series.key];
    return value === null || value === undefined ? '—' : String(value);
  })]);
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
    const measure = (spec.measures || [])[0] && measures.includes(spec.measures[0]) ? spec.measures[0] : (measures[0] || 'hook_events');
    if (!measures.includes(measure)) {
      return unsupportedState({ missing: measure, reason: 'not published for the time grain', source: 'server /schema' });
    }
    const { first, second } = mixDimsFromSpec(spec);
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
    const mode = mixMode(spec);
    const meta = measureMeta(schema, measure);
    const params = requestParams({ scope, spec, measure, bucket: 'none' });
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
    let summary = null;
    if (measure === 'cost_usd') {
      try {
        const answer = await transport.get('summary', requestParams({ scope, spec }), { tenant, signal, stateKey: 'mix-summary' });
        if (answer.response.ok) summary = answer.body;
      } catch {
        summary = null;
      }
    }
    const honesty = costHonesty({ summary, measure });
    const omitted = costOmitted(body);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-cost p10-mix';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${meta.label} (${meta.unit}) by ${first} × ${second}, ${mode === 'percent' ? '100 percent' : 'stacked'} bars, bucket=none. ${populationLine(body)}.`;
      const node = doc.createElement('yk-bars');
      node.className = 'p10-cost-chart';
      node.spec = {
        chart: 'bars',
        type: mode,
        title: `${meta.label} by ${first} × ${second}`,
        units: meta.unit,
        series: model.series.map(series => ({ ...series, unit: meta.unit, kind: mode === 'percent' ? 'percent' : meta.kind }))
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note p10-pricing';
      note.dataset.state = honesty?.state || 'measured';
      note.textContent = [
        honesty ? `Pricing: ${honesty.text}${honesty.money ? ` (${honesty.money})` : ''}.` : '',
        model.twoLevel ? '' : `The server returned only the ${first} dimension; the ${second} composition is unavailable and a single series is shown.`,
        omitted
      ].filter(Boolean).join(' ');
      const columns = [{ label: first }, ...model.series.map(series => ({ label: series.label, numeric: true }))];
      wrapper.append(basis, node, note, table(doc, { caption: `${measure} composition by ${first} × ${second}`, columns, rows: mixTableRows(model) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderMixChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split: first }, schema, measure, first, second, mode, doc }));
    });
    return {
      state: 'ready', measure, first, second, mode,
      population: body.population || null,
      pricing: honesty?.state || null,
      twoLevel: model.twoLevel,
      omitted
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'hook_events'} composition`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The composition query failed.' });
  }
}

function select(doc, labelText, options, value, onChange) {
  const label = doc.createElement('label');
  label.className = 'p10-chooser-field';
  label.append(doc.createTextNode(labelText));
  const control = doc.createElement('select');
  control.setAttribute('aria-label', labelText);
  for (const option of options) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    control.append(node);
  }
  control.addEventListener('change', () => onChange(control.value));
  label.append(control);
  return label;
}

export function renderMixChooser({ panelId, panel, spec = {}, schema = null, measure, first, second, mode, doc = globalThis.document } = {}) {
  const measures = offeredMeasures(panel, schema);
  const dims = mixDims(panel, measure, schema);
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const emit = patch => {
    const merged = canonicalPanelSpec({
      grain: spec.grain || panel?.grain || 'time',
      measures: patch.measures || [measure],
      split: patch.split ?? first,
      chart: 'bars',
      scope: { ...(spec.scope || {}), ...(patch.scope || {}) }
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: merged } }));
  };
  wrapper.append(select(doc, 'Measure', measures.map(name => ({ value: name, label: measureMeta(schema, name).label })), measure,
    value => emit({ measures: [value] })));
  wrapper.append(select(doc, 'First', dims.map(name => ({ value: name, label: name })), first,
    value => emit({ split: value })));
  wrapper.append(select(doc, 'Second', dims.map(name => ({ value: name, label: name })), second,
    value => emit({ scope: { second: value } })));
  wrapper.append(select(doc, 'Mode', MIX_MODES.map(name => ({ value: name, label: name })), mode,
    value => emit({ scope: { mode: value } })));
  return wrapper;
}

export const MIX_PANEL = {
  id: 'mix',
  title: 'Composition',
  grain: 'time',
  measures: MIX_MEASURES,
  lenses: MIX_LENSES,
  charts: ['bars'],
  requires: [],
  caveats: 'One measure over one or two published lenses as stacked or 100-percent bars. Special groups stay separate; omitted and unpriced populations are named.',
  measureBasis: 'the scope window at bucket=none over one or two lenses',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'hook_events', bucket: 'none', dim: 'tool_kind' } }],
  load
};

export default MIX_PANEL;
