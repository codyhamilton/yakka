// `treemap`: a measure composed over two schema-published lenses, drawn with
// `<yk-treemap>`. The parent holds child cells; the tail beyond the declared
// parents is the element's labelled `(other)` group. Cost is special: usage
// rows carry an empty direct repo, so a cost split by `repo_id` or `session_repo`
// is named unsupported with the `/distribution` alternative, and a cost by a
// tool is named unsupported with the `hook_events by tool` view. The panel never
// invents a priced value; a partially priced window says lower bound with its
// unpriced call count and an all-unpriced window says unpriced, never $0.

import '../charts/yk-treemap.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { filterRefusal, table } from './pulse-strips.js';
import {
  ensureP10Styles, honestJoinGuard, measureMeta, mountPanelViews, offeredMeasures, offeredSplit, populationLine,
  requestParams, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import { dimensionLabel, renderChooserFields } from './trend-columns.js';

export const treemapTableColumns = (unit = 'USD') => ['Parent', 'Child', `Value (${unit})`];

export const COSTMAP_CAPTION = 'Each rectangle shows priced spend for a model within a harness; larger rectangles mean more dollars spent.';
export const TOOLSMAP_CAPTION = 'Each rectangle counts hook events for a tool within a harness; larger rectangles mean more events.';
export const TOOLSMAP_CATEGORY_CAPTION = 'Each rectangle counts hook events for a tool category within a harness; larger rectangles mean more events.';

function treemapKey(spec = {}) {
  return spec?.scope?.captionKey || '';
}

function isToolsMap(spec = {}) {
  return treemapKey(spec) === 'G-toolsmap' || (spec.measures || [])[0] === 'hook_events';
}

registerCaption('treemap', ({ spec = {}, schema = null, result = null } = {}) => {
  const key = treemapKey(spec);
  const measure = (spec.measures || [])[0] || (isToolsMap(spec) ? 'hook_events' : 'cost_usd');
  const child = result?.child || spec.split || (isToolsMap(spec) ? 'tool' : 'model');
  if (key === 'G-costmap' || (measure === 'cost_usd' && child === 'model')) return COSTMAP_CAPTION;
  if (key === 'G-toolsmap' || isToolsMap(spec)) {
    return child === 'tool_kind' ? TOOLSMAP_CATEGORY_CAPTION : TOOLSMAP_CAPTION;
  }
  return CAPTION_TEMPLATES.treemap({
    measure,
    parent: spec?.scope?.parent || 'harness',
    child,
    unit: measureMeta(schema, measure).unit || ''
  });
});
import { canonicalPanelSpec } from '../core/view-spec.js';
import { formatCount, formatMoney } from '../charts/formatters.js';

export const TREEMAP_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions', 'commits'
];

export const TREEMAP_LENSES = [
  'model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan', 'source'
];

// Cost-specific rules. These are request rules, not a new join: the server
// publishes `session_repo` on /distribution, and it publishes no cost-by-tool
// join at all. The panel names the missing combination instead of querying it.
export function costJoinGuard(measure, dims = []) {
  return honestJoinGuard(measure, dims);
}

export function treemapDims(panel, measure, schema) {
  const offered = offeredSplit(panel, measure, schema);
  if (measure !== 'cost_usd') return offered;
  return offered.filter(dim => !['repo_id', 'session_repo', 'tool', 'tool_kind'].includes(dim));
}

export function treemapDimsFromSpec(spec = {}) {
  return { parent: spec?.scope?.parent || 'harness', child: spec?.split || 'model' };
}

const pluralCall = value => formatCount(value, { unit: 'call' });

