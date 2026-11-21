// `rhythm`: weekday-by-hour hook-event heat map. The caption and table are the
// G-rhythm contract; hook events, weekday and hour_of_day are fixed, and the
// panel offers no chooser.

import '../charts/yk-matrix.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { WEEKDAY_LABELS } from '../charts/yk-matrix.js';
import { filterRefusal, table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import {
  ensureP10Styles, measureMeta, mountPanelViews, populationLine, requestParams, whenPanelBody, whenPanelSlot
} from './p10-shared.js';

export const RHYTHM_CAPTION = 'Each square counts hook events for a weekday and hour in the selected timezone; use the labelled colour scale to compare event counts.';
export const RHYTHM_TABLE_COLUMNS = ['Weekday (Mon=1)', 'Hour (0–23)', 'Hook events'];
export const RHYTHM_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

registerCaption('rhythm', () => RHYTHM_CAPTION);

function weekdayIndex(value) {
  const index = Number(value);
  if (Number.isInteger(index) && index >= 0 && index < 7) return index;
  const named = WEEKDAY_LABELS.findIndex(day => String(day).toLowerCase() === String(value).toLowerCase());
  return named >= 0 ? named : null;
}

function weekdayLabel(value) {
  const index = weekdayIndex(value);
  return index === null ? String(value) : WEEKDAY_LABELS[index];
}

export function rhythmRows(body = {}) {
  const source = Array.isArray(body.rows) ? body.rows : [];
  return source.map(row => {
    const index = weekdayIndex(row.k?.[0]);
    const weekday = weekdayLabel(row.k?.[0]);
    const hour = Number(row.k?.[1]);
    const padded = Number.isFinite(hour) ? String(hour).padStart(2, '0') : String(row.k?.[1] ?? '');
    return {
      key: `rhythm:${weekday}:${padded}`,
      row: weekday,
      weekdayIndex: index,
      weekdayValue: index === null ? String(row.k?.[0] ?? '') : String(index + 1),
      column: padded,
      x: Number.isFinite(hour) ? hour : 0,
      values: { hook_events: row.v === null || row.v === undefined ? null : Number(row.v) },
      n: row.n
    };
  });
}

function ignoredFrom(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || RHYTHM_PANEL;
    const refusal = filterRefusal({ panel, spec, scope, schema });
    if (refusal) return refusal;
    const published = schema?.grains?.time?.measures || [];
    if (published.length && !published.includes('hook_events')) {
      return unsupportedState({ missing: 'hook_events', reason: 'not published for the time grain', source: 'server /schema' });
    }
    const meta = measureMeta(schema, 'hook_events');
    const params = requestParams({
      scope, spec, measure: 'hook_events', split: 'weekday', bucket: 'none',
      extra: { dim: ['hour_of_day'] }
    });
    const { response, body } = await transport.get('query', params, { tenant, signal, stateKey: 'rhythm' });
    if (!response.ok) {
      if (response.status === 400) return unsupportedState({ missing: 'weekday by hour_of_day', reason: body?.error || 'unsupported dimension', source: 'server /schema' });
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || '' });
    }
    const rows = rhythmRows(body).sort((a, b) => {
      const left = a.weekdayIndex ?? 7;
      const right = b.weekdayIndex ?? 7;
      return left - right || a.column.localeCompare(b.column);
    });
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no hook events in window ${scope.win || 'all'}`, clear: null }]);
    }
    const weekdayKeys = [...new Set(rows.map(row => row.row))].sort((a, b) => WEEKDAY_LABELS.indexOf(a) - WEEKDAY_LABELS.indexOf(b));
    const hourKeys = [...new Set(rows.map(row => row.column))].sort();
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-rhythm';
      const node = doc.createElement('yk-matrix');
      node.className = 'p10-rhythm-matrix';
      node.spec = {
        chart: 'matrix',
        type: 'heatmap',
        title: 'Hook events by weekday and hour',
        timeBasis: 'hook event facts.ts in the scope timezone',
        ramp: 'sequential',
        series: [{ key: 'hook_events', label: meta.label || 'Hook events', unit: 'events', kind: 'count' }],
        rows: WEEKDAY_LABELS.map(key => ({ key, label: key })),
        columns: RHYTHM_HOURS.map(key => ({ key, label: key }))
      };
      node.data = rows;
      painted = node;
      const bodyText = populationLine(body);
      const columns = RHYTHM_TABLE_COLUMNS.map((label, index) => ({ label, numeric: index === 2 }));
      const tableNode = table(doc, {
        caption: 'Hook events by weekday and hour',
        columns,
        rows: rows.map(row => [
          row.weekdayValue,
          row.column,
          row.values.hook_events === null ? '—' : String(row.values.hook_events)
        ])
      });
      wrapper.append(node);
      const views = mountPanelViews({ panelId: panel.id, chart: wrapper, table: tableNode, doc, defaultView: 'chart', label: 'Hook event rhythm view' });
      views.element.removeAttribute('data-panel');
      if (bodyText) {
        const note = doc.createElement('p');
        note.className = 'p10-note';
        note.textContent = bodyText;
        wrapper.append(note);
      }
      host.replaceChildren(views.element);
    });
    await painted?.whenSettled?.();
    const post = filterRefusal({ panel, spec, scope, schema, ignoredFilters: ignoredFrom(body) });
    if (post) return post;
    whenPanelSlot(panel.id, 'chooser', doc, slot => slot.replaceChildren());
    return {
      state: 'ready', measure: 'hook_events',
      population: body.population || null,
      basis: 'query weekday by hour_of_day, bucket=none',
      weekdays: weekdayKeys.length, hours: hourKeys.length,
      tableRows: rows.map(row => [row.weekdayValue, row.column, row.values.hook_events === null ? '—' : String(row.values.hook_events)])
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The rhythm query failed.' });
  }
}

export const RHYTHM_PANEL = {
  id: 'rhythm',
  title: 'When hook events happen',
  grain: 'time',
  measures: ['hook_events'],
  lenses: ['tool', 'tool_kind', 'harness', 'model', 'kind', 'plan', 'source'],
  charts: ['heatmap'],
  applies: ['harness', 'kind', 'plan', 'model', 'tool', 'tool_kind', 'session_model', 'source'],
  requires: [],
  caveats: 'Weekday by hour heat map of hook events only. Cells share their keys with the table; no cost measure is joined here.',
  measureBasis: 'hook event facts.ts in the scope timezone',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'hook_events', dim: ['weekday', 'hour_of_day'], bucket: 'none' } }],
  load
};

export default RHYTHM_PANEL;
