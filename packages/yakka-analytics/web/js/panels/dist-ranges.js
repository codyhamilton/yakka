// `dist-ranges`: box and whisker per lens value with p95, n and unpriced.
// Compare-period renders one row per group for both periods, labelled with the
// period, so both populations are always visible. The opt-in entity legend
// names and colours the groups; the tooltip still reports the summaries.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { publishedNames } from '../core/schema-adapter.js';
import { currentWindow, filterRefusal, previousWindow, table } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import {
  comparisonPlan, comparisonSummary, coverageFacts, ensureP10Styles, measureMeta, mountPanelViews, populationLine,
  requestParams, schemaGrain, whenPanelBody, whenPanelSlot, windowParams
} from './p10-shared.js';

export const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';
export const SHARED_BOUNDARY_NOTE = 'An event exactly at the shared boundary belongs to both periods.';

export const DIST_MEASURES = ['cost_usd', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'tokens_reasoning'];
export const DIST_DIMS = ['model', 'harness', 'session_model', 'session_repo'];
export const DIST_GRAINS = ['call', 'conversation'];

export const DIST_GRAIN_OPTIONS = [
  { value: 'call', label: 'Model call' },
  { value: 'conversation', label: 'Session' }
];

export const DIST_GROUP_LABELS = {
  model: 'Model',
  harness: 'Harness',
  session_model: 'Session model',
  session_repo: 'Repository'
};

export const DIST_MEASURE_LABELS = {
  cost_usd: 'Priced spend',
  tokens_in: 'Input tokens',
  tokens_out: 'Output tokens',
  tokens_cache_read: 'Cached input tokens',
  tokens_cache_write: 'Cache-write tokens',
  tokens_reasoning: 'Reasoning tokens'
};

export const DIST_RANGES_CAPTION = 'Each row shows the spread of session costs for a repository; the box covers the middle half and the line marks the median.';
export const COMPRANGES_CAPTION = 'Each pair of rows compares call costs for a model in the selected and previous equal-length periods; compare medians and the middle-half boxes.';

export const DIST_RANGES_CAPTIONS = {
  'G-ranges': DIST_RANGES_CAPTION,
  'G-compranges': COMPRANGES_CAPTION
};

export const DIST_RANGES_DEFAULTS = { grain: 'conversation', dim: 'session_repo' };

// The G item each caption key describes, so an alternate grain/group/measure
// falls back to the shared ranges template rather than a wrong literal.
const CAPTION_SHAPE = {
  'G-ranges': { grain: 'conversation', dim: 'session_repo' },
  'G-compranges': { grain: 'call', dim: 'model' }
};

// CONTRACTS.md 17.3: call rows use the call harness/model; session_model and
// session_repo are declared session attributes, so they exist only at the
// conversation grain. A call-grain session lens is unsupported with the
// conversation alternative, never a fabricated empty group.
const DIM_GRAINS = {
  model: ['call', 'conversation'],
  harness: ['call', 'conversation'],
  session_model: ['conversation'],
  session_repo: ['conversation']
};

export function distributionGuard({ grain = 'call', dim = '' } = {}) {
  const chosenGrain = DIST_GRAINS.includes(grain) ? grain : 'call';
  if (!dim) return { ok: true, grain: chosenGrain, dim: '' };
  if (!DIST_DIMS.includes(dim)) {
    return { ok: false, grain: chosenGrain, dim, reason: `${dim} is not a published distribution dimension`, try: 'model' };
  }
  const grains = DIM_GRAINS[dim] || DIST_GRAINS;
  if (!grains.includes(chosenGrain)) {
    return {
      ok: false, grain: chosenGrain, dim,
      reason: `${dim} is a declared session attribute, not a ${chosenGrain} attribute`,
      try: 'conversation'
    };
  }
  return { ok: true, grain: chosenGrain, dim };
}

function requestedGrain(spec = {}, defaults = {}) {
  const scoped = spec?.scope?.grain;
  if (scoped === 'call' || scoped === 'conversation') return scoped;
  if (spec?.grain === 'call' || spec?.grain === 'conversation') return spec.grain;
  return defaults.grain || 'call';
}

export function distributionSpec(spec = {}, defaults = { grain: 'call', dim: 'model' }) {
  const grain = requestedGrain(spec, defaults);
  const requested = spec?.scope?.dim || spec?.split || defaults.dim || 'model';
  return distributionGuard({ grain, dim: requested });
}

