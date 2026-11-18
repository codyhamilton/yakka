// `plan-timeline`: artifact versions and executions of one plan in time lanes.
// It composes the existing `<yk-lanes>` element and adds no timeline of its
// own. The events collection does not serve a version `content_hash`, so a
// marker opens the plan (and, inside plan detail later, the artifact's latest
// version); no historical hash is invented. Markers are sized by nothing.

import '../charts/yk-lanes.js';
import { formatLaneTime } from '../charts/yk-lanes.js';
import { formatCount, formatMoney } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { planDestination, planIdentity } from './scatter-plan.js';
import { ensureWorkflowStyles } from './shape-bars.js';
import { requestParams, schemaGrain, whenPanelSlot } from './p10-shared.js';
import { panelBody, table, whenPanelBody } from './pulse-strips.js';

export const ARTIFACT_KINDS = ['design', 'brief', 'report'];
const KIND_LABELS = { design: 'Design', brief: 'Brief', report: 'Report', other: 'Other artifact' };
const EXECUTION_LANE = 'execution';

export function artifactKind(path) {
  const text = String(path || '');
  const base = text.split('/').pop() || '';
  if (/^DESIGN\.md$/i.test(base)) return 'design';
  if (/\/briefs\//.test(text)) return 'brief';
  if (/\/reports\//.test(text)) return 'report';
  return 'other';
}

// Plan and execution timestamps are epoch seconds on the entity routes; the
// lanes element expects epoch milliseconds. Strings are already dates.
export function tsToMs(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number < 1e12 ? number * 1000 : number;
}

export function executionCostText(row = {}) {
  const flags = row?.flags || {};
  const measure = row?.m || {};
  if (measure.session_cost_usd === null || measure.session_cost_usd === undefined) return 'unpriced (all calls)';
  if (flags.session_cost_null_reason === 'all_unpriced') return 'unpriced (all calls)';
  return formatMoney(measure.session_cost_usd, { lowerBound: flags.session_cost_lower_bound === true });
}

function artifactLaneKey(kind) {
  return `artifact:${kind}`;
}

function laneLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS.other;
}

// One lane per observed artifact kind plus one execution lane. A non-version
// event stays in the table (named as not drawn) so the events table is not
// mistaken for a version timeline. A null count or cost is never zero.
export function timelineModel({ eventsBody = {}, executionsBody = {}, identity = null } = {}) {
  const events = Array.isArray(eventsBody.rows) ? eventsBody.rows : [];
  const executions = Array.isArray(executionsBody.rows) ? executionsBody.rows : [];
  const observed = [];
  const data = [];
  const tableRows = [];

  events.forEach((row, index) => {
    const type = String(row?.event_type || '');
    const path = String(row?.path || '');
    const conversation = String(row?.conversation_id || '');
    const at = tsToMs(row?.ts);
    if (type === 'artifact_version') {
      const kind = artifactKind(path);
      if (!observed.includes(kind)) observed.push(kind);
      const lane = artifactLaneKey(kind);
      data.push({
        key: `event:${index}:${row?.ts}:${path}`,
        lane,
        kind: lane,
        at,
        label: `${laneLabel(kind)} ${path.split('/').pop() || ''}`.trim(),
        path,
        conversation_id: conversation,
        event_type: type,
        values: { path }
      });
      tableRows.push({ at, lane: laneLabel(kind), kind: 'Artifact version', path, conversation, note: '' });
    } else {
      tableRows.push({ at, lane: 'Other event', kind: type || 'event', path: path || row?.event || '—', conversation, note: 'not drawn (not an artifact_version)' });
    }
  });

  executions.forEach((row, index) => {
    const shape = String(row?.l?.shape || 'unknown');
    const briefPath = String(row?.id?.brief_path || '');
    const conversation = String(row?.id?.conversation_id || '');
    const at = tsToMs(row?.m?.ts);
    const flags = row?.flags || {};
    const priced = !(row?.m?.session_cost_usd === null || flags.session_cost_null_reason === 'all_unpriced');
    data.push({
      key: `execution:${index}:${row?.m?.ts}:${conversation}:${briefPath}`,
      lane: EXECUTION_LANE,
      kind: EXECUTION_LANE,
      at,
      label: `Execution ${shape}`,
      shape,
      conversation_id: conversation,
      brief_path: briefPath,
      priced,
      lower_bound: flags.session_cost_lower_bound === true,
      values: { shape, session_cost_usd: row?.m?.session_cost_usd ?? null }
    });
    tableRows.push({
      at,
      lane: 'Executions',
      kind: shape,
      path: briefPath || '—',
      conversation,
      note: executionCostText(row)
    });
  });

  const lanes = observed.map(kind => ({ key: artifactLaneKey(kind), label: laneLabel(kind) }));
  lanes.push({ key: EXECUTION_LANE, label: 'Executions' });
  const series = observed.map(kind => ({ key: artifactLaneKey(kind), label: laneLabel(kind), unit: 'versions', kind: 'count' }));
  series.push({ key: EXECUTION_LANE, label: 'Executions', unit: 'executions', kind: 'count' });

  tableRows.sort((a, b) => {
    const av = a.at === null ? -Infinity : a.at;
    const bv = b.at === null ? -Infinity : b.at;
    if (av !== bv) return bv - av;
    return String(a.lane).localeCompare(String(b.lane));
  });

  const entities = {};
  for (const marker of data) {
    entities[marker.key] = {
      grain: 'plan',
      key: marker.key,
      identity,
      destination: identity ? planDestination(identity) : '/plans',
      entity: identity ? { grain: 'plan', repo_id: identity.repo_id, plan: identity.plan } : null,
      artifact: marker.path ? { repo_id: identity?.repo_id || '', path: marker.path } : null
    };
  }

  return {
    lanes,
    series,
    data,
    tableRows,
    entities,
    versionMarkers: data.filter(marker => marker.lane !== EXECUTION_LANE).length,
    executionMarkers: data.filter(marker => marker.lane === EXECUTION_LANE).length,
    otherEvents: tableRows.filter(row => row.lane === 'Other event').length,
    eventsPopulation: eventsBody.population || null,
    executionsPopulation: executionsBody.population || null
  };
}

export function planChoiceKey(identity = {}) {
  return JSON.stringify({ repo_id: String(identity.repo_id || ''), plan: String(identity.plan || '') });
}

export function parsePlanChoice(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.repo_id && !parsed.plan) return null;
    return { repo_id: String(parsed.repo_id || ''), plan: String(parsed.plan || '') };
  } catch { return null; }
}

