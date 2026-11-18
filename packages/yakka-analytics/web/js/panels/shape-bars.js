// `shape-bars`: the process shape of plans. Complete, unreported and started
// executions are drawn as one stacked bar per plan from the plan grain's served
// measures, so the panel never counts execution rows in the browser. Process
// shape is completion, never success; `last_ts` is the age of the last
// observation, not an inferred outcome. Harness and repo grouping are offered
// but named unsupported: the server publishes no execution aggregate mode.

import '../charts/yk-bars.js';
import { canonicalRowKey } from './scatter-shared.js';
import { planDestination, planIdentity } from './scatter-plan.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { formatCount, formatPercent } from '../charts/formatters.js';
import { requestParams, schemaGrain, whenPanelSlot } from './p10-shared.js';
import { table, whenPanelBody } from './pulse-strips.js';

let stylesLoaded = false;

// The Phase 12 panels share one stylesheet. Register it once per document; a
// second panel finds the committed link and does nothing.
export function ensureWorkflowStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/workflow.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/workflow.css';
  doc.head?.append(link);
}

export const SHAPE_SERIES = [
  { key: 'executions_complete', label: 'Complete', unit: 'executions', kind: 'count' },
  { key: 'executions_unreported', label: 'Unreported', unit: 'executions', kind: 'count' },
  { key: 'executions_started', label: 'Started', unit: 'executions', kind: 'count' }
];

export const SHAPE_GROUPINGS = [
  { value: 'plan', label: 'Plan' },
  { value: 'harness', label: 'Harness' },
  { value: 'repo', label: 'Repo' }
];

const GROUPING_MISSING = 'execution aggregate grouping';

// The catalog offers harness and repo grouping, but no route groups execution
// shape by either. Name the carry rather than fetching execution pages and
// counting them: the server publishes no execution aggregate mode.
export function groupingState(grouping = 'plan') {
  if (grouping === 'plan') return null;
  return unsupportedState({
    feature: GROUPING_MISSING,
    reason: 'the server publishes no execution aggregate mode; process shape is served by plan measures only',
    source: 'server /schema',
    nearest: 'plan grouping'
  });
}

export function shapeGrouping(spec = {}) {
  const chosen = String(spec?.scope?.p12_grouping || 'plan');
  return SHAPE_GROUPINGS.some(option => option.value === chosen) ? chosen : 'plan';
}

// The top page is bounded by the published budgets, never clipped silently.
export function shapeTop(schema, requested = 12) {
  const topMax = Number(schema?.budgets?.top_max);
  const pageMax = Number(schema?.budgets?.page_max);
  const bounds = [Number(requested)].filter(value => Number.isFinite(value) && value > 0);
  if (Number.isFinite(topMax) && topMax > 0) bounds.push(topMax);
  if (Number.isFinite(pageMax) && pageMax > 0) bounds.push(pageMax);
  return Math.max(1, Math.floor(Math.min(...bounds)));
}

// Plan measures map to one stacked row. A null count stays null (the chart
// skips the segment) and is never drawn as zero; `complete_share` is null with
// `no_executions`, never zero.
export function shapeRows(body = {}) {
  const rows = [];
  for (const row of Array.isArray(body.rows) ? body.rows : []) {
    const identity = planIdentity(row);
    const measures = row?.m || {};
    const values = {};
    let missing = 0;
    for (const series of SHAPE_SERIES) {
      const value = measures[series.key];
      values[series.key] = value === null || value === undefined ? null : Number(value);
      if (values[series.key] === null) missing += 1;
    }
    const share = measures.complete_share;
    const lastTs = measures.last_ts;
    values.complete_share = share === null || share === undefined ? null : Number(share);
    values.last_ts = lastTs === null || lastTs === undefined ? null : Number(lastTs);
    rows.push({
      key: canonicalRowKey(row?.id, 'plan'),
      label: identity.plan || '(no plan)',
      identity,
      values,
      complete_share: values.complete_share,
      last_ts: values.last_ts,
      flags: row?.flags || {},
      missing
    });
  }
  return rows;
}

export function shapePopulationText(population = null) {
  const returned = Number(population?.returned_n) || 0;
  const scope = Number(population?.scope_n) || 0;
  return `top ${formatCount(returned)} of ${formatCount(scope)} plans`;
}

export function completeShareText(row = {}) {
  if (row.complete_share === null || row.complete_share === undefined) {
    return row.flags?.complete_share_null_reason === 'no_executions' ? 'no executions' : '—';
  }
  return formatPercent(row.complete_share);
}