// The one cost-honesty read-out. A summary carries the window totals; a
// distribution row carries its own n/unpriced. Priced zero and all-unpriced
// are different states even though both cost nothing.
export function costHonesty({ summary = null, n = null, unpriced = 0, measure = 'cost_usd' } = {}) {
  if (measure !== 'cost_usd') return null;
  if (summary) {
    const calls = Number(summary.model_calls);
    const unpricedCalls = Number(summary.unpriced_calls || 0);
    const cost = summary.cost_usd;
    if (Number.isFinite(calls) && calls > 0 && unpricedCalls >= calls) {
      return { state: 'all-unpriced', text: `all ${pluralCall(calls)} unpriced; no priced cost`, money: 'unpriced' };
    }
    if (unpricedCalls > 0) {
      return {
        state: 'lower-bound',
        text: `lower bound, ${pluralCall(unpricedCalls)} unpriced`,
        money: formatMoney(cost, { unpriced: unpricedCalls, lowerBound: true })
      };
    }
    if (Number(cost) === 0) {
      return { state: 'priced-zero', text: 'priced cost is a real zero', money: formatMoney(0) };
    }
    return { state: 'priced', text: 'fully priced', money: formatMoney(cost) };
  }
  const count = Number(n ?? 0);
  const unpricedCalls = Number(unpriced ?? 0);
  if (count === 0 && unpricedCalls > 0) {
    return { state: 'all-unpriced', text: `all ${pluralCall(unpricedCalls)} unpriced; no priced cost`, money: 'unpriced' };
  }
  if (unpricedCalls > 0) {
    return { state: 'lower-bound', text: `lower bound, ${pluralCall(unpricedCalls)} unpriced`, money: 'unpriced' };
  }
  return { state: 'priced', text: 'fully priced', money: '' };
}

export function costOmitted(body = {}) {
  const parts = [];
  const groups = Number(body.omitted_groups || 0);
  const rows = Number(body.omitted_n || 0);
  const unpriced = Number(body.omitted_unpriced || 0);
  if (groups) parts.push(`${formatCount(groups, { unit: 'group' })} omitted`);
  if (rows) parts.push(`${formatCount(rows, { unit: 'row' })} in omitted groups`);
  if (unpriced) parts.push(`${pluralCall(unpriced)} unpriced in omitted groups`);
  return parts.join(', ');
}

// `/query` rows carry `k:[parent, child]`. A server that has not published the
// pair returns only the parent dim; the panel then mirrors the parent total as
// the child cell and says so rather than inventing a split.
export function buildTreemapData({ rows = [], measure = '', parent = '', child = '' } = {}) {
  const source = Array.isArray(rows) ? rows : [];
  const resolved = source.reduce((max, row) => Math.max(max, Array.isArray(row?.k) ? row.k.length : 0), 0);
  const twoLevel = resolved >= 2;
  const parents = [];
  const data = [];
  for (const row of source) {
    const k = Array.isArray(row?.k) ? row.k : [];
    const value = row?.v === null || row?.v === undefined ? null : Number(row.v);
    if (value === null || !Number.isFinite(value)) continue;
    const parentKey = String(k[0] ?? '');
    const childKey = twoLevel ? String(k[1] ?? '') : parentKey;
    if (!parents.some(item => item.key === parentKey)) parents.push({ key: parentKey, label: parentKey || '(none)' });
    data.push({
      key: `${parentKey}:${childKey}`,
      parent: parentKey,
      parentLabel: parentKey || '(none)',
      label: childKey || '(none)',
      value,
      values: { [measure]: value }
    });
  }
  return { data, parents, twoLevel };
}

