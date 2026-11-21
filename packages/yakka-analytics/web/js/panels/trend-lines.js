// `trend-lines`: priced model spend over time as lines/areas, and in
// `cmp=period` the current and previous equal-length periods aligned by elapsed
// position. The caption and defaults are the G-lines and G-complines contracts.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, filterRefusal, previousWindow, table, windowParams } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import {
  bucketInfo, comparisonPlan, comparisonSummary, ensureP10Styles, measureMeta, mountPanelViews,
  offeredMeasures, offeredSplit, populationLine, queryRows, requestParams, whenPanelBody, whenPanelSlot, wireChartScope
} from './p10-shared.js';
import {
  chartShape, dimensionLabel, paintCumulativeRefusal, renderChooserFields, TREND_LENSES, TREND_MEASURES, trendTableColumns
} from './trend-columns.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';
const CHARTS = ['lines', 'area'];

export const TREND_LINES_CAPTION = 'Each line shows a model’s priced spend over time; higher points mean more dollars spent in that bucket.';
export const TREND_COMPLINES_CAPTION = 'Each line shows priced spend in the selected or previous equal-length period; matching elapsed positions compare the same point within each period.';

registerCaption('trend-lines', ({ spec = {}, schema = null, result = null, scope = null } = {}) => {
  const key = spec?.scope?.captionKey;
  const measure = (spec.measures || [])[0] || 'cost_usd';
  const split = spec.split || 'model';
  const chart = spec.chart || 'lines';
  const compare = (scope?.cmp || spec?.scope?.cmp) === 'period';
  const defaultPair = measure === 'cost_usd' && split === 'model' && chart === 'lines';
  if (key === 'G-complines' || (compare && defaultPair)) return TREND_COMPLINES_CAPTION;
  if (key === 'G-lines' || !compare) {
    if (defaultPair) return TREND_LINES_CAPTION;
  }
  return CAPTION_TEMPLATES['lines/area']({
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

function currentLabel(scope) {
  const win = currentWindow(scope);
  if (!win) return 'Current period';
  return `Current period (${iso(win.from)} → ${iso(win.to)})`;
}

function previousLabel(scope) {
  const previous = previousWindow(scope);
  if (!previous) return 'Previous period';
  return `Previous period (${iso(previous.from)} → ${iso(previous.to)})`;
}

export function compareRows({ currentBody, previousBody, measure, split, schema, scope }) {
  const currentWindowValue = currentWindow(scope);
  const previousWindowValue = previousWindow(scope);
  const span = currentWindowValue && previousWindowValue ? currentWindowValue.from - previousWindowValue.from : 0;
  const meta = measureMeta(schema, measure);
  const current = queryRows(currentBody, measure, split, meta);
  const previous = queryRows(previousBody, measure, split, meta);
  const series = [
    { key: 'current', label: currentLabel(scope), unit: meta.unit, kind: meta.kind },
    { key: 'previous', label: previousLabel(scope), unit: meta.unit, kind: meta.kind }
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
  const rows = [...byX.values()]
    .filter(row => row.values.current !== undefined || row.values.previous !== undefined)
    .sort((a, b) => a.x - b.x);
  return { series, rows, span, current, previous };
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

function longRows(rows, series) {
  const ordered = [...series].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  const out = [];
  for (const row of rows) {
    for (const item of ordered) {
      const value = row.values[item.key];
      out.push([iso(row.x), item.label, value === null || value === undefined ? '—' : String(value)]);
    }
  }
  return out;
}

function ignoredFrom(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const requestedChart = String(spec?.chart || '');
  if (requestedChart === 'cumulative' || requestedChart === 'share') {
    return paintCumulativeRefusal({ spec, doc, panelId: TREND_LINES_PANEL.id });
  }
  const plan = comparisonPlan(scope);
  if (plan.unsupported) return unsupportedState({ missing: 'comparison', reason: plan.unsupported, source: 'scope' });
  const compare = plan.mode === 'period';
  const cohortCompare = plan.mode === 'cohorts';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || TREND_LINES_PANEL;
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
    const chart = compare || cohortCompare || requestedChart === 'area' ? (requestedChart === 'area' && !compare && !cohortCompare ? 'area' : 'lines') : 'lines';
    if (compare || cohortCompare) {
      if (requestedChart && !CHARTS.includes(requestedChart) && requestedChart !== 'lines') {
        return unsupportedState({ missing: `chart ${requestedChart}`, reason: 'only lines are offered for a period comparison', source: 'chart kit', nearest: 'lines' });
      }
    }
    const shape = chartShape(chart);
    const meta = measureMeta(schema, measure);
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const params = requestParams({ scope, measure, split, bucket: 'auto', extra });
    const response = await transport.get('query', params, { tenant, signal, stateKey: cohortCompare ? 'trend-lines-a' : 'trend-lines' });
    if (!response.response.ok) {
      if (response.response.status === 400 && /unsupported|not available|range too wide/i.test(response.body?.error || '')) {
        return unsupportedState({ missing: `${measure}${split ? ` by ${split}` : ''}`, reason: response.body.error, source: 'server /schema', nearest: splits[0] || 'no split' });
      }
      return errorState({ message: response.body?.error || `The server returned ${response.response.status}.`, code: response.body?.code || '' });
    }
    let series;
    let rows;
    let charts = null;
    let previousBody = null;
    let tableRows;
    let summary = '';
    if (cohortCompare) {
      const bParams = requestParams({ scope, measure, split, bucket: 'auto', extra, cohort: plan.b || null });
      const other = await transport.get('query', bParams, { tenant, signal, stateKey: 'trend-lines-b' });
      if (!other.response.ok) return errorState({ message: other.body?.error || `The server returned ${other.response.status}.`, code: other.body?.code || '' });
      previousBody = other.body;
      const mappedA = queryRows(response.body, measure, split, meta);
      const mappedB = queryRows(previousBody, measure, split, meta);
      const groups = split
        ? [...new Set([...mappedA.keys, ...mappedB.keys])].filter(key => key !== '__other__' && key !== '')
        : [''];
      charts = groups.map(group => {
        const key = split ? `${split}:${group}` : measure;
        const byX = new Map();
        for (const row of mappedA.rows) {
          const value = row.values[key];
          if (value === undefined) continue;
          byX.set(row.x, { key: row.key, x: row.x, values: { a: value } });
        }
        for (const row of mappedB.rows) {
          const value = row.values[key];
          if (value === undefined) continue;
          if (!byX.has(row.x)) byX.set(row.x, { key: row.key, x: row.x, values: {} });
          byX.get(row.x).values.b = value;
        }
        return {
          group,
          series: [
            { key: 'a', label: plan.aLabel, unit: meta.unit, kind: meta.kind },
            { key: 'b', label: plan.bLabel, unit: meta.unit, kind: meta.kind }
          ],
          rows: [...byX.values()].sort((a, b) => a.x - b.x)
        };
      });
      series = charts[0]?.series || [];
      rows = charts.flatMap(item => item.rows);
      summary = comparisonSummary({ plan, sides: { a: response.body, b: previousBody }, unit: meta.unit }).text;
      tableRows = charts.flatMap(item => item.rows.flatMap(row => {
        const out = [];
        if (row.values.a !== undefined) out.push([iso(row.x), `${item.group || 'all'} · ${plan.aLabel}`, String(row.values.a)]);
        if (row.values.b !== undefined) out.push([iso(row.x), `${item.group || 'all'} · ${plan.bLabel}`, String(row.values.b)]);
        return out;
      })).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    } else if (compare) {
      const previous = await transport.get('query', previousRequest({ scope, measure, split, extra }), { tenant, signal, stateKey: 'trend-lines-previous' });
      if (!previous.response.ok) return errorState({ message: previous.body?.error || `The server returned ${previous.response.status}.`, code: previous.body?.code || '' });
      previousBody = previous.body;
      const compared = compareRows({ currentBody: response.body, previousBody, measure, split, schema, scope });
      series = compared.series;
      rows = compared.rows;
      tableRows = [];
      for (const row of compared.rows) {
        const items = [
          { label: currentLabel(scope), key: 'current', offset: 0 },
          { label: previousLabel(scope), key: 'previous', offset: -compared.span }
        ];
        for (const item of items) {
          const value = row.values[item.key];
          if (value === undefined) continue;
          tableRows.push([iso(row.x + item.offset), item.label, value === null ? '—' : String(value)]);
        }
      }
      tableRows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    } else {
      const mapped = queryRows(response.body, measure, split, meta);
      series = mapped.series;
      rows = mapped.rows;
      tableRows = longRows(rows, series);
    }
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null }]);
    }
    const info = bucketInfo(response.body);
    const columns = trendTableColumns(meta.unit || 'USD');
    const painted = [];
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-trend';
      const chartHost = doc.createElement('div');
      if (charts) {
        chartHost.className = 'p10-multiples';
        for (const item of charts) {
          const section = doc.createElement('div');
          section.className = 'p10-split-group';
          section.dataset.split = item.group || 'all';
          const node = doc.createElement('yk-chart');
          node.className = 'p10-trend-chart';
          node.dataset.split = item.group || 'all';
          node.spec = {
            chart: 'lines', type: 'line', mode: 'absolute',
            title: `${meta.label}${split ? ` by ${split} · ${item.group}` : ''} (${plan.aLabel} and ${plan.bLabel})`,
            units: meta.unit,
            timeBasis: 'artifact/event facts.ts bucket start',
            series: item.series,
            x: { label: 'Time', kind: 'time' },
            empty: 'no buckets in the current window'
          };
          node.data = item.rows;
          wireChartScope(node, panel.id, doc);
          section.append(node);
          chartHost.append(section);
          painted.push(node);
        }
      } else {
        const node = doc.createElement('yk-chart');
        node.className = 'p10-trend-chart';
        node.spec = {
          chart: shape.chart, type: shape.type, mode: 'absolute',
          title: `${meta.label}${split ? ` by ${split}` : ''}`,
          units: meta.unit,
          timeBasis: 'artifact/event facts.ts bucket start; previous period aligned by offset',
          series,
          x: { label: compare ? 'Elapsed offset (tooltip shows the actual date)' : 'Time', kind: 'time' },
          empty: 'no buckets in the current window'
        };
        node.data = rows;
        wireChartScope(node, panel.id, doc);
        chartHost.append(node);
        painted.push(node);
      }
      const tableNode = table(doc, {
        caption: `${meta.label} per bucket`,
        columns: columns.map((label, index) => index === 2 ? { label, numeric: true } : { label }),
        rows: tableRows
      });
      const views = mountPanelViews({ panelId: panel.id, chart: chartHost, table: tableNode, doc, defaultView: 'chart', label: 'Spend over time view' });
      views.element.removeAttribute('data-panel');
      wrapper.append(views.element);
      if (cohortCompare && summary) {
        const note = doc.createElement('p');
        note.className = 'p10-note';
        note.textContent = summary;
        wrapper.append(note);
      }
      host.replaceChildren(wrapper);
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
      if (!compare && !cohortCompare) {
        fields.push({
          label: 'Chart', value: chart,
          options: [{ value: 'lines', label: 'Lines' }, { value: 'area', label: 'Area' }],
          patch: value => ({ chart: value })
        });
      }
      slot.replaceChildren(renderChooserFields({ panelId: panel.id, spec: { ...spec, measures: [measure], split, chart }, doc, fields }));
    });
    return {
      state: 'ready', measure, split, chart,
      bucket: info.effective, coarsened: info.coarsened,
      compare, cohortCompare,
      groups: charts ? charts.length : (split ? queryRows(response.body, measure, split, meta).keys.length : 1),
      population: response.body.population || null,
      previousPopulation: previousBody?.population || null,
      basis: `query ${info.effective || 'auto'} buckets${compare ? '; previous equal-length window aligned by offset' : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`,
      tableRows
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The trend query failed.' });
  }
}

export const TREND_LINES_PANEL = {
  id: 'trend-lines',
  title: 'Spend by model over time',
  grain: 'time',
  measures: TREND_MEASURES,
  lenses: TREND_LENSES,
  charts: CHARTS,
  applies: ['repo_id', 'harness', 'kind', 'plan', 'model', 'tool', 'tool_kind', 'session_model', 'session_repo', 'source'],
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
