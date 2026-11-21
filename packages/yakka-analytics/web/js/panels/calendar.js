// `calendar`: day-by-week calendar of one supported measure, drawn by the
// existing `<yk-matrix type="calendar">`. A drag emits a day-snapped interval as
// transient `sel` and shows a labelled peer preview; Zoom to selection (or a
// double-click) commits `from`/`to`, pushes history and clears `sel`.

import '../charts/yk-matrix.js';
import { formatCount, formatMoney } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import { decodeUrlState, encodeUrlState } from '../../contract/url-state.js';
import { emptyCausesFor, ensurePulseStyles, filterRefusal, scopeParams, table, whenPanelBody } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import { mountPanelViews } from './p10-shared.js';

const MEASURES = ['cost_usd', 'model_calls', 'commits'];
const MEASURE_LABELS = { cost_usd: 'Cost', model_calls: 'Model calls', commits: 'Commits' };
const MEASURE_UNITS = { cost_usd: 'USD', model_calls: 'calls', commits: 'commits' };
const MEASURE_KINDS = { cost_usd: 'money', model_calls: 'count', commits: 'count' };
export const CALENDAR_CAPTION = 'Each square shows priced spend on one day; use the labelled colour scale to compare dollars spent.';
export function calendarTableColumns(measure = 'cost_usd') {
  return ['Date', `Value (${MEASURE_UNITS[measure] || ''})`];
}

registerCaption('calendar', ({ spec }) => {
  const measure = spec?.measures?.[0] || 'cost_usd';
  if (measure === 'cost_usd') return CALENDAR_CAPTION;
  return CAPTION_TEMPLATES.calendar({ measure, unit: MEASURE_UNITS[measure] || '' });
});

export function suggestedMeasures(schema) {
  const listed = schema?.grains?.time?.measures;
  if (!Array.isArray(listed) || !listed.length) return MEASURES.slice();
  const offered = MEASURES.filter(measure => listed.includes(measure));
  return offered.length ? offered : MEASURES.slice();
}

function iso(value) {
  return new Date(value).toISOString();
}

export function calendarRows(body, measure) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.map(row => {
    const time = Date.parse(row?.t);
    const value = row?.v === null || row?.v === undefined || !Number.isFinite(Number(row.v)) ? null : Number(row.v);
    return {
      key: `day:${row?.t}`,
      x: Number.isFinite(time) ? time : null,
      values: { [measure]: value },
      n: row?.n
    };
  }).filter(row => row.x !== null);
}

export function coarsenedLabel(body) {
  const requested = body?.requested?.bucket || 'day';
  const effective = body?.effective?.bucket || requested;
  return requested === effective ? `Cells are ${effective} buckets.` : `Requested ${requested} buckets; the server coarsened them to ${effective}.`;
}

function urlWith(mode, from, to, win) {
  const state = decodeUrlState(win.location.search);
  if (mode === 'transient') {
    state.from = '';
    state.to = '';
    state.win = '';
    state.sel = `${iso(from)}/${iso(to)}`;
  } else {
    state.sel = '';
    state.win = '';
    state.from = iso(from);
    state.to = iso(to);
  }
  const query = encodeUrlState(state, win.location.search).toString();
  return `${win.location.pathname}${query ? `?${query}` : ''}`;
}

