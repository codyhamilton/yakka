// `trend-columns`: priced model spend per event-time bucket in the selected
// timezone. The caption and defaults are the G-columns contract; cumulative and
// share are not offered in this amendment.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { filterRefusal, table } from './pulse-strips.js';
import { CAPTION_TEMPLATES, LABELS, registerCaption } from './captions.js';
import {
  bucketInfo, coarsenedText, ensureP10Styles, measureMeta, mountPanelViews, offeredMeasures, offeredSplit,
  populationLine, queryRows, requestParams, whenPanelBody, whenPanelSlot, wireChartScope
} from './p10-shared.js';

export const TREND_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions',
  'distinct_content', 'commits', 'rejections'
];

export const TREND_LENSES = ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan', 'source'];

export const CUMULATIVE_REFUSAL = 'Cumulative display is unavailable; choose columns or lines.';

export function chooseColumnsSpec(spec = {}) {
  return canonicalPanelSpec({
    ...spec,
    measures: spec.measures?.length ? spec.measures : ['cost_usd'],
    split: spec.split || 'model',
    chart: 'columns',
    scope: spec.scope || {}
  });
}

export const TREND_COLUMNS_CAPTION = 'Each bar shows priced model spend in one time bucket; taller bars mean more dollars spent.';

export function trendTableColumns(unit = 'USD') {
  return ['Bucket', 'Group', `Value (${unit})`];
}

