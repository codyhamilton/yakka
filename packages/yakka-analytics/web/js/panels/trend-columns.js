// `trend-columns`: any published count/usage measure per bucket, optionally
// stacked by a supported split lens. Buckets come from `bucket=auto`; the
// response's effective bucket and any coarsening are named. A measure with no
// published split shows the unsupported pairing with its source instead of a
// fake split.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import {
  bucketInfo, chooserModel, coarsenedText, ensureP10Styles, measureMeta, populationLine,
  queryRows, requestParams, whenPanelBody, whenPanelSlot, renderChooser, wireChartScope
} from './p10-shared.js';

export const TREND_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions',
  'distinct_content', 'commits', 'rejections'
];

export const TREND_LENSES = ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan', 'source'];

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

export function trendTableRows(model) {
  return model.rows.map(row => [
    new Date(row.x).toISOString(),
    ...model.series.map(series => row.values[series.key] === undefined || row.values[series.key] === null ? '—' : String(row.values[series.key]))
  ]);
}

function bucketChoice(scope, spec) {
  const requested = spec?.bucket || spec?.scope?.bucket || '';
  if (['hour', 'day', 'week', 'month'].includes(requested)) return requested;
  return 'auto';
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal, clear = null } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_COLUMNS_PANEL;
    const chooser = chooserModel(panel, spec, schema);
    if (!chooser.measure) {
      return unsupportedState({ missing: 'a published measure', reason: 'the grain publishes none', source: 'server /schema' });
    }
    if (spec.split && !chooser.splits.includes(spec.split)) {
      return unsupportedState({
        missing: `split ${spec.split}`, reason: 'not published for this measure', source: 'server /schema',
        nearest: chooser.splits[0] || 'no split'
      });
    }
    const measure = chooser.measure;
    const split = chooser.split;
    const chart = chooser.chart || 'columns';
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const params = requestParams({
      scope, spec, measure, split, bucket: bucketChoice(scope, spec),
      extra: topMax ? { top: String(Math.min(100, topMax)) } : null
    });
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'trend-columns' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not available|range too wide/i.test(body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: body.error, source: 'server /schema', nearest: chooser.splits[0] || 'no split' });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const model = buildTrendChart({ body, measure, split, schema, chart });
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(body);
    const contextForPaint = { model, body, measure, split, schema, chart };
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${coarsenedText(body)} Measure ${measureMeta(schema, measure).label} (${measureMeta(schema, measure).unit}). ${populationLine(body)}.`;
      const node = doc.createElement('yk-chart');
      node.className = 'p10-trend-chart';
      node.spec = model.spec;
      node.data = model.rows;
      wireChartScope(node, panel.id, doc);
      const columns = [{ label: 'Bucket' }, ...model.series.map(series => ({ label: series.label, numeric: true }))];
      wrapper.append(basis, node, table(doc, { caption: `${measure} per ${info.effective || 'bucket'}`, columns, rows: trendTableRows(model) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split, chart }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split, chart,
      bucket: info.effective, coarsened: info.coarsened,
      population: body.population || null,
      basis: `query ${info.effective || 'auto'} buckets; ${coarsenedText(body)}`,
      tableRows: trendTableRows(model)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_COLUMNS_PANEL = {
  id: 'trend-columns',
  title: 'Trend columns',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: ['columns', 'lines', 'cumulative', 'share'],
  requires: [],
  caveats: 'Buckets are the server’s effective bucket; coarsening is named. A split is offered only when the measure publishes that dim. Zero-fill is shown only where the server supplied a zero.',
  measureBasis: 'artifact/event facts.ts bucket start',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model' } }],
  load
};

export default TREND_COLUMNS_PANEL;
