// `trend-multiples`: one lines chart per split value (small multiples). The
// caption and defaults are the G-multiples contract: priced spend per model,
// with every chart on the same time and value scale.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, filterRefusal, previousWindow, table, windowParams } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import {
  bucketInfo, comparisonPlan, ensureP10Styles, measureMeta, mountPanelViews, offeredMeasures, offeredSplit,
  queryRows, requestParams, whenPanelBody, whenPanelSlot, wireChartScope
} from './p10-shared.js';
import { dimensionLabel, renderChooserFields, TREND_LENSES, TREND_MEASURES } from './trend-columns.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

export const multiplesTableColumns = (unit = 'USD') => ['Group', 'Bucket', `Value (${unit})`];

export const TREND_MULTIPLES_CAPTION = 'Each small chart shows one model’s priced spend over time on the same scale; compare heights across charts.';

registerCaption('trend-multiples', ({ spec = {}, schema = null } = {}) => {
  const key = spec?.scope?.captionKey;
  const measure = (spec.measures || [])[0] || 'cost_usd';
  const split = spec.split || 'model';
  if (key === 'G-multiples' || (measure === 'cost_usd' && split === 'model')) return TREND_MULTIPLES_CAPTION;
  return CAPTION_TEMPLATES['small multiples']({
    measure, group: split || 'all', unit: measureMeta(schema, measure).unit || ''
  });
});

function iso(value) {
  return new Date(Number(value)).toISOString();
}

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

function ignoredFrom(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
}

