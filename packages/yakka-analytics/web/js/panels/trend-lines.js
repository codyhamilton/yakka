// `trend-lines`: the same request shape as trend-columns drawn as lines/areas.
// In `cmp=period` it requests the current window and the equal-length previous
// window and draws two named series in one chart, current first, aligned by
// offset. `win=all` with a period compare is unsupported with the contract's
// copy and never asks for a previous window.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, previousWindow } from './pulse-strips.js';
import { table } from './pulse-strips.js';
import {
  bucketInfo, chooserModel, coarsenedText, ensureP10Styles, measureMeta, populationLine,
  queryRows, requestParams, whenPanelBody, whenPanelSlot, renderChooser, windowParams, wireChartScope
} from './p10-shared.js';
import { chartShape, TREND_LENSES, TREND_MEASURES, trendTableRows } from './trend-columns.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

function iso(value) {
  return new Date(Number(value)).toISOString();
}

function previousParams({ scope, measure, split, extra }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
  const window = windowParams(previous);
  params.set('from', window.get('from'));
  params.set('to', window.get('to'));
  return { params, window: previous };
}

function currentLabel(scope) {
  const win = currentWindow(scope);
  if (!win) return 'Current period';
  return `Current period (${new Date(win.from).toISOString()} → ${new Date(win.to).toISOString()})`;
}

function previousLabel(scope) {
  const previous = previousWindow(scope);
  if (!previous) return 'Previous period';
  return `Previous period (${new Date(previous.from).toISOString()} → ${new Date(previous.to).toISOString()})`;
}

export function compareRows({ currentBody, previousBody, measure, split, schema, scope }) {
  const currentWindowValue = currentWindow(scope);
  const previousWindowValue = previousWindow(scope);
  const span = currentWindowValue && previousWindowValue ? currentWindowValue.from - previousWindowValue.from : 0;
  const current = queryRows(currentBody, measure, split, measureMeta(schema, measure));
  const previous = queryRows(previousBody, measure, split, measureMeta(schema, measure));
  const series = [
    { key: 'current', label: currentLabel(scope), unit: measureMeta(schema, measure).unit, kind: measureMeta(schema, measure).kind },
    { key: 'previous', label: previousLabel(scope), unit: measureMeta(schema, measure).unit, kind: measureMeta(schema, measure).kind }
  ];
  const byX = new Map();
  for (const row of current.rows) {
    byX.set(row.x, { key: `t:${row.x}`, x: row.x, values: { current: split ? sumValues(row.values, current.series) : row.values[measure] } });
  }
  for (const row of previous.rows) {
    const x = row.x + span;
    if (!byX.has(x)) byX.set(x, { key: `t:${x}`, x, values: {} });
    byX.get(x).values.previous = split ? sumValues(row.values, previous.series) : row.values[measure];
  }
  const rows = [...byX.values()].filter(row => row.values.current !== undefined || row.values.previous !== undefined).sort((a, b) => a.x - b.x);
  return { series, rows };
}

function sumValues(values, series) {
  let total = 0;
  let seen = false;
  for (const item of series) {
    const value = values[item.key];
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    total += Number(value);
    seen = true;
  }
  return seen ? total : null;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const compare = scope.cmp === 'period';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_LINES_PANEL;
    const chooser = chooserModel(panel, spec, schema);
    if (!chooser.measure) return unsupportedState({ missing: 'a published measure', reason: 'the grain publishes none', source: 'server /schema' });
    if (spec.split && !chooser.splits.includes(spec.split)) {
      return unsupportedState({ missing: `split ${spec.split}`, reason: 'not published for this measure', source: 'server /schema', nearest: chooser.splits[0] || 'no split' });
    }
    if (compare && !currentWindow(scope)) {
      return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    }
    const measure = chooser.measure;
    const split = chooser.split;
    const chart = chooser.chart === 'area' ? 'area' : 'lines';
    const shape = chartShape(chart);
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
    const response = await transport.get('query', params, { tenant, signal, stateKey: 'trend-lines' });
    if (!response.response.ok) {
      if (response.response.status === 400 && /unsupported|not available|range too wide/i.test(response.body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: response.body.error, source: 'server /schema', nearest: chooser.splits[0] || 'no split' });
      }
      return errorState({ message: response.body?.error || `The server returned ${response.response.status}.`, code: response.body?.code || '' });
    }
    let series;
    let rows;
    let previousBody = null;
    if (compare) {
      const previousRequest = previousParams({ scope, measure, split, extra });
      const previous = await transport.get('query', previousRequest.params, { tenant, signal, stateKey: 'trend-lines-previous' });
      if (!previous.response.ok) {
        return errorState({ message: previous.body?.error || `The server returned ${previous.response.status}.`, code: previous.body?.code || '' });
      }
      previousBody = previous.body;
      const compared = compareRows({ currentBody: response.body, previousBody, measure, split, schema, scope });
      series = compared.series;
      rows = compared.rows;
    } else {
      const mapped = queryRows(response.body, measure, split, measureMeta(schema, measure));
      series = mapped.series;
      rows = mapped.rows;
    }
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(response.body);
    const meta = measureMeta(schema, measure);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${coarsenedText(response.body)} Measure ${meta.label} (${meta.unit}). ${populationLine(response.body)}.${compare ? ` ${previousLabel(scope)} aligned by offset.` : ''}`;
      const node = doc.createElement('yk-chart');
      node.className = 'p10-trend-chart';
      node.spec = {
        chart: shape.chart,
        type: shape.type,
        mode: 'absolute',
        title: `${meta.label}${split ? ` by ${split}` : ''}`,
        units: meta.unit,
        timeBasis: 'artifact/event facts.ts bucket start; previous period aligned by offset',
        series,
        x: { label: compare ? 'Current time (previous aligned)' : 'Time', kind: 'time' },
        empty: 'no buckets in the current window'
      };
      node.data = rows;
      wireChartScope(node, panel.id, doc);
      const columns = [{ label: 'Bucket' }, ...series.map(item => ({ label: item.label, numeric: true }))];
      const tableRows = rows.map(row => [new Date(row.x).toISOString(), ...series.map(item => row.values[item.key] === null || row.values[item.key] === undefined ? '—' : String(row.values[item.key]))]);
      wrapper.append(basis, node, table(doc, { caption: `${measure} per bucket`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split, chart }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split, chart,
      bucket: info.effective, coarsened: info.coarsened,
      compare,
      population: response.body.population || null,
      previousPopulation: previousBody?.population || null,
      basis: `query ${info.effective || 'auto'} buckets${compare ? '; previous equal-length window aligned by offset' : ''}`,
      tableRows: trendTableRows({ rows, series })
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_LINES_PANEL = {
  id: 'trend-lines',
  title: 'Trend lines',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: ['lines', 'area'],
  requires: [],
  caveats: 'Period overlay names both windows and aligns the previous period by offset. All-history has no previous period.',
  measureBasis: 'artifact/event facts.ts bucket start; period overlay is the equal length immediately before',
  requests: () => [
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model' } },
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model', window: 'previous' } }
  ],
  load
};

export default TREND_LINES_PANEL;