// A fixed plan comes from `spec.plan` (direct load, used by plan detail) or the
// panel-local chooser kept in the panel spec's scope. A bare string is refused,
// never guessed into a repository.
export function fixedPlan(spec = {}) {
  const fixed = spec?.plan;
  if (fixed && typeof fixed === 'object' && !Array.isArray(fixed)) {
    if (fixed.repo_id || fixed.plan) return { repo_id: String(fixed.repo_id || ''), plan: String(fixed.plan || '') };
    return null;
  }
  return parsePlanChoice(spec?.scope?.p12_plan);
}

// Without a fixed plan the first served plan is the default; an unserved choice
// never silently falls back to another plan.
export function chooserFallback(rows = [], choice = null) {
  const identities = rows.map(row => planIdentity(row));
  if (!identities.length) return null;
  const wanted = parsePlanChoice(choice);
  if (!wanted) return identities[0];
  const match = identities.find(identity => identity.repo_id === wanted.repo_id && identity.plan === wanted.plan);
  return match || null;
}

export function isMissingPlan(eventsBody = {}, executionsBody = {}) {
  const events = Array.isArray(eventsBody.rows) ? eventsBody.rows : [];
  const executions = Array.isArray(executionsBody.rows) ? executionsBody.rows : [];
  return events.length === 0 && executions.length === 0;
}

export function pageLimit(schema) {
  const pageMax = Number(schema?.budgets?.page_max);
  return Number.isFinite(pageMax) && pageMax > 0 ? Math.floor(pageMax) : 500;
}

function appendSessionModel(params, scope = {}) {
  const value = scope.session_model;
  if (Array.isArray(value)) { for (const item of value) if (item) params.append('session_model', item); }
  else if (typeof value === 'string' && value) params.set('session_model', value);
}

function planListParams(scope) {
  const params = requestParams({ scope, extra: { grain: 'plan', sort: 'last_ts:desc', limit: '12' } });
  appendSessionModel(params, scope);
  return params;
}

function eventsParams(scope, identity, limit, cursor = '') {
  const params = requestParams({ scope, extra: { grain: 'plan', collection: 'events', repo_id: identity.repo_id, plan: identity.plan, limit: String(limit) } });
  params.delete('cohort');
  appendSessionModel(params, scope);
  if (cursor) params.set('cursor', cursor);
  return params;
}

