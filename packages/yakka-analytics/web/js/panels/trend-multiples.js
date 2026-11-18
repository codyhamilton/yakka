// `trend-multiples`: one chart per split value (small multiples). `top` bounds
// the chart count by the published budget; the remainder of the response's top
// groups is named as omitted. Compare plus a split stays small multiples, never
// one overlaid chart.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, previousWindow } from './pulse-strips.js';
import { table } from './pulse-strips.js';
import {
  bucketInfo, chooserModel, coarsenedText, ensureP10Styles, measureMeta, populationLine,
  queryRows, requestParams, whenPanelBody, whenPanelSlot, renderChooser, windowParams, wireChartScope
} from './p10-shared.js';
import { TREND_LENSES, TREND_MEASURES } from './trend-columns.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

function previousRequest({ scope, measure, split, extra }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
  const window = windowParams(previous);
  params.set('from', window.get('from'));
  params.set('to', window.get('to'));
  return params;
}

function groupRows(mapped, groupKey, measure, split) {
  if (!split) return mapped.rows;
  const seriesKey = `${split}:${groupKey}`;
  return mapped.rows.map(row => ({
    key: row.key,
    x: row.x,
    values: { [measure]: row.values[seriesKey] === undefined ? null : row.values[seriesKey] }
  }));
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const compare = scope.cmp === 'period';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_MULTIPLES_PANEL;
    const chooser = chooserModel(panel, spec, schema);
    if (!chooser.measure) return unsupportedState({ missing: 'a published measure', reason: 'the grain publishes none', source: 'server /schema' });
    if (spec.split && !chooser.splits.includes(spec.split)) {
      return unsupportedState({ missing: `split ${spec.split}`, reason: 'not published for this measure', source: 'server /schema', nearest: chooser.splits[0] || 'no split' });
    }
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    const measure = chooser.measure;
    const split = chooser.split;
    const chart = chooser.chart === 'area' ? 'area' : 'lines';
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
    const response = await transport.get('query', params, { tenant, signal, stateKey: 'trend-multiples' });
    if (!response.response.ok) {
      if (response.response.status === 400 && /unsupported|not available|range too wide/i.test(response.body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: response.body.error, source: 'server /schema', nearest: chooser.splits[0] || 'no split' });
      }
      return errorState({ message: response.body?.error || `The server returned ${response.response.status}.`, code: response.body?.code || '' });
    }
    const meta = measureMeta(schema, measure);
    const mapped = queryRows(response.body, measure, split, meta);
    let previousMapped = null;
    let span = 0;
    if (compare) {
      const previous = await transport.get('query', previousRequest({ scope, measure, split, extra }), { tenant, signal, stateKey: 'trend-multiples-previous' });
      if (!previous.response.ok) return errorState({ message: previous.body?.error || `The server returned ${previous.response.status}.`, code: previous.body?.code || '' });
      previousMapped = queryRows(previous.body, measure, split, meta);
      const current = currentWindow(scope);
      const before = previousWindow(scope);
      span = current && before ? current.from - before.from : 0;
    }
    const groups = split
      ? mapped.keys.filter(key => key !== '__other__' && key !== '')
      : [''];
    const omitted = Number(response.body.omitted_groups) || (mapped.keys.includes('__other__') ? 1 : 0);
    if (!mapped.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(response.body);
    const charts = groups.map(groupKey => {
      const currentRows = groupRows(mapped, groupKey, measure, split);
      let series = [{ key: measure, label: groupKey || meta.label, unit: meta.unit, kind: meta.kind }];
      let rows = currentRows;
      if (compare) {
        const previousRows = groupRows(previousMapped, groupKey, measure, split).map(row => ({ ...row, x: row.x + span }));
        const byX = new Map(currentRows.map(row => [row.x, { key: row.key, x: row.x, values: { current: row.values[measure] } }]));
        for (const row of previousRows) {
          if (!byX.has(row.x)) byX.set(row.x, { key: row.key, x: row.x, values: {} });
          byX.get(row.x).values.previous = row.values[measure];
        }
        rows = [...byX.values()].sort((a, b) => a.x - b.x);
        series = [
          { key: 'current', label: 'Current period', unit: meta.unit, kind: meta.kind },
          { key: 'previous', label: 'Previous period', unit: meta.unit, kind: meta.kind }
        ];
      }
      return { groupKey, series, rows };
    });
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend p10-multiples';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${coarsenedText(response.body)} Measure ${meta.label} (${meta.unit}). ${populationLine(response.body)}.`;
      wrapper.append(basis);
      for (const item of charts) {
        const node = doc.createElement('yk-chart');
        node.className = 'p10-trend-chart p10-multiple';
        node.dataset.group = item.groupKey || 'all';
        node.spec = {
          chart,
          type: chart === 'area' ? 'area' : 'line',
          mode: 'absolute',
          title: split ? `${meta.label} · ${item.groupKey}` : meta.label,
          units: meta.unit,
          timeBasis: 'artifact/event facts.ts bucket start',
          series: item.series,
          x: { label: 'Time', kind: 'time' }
        };
        node.data = item.rows;
        wireChartScope(node, panel.id, doc);
        wrapper.append(node);
      }
      if (omitted > 0) {
        const note = doc.createElement('p');
        note.className = 'p10-note';
        note.textContent = `${omitted} further group${omitted === 1 ? '' : 's'} omitted from the returned top groups; lower the split cardinality or raise the server top budget to see them.`;
        wrapper.append(note);
      }
      const columns = [{ label: 'Bucket' }, ...charts.map(item => ({ label: item.groupKey || 'all', numeric: true }))];
      const tableRows = (mapped.rows || []).map(row => [
        new Date(row.x).toISOString(),
        ...charts.map(item => {
          const values = split ? row.values[`${split}:${item.groupKey}`] : row.values[measure];
          return values === undefined || values === null ? '—' : String(values);
        })
      ]);
      wrapper.append(table(doc, { caption: `${measure} per bucket, one chart per split value`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split, chart }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split, chart, compare,
      groups: groups.length, omitted,
      bucket: info.effective, coarsened: info.coarsened,
      population: response.body.population || null,
      previousPopulation: null,
      basis: `query ${info.effective || 'auto'} buckets, ${groups.length} small multiple${groups.length === 1 ? '' : 's'}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_MULTIPLES_PANEL = {
  id: 'trend-multiples',
  title: 'Trend multiples',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: ['lines', 'area'],
  requires: [],
  caveats: 'One chart per split value, bounded by the published top budget. Omitted groups are named; compare plus split stays small multiples.',
  measureBasis: 'artifact/event facts.ts bucket start',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model', top: 20 } }],
  load
};

export default TREND_MULTIPLES_PANEL;
