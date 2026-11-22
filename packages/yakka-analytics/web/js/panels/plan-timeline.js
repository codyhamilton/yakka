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
import { mountPanelViews, requestParams, schemaGrain, whenPanelSlot } from './p10-shared.js';
import { registerCaption } from './captions.js';
import { panelBody, table, whenPanelBody } from './pulse-strips.js';

export const PLANLINE_CAPTION = 'Each marker shows a recorded plan event at its event time; rows separate plans and do not imply continuous work between markers.';
export const TIMELINE_TABLE_COLUMNS = ['Event time', 'Event type', 'Repository', 'Plan', 'Path', 'Conversation', 'Session cost (USD)'];
export const TIMELINE_EMPTY_TEXT = 'No records match these filters.';
registerCaption('plan-timeline', () => PLANLINE_CAPTION);

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

// G-planline: event time on X, one lane per selected plan, marker style is the
// recorded event type. Markers carry a single instant; no continuous duration
// is inferred between them. A null cost is never shown as zero.
export function planLaneKey(identity = {}) {
  return `plan:${String(identity?.repo_id || '')}:${String(identity?.plan || '')}`;
}

export function timelineModel({ eventsBody = {}, executionsBody = {}, identity = null } = {}) {
  const events = Array.isArray(eventsBody.rows) ? eventsBody.rows : [];
  const executions = Array.isArray(executionsBody.rows) ? executionsBody.rows : [];
  const data = [];
  const tableRows = [];
  const kinds = [];
  const lane = planLaneKey(identity);
  const repo = String(identity?.repo_id || '');
  const plan = String(identity?.plan || '');

  events.forEach((row, index) => {
    const type = String(row?.event_type || 'event');
    const path = String(row?.path || '');
    const conversation = String(row?.conversation_id || '');
    const at = tsToMs(row?.ts);
    if (!kinds.includes(type)) kinds.push(type);
    data.push({
      key: `event:${index}:${row?.ts}:${path}`,
      lane,
      kind: type,
      at,
      label: `${type} ${path.split('/').pop() || ''}`.trim(),
      path,
      conversation_id: conversation,
      event_type: type,
      values: {}
    });
    tableRows.push({ at, type, repo, plan, path, conversation, cost: null });
  });

  executions.forEach((row, index) => {
    const shape = String(row?.l?.shape || 'unknown');
    const briefPath = String(row?.id?.brief_path || '');
    const conversation = String(row?.id?.conversation_id || '');
    const at = tsToMs(row?.m?.ts);
    const flags = row?.flags || {};
    const priced = !(row?.m?.session_cost_usd === null || flags.session_cost_null_reason === 'all_unpriced');
    if (!kinds.includes(EXECUTION_LANE)) kinds.push(EXECUTION_LANE);
    data.push({
      key: `execution:${index}:${row?.m?.ts}:${conversation}:${briefPath}`,
      lane,
      kind: EXECUTION_LANE,
      at,
      label: `Execution ${shape}`,
      shape,
      conversation_id: conversation,
      brief_path: briefPath,
      priced,
      lower_bound: flags.session_cost_lower_bound === true,
      values: { session_cost_usd: row?.m?.session_cost_usd ?? null }
    });
    tableRows.push({ at, type: shape || EXECUTION_LANE, repo, plan, path: briefPath, conversation, cost: executionCostText(row) });
  });

  const lanes = identity ? [{ key: lane, label: `${repo} · ${plan}`.trim() }] : [];
  const series = kinds
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map(kind => ({ key: kind, label: kind, unit: 'events', kind: 'count' }));

  tableRows.sort((a, b) => {
    const av = a.at === null ? Infinity : a.at;
    const bv = b.at === null ? Infinity : b.at;
    if (av !== bv) return av - bv;
    const type = String(a.type).localeCompare(String(b.type));
    if (type) return type;
    const path = String(a.path).localeCompare(String(b.path));
    if (path) return path;
    return String(a.conversation).localeCompare(String(b.conversation));
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
    versionMarkers: events.length,
    executionMarkers: executions.length,
    otherEvents: events.filter(row => String(row?.event_type || '') !== 'artifact_version').length,
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

// The served first plan page sorted unreported DESC then plan identity ASC.
export function sortedPlanIdentities(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .map(row => ({ identity: planIdentity(row), unreported: row?.m?.executions_unreported }))
    .sort((a, b) => {
      const av = a.unreported;
      const bv = b.unreported;
      const an = av === null || av === undefined;
      const bn = bv === null || bv === undefined;
      if (an !== bn) return an ? 1 : -1;
      if (!an && av !== bv) return bv - av;
      const repo = String(a.identity.repo_id || '').localeCompare(String(b.identity.repo_id || ''));
      if (repo) return repo;
      return String(a.identity.plan || '').localeCompare(String(b.identity.plan || ''));
    })
    .map(item => item.identity);
}

export function planOptions(rows = []) {
  return sortedPlanIdentities(rows).map(identity => ({
    identity,
    key: planChoiceKey(identity),
    label: `${identity.repo_id || '—'} · ${identity.plan || '—'}`
  }));
}

// A selected global plan (URL plan filter, with repo_id when present) wins over
// the panel-local choice. A fixed plan from spec.plan remains the direct path.
export function scopePlan(scope = {}) {
  const raw = scope?.plan;
  const value = Array.isArray(raw) ? raw.find(Boolean) : raw;
  if (!value) return null;
  const repoRaw = scope?.repo_id;
  const repo = Array.isArray(repoRaw) ? repoRaw.find(Boolean) : repoRaw;
  return { repo_id: String(repo || ''), plan: String(value) };
}

export function resolveTimelinePlan({ rows = [], spec = {}, scope = {} } = {}) {
  const fixed = fixedPlan(spec);
  if (fixed) return { identity: fixed, source: 'fixed' };
  const options = sortedPlanIdentities(rows);
  const global = scopePlan(scope);
  if (global) {
    const match = options.find(identity => identity.plan === global.plan
      && (!global.repo_id || identity.repo_id === global.repo_id));
    return { identity: match || global, source: 'global' };
  }
  const wanted = parsePlanChoice(spec?.scope?.p12_plan);
  if (wanted) {
    const match = options.find(identity => identity.repo_id === wanted.repo_id && identity.plan === wanted.plan);
    return { identity: match || null, source: 'local' };
  }
  return { identity: options[0] || null, source: 'default' };
}

// Without a fixed plan the first sorted served plan is the default; an unserved
// choice never silently falls back to another plan.
export function chooserFallback(rows = [], choice = null) {
  const identities = sortedPlanIdentities(rows);
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

export function planListLimit(schema) {
  return Math.min(100, pageLimit(schema));
}

function planListParams(scope, limit) {
  const params = requestParams({ scope, extra: { grain: 'plan', sort: 'executions_unreported:desc', limit: String(limit) } });
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
  for (const option of planOptions(rows)) {
    const node = doc.createElement('option');
    node.value = option.key;
    node.textContent = option.label;
    node.selected = selected ? option.key === planChoiceKey(selected) : false;
    select.append(node);
  }
  select.addEventListener('change', () => {
    const host = doc.querySelector('[data-panel="plan-timeline"]') || doc;
    const choice = parsePlanChoice(select.value);
    const next = canonicalPanelSpec({
      grain: 'plan',
      measures: ['ts', 'session_cost_usd'],
      chart: 'lanes',
      scope: { p12_plan: select.value, plan: choice?.plan, repo_id: choice?.repo_id }
    });
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  });
  label.append(select);
  return label;
}

function renderEmptyPlanList(doc, host) {
  const wrapper = el(doc, 'div', 'p12-timeline-empty');
  const row = el(doc, 'p', 'p12-timeline-empty-row', TIMELINE_EMPTY_TEXT);
  wrapper.append(row);
  host.replaceChildren(wrapper);
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
    const fixed = fixedPlan(spec);
    let rows = [];
    let source = 'fixed';
    let identity = fixed;
    if (!identity) {
      const listLimit = planListLimit(schema);
      const { response, body } = await transport.get('entities', planListParams(scope, listLimit), { tenant, signal, stateKey: 'plan-timeline-plans' });
      if (!response.ok) {
        if (response.status === 400) return unsupportedState({ missing: 'plan list', reason: body?.error || 'the server refused the plan list', source: 'server /schema' });
        return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
      }
      rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) {
        whenPanelBody('plan-timeline', doc, host => renderEmptyPlanList(doc, host));
        whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren());
        return emptyState([{ kind: 'scope', label: `no plans in window ${scope.win || 'all'}`, clear: null, text: TIMELINE_EMPTY_TEXT }]);
      }
      const resolved = resolveTimelinePlan({ rows, spec, scope });
      identity = resolved.identity;
      source = resolved.source;
      if (!identity) {
        const wanted = parsePlanChoice(spec?.scope?.p12_plan);
        whenPanelBody('plan-timeline', doc, host => renderMissingPlan(doc, wanted, host));
        whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren(renderPlanChooser({ doc, rows, selected: null })));
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
      whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren());
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
      const basis = el(doc, 'p', 'p12-timeline-basis', `Basis: ${identity.repo_id} · ${identity.plan}; recorded event and execution times in the scope window. ${populationText(model)}.`);
      const note = el(doc, 'p', 'p12-timeline-note', 'Each marker is a recorded event at its event time; markers are sized by nothing and no continuous duration is inferred between them. The events collection serves no version content_hash, so a marker opens the plan, never an invented historical hash.');
      const chart = el(doc, 'yk-lanes', 'p12-timeline-chart');
      chart.spec = {
        chart: 'lanes',
        type: 'timeline',
        title: 'Plan activity over time',
        timeBasis: 'recorded event and execution times in the scope window',
        units: 'events',
        lanes: model.lanes,
        series: model.series,
        entities: model.entities,
        empty: 'no recorded plan event or execution marker for this plan'
      };
      chart.data = model.data;
      state.painted = chart;
      const columns = TIMELINE_TABLE_COLUMNS.map((label, index) => ({ label, numeric: label === 'Session cost (USD)' && index === 6 }));
      const tableRows = model.tableRows.map(row => [
        row.at === null ? '—' : formatLaneTime(row.at),
        row.type || '—',
        row.repo || '—',
        row.plan || '—',
        row.path || '—',
        row.conversation || '—',
        row.cost === null || row.cost === undefined ? '—' : row.cost
      ]);
      const tableNode = table(doc, { caption: `Plan events and executions, ${model.tableRows.length} rows`, columns, rows: tableRows });
      const views = mountPanelViews({ panelId: 'plan-timeline', chart, table: tableNode, doc, defaultView: 'chart', label: 'Plan activity view' });
      views.element.removeAttribute('data-panel');
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
      wrapper.append(basis, note, views.element);
      if (actions.childNodes.length) wrapper.append(actions);
      host.replaceChildren(wrapper);
    };

    const host = panelBody('plan-timeline', doc) || null;
    state.host = host;
    if (host) paint();
    else whenPanelBody('plan-timeline', doc, later => { state.host = later; paint(); });
    await state.painted?.whenSettled?.();

    if (!fixed && source !== 'global' && rows.length) {
      whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren(renderPlanChooser({ doc, rows, selected: identity })));
    } else {
      whenPanelSlot('plan-timeline', 'chooser', doc, slot => slot.replaceChildren());
    }

    const model = timelineModel({ eventsBody: { rows: state.events }, executionsBody: { rows: state.executions }, identity });
    return {
      state: 'ready',
      plan: identity,
      planSource: source,
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
  caveats: 'Markers come from plan-associated events and the execution grain; they are sized by nothing and no continuous duration is inferred. The events collection serves no version content_hash, so Open reaches the plan, never a historical hash.',
  measureBasis: 'event ts and execution ts in the scope window',
  requests: () => [
    { route: '/v1/analytics/entities', method: 'GET', params: { grain: 'plan', sort: 'executions_unreported:desc', limit: '100' } },
    { route: '/v1/analytics/entity', method: 'GET', params: { grain: 'plan', collection: 'events', repo_id: '<repo_id>', plan: '<plan>' } },
    { route: '/v1/analytics/entities', method: 'GET', params: { grain: 'execution', repo_id: '<repo_id>', plan: '<plan>' } }
  ],
  load
};

export default PLAN_TIMELINE_PANEL;