function renderCalendar(host, result, doc, context) {
  ensurePulseStyles(doc);
  const win = doc.defaultView;
  const wrapper = doc.createElement('div');
  wrapper.className = 'pulse-calendar';

  if (context.measures.length > 1) {
    const chooserLabel = doc.createElement('label');
    chooserLabel.className = 'pulse-chooser';
    chooserLabel.append(doc.createTextNode('Measure '));
    const chooser = doc.createElement('select');
    chooser.setAttribute('aria-label', 'Calendar measure');
    for (const measure of context.measures) {
      const option = doc.createElement('option');
      option.value = measure;
      option.textContent = MEASURE_LABELS[measure] || measure;
      option.selected = measure === result.measure;
      chooser.append(option);
    }
    chooser.addEventListener('change', () => context.refresh?.(chooser.value));
    chooserLabel.append(chooser);
    wrapper.append(chooserLabel);
  }

  const chartHost = doc.createElement('div');
  chartHost.className = 'pulse-calendar-chart';
  const chart = doc.createElement('yk-matrix');
  chart.className = 'pulse-calendar-matrix';
  chart.setAttribute('aria-label', `${MEASURE_LABELS[result.measure]} by day`);
  chartHost.append(chart);

  const controls = doc.createElement('div');
  controls.className = 'pulse-calendar-controls';
  const preview = doc.createElement('p');
  preview.className = 'pulse-preview';
  preview.dataset.state = 'idle';
  preview.textContent = 'Drag across the calendar to preview a peer interval.';
  const zoom = doc.createElement('button');
  zoom.type = 'button';
  zoom.className = 'pulse-zoom';
  zoom.textContent = 'Zoom to selection';
  zoom.disabled = true;
  controls.append(preview, zoom);
  chartHost.append(controls);

  const ordered = result.rows.slice().sort((a, b) => a.x - b.x);
  const value = row => row.values[result.measure] === null || row.values[result.measure] === undefined
    ? '—'
    : result.measure === 'cost_usd' ? formatMoney(Number(row.values[result.measure])) : formatCount(Number(row.values[result.measure]), { unit: '' });
  const tableNode = table(doc, {
    caption: `Daily ${MEASURE_LABELS[result.measure]}`,
    columns: calendarTableColumns(result.measure).map((label, index) => ({ label, numeric: index === 1 })),
    rows: ordered.map(row => [new Date(row.x).toISOString().slice(0, 10), value(row)])
  });
  const views = mountPanelViews({ panelId: 'calendar', chart: chartHost, table: tableNode, doc, defaultView: 'chart', label: 'Daily spend view' });
  views.element.removeAttribute('data-panel');
  wrapper.append(views.element);
  wrapper.append(elNote(doc, 'pulse-note pulse-calendar-caveat', 'Heatmap cells and calendar days share entity keys by design: a selected day key highlights every cell for it and the table repeats the key.'));
  wrapper.append(elNote(doc, 'pulse-note', `Basis: ${coarsenedLabel(context.body)} Measure ${MEASURE_LABELS[result.measure]} (${MEASURE_UNITS[result.measure]}).`));
  host.replaceChildren(wrapper);

  chart.spec = {
    chart: 'matrix',
    type: 'calendar',
    title: `${MEASURE_LABELS[result.measure]} calendar`,
    timeBasis: 'artifact/event facts.ts bucket start',
    series: [{ key: result.measure, label: MEASURE_LABELS[result.measure], unit: MEASURE_UNITS[result.measure], kind: MEASURE_KINDS[result.measure] }]
  };
  chart.data = result.rows;

  let brushed = null;
  function showPreview(from, to) {
    const days = Math.max(1, Math.round((to - from) / 86400e3));
    preview.dataset.state = 'preview';
    preview.textContent = `Selected ${iso(from)} → ${iso(to)} (${days} day${days === 1 ? '' : 's'}). Peer preview only; scope changes on Zoom to selection or double-click.`;
    zoom.disabled = false;
  }
  chart.addEventListener('brush', event => {
    const detail = event.detail || {};
    if (!Number.isFinite(detail.from) || !Number.isFinite(detail.to) || detail.to <= detail.from) {
      brushed = null;
      preview.dataset.state = 'idle';
      preview.textContent = 'Drag across the calendar to preview a peer interval.';
      zoom.disabled = true;
      return;
    }
    brushed = { from: Math.min(detail.from, detail.to), to: Math.max(detail.from, detail.to) };
    showPreview(brushed.from, brushed.to);
    if (win) win.history.replaceState(null, '', urlWith('transient', brushed.from, brushed.to, win));
  });

  function commit() {
    if (!brushed || !win) return;
    win.history.pushState(null, '', urlWith('commit', brushed.from, brushed.to, win));
    win.dispatchEvent(new PopStateEvent('popstate'));
  }
  zoom.addEventListener('click', commit);
  chart.addEventListener('dblclick', commit);

  return chart;
}

function elNote(doc, className, text) {
  const node = doc.createElement('p');
  node.className = className;
  node.textContent = text;
  return node;
}

export async function load({ scope = {}, spec = {}, transport, tenant, signal, doc = globalThis.document, clear = null, schema = null } = {}) {
  spec = spec || {};
  ensurePulseStyles(doc);
  try {
    const resolvedSchema = schema || (await transport.schema(tenant)).body;
    const refusal = filterRefusal({ panel: CALENDAR_PANEL, spec, scope, schema: resolvedSchema });
    if (refusal) return refusal;
    const measures = suggestedMeasures(resolvedSchema);
    let measure = (spec.measures || [])[0];
    if (!measures.includes(measure)) measure = measures.includes('cost_usd') ? 'cost_usd' : measures[0];
    const params = scopeParams(scope);
    params.set('measure', measure);
    params.set('bucket', 'day');
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'calendar' });
    if (!response.ok) {
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const lateRefusal = filterRefusal({
      panel: CALENDAR_PANEL, spec, scope, schema: resolvedSchema,
      ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters : []
    });
    if (lateRefusal) return lateRefusal;
    const rows = calendarRows(body, measure);
    if (!rows.length) {
      whenPanelBody('calendar', doc, host => host.replaceChildren());
      const causes = emptyCausesFor(scope, clear);
      if (!causes.length) causes.push({ kind: 'scope', label: `no ${measure} buckets in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    const result = {
      state: 'ready',
      measure,
      rows,
      bucket: body?.effective?.bucket || 'day',
      coarsened: (body?.requested?.bucket || 'day') !== (body?.effective?.bucket || 'day'),
      population: body?.population || null,
      basis: `query day buckets; ${coarsenedLabel(body)}`
    };
    const context = {
      measures,
      body,
      refresh: nextMeasure => load({ scope, spec: { ...spec, measures: [nextMeasure] }, transport, tenant, doc, signal: undefined, clear })
    };
    whenPanelBody('calendar', doc, host => renderCalendar(host, result, doc, context));
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The calendar query failed.' });
  }
}

export const CALENDAR_PANEL = {
  id: 'calendar',
  title: 'Daily spend',
  grain: 'time',
  measures: MEASURES,
  lenses: ['id'],
  charts: ['calendar'],
  applies: ['repo_id'],
  requires: [],
  caveats: 'Day-by-week calendar from day buckets; the panel names any server coarsening. Default measure is priced spend. Heatmap cells and calendar days share entity keys by design, so a day key highlights every cell for it.',
  measureBasis: 'artifact/event facts.ts bucket start',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'day' } }],
  load
};

export default CALENDAR_PANEL;