// The deterministic intersection of the registry list with the session grain's
// published capability. The selected incompatible value is kept by the caller
// so it stays visible and refuses, rather than silently changing.
export function distMeasureOptions(schema = null) {
  if (!schema) return [...DIST_MEASURES];
  const published = new Set(publishedNames(schemaGrain(schema, 'session')?.measures));
  if (!published.size) return [...DIST_MEASURES];
  return DIST_MEASURES.filter(name => published.has(name));
}

export function distGroupOptions(schema = null) {
  if (!schema) return [...DIST_DIMS];
  const grain = schemaGrain(schema, 'session');
  const published = new Set([
    ...publishedNames(grain?.lenses),
    ...(measureMeta(schema, 'cost_usd').dims || [])
  ]);
  if (!published.size) return [...DIST_DIMS];
  return DIST_DIMS.filter(name => published.has(name));
}

export function distGrainLabel(value) {
  return DIST_GRAIN_OPTIONS.find(option => option.value === value)?.label || value;
}

export function distDimensionLabel(value) {
  return DIST_GROUP_LABELS[value] || String(value).replace(/_/g, ' ');
}

function distMeasureLabel(value) {
  return DIST_MEASURE_LABELS[value] || measureMeta(null, value).label || String(value);
}

function addField(doc, wrapper, labelText, options, value, onChange) {
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
    if (option.disabled) node.disabled = true;
    control.append(node);
  }
  control.addEventListener('change', () => onChange(control.value));
  label.append(control);
  wrapper.append(label);
}