export function dimensionLabel(name) {
  if (!name) return 'No grouping';
  const label = LABELS.entities[name] || String(name).replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function renderChooserFields({ panelId, spec = {}, doc = globalThis.document, fields = [] } = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const scope = { ...(spec.scope || {}) };
  for (const field of fields) {
    if (!field || !field.options?.length) continue;
    const label = doc.createElement('label');
    label.className = 'p10-chooser-field';
    label.append(doc.createTextNode(field.label));
    const control = doc.createElement('select');
    control.setAttribute('aria-label', field.label);
    for (const option of field.options) {
      const node = doc.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      node.selected = option.value === field.value;
      control.append(node);
    }
    control.addEventListener('change', () => {
      const patch = field.patch(control.value);
      const next = canonicalPanelSpec({
        grain: spec.grain || 'time',
        measures: patch.measures || spec.measures || ['cost_usd'],
        split: patch.split !== undefined ? patch.split : spec.split,
        chart: patch.chart || spec.chart || 'columns',
        scope
      });
      const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
      host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
    });
    label.append(control);
    wrapper.append(label);
  }
  return wrapper;
}

export const TREND_COLUMNS_CHARTS = ['columns', 'lines', 'area'];

function trendCaption({ spec = {}, schema = null, result = null } = {}) {
  const measure = (spec.measures || [])[0] || 'cost_usd';
  const split = spec.split || 'model';
  const chart = spec.chart || 'columns';
  if (measure === 'cost_usd' && split === 'model' && chart === 'columns') return TREND_COLUMNS_CAPTION;
  const vars = {
    measure,
    group: split || 'all',
    bucket: result?.bucket || 'time',
    unit: measureMeta(schema, measure).unit || ''
  };
  if (chart === 'lines' || chart === 'area') return CAPTION_TEMPLATES['lines/area'](vars);
  return CAPTION_TEMPLATES.columns(vars);
}

registerCaption('trend-columns', trendCaption);

export function chartShape(chart) {
  if (chart === 'lines') return { chart: 'lines', type: 'line', mode: 'absolute' };
  if (chart === 'area') return { chart: 'area', type: 'area', mode: 'absolute' };
  if (chart === 'cumulative') return { chart: 'cumulative', type: 'columns', mode: 'cumulative' };
  if (chart === 'share') return { chart: 'share', type: 'columns', mode: 'share' };
  return { chart: 'columns', type: 'columns', mode: 'absolute' };
}

export function buildTrendChart({ body, measure, split, schema, chart = 'columns' }) {
  const meta = measureMeta(schema, measure);
  const shape = chartShape(chart);
  const mapped = queryRows(body, measure, split, meta);
  return {
    ...shape,
    spec: {
      chart: shape.chart,
      type: shape.type,
      mode: shape.mode,
      stacked: shape.type === 'columns' && Boolean(split),
      title: `${meta.label}${split ? ` by ${split}` : ''}`,
      units: meta.unit,
      timeBasis: 'artifact/event facts.ts bucket start; latest-known scores are not mixed in',
      series: mapped.series,
      x: { label: 'Time', kind: 'time' },
      empty: 'no buckets in the current window'
    },
    rows: mapped.rows,
    series: mapped.series,
    keys: mapped.keys
  };
}

export function trendLongRows(model) {
  const series = [...model.series].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const rows = [];
  for (const row of model.rows) {
    for (const item of series) {
      const value = row.values[item.key];
      rows.push([
        new Date(row.x).toISOString(),
        item.label,
        value === null || value === undefined ? '—' : String(value)
      ]);
    }
  }
  return rows;
}

export function trendTableRows(model) {
  return trendLongRows(model);
}

function bucketChoice(scope, spec) {
  const requested = spec?.bucket || spec?.scope?.bucket || '';
  if (['hour', 'day', 'week', 'month'].includes(requested)) return requested;
  return 'auto';
}

function ignoredFrom(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
}

export function paintCumulativeRefusal({ spec, doc, panelId = TREND_COLUMNS_PANEL.id }) {
  const message = CUMULATIVE_REFUSAL;
  whenPanelBody(panelId, doc, host => {
    const wrapper = doc.createElement('div');
    wrapper.className = 'p10-trend';
    const note = doc.createElement('p');
    note.className = 'p10-note p10-cumulative-refusal';
    note.textContent = message;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'p10-choose-columns';
    button.textContent = 'Choose columns';
    button.addEventListener('click', () => {
      const next = chooseColumnsSpec(spec);
      const hostNode = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
      hostNode.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
    });
    wrapper.append(note, button);
    host.replaceChildren(wrapper);
  });
  return { state: 'ready', refused: 'cumulative', message };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const requestedChart = String(spec?.chart || '');
  if (requestedChart === 'cumulative' || requestedChart === 'share') return paintCumulativeRefusal({ spec, doc });
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_COLUMNS_PANEL;
    const refusal = filterRefusal({ panel, spec, scope, schema });
    if (refusal) return refusal;
    const measures = offeredMeasures(panel, schema);
    const requestedMeasure = (spec.measures || [])[0] || '';
    if (requestedMeasure && !measures.includes(requestedMeasure)) {
      return unsupportedState({
        missing: requestedMeasure, reason: 'not published for the time grain', source: 'server /schema',
        nearest: measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || null)
      });
    }
    const measure = requestedMeasure || (measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || ''));
    if (!measure) return unsupportedState({ missing: 'a published measure', reason: 'the grain publishes none', source: 'server /schema' });
    const splits = offeredSplit(panel, measure, schema);
    const requestedSplit = spec.split || '';
    if (requestedSplit && !splits.includes(requestedSplit)) {
      return unsupportedState({
        missing: `split ${requestedSplit}`, reason: 'not published for this measure', source: 'server /schema',
        nearest: splits.includes('model') ? 'model' : (splits[0] || 'no split')
      });
    }
    const split = requestedSplit || (splits.includes('model') ? 'model' : '');
    const requestedChartValue = String(spec?.chart || 'columns');
    const chart = TREND_COLUMNS_CHARTS.includes(requestedChartValue) ? requestedChartValue : 'columns';
    const meta = measureMeta(schema, measure);
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const params = requestParams({
      scope, spec, measure, split, bucket: bucketChoice(scope, spec),
      extra: topMax ? { top: String(Math.min(100, topMax)) } : null
    });
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'trend-columns' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not available|range too wide/i.test(body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: body.error, source: 'server /schema', nearest: splits[0] || 'no split' });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const model = buildTrendChart({ body, measure, split, schema, chart });
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(body);
    const columns = trendTableColumns(meta.unit || 'USD');
    let paintedChart = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend';
      const node = doc.createElement('yk-chart');
      node.className = 'p10-trend-chart';
      node.spec = model.spec;
      node.data = model.rows;
      wireChartScope(node, panel.id, doc);
      const tableNode = table(doc, {
        caption: `${meta.label} per ${info.effective || 'bucket'}`,
        columns: columns.map((label, index) => index === 2 ? { label, numeric: true } : { label }),
        rows: trendLongRows(model)
      });
      const views = mountPanelViews({ panelId: panel.id, chart: node, table: tableNode, doc, defaultView: 'chart', label: 'Spend over time view' });
      views.element.removeAttribute('data-panel');
      wrapper.append(views.element);
      host.replaceChildren(wrapper);
      paintedChart = node;
    });
    await paintedChart?.whenSettled?.();
    const post = filterRefusal({ panel, spec, scope, schema, ignoredFilters: ignoredFrom(body) });
    if (post) return post;
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderChooserFields({
        panelId: panel.id,
        spec: { ...spec, measures: [measure], split, chart },
        doc,
        fields: [
          {
            label: 'Measure',
            value: measure,
            options: measures.map(name => ({ value: name, label: measureMeta(schema, name).label })),
            patch: value => ({ measures: [value] })
          },
          {
            label: 'Group by',
            value: split,
            options: [{ value: '', label: 'No grouping' }, ...splits.map(name => ({ value: name, label: dimensionLabel(name) }))],
            patch: value => ({ split: value })
          },
          {
            label: 'Chart', value: chart,
            options: [{ value: 'columns', label: 'Columns' }, { value: 'lines', label: 'Lines' }, { value: 'area', label: 'Area' }],
            patch: value => ({ chart: value })
          }
        ]
      }));
    });
    return {
      state: 'ready', measure, split, chart,
      bucket: info.effective, coarsened: info.coarsened,
      population: body.population || null,
      basis: `query ${info.effective || 'auto'} buckets; ${coarsenedText(body)}`,
      tableRows: trendLongRows(model)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_COLUMNS_PANEL = {
  id: 'trend-columns',
  title: 'Spend over time',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: TREND_COLUMNS_CHARTS,
  applies: ['repo_id', 'harness', 'kind', 'plan', 'model', 'tool', 'tool_kind', 'session_model', 'session_repo', 'source'],
  requires: [],
  caveats: 'Buckets are the server’s effective bucket; coarsening is named. A split is offered only when the measure publishes that dim. Zero-fill is shown only where the server supplied a zero.',
  measureBasis: 'artifact/event facts.ts bucket start',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model' } }],
  load
};

export default TREND_COLUMNS_PANEL;