// `last_ts` is shown as age of last observation. It is never turned into an
// outcome; an absent timestamp stays `—`.
export function observedAge(lastTs, now = Date.now()) {
  const seconds = Number(lastTs);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor((Number(now) / 1000 - seconds) / 86400);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function entitiesFor(rows) {
  const entities = {};
  for (const row of rows) {
    entities[row.key] = {
      grain: 'plan',
      key: row.key,
      identity: row.identity,
      destination: planDestination(row.identity),
      entity: { grain: 'plan', repo_id: row.identity.repo_id, plan: row.identity.plan }
    };
  }
  return entities;
}

function cleanRow(row) {
  return {
    key: row.key,
    label: row.label,
    values: {
      executions_complete: row.values.executions_complete,
      executions_unreported: row.values.executions_unreported,
      executions_started: row.values.executions_started,
      complete_share: row.values.complete_share,
      last_ts: row.values.last_ts
    }
  };
}

function renderGroupChooser({ panelId, grouping, doc }) {
  const label = doc.createElement('label');
  label.className = 'p12-chooser-field';
  label.append(doc.createTextNode('Group by '));
  const select = doc.createElement('select');
  select.className = 'p12-grouping';
  select.setAttribute('aria-label', 'Group by');
  for (const option of SHAPE_GROUPINGS) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === grouping;
    select.append(node);
  }
  select.addEventListener('change', () => {
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    const next = canonicalPanelSpec({
      grain: 'plan',
      measures: SHAPE_SERIES.map(series => series.key).concat(['complete_share', 'last_ts']),
      chart: 'bars',
      scope: { p12_grouping: select.value }
    });
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  });
  label.append(select);
  return label;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureWorkflowStyles(doc);
  const grouping = shapeGrouping(spec);
  whenPanelSlot('shape-bars', 'chooser', doc, slot => slot.replaceChildren(renderGroupChooser({ panelId: 'shape-bars', grouping, doc })));
  const unsupported = groupingState(grouping);
  if (unsupported) return unsupported;
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    if (!schemaGrain(schema, 'plan')) {
      return unsupportedState({ grain: 'plan', reason: 'the server publishes no plan grain', source: 'server /schema' });
    }
    const top = shapeTop(schema, 12);
    const params = requestParams({ scope, extra: { grain: 'plan', sort: 'executions_unreported:desc', limit: String(top) } });
    const sessionModel = scope.session_model;
    if (Array.isArray(sessionModel)) for (const value of sessionModel) if (value) params.append('session_model', value);
    else if (typeof sessionModel === 'string' && sessionModel) params.set('session_model', sessionModel);
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'shape-bars' });
    if (!response.ok) {
      if (response.status === 400) return unsupportedState({ missing: 'plan process shape', reason: body?.error || 'the server refused the request', source: 'server /schema' });
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const rows = shapeRows(body);
    if (!rows.length) {
      whenPanelBody('shape-bars', doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no plans in window ${scope.win || 'all'}`, clear: null }]);
    }
    const population = body.population || null;
    const populationText = shapePopulationText(population);
    const entities = entitiesFor(rows);
    let painted = null;
    whenPanelBody('shape-bars', doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p12-shape';
      const note = doc.createElement('p');
      note.className = 'p12-shape-label';
      note.textContent = 'Execution completion, not success. Bars stack complete, unreported and started executions per plan; last observation age is lifetime, not an outcome.';
      const basis = doc.createElement('p');
      basis.className = 'p12-shape-basis';
      basis.textContent = `Basis: plan measures over the scope window, sorted by unreported executions; ${populationText}.`;
      const node = doc.createElement('yk-bars');
      node.className = 'p12-shape-chart';
      node.spec = {
        chart: 'bars',
        type: 'stacked',
        title: 'Process shape per plan (completion, not success)',
        timeBasis: 'the scope window; last observation age is lifetime',
        units: 'executions',
        series: SHAPE_SERIES,
        entities,
        empty: 'no plan has execution measures in this window'
      };
      node.data = rows.map(cleanRow);
      painted = node;
      wrapper.append(note, basis, node);
      const tableRows = rows.map(row => [
        row.identity.plan || '—',
        row.identity.repo_id || '—',
        row.values.executions_complete === null ? '—' : String(row.values.executions_complete),
        row.values.executions_unreported === null ? '—' : String(row.values.executions_unreported),
        row.values.executions_started === null ? '—' : String(row.values.executions_started),
        completeShareText(row),
        observedAge(row.last_ts)
      ]);
      const columns = [
        { label: 'Plan' }, { label: 'Repo' },
        { label: 'Complete', numeric: true }, { label: 'Unreported', numeric: true }, { label: 'Started', numeric: true },
        { label: 'Complete share', numeric: true }, { label: 'Last observed' }
      ];
      wrapper.append(table(doc, { caption: `Process shape, ${populationText}`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    await painted?.whenSettled?.();
    return {
      state: 'ready',
      grouping,
      top,
      population,
      populationText,
      rows: rows.length,
      basis: `plan process shape, top ${top} of ${population?.scope_n ?? rows.length} plans`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The process shape query failed.' });
  }
}

export const SHAPE_BARS_PANEL = {
  id: 'shape-bars',
  title: 'Process shape',
  grain: 'plan',
  measures: ['executions_complete', 'executions_unreported', 'executions_started', 'complete_share', 'last_ts'],
  lenses: ['repo_id', 'harness', 'session_model', 'id'],
  charts: ['bars'],
  table: true,
  requires: ['entities_plan'],
  caveats: 'Process shape is execution completion, not success. Complete share is null with no_executions, never zero. Harness and repo grouping are unsupported: the server publishes no execution aggregate mode.',
  measureBasis: 'plan measures in the scope window; last_ts is age of the last observation',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'plan', sort: 'executions_unreported:desc', limit: '12' } }],
  load
};

export default SHAPE_BARS_PANEL;