// P4: Measure, Grain and Group by. A change writes `measures[0]`,
// `scope.grain` or `scope.dim` and dispatches one composed `spec` event; the
// app owns the router and reloads only this panel.
export function renderDistributionChooser({ panelId, panel = null, spec = {}, schema = null, doc = globalThis.document } = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const grain = requestedGrain(spec, { grain: 'call' });
  const dim = spec?.scope?.dim || spec?.split || 'model';
  const measure = (spec?.measures || [])[0] || 'cost_usd';

  const dispatch = (patch = {}) => {
    const scope = { ...(spec.scope || {}), ...(patch.scope || {}) };
    const next = canonicalPanelSpec({
      grain: spec.grain || panel?.grain || 'session',
      measures: patch.measures || spec.measures || [measure],
      split: patch.split !== undefined ? patch.split : spec.split,
      chart: spec.chart,
      scope
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  };

  const measures = distMeasureOptions(schema);
  const measureList = measures.includes(measure) ? measures : [measure, ...measures];
  addField(doc, wrapper, 'Measure',
    measureList.map(name => ({ value: name, label: distMeasureLabel(name) })),
    measure, value => dispatch({ measures: [value] }));

  addField(doc, wrapper, 'Grain', DIST_GRAIN_OPTIONS, grain,
    value => dispatch({ scope: { grain: value } }));

  const groups = distGroupOptions(schema);
  const groupList = groups.includes(dim) ? groups : [dim, ...groups];
  addField(doc, wrapper, 'Group by',
    groupList.map(name => ({
      value: name,
      label: distDimensionLabel(name),
      disabled: !(DIM_GRAINS[name] || DIST_GRAINS).includes(grain)
    })),
    dim, value => dispatch({ scope: { dim: value } }));

  const required = (DIM_GRAINS[dim] || []).filter(name => name !== grain);
  if (required.length) {
    const note = doc.createElement('p');
    note.className = 'p10-chooser-note';
    note.textContent = `${distDimensionLabel(dim)} needs the ${required.map(distGrainLabel).join(' or ')} grain.`;
    wrapper.append(note);
  }
  return wrapper;
}

export function distributionParams({ scope = {}, measure, grain = 'call', dim = '', cohort = undefined }) {
  return requestParams({ scope, measure, split: dim, extra: { grain }, ...(cohort !== undefined ? { cohort } : {}) });
}

export function previousDistributionParams({ scope = {}, measure, grain = 'call', dim = '', cohort = undefined }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = distributionParams({ scope, measure, grain, dim, cohort });
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

export function rangeTableColumns() {
  return ['Group', 'Period', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter', '95th percentile', 'Maximum', 'Count', 'Unpriced'];
}

export function rangeTableColumnSpecs() {
  return rangeTableColumns().map((label, index) => ({ label, numeric: index >= 2 }));
}

export function periodRank(period) {
  const text = String(period || 'current').toLowerCase();
  if (text === 'current' || text.startsWith('cohort a')) return 0;
  return 1;
}

// Group ascending, current before previous, bin/edge ascending inside a side.
export function orderRangeRows(rows = []) {
  return [...rows].sort((a, b) => String(a.group).localeCompare(String(b.group)) || periodRank(a.period) - periodRank(b.period));
}

export function boxTableRows(rows = []) {
  const value = item => item === null || item === undefined ? '—' : String(item);
  return rows.map(row => [
    row.group,
    row.period || 'current',
    value(row.values.min),
    value(row.values.q1),
    value(row.values.median),
    value(row.values.q3),
    value(row.values.p95),
    value(row.values.max),
    value(row.n),
    value(row.unpriced)
  ]);
}

function dimensionLabel(name) {
  return distDimensionLabel(name);
}

function filterScopeFor(scope = {}) {
  const rest = { ...scope };
  delete rest.grain;
  delete rest.dim;
  delete rest.captionKey;
  return rest;
}

function ignoredList(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
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

function renderChooser(panel, spec, schema, doc) {
  whenPanelSlot(panel.id, 'chooser', doc, slot => {
    slot.replaceChildren(renderDistributionChooser({ panelId: panel.id, panel, spec, schema, doc }));
  });
}

registerCaption('dist-ranges', ({ spec = {}, scope = {}, schema = null } = {}) => {
  const key = spec?.scope?.captionKey || 'G-ranges';
  const measure = (spec?.measures || [])[0] || 'cost_usd';
  const resolved = distributionSpec(spec, DIST_RANGES_DEFAULTS);
  const shape = CAPTION_SHAPE[key] || CAPTION_SHAPE['G-ranges'];
  const compare = String(scope?.cmp || 'off') === 'period';
  const single = !scope?.cmp || scope.cmp === 'off';
  const mode = key === 'G-compranges' ? compare : single;
  if (mode && measure === 'cost_usd' && resolved.ok && resolved.grain === shape.grain && resolved.dim === shape.dim) {
    return DIST_RANGES_CAPTIONS[key] || DIST_RANGES_CAPTION;
  }
  return CAPTION_TEMPLATES.ranges({
    measure,
    group: resolved.dim || 'all',
    unit: measureMeta(schema, measure).unit || ''
  });
});

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const plan = comparisonPlan(scope);
  const compare = plan.mode === 'period';
  const cohortCompare = plan.mode === 'cohorts';
  if (plan.unsupported) return unsupportedState({ missing: 'comparison', reason: plan.unsupported, source: 'scope' });
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || DIST_RANGES_PANEL;
    const filterScope = filterScopeFor(scope);
    const refusal = filterRefusal({ panel, spec, scope: filterScope, schema });
    if (refusal) return refusal;
    const measures = distMeasureOptions(schema);
    const requestedMeasure = (spec.measures || [])[0] || '';
    if (requestedMeasure && !measures.includes(requestedMeasure)) {
      return unsupportedState({
        missing: requestedMeasure, reason: 'not published for the session grain', source: 'server /schema',
        nearest: measures[0] || null
      });
    }
    const measure = requestedMeasure || (measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || 'cost_usd'));
    const distributed = distributionSpec(spec, DIST_RANGES_DEFAULTS);
    if (!distributed.ok) {
      renderChooser(panel, spec, schema, doc);
      return unsupportedState({
        missing: `${measure} by ${distributed.dim} at ${distributed.grain} grain`,
        reason: distributed.reason,
        source: 'contract 17.3',
        nearest: `${distributed.try} grain`
      });
    }
    const { grain, dim } = distributed;
    if (compare && !currentWindow(scope)) {
      renderChooser(panel, spec, schema, doc);
      return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    }
    const meta = measureMeta(schema, measure);
    const unit = unitKindFor(meta);
    let body;
    let previous = null;
    let labels = { current: compare ? 'current' : '', previous: 'previous' };
    if (cohortCompare) {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.a }), { tenant, signal, stateKey: 'dist-ranges' });
      previous = plan.b
        ? await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.b }), { tenant, signal, stateKey: 'dist-ranges-b' })
        : await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: null }), { tenant, signal, stateKey: 'dist-ranges-b' });
      labels = { current: plan.aLabel, previous: plan.bLabel };
    } else {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ranges' });
      if (compare) {
        previous = await fetchDistribution(transport, previousDistributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ranges-previous' });
      }
    }
    const post = filterRefusal({
      panel, spec, scope: filterScope, schema,
      ignoredFilters: [...ignoredList(body), ...ignoredList(previous)]
    });
    if (post) return post;
    const compared = compare || cohortCompare;
    const rows = orderRangeRows([
      ...(body.rows || []).map(row => boxRow(row, { dim, period: labels.current, measure, ...unit })),
      ...((previous?.rows || []).map(row => boxRow(row, { dim, period: labels.previous, measure, ...unit })))
    ]);
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
      return emptyState([{ kind: 'scope', label: `no ${measure} distributions in window ${scope.win || 'all'}`, clear: null }]);
    }
    const omittedGroups = (body.omitted_groups || 0) + (previous?.omitted_groups || 0);
    const omittedN = (body.omitted_n || 0) + (previous?.omitted_n || 0);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist';
      const chartHost = doc.createElement('div');
      chartHost.className = 'p10-dist-charts';
      const chartSpec = {
        chart: 'ranges',
        type: 'box',
        legend: 'entities',
        title: `${meta.label} by ${dimensionLabel(dim)}${cohortCompare ? ` (${plan.aLabel} and ${plan.bLabel})` : compare ? ' (current and previous period)' : ''}`,
        timeBasis: 'priced calls only; the current scope window',
        units: meta.unit,
        series: [{ key: measure, label: meta.label, unit: meta.unit, kind: meta.kind }],
        ...(spec.baseline ? { baseline: spec.baseline } : {})
      };
      if (cohortCompare) {
        const groups = [...new Set(rows.map(row => row.group))];
        for (const group of groups) {
          const section = doc.createElement('div');
          section.className = 'p10-split-group';
          section.dataset.split = group;
          const node = doc.createElement('yk-ranges');
          node.className = 'p10-dist-chart';
          node.dataset.group = group;
          node.spec = { ...chartSpec, title: `${meta.label} by ${dimensionLabel(dim)} · ${group} (${plan.aLabel} and ${plan.bLabel})` };
          node.data = rows.filter(row => row.group === group);
          section.append(node);
          chartHost.append(section);
        }
      } else {
        const node = doc.createElement('yk-ranges');
        node.className = 'p10-dist-chart';
        node.spec = chartSpec;
        node.data = rows;
        chartHost.append(node);
      }
      const tableNode = table(doc, {
        caption: `${meta.label} distribution by ${dimensionLabel(dim)}`,
        columns: rangeTableColumnSpecs(),
        rows: boxTableRows(rows)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: chartHost, table: tableNode, doc,
        defaultView: 'chart', label: 'Distribution ranges view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      const comparisonText = compared
        ? comparisonSummary({ plan, sides: cohortCompare ? { a: body, b: previous } : { current: body, previous }, unit: meta.unit }).text
        : '';
      const boundary = plan.mode === 'period' ? ` ${SHARED_BOUNDARY_NOTE}` : '';
      basis.textContent = `Basis: ${measure} over ${grain} grain by ${dim}. ${populationLine(body)}. Unpriced ${body.unpriced ?? 0}${previous ? `; ${cohortCompare ? labels.previous : 'previous period'} unpriced ${previous.unpriced ?? 0}` : ''}. ${comparisonText}${boundary}`;
      const facts = coverageFacts({ ...body, omitted_groups: omittedGroups, omitted_n: omittedN });
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        `${meta.unit === 'USD' ? 'Unpriced cost is a lower bound, never $0.' : 'Priced values only; unpriced calls are counted separately.'}`,
        omittedGroups ? `${omittedGroups} groups omitted (${omittedN} rows).` : '',
        ...facts
      ].filter(Boolean).join(' ');
      wrapper.append(views.element, note, basis);
      host.replaceChildren(wrapper);
    });
    renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
    return {
      state: 'ready', measure, split: dim, grain, compare: compared, cohortCompare,
      population: body.population || null,
      previousPopulation: previous?.population || null,
      omittedGroups, omittedN,
      basis: `${measure} distribution over ${grain} grain by ${dim}${compare ? `; current and previous period. ${SHARED_BOUNDARY_NOTE}` : ''}`
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
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'conversation', dim: 'session_repo' } }],
  load
};

export default DIST_RANGES_PANEL;
