// `rhythm`: weekday-by-hour activity heat map over hook events. One query with
// two dims and `bucket=none`; the unit and the shared-entity-key note stay
// visible. No cost join is claimed here.

import '../charts/yk-matrix.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { WEEKDAY_LABELS } from '../charts/yk-matrix.js';
import { table } from './pulse-strips.js';
import {
  ensureP10Styles, measureMeta, populationLine, requestParams, whenPanelBody, whenPanelSlot, renderChooser
} from './p10-shared.js';

function weekdayLabel(value) {
  const index = Number(value);
  if (Number.isInteger(index) && index >= 0 && index < 7) return WEEKDAY_LABELS[index];
  return String(value);
}

export function rhythmRows(body = {}) {
  const source = Array.isArray(body.rows) ? body.rows : [];
  return source.map(row => {
    const weekday = weekdayLabel(row.k?.[0]);
    const hour = Number(row.k?.[1]);
    const padded = Number.isFinite(hour) ? String(hour).padStart(2, '0') : String(row.k?.[1] ?? '');
    return {
      key: `rhythm:${weekday}:${padded}`,
      row: weekday,
      column: padded,
      x: Number.isFinite(hour) ? hour : 0,
      values: { hook_events: row.v === null || row.v === undefined ? null : Number(row.v) },
      n: row.n
    };
  });
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || RHYTHM_PANEL;
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
    const rows = rhythmRows(body);
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no hook events in window ${scope.win || 'all'}`, clear: null }]);
    }
    const weekdays = [...new Set(rows.map(row => row.row))];
    const hours = [...new Set(rows.map(row => row.column))].sort();
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-rhythm';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: hook events (events) on weekday by hour_of_day, bucket=none. ${populationLine(body)}.`;
      const node = doc.createElement('yk-matrix');
      node.className = 'p10-rhythm-matrix';
      node.spec = {
        chart: 'matrix',
        type: 'heatmap',
        title: 'Hook events by weekday and hour',
        timeBasis: 'hook event facts.ts in the scope timezone',
        series: [{ key: 'hook_events', label: 'Events', unit: 'events', kind: 'count' }],
        rows: weekdays.map(key => ({ key, label: key })),
        columns: hours.map(key => ({ key, label: key }))
      };
      node.data = rows;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = 'Shared entity key marks every cell: a day/hour key highlights every cell for it, and the table repeats the key.';
      const columns = [{ label: 'Weekday' }, { label: 'Hour' }, { label: 'Events', numeric: true }];
      wrapper.append(basis, node, note, table(doc, {
        caption: 'Hook events by weekday and hour',
        columns,
        rows: rows.map(row => [row.row, row.column, row.values.hook_events === null ? '—' : String(row.values.hook_events)])
      }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: ['hook_events'] }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure: 'hook_events',
      population: body.population || null,
      basis: 'query weekday by hour_of_day, bucket=none',
      weekdays: weekdays.length, hours: hours.length
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The rhythm query failed.' });
  }
}

export const RHYTHM_PANEL = {
  id: 'rhythm',
  title: 'Rhythm',
  grain: 'time',
  measures: ['hook_events'],
  lenses: ['tool', 'tool_kind', 'harness', 'repo_id', 'model'],
  charts: ['heatmap'],
  requires: [],
  caveats: 'Weekday by hour heat map of hook events only. Cells share their keys with the table; no cost measure is joined here.',
  measureBasis: 'hook event facts.ts in the scope timezone',
  requests: () => [{ route: '/v1/analytics/query', method: 'GET', params: { measure: 'hook_events', dim: ['weekday', 'hour_of_day'], bucket: 'none' } }],
  load
};

export default RHYTHM_PANEL;