function executionsParams(scope, identity, limit, cursor = '') {
  const params = requestParams({ scope, extra: { grain: 'execution', repo_id: identity.repo_id, plan: identity.plan, limit: String(limit) } });
  appendSessionModel(params, scope);
  if (cursor) params.set('cursor', cursor);
  return params;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPlanChooser({ doc, rows, selected }) {
  const label = el(doc, 'label', 'p12-chooser-field', 'Plan ');
  const select = el(doc, 'select', 'p12-plan-chooser');
  select.setAttribute('aria-label', 'Plan');
  for (const row of rows) {
    const identity = planIdentity(row);
    const option = doc.createElement('option');
    option.value = planChoiceKey(identity);
    option.textContent = `${identity.repo_id} · ${identity.plan}`;
    option.selected = selected ? option.value === planChoiceKey(selected) : false;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const host = doc.querySelector('[data-panel="plan-timeline"]') || doc;
    const next = canonicalPanelSpec({ grain: 'plan', measures: ['ts', 'session_cost_usd'], chart: 'lanes', scope: { p12_plan: select.value } });
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  });
  label.append(select);
  return label;
}

function renderMissingPlan(doc, identity, host) {
  const wrapper = el(doc, 'div', 'p12-timeline-missing');
  const text = el(doc, 'p', '', `no served plan (${identity?.repo_id || '—'}, ${identity?.plan || '—'}). `);
  const link = el(doc, 'a', '', 'Plans');
  link.href = '/plans';
  text.append(link);
  wrapper.append(text);
  host.replaceChildren(wrapper);
}