// One Y domain for every small multiple. It spans every group and, in a period
// compare, both the current and previous series so heights compare across charts.
export function multiplesYRange(charts = []) {
  let max = 0;
  for (const item of charts) {
    for (const row of item.rows || []) {
      for (const series of item.series || []) {
        const value = Number(row.values?.[series.key]);
        if (Number.isFinite(value)) max = Math.max(max, value);
      }
    }
  }
  return max > 0 ? { min: 0, max } : null;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const plan = comparisonPlan(scope);
  if (plan.unsupported) return unsupportedState({ missing: 'comparison', reason: plan.unsupported, source: 'scope' });
  const compare = plan.mode === 'period';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_MULTIPLES_PANEL;
    const refusal = filterRefusal({ panel, spec, scope, schema });
    if (refusal) return refusal;
    const measures = offeredMeasures(panel, schema);
    const requestedMeasure = (spec.measures || [])[0] || '';
    if (requestedMeasure && !measures.includes(requestedMeasure)) {
      return unsupportedState({ missing: requestedMeasure, reason: 'not published for the time grain', source: 'server /schema', nearest: measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || null) });
    }
    const measure = requestedMeasure || (measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || ''));
    if (!measure) return unsupportedState({ missing: 'a published measure', reason: 'the grain publishes none', source: 'server /schema' });
    const splits = offeredSplit(panel, measure, schema);
    const requestedSplit = spec.split || '';
    if (requestedSplit && !splits.includes(requestedSplit)) {
      return unsupportedState({ missing: `split ${requestedSplit}`, reason: 'not published for this measure', source: 'server /schema', nearest: splits.includes('model') ? 'model' : (splits[0] || 'no split') });
    }
    const split = requestedSplit || (splits.includes('model') ? 'model' : '');
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    const meta = measureMeta(schema, measure);
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
    const response = await transport.get('query', params, { tenant, signal, stateKey: 'trend-multiples' });
    if (!response.response.ok) {
      if (response.response.status === 400 && /unsupported|not available|range too wide/i.test(response.body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: response.body.error, source: 'server /schema', nearest: splits[0] || 'no split' });
      }
      return errorState({ message: response.body?.error || `The server returned ${response.response.status}.`, code: response.body?.code || '' });
    }
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
    const groups = (split ? mapped.keys.filter(key => key !== '__other__' && key !== '') : ['']).sort((a, b) => String(a).localeCompare(String(b)));
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
          { key: 'previous', label: 'Previous period', unit: meta.unit, kind: meta.kind, dash: 'dashed' }
        ];
      }
      return { groupKey, series, rows };
    });
    const yRange = multiplesYRange(charts);
    const tableRows = [];
    for (const item of charts) {
      for (const row of item.rows) {
        for (const series of item.series) {
          const value = row.values[series.key];
          tableRows.push([item.groupKey || 'all', iso(row.x), value === null || value === undefined ? '—' : String(value), series.label]);
        }
      }
    }
    tableRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[3].localeCompare(b[3]));
    const painted = [];
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend p10-multiples';
      for (const item of charts) {
        const section = doc.createElement('div');
        section.className = 'p10-multiple';
        section.dataset.group = item.groupKey || 'all';
        const node = doc.createElement('yk-chart');
        node.className = 'p10-trend-chart p10-multiple-chart';
        node.dataset.group = item.groupKey || 'all';
        node.spec = {
          chart: 'lines', type: 'line', mode: 'absolute',
          title: split ? `${meta.label} · ${item.groupKey}` : meta.label,
          units: meta.unit,
          timeBasis: 'artifact/event facts.ts bucket start',
          scaleGroup: `trend-multiples:${measure}:${split}`,
          ...(yRange ? { yRange } : {}),
          series: item.series,
          x: {
            label: 'Time', kind: 'time', timeZone: scope.tz || 'UTC',
            ...(compare ? { axisMode: 'elapsed', axisOrigin: currentWindow(scope)?.from } : {})
          },
          empty: 'no buckets in the current window'
        };
        node.data = item.rows;
        wireChartScope(node, panel.id, doc);
        section.append(node);
        wrapper.append(section);
        painted.push(node);
      }
      if (omitted > 0) {
        const note = doc.createElement('p');
        note.className = 'p10-note';
        note.textContent = `${omitted} further group${omitted === 1 ? '' : 's'} omitted from the returned top groups; lower the split cardinality or raise the server top budget to see them.`;
        wrapper.append(note);
      }
      const columns = multiplesTableColumns(meta.unit || 'USD');
      const tableNode = table(doc, {
        caption: `${meta.label} per group and bucket`,
        columns: columns.map((label, index) => index === 2 ? { label, numeric: true } : { label }),
        rows: tableRows.map(row => row.slice(0, 3))
      });
      const views = mountPanelViews({ panelId: panel.id, chart: wrapper, table: tableNode, doc, defaultView: 'chart', label: 'Spend by model small multiples view' });
      views.element.removeAttribute('data-panel');
      host.replaceChildren(views.element);
    });
    await Promise.all(painted.map(node => node?.whenSettled?.()).filter(Boolean));
    const post = filterRefusal({ panel, spec, scope, schema, ignoredFilters: ignoredFrom(response.body) });
    if (post) return post;
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const fields = [
        {
          label: 'Measure', value: measure,
          options: measures.map(name => ({ value: name, label: measureMeta(schema, name).label })),
          patch: value => ({ measures: [value] })
        },
        {
          label: 'Group by', value: split,
          options: [{ value: '', label: 'No grouping' }, ...splits.map(name => ({ value: name, label: dimensionLabel(name) }))],
          patch: value => ({ split: value })
        }
      ];
      slot.replaceChildren(renderChooserFields({ panelId: panel.id, spec: { ...spec, measures: [measure], split, chart: 'lines' }, doc, fields }));
    });
    return {
      state: 'ready', measure, split, chart: 'lines', compare,
      groups: groups.length, omitted,
      bucket: info.effective, coarsened: info.coarsened,
      population: response.body.population || null,
      previousPopulation: null,
      basis: `query ${info.effective || 'auto'} buckets, ${groups.length} small multiple${groups.length === 1 ? '' : 's'}`,
      tableRows: tableRows.map(row => row.slice(0, 3))
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_MULTIPLES_PANEL = {
  id: 'trend-multiples',
  title: 'One spend chart per model',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: ['lines'],
  applies: ['repo_id', 'harness', 'kind', 'plan', 'model', 'tool', 'tool_kind', 'session_model', 'session_repo', 'source'],
  requires: [],
  caveats: 'One chart per split value, bounded by the published top budget. Omitted groups are named; every chart shares the time and value scale.',
  measureBasis: 'artifact/event facts.ts bucket start',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'auto', dim: 'model', top: 20 } }],
  load
};

export default TREND_MULTIPLES_PANEL;