function pricedNote(summary, measure) {
  const honesty = costHonesty({ summary, measure });
  if (!honesty) return '';
  return `Pricing: ${honesty.text}${honesty.money ? ` (${honesty.money})` : ''}.`;
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

export function renderTreemapChooser({ panelId, panel, spec = {}, schema = null, measure, parent, child, doc = globalThis.document } = {}) {
  const measures = offeredMeasures(panel, schema);
  const dims = treemapDims(panel, measure, schema);
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const emit = patch => {
    const merged = canonicalPanelSpec({
      grain: spec.grain || panel?.grain || 'time',
      measures: patch.measures || [measure],
      split: patch.split ?? child,
      chart: 'treemap',
      scope: { ...(spec.scope || {}), ...(patch.scope || {}) }
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: merged } }));
  };
  wrapper.append(select(doc, 'Measure', measures.map(name => ({ value: name, label: measureMeta(schema, name).label })), measure,
    value => emit({ measures: [value] })));
  wrapper.append(select(doc, 'Parent', dims.map(name => ({ value: name, label: name })), parent,
    value => emit({ scope: { parent: value } })));
  wrapper.append(select(doc, 'Child', dims.map(name => ({ value: name, label: name })), child,
    value => emit({ split: value })));
  return wrapper;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/cost.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREEMAP_PANEL;
    const key = treemapKey(spec);
    const tools = isToolsMap(spec);
    const measures = offeredMeasures(panel, schema);
    if (tools && !measures.includes('hook_events')) {
      return unsupportedState({ missing: 'hook_events', reason: 'not published for the time grain', source: 'server /schema' });
    }
    const requestedMeasure = (spec.measures || [])[0] || '';
    const measure = tools
      ? 'hook_events'
      : (requestedMeasure && measures.includes(requestedMeasure) ? requestedMeasure : (measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || '')));
    if (!measure || !measures.includes(measure)) {
      return unsupportedState({ missing: measure || 'a published measure', reason: 'not published for the time grain', source: 'server /schema' });
    }
    const filterScope = { ...scope };
    delete filterScope.parent;
    delete filterScope.captionKey;
    const refusal = filterRefusal({ panel, spec, scope: filterScope, schema });
    if (refusal) return refusal;
    const parent = 'harness';
    const { child: requestedChild } = treemapDimsFromSpec(spec);
    const dims = treemapDims(panel, measure, schema);
    // Fall back to the next published child rather than requesting an
    // unpublished dim; the basis text labels the fallback.
    const wantedChild = tools ? 'tool' : (requestedChild || 'model');
    const child = !dims.includes(wantedChild) && wantedChild === 'tool' && dims.includes('tool_kind')
      ? 'tool_kind' : wantedChild;
    const guard = costJoinGuard(measure, [parent, child]);
    if (guard) return unsupportedState({ missing: guard.missing, reason: guard.reason, source: 'contract 17.3', nearest: guard.try });
    for (const dim of [parent, child]) {
      if (!dims.includes(dim)) {
        return unsupportedState({
          missing: `${measure} by ${parent} → ${child}`,
          reason: dim === parent ? `${parent} is not a published parent lens for ${measure}` : `${child} is not a published child lens for ${measure}`,
          source: 'server /schema',
          nearest: dims[0] || 'no published lens'
        });
      }
    }
    const meta = measureMeta(schema, measure);
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const params = requestParams({ scope, spec, measure, bucket: 'none' });
    params.append('dim', parent);
    params.append('dim', child);
    if (topMax) params.set('top', String(Math.min(100, topMax)));
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'treemap' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not available|not served/i.test(body?.error || '')) {
        return unsupportedState({ missing: `${measure} by ${parent} → ${child}`, reason: body.error, source: 'server /schema', nearest: dims[0] || 'no published lens' });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const mapped = buildTreemapData({ rows: body.rows, measure, parent, child });
    let summary = null;
    if (measure === 'cost_usd') {
      try {
        const answer = await transport.get('summary', requestParams({ scope, spec }), { tenant, signal, stateKey: 'treemap-summary' });
        if (answer.response.ok) summary = answer.body;
      } catch {
        summary = null;
      }
    }
    const data = mapped.data;
    if (!data.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} groups in window ${scope.win || 'all'}`, clear: null }]);
    }
    const honesty = costHonesty({ summary, measure });
    const omitted = costOmitted(body);
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-cost p10-treemap';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${meta.label} (${meta.unit}) over ${parent} → ${child}, bucket=none. ${populationLine(body)}.`;
      const node = doc.createElement('yk-treemap');
      node.className = 'p10-cost-chart';
      node.spec = {
        chart: 'treemap', type: 'treemap',
        title: `${meta.label} by ${parent} then ${child}`,
        units: meta.unit,
        series: [{ key: measure, label: meta.label, unit: meta.unit, kind: meta.kind }],
        parents: mapped.parents,
        empty: 'no positive values in the current window'
      };
      node.data = data;
      painted = node;
      const note = doc.createElement('p');
      note.className = 'p10-note p10-pricing';
      note.dataset.state = honesty?.state || 'measured';
      note.textContent = [
        pricedNote(summary, measure),
        mapped.twoLevel ? '' : `The server returned only the ${parent} dimension; child cells mirror the parent totals.`,
        omitted,
        child === 'tool_kind' && tools ? 'The schema publishes no tool lens; child cells use the published tool category.' : '',
        summary ? '' : measure === 'cost_usd' ? 'The server did not report a cost summary; the priced total cannot be called complete.' : ''
      ].filter(Boolean).join(' ');
      const columns = treemapTableColumns(meta.unit || 'USD').map((label, index) => ({ label, numeric: index === 2 }));
      const rows = [...data]
        .sort((a, b) => b.value - a.value || String(a.parent).localeCompare(String(b.parent)) || String(a.label).localeCompare(String(b.label)))
        .map(row => [row.parentLabel, row.label, String(row.value)]);
      const tableNode = table(doc, { caption: `${measure} by ${parent} then ${child}`, columns, rows });
      const views = mountPanelViews({ panelId: panel.id, chart: node, table: tableNode, doc, defaultView: 'chart', label: 'Treemap view' });
      views.element.removeAttribute('data-panel');
      wrapper.append(basis, views.element, note);
      host.replaceChildren(wrapper);
    });
    await painted?.whenSettled?.();
    const post = filterRefusal({ panel, spec, scope: filterScope, schema, ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [] });
    if (post) return post;
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      if (tools) { slot.replaceChildren(); return; }
      const fields = [
        {
          label: 'Measure', value: measure,
          options: measures.map(name => ({ value: name, label: measureMeta(schema, name).label })),
          patch: value => ({ measures: [value] })
        },
        {
          label: 'Group by', value: child,
          options: dims.map(name => ({ value: name, label: dimensionLabel(name) })),
          patch: value => ({ split: value })
        }
      ];
      slot.replaceChildren(renderChooserFields({ panelId: panel.id, spec: { ...spec, measures: [measure], split: child, scope: { ...(spec.scope || {}), parent } }, doc, fields }));
    });
    return {
      state: 'ready', measure, parent, child,
      population: body.population || null,
      pricing: honesty?.state || null,
      twoLevel: mapped.twoLevel,
      omitted,
      tableRows: [...data]
        .sort((a, b) => b.value - a.value || String(a.parent).localeCompare(String(b.parent)) || String(a.label).localeCompare(String(b.label)))
        .map(row => [row.parentLabel, row.label, String(row.value)]),
      basis: `${measure} by ${parent} then ${child}, bucket=none`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} treemap`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The treemap query failed.' });
  }
}

export const TREEMAP_PANEL = {
  id: 'treemap',
  title: 'Treemap',
  grain: 'time',
  measures: TREEMAP_MEASURES,
  lenses: TREEMAP_LENSES,
  charts: ['treemap'],
  requires: [],
  caveats: 'Two published lenses, parent then child; the tail is the element’s labelled (other). A cost split by repo_id/session_repo is unsupported with the /distribution alternative; cost by a tool is unsupported with hook_events by tool. Lower-bound and all-unpriced cost are named, never $0.',
  measureBasis: 'the scope window at bucket=none over two lenses',
  requests: () => [
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'none', dims: ['harness', 'model'] } },
    { route: '/v1/analytics/summary', method: 'GET' }
  ],
  load
};

export default TREEMAP_PANEL;