function populationText(model) {
  const events = model.eventsPopulation;
  const executions = model.executionsPopulation;
  const eventText = events
    ? `${formatCount(events.returned_n ?? 0)} of ${formatCount(events.scope_n ?? 0)} events`
    : 'events not reported';
  const executionText = executions
    ? `${formatCount(executions.returned_n ?? 0)} of ${formatCount(executions.scope_n ?? 0)} executions`
    : 'executions not reported';
  return `${eventText}; ${executionText}`;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureWorkflowStyles(doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    if (!schemaGrain(schema, 'plan') || !schemaGrain(schema, 'execution')) {
      return unsupportedState({ grain: 'plan · execution', reason: 'the server does not publish the plan and execution grains', source: 'server /schema' });
    }
    const limit = pageLimit(schema);
    let rows = [];
    let identity = fixedPlan(spec);
    if (!identity) {
      const { response, body } = await transport.get('entities', planListParams(scope), { tenant, signal, stateKey: 'plan-timeline-plans' });
      if (!response.ok) {
        if (response.status === 400) return unsupportedState({ missing: 'plan list', reason: body?.error || 'the server refused the plan list', source: 'server /schema' });
        return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
      }
      rows = Array.isArray(body.rows) ? body.rows : [];
      identity = chooserFallback(rows, spec?.scope?.p12_plan);
      if (!rows.length) {
        whenPanelBody('plan-timeline', doc, host => renderMissingPlan(doc, { repo_id: '', plan: '' }, host));
        return emptyState([{ kind: 'scope', label: `no plans in window ${scope.win || 'all'}`, clear: null }]);
      }
      if (!identity) {
        whenPanelBody('plan-timeline', doc, host => renderMissingPlan(doc, parsePlanChoice(spec?.scope?.p12_plan), host));
        return emptyState([{ kind: 'scope', label: 'the selected plan is not served', clear: null }]);
      }
    }

    const [events, executions] = await Promise.all([
      transport.get('entity', eventsParams(scope, identity, limit), { tenant, signal, stateKey: 'plan-timeline-events' }),
      transport.get('entities', executionsParams(scope, identity, limit), { tenant, signal, stateKey: 'plan-timeline-executions' })
    ]);
    for (const result of [events, executions]) {
      if (!result.response.ok) {
        if (result.response.status === 400) return unsupportedState({ missing: 'plan timeline', reason: result.body?.error || 'the server refused the collection', source: 'server /schema' });
        return errorState({ message: result.body?.error || `The server returned ${result.response.status}.`, code: result.body?.code || String(result.response.status || '') });
      }
    }
    if (isMissingPlan(events.body, executions.body)) {
      whenPanelBody('plan-timeline', doc, host => renderMissingPlan(doc, identity, host));
      return emptyState([{ kind: 'scope', label: `no served plan (${identity.repo_id}, ${identity.plan})`, clear: null }]);
    }

    const eventsPopulation = events.body.population || null;
    const executionsPopulation = executions.body.population || null;
    const state = {
      events: Array.isArray(events.body.rows) ? events.body.rows.slice() : [],
      executions: Array.isArray(executions.body.rows) ? executions.body.rows.slice() : [],
      eventsNext: events.body.next || null,
      executionsNext: executions.body.next || null,
      host: null,
      painted: null
    };

    const paint = () => {
      const host = state.host;
      if (!host) return;
      const model = timelineModel({
        eventsBody: { rows: state.events, population: eventsPopulation },
        executionsBody: { rows: state.executions, population: executionsPopulation },
        identity
      });
      const wrapper = el(doc, 'div', 'p12-timeline');
      const basis = el(doc, 'p', 'p12-timeline-basis', `Basis: ${identity.repo_id} · ${identity.plan}; event and execution ts in the scope window. ${populationText(model)}.`);
      const note = el(doc, 'p', 'p12-timeline-note', 'Markers are sized by nothing. The events collection does not serve a version content_hash, so a marker opens the plan, never an invented historical hash.');
      const chart = el(doc, 'yk-lanes', 'p12-timeline-chart');
      chart.spec = {
        chart: 'lanes',
        type: 'timeline',
        title: 'Plan artifact versions and executions',
        timeBasis: 'event ts and execution ts in the scope window',
        units: 'versions × executions',
        lanes: model.lanes,
        series: model.series,
        entities: model.entities,
        empty: 'no artifact version or execution marker for this plan'
      };
      chart.data = model.data;
      state.painted = chart;
      wrapper.append(basis, note, chart);

      const columns = [
        { label: 'Time (UTC)' }, { label: 'Lane' }, { label: 'Kind' },
        { label: 'Path / shape' }, { label: 'Conversation' }, { label: 'Cost / note' }
      ];
      const tableRows = model.tableRows.map(row => [
        row.at === null ? '—' : formatLaneTime(row.at),
        row.lane,
        row.kind,
        row.path,
        row.conversation || '—',
        row.note || '—'
      ]);
      wrapper.append(table(doc, { caption: `Plan events and executions, ${model.tableRows.length} rows`, columns, rows: tableRows }));

      const actions = el(doc, 'div', 'p12-timeline-more');
      if (state.eventsNext) {
        const button = el(doc, 'button', 'p12-load-more-events', 'Load more events');
        button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const next = await transport.get('entity', eventsParams(scope, identity, limit, state.eventsNext), { tenant, signal, stateKey: 'plan-timeline-events-more' });
            if (next.response.ok) {
              state.events = state.events.concat(Array.isArray(next.body.rows) ? next.body.rows : []);
              state.eventsNext = next.body.next || null;
              paint();
            }
          } finally { button.disabled = false; }
        });
        actions.append(button);
      }
      if (state.executionsNext) {
        const button = el(doc, 'button', 'p12-load-more-executions', 'Load more executions');
        button.type = 'button';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const next = await transport.get('entities', executionsParams(scope, identity, limit, state.executionsNext), { tenant, signal, stateKey: 'plan-timeline-executions-more' });
            if (next.response.ok) {
              state.executions = state.executions.concat(Array.isArray(next.body.rows) ? next.body.rows : []);
              state.executionsNext = next.body.next || null;
              paint();
            }
          } finally { button.disabled = false; }
        });
        actions.append(button);
      }
      if (actions.childNodes.length) wrapper.append(actions);
      host.replaceChildren(wrapper);
    };

    const host = panelBody('plan-timeline', doc) || null;
    state.host = host;
    if (host) paint();
    else whenPanelBody('plan-timeline', doc, later => { state.host = later; paint(); });
    await state.painted?.whenSettled?.();

    if (!fixedPlan(spec) && rows.length) {
      whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren(renderPlanChooser({ doc, rows, selected: identity })));
    }

    const model = timelineModel({ eventsBody: { rows: state.events }, executionsBody: { rows: state.executions }, identity });
    return {
      state: 'ready',
      plan: identity,
      population: eventsPopulation || executionsPopulation,
      versionMarkers: model.versionMarkers,
      executionMarkers: model.executionMarkers,
      otherEvents: model.otherEvents,
      rows: model.tableRows.length,
      basis: `plan ${identity.repo_id} · ${identity.plan}; ${populationText(model)}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The plan timeline query failed.' });
  }
}

export const PLAN_TIMELINE_PANEL = {
  id: 'plan-timeline',
  title: 'Plan timeline',
  grain: 'plan',
  measures: ['ts', 'session_cost_usd'],
  lenses: ['repo_id', 'plan', 'shape', 'id'],
  charts: ['lanes'],
  table: true,
  requires: ['entities_plan', 'entities_execution'],
  caveats: 'Artifact markers come from plan-associated events and execution markers from the execution grain; markers are sized by nothing. The events collection serves no version content_hash, so Open reaches the plan, never a historical hash.',
  measureBasis: 'event ts and execution ts in the scope window',
  requests: () => [
    { route: '/v1/analytics/entities', method: 'GET', params: { grain: 'plan', sort: 'last_ts:desc', limit: '12' } },
    { route: '/v1/analytics/entity', method: 'GET', params: { grain: 'plan', collection: 'events', repo_id: '<repo_id>', plan: '<plan>' } },
    { route: '/v1/analytics/entities', method: 'GET', params: { grain: 'execution', repo_id: '<repo_id>', plan: '<plan>' } }
  ],
  load
};

export default PLAN_TIMELINE_PANEL;
