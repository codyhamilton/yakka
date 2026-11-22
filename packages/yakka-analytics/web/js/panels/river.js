// `river`: the tenant's recent observations as one dense linked timeline.
// Rows come from `/activity?mode=list` and are drawn by the existing
// `<yk-lanes>` element (no new chart type). Follow is this panel's control:
// it probes only while visible, reports counts by observation type and moves
// the acknowledged watermark only when the user acknowledges.

import '../charts/yk-lanes.js';
import { formatNumber } from '../charts/formatters.js';
import { createFollow } from '../core/follow.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import { emptyCausesFor, ensurePulseStyles, filterRefusal, scopeParams, whenPanelBody } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import { mountPanelViews } from './p10-shared.js';

export const OBSERVATION_TYPES = ['session_start', 'artifact_version', 'execution', 'rejection'];
export const ACTIVITY_CAPTION = 'Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.';
export const ACTIVITY_COLUMNS = ['Time', 'Type', 'Repository', 'Plan', 'Kind', 'Path', 'Conversation', 'Stage', 'Open'];
export const RIVER_DEFAULT_VIEW = 'table';

registerCaption('river', () => ACTIVITY_CAPTION);

function countOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

// N1 activity denominator: loaded observation rows against the typed
// observation population. `cohort_n` wins; `eligible_n` is only a fallback,
// and neither supplied is unavailable — never `of 0`.
export function activityPopulationText({ loaded = 0, population = null } = {}) {
  const shown = countOrNull(loaded) ?? 0;
  const shownText = formatNumber(shown);
  const cohort = countOrNull(population?.cohort_n);
  const eligible = countOrNull(population?.eligible_n);
  const matching = cohort ?? eligible;
  if (matching === null) return `${shownText} observations displayed; matching observation total unavailable.`;
  return `${shownText} observations displayed of ${formatNumber(matching)} matching observations`;
}
export const ACTIVITY_TYPE_LABELS = {
  session_start: 'Session start',
  artifact_version: 'Artifact version',
  execution: 'Brief execution',
  rejection: 'Rejection'
};
const TYPE_LABELS = ACTIVITY_TYPE_LABELS;
const TYPE_UNITS = {
  session_start: 'session', artifact_version: 'version', execution: 'execution', rejection: 'rejection'
};

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

// Map the `/activity` list response. Every row keeps its observation type and
// event clock; `ignored_filters` is preserved verbatim.
export function mapActivityList({ status, body } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!status || status >= 400) {
    return errorState({ message: payload.error || `The server returned ${status ?? 'no status'}.`, code: payload.code || (status ? String(status) : '') });
  }
  const rows = Array.isArray(payload.rows) ? payload.rows.map(row => ({
    event_time: asString(row?.event_time),
    type: asString(row?.type),
    identity: asString(row?.identity),
    conversation_id: asString(row?.conversation_id),
    repo_id: asString(row?.repo_id),
    path: asString(row?.path),
    harness: asString(row?.harness),
    kind: asString(row?.kind),
    plan: asString(row?.plan),
    stage: asString(row?.stage)
  })) : [];
  return {
    state: rows.length ? 'ready' : 'empty',
    rows,
    next: asString(payload.next) || null,
    ignoredFilters: Array.isArray(payload.ignored_filters) ? payload.ignored_filters.map(String) : [],
    population: payload.population && typeof payload.population === 'object'
      ? payload.population
      : { unit: 'typed_observation', returned_n: rows.length },
    basis: 'row clock is event time; late arrivals are reported by Follow at receive time'
  };
}

export function countsByType(counts = {}) {
  return OBSERVATION_TYPES.map(type => ({ type, label: TYPE_LABELS[type], unit: TYPE_UNITS[type], count: Number(counts?.[type]) || 0 }));
}

// The lanes model rows: kind-keyed colours/shapes from the existing element,
// entity keys that open the inspector, and the provenance each row carries.
export function laneRows(rows = []) {
  const types = [];
  const data = [];
  for (const row of rows) {
    if (!row.identity) continue;
    if (!types.includes(row.type)) types.push(row.type);
    data.push({
      key: `${row.type}:${row.identity}`,
      kind: row.type,
      lane: row.type,
      at: row.event_time,
      values: {
        [row.type]: 1,
        observation: TYPE_LABELS[row.type] || row.type,
        identity: row.identity,
        conversation_id: row.conversation_id,
        repo_id: row.repo_id,
        path: row.path,
        harness: row.harness,
        kind: row.kind,
        plan: row.plan,
        stage: row.stage
      }
    });
  }
  const series = types.map(type => ({ key: type, label: TYPE_LABELS[type] || type, unit: TYPE_UNITS[type] || '', kind: 'count' }));
  return { data, series };
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderFollow(host, doc, context) {
  let mount = host.__riverFollow;
  if (!mount) {
    const bar = el(doc, 'section', 'river-follow');
    bar.setAttribute('aria-label', 'Follow');
    const toggle = el(doc, 'button', 'river-follow-toggle', 'Follow: off');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'false');
    const intervalLabel = el(doc, 'label', 'river-follow-interval');
    intervalLabel.append(doc.createTextNode('Every '));
    const interval = el(doc, 'input');
    interval.type = 'number';
    interval.min = '1';
    interval.step = '1';
    interval.setAttribute('aria-label', 'Follow interval in seconds');
    intervalLabel.append(interval, doc.createTextNode(' s'));
    const probe = el(doc, 'button', 'river-follow-probe', 'Check now');
    probe.type = 'button';
    const ack = el(doc, 'button', 'river-follow-ack', 'Acknowledge');
    ack.type = 'button';
    const counts = el(doc, 'ul', 'river-follow-counts');
    const watermark = el(doc, 'p', 'river-follow-watermark');
    const status = el(doc, 'p', 'river-follow-status');
    bar.append(toggle, intervalLabel, probe, ack);
    bar.append(counts, watermark, status);
    mount = { bar, toggle, interval, probe, ack, counts, watermark, status, follow: null, update: () => {} };
    const follow = createFollow({
      transport: context.transport,
      tenant: context.tenant,
      onChange: snapshot => mount.update(snapshot)
    });
    mount.follow = follow;
    toggle.addEventListener('click', () => follow.toggle());
    interval.addEventListener('change', () => follow.setIntervalSeconds(interval.value));
    probe.addEventListener('click', () => follow.probeNow());
    ack.addEventListener('click', async () => {
      follow.acknowledge();
      await context.refresh?.();
    });
    mount.update = snapshot => {
      toggle.textContent = `Follow: ${snapshot.enabled ? 'on' : 'off'}`;
      toggle.setAttribute('aria-pressed', String(snapshot.enabled));
      interval.value = String(snapshot.seconds);
      counts.replaceChildren();
      for (const item of countsByType(snapshot.counts)) {
        counts.append(el(doc, 'li', '', `${item.label}: ${formatNumber(item.count)} ${item.unit}${item.count === 1 ? '' : 's'}`));
      }
      watermark.textContent = snapshot.acknowledged
        ? `Acknowledged watermark: ${snapshot.acknowledged}`
        : 'Acknowledged watermark: none';
      if (snapshot.error) status.textContent = `Probe failed: ${snapshot.error.message} (${snapshot.error.status}). The watermark is unchanged.`;
      else status.textContent = snapshot.enabled ? 'Probing only while this document is visible.' : 'Follow is off.';
    };
    host.__riverFollow = mount;
    mount.update(follow.snapshot());
  }
  mount.update = mount.update || (() => {});
  const bar = mount.bar;
  if (!bar.isConnected) host.append(bar);
  return mount;
}

function timeZoneLabel(tz) {
  return tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function formatActivityTime(value, tz) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZoneLabel(tz), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

export function activityTableRows(rows = [], tz) {
  return rows.map(row => [
    formatActivityTime(row.event_time, tz),
    TYPE_LABELS[row.type] || row.type,
    row.repo_id || '—',
    row.plan || '—',
    row.kind || '—',
    row.path || '—',
    row.conversation_id || '—',
    row.stage || '—'
  ]);
}

function tableCell(doc, value, className = '') {
  const cell = doc.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  if (value !== null && value !== undefined && value !== '' && value !== '—') cell.title = String(value);
  return cell;
}

function buildActivityTable(state, context, doc, onUpdate) {
  const wrap = doc.createElement('div');
  wrap.className = 'activity-table-view';
  const node = doc.createElement('table');
  node.className = 'pulse-table activity-table';
  const cap = doc.createElement('caption');
  cap.textContent = 'Recent observations, newest first';
  node.append(cap);
  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  const tz = timeZoneLabel(context.scope?.tz);
  ACTIVITY_COLUMNS.forEach((label, index) => {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = index === 0 ? `Time (${tz})` : label;
    headRow.append(th);
  });
  head.append(headRow);
  const tbody = doc.createElement('tbody');
  node.append(head, tbody);

  function rowNode(row) {
    const tr = doc.createElement('tr');
    const values = activityTableRows([row], context.scope?.tz)[0];
    for (const value of values) tr.append(tableCell(doc, value));
    const openCell = doc.createElement('td');
    const open = doc.createElement('button');
    open.type = 'button';
    open.className = 'activity-open';
    open.textContent = 'Open';
    open.setAttribute('aria-label', `Open ${TYPE_LABELS[row.type] || row.type} ${row.identity}`);
    open.addEventListener('click', () => {
      const view = doc.defaultView;
      const Ctor = view?.CustomEvent || globalThis.CustomEvent;
      if (!Ctor) return;
      open.dispatchEvent(new Ctor('activity-open', { bubbles: true, detail: { ...row } }));
    });
    openCell.append(open);
    tr.append(openCell);
    return tr;
  }

  function renderRows() {
    tbody.replaceChildren();
    for (const row of state.rows) tbody.append(rowNode(row));
  }

  const pager = doc.createElement('div');
  pager.className = 'activity-pager';
  function renderPager() {
    pager.replaceChildren();
    if (!state.next) return;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'activity-more';
    button.textContent = 'Load more observations';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Loading…';
      try {
        const params = new URLSearchParams(state.params);
        params.set('cursor', state.next);
        const { response, body } = await context.transport.get('activity', params, { tenant: context.tenant, stateKey: 'river-more' });
        const page = mapActivityList({ status: response.status, body });
        if (page.state === 'error') {
          button.disabled = false;
          button.textContent = 'Load more observations';
          pager.append(el(doc, 'span', 'pulse-note', ` Retry next page: ${page.message}`));
          return;
        }
        state.rows.push(...page.rows);
        state.next = page.next;
        if (page.population?.cohort_n !== undefined) state.population = page.population;
        renderRows();
        renderPager();
        onUpdate?.();
      } catch {
        button.disabled = false;
        button.textContent = 'Load more observations';
        pager.append(el(doc, 'span', 'pulse-note', ' Retry next page.'));
      }
    });
    pager.append(button);
  }

  renderRows();
  renderPager();
  wrap.append(node, pager);
  return wrap;
}

function buildLanes(result, doc) {
  const chart = doc.createElement('yk-lanes');
  chart.className = 'river-lanes';
  chart.setAttribute('aria-label', 'Recent session starts, artifact versions, executions and rejections');
  const model = laneRows(result.rows);
  chart.spec = {
    chart: 'lanes',
    type: 'timeline',
    title: 'Recent observations',
    timeBasis: 'activity event time',
    series: model.series
  };
  chart.data = model.data;
  return chart;
}

function renderRiver(host, result, context, doc) {
  ensurePulseStyles(doc);
  const mount = renderFollow(host, doc, context);
  const body = el(doc, 'div', 'river');
  const state = { ...result, rows: result.rows.slice() };
  const population = el(doc, 'p', 'activity-population');
  const chart = buildLanes(state, doc);
  const updatePopulation = () => {
    population.textContent = activityPopulationText({ loaded: state.rows.length, population: state.population });
    const lanes = laneRows(state.rows);
    chart.spec = { ...chart.spec, series: lanes.series };
    chart.data = lanes.data;
  };
  updatePopulation();
  const views = mountPanelViews({
    panelId: 'river',
    chart,
    table: buildActivityTable(state, context, doc, updatePopulation),
    doc,
    defaultView: RIVER_DEFAULT_VIEW,
    label: 'Recent activity view'
  });
  views.element.removeAttribute('data-panel');
  body.append(views.element, population);
  if (state.next) body.append(el(doc, 'p', 'pulse-note', 'More observations are available; use Load more observations.'));
  host.replaceChildren(mount.bar, body);
}

function renderStatusLine(result, context, doc) {
  const wrapper = el(doc, 'div', 'river');
  wrapper.append(el(doc, 'p', 'activity-population', activityPopulationText({ loaded: result.rows?.length || 0, population: result.population })));
  if (context?.scope?.tz) wrapper.append(el(doc, 'p', 'pulse-note', `Times shown in ${timeZoneLabel(context.scope.tz)}.`));
  return wrapper;
}

export async function load({ scope = {}, spec = {}, transport, tenant, signal, doc = globalThis.document, clear = null, schema = null } = {}) {
  ensurePulseStyles(doc);
  const context = {
    transport, tenant, doc, scope,
    refresh: () => load({ scope, transport, tenant, doc, signal: undefined, clear })
  };
  try {
    const refusal = filterRefusal({ panel: RIVER_PANEL, spec, scope, schema });
    if (refusal) return refusal;
    const params = scopeParams(scope);
    params.set('mode', 'list');
    params.set('limit', '100');
    const { response, body } = await transport.get('activity', params, { tenant, signal, stateKey: 'river' });
    const result = mapActivityList({ status: response.status, body });
    const lateRefusal = filterRefusal({ panel: RIVER_PANEL, spec, scope, schema, ignoredFilters: result.ignoredFilters });
    if (lateRefusal) return lateRefusal;
    if (result.state === 'error') {
      whenPanelBody('river', doc, host => host.replaceChildren(renderStatusLine(result, context, doc)));
      return result;
    }
    if (result.state === 'empty') {
      whenPanelBody('river', doc, host => host.replaceChildren(renderStatusLine(result, context, doc)));
      const causes = emptyCausesFor(scope, clear);
      if (!causes.length) causes.push({ kind: 'scope', label: `no observations in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    result.params = params;
    whenPanelBody('river', doc, host => renderRiver(host, result, context, doc));
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    const result = errorState({ message: error?.message || 'The activity request failed.' });
    whenPanelBody('river', doc, host => host.replaceChildren(renderStatusLine(result, context, doc)));
    return result;
  }
}

export const RIVER_PANEL = {
  id: 'river',
  title: 'Recent activity',
  grain: 'activity observation',
  measures: ['observation'],
  lenses: ['conversation_id', 'repo_id', 'harness', 'kind', 'plan', 'stage'],
  charts: ['lanes'],
  applies: ['repo_id', 'kind', 'harness', 'plan'],
  requires: ['activity'],
  caveats: 'Row clock is event time; late arrivals are reported by Follow by receive time. Follow advances its acknowledged watermark only when you acknowledge. Observations are not a count of all events.',
  measureBasis: 'activity event time; Follow counts by receive time',
  requests: () => [
    { route: '/v1/analytics/activity', method: 'GET', params: { mode: 'list', limit: 100 } },
    { route: '/v1/analytics/activity', method: 'GET', params: { mode: 'probe', after: '<watermark>' } }
  ],
  load
};

export default RIVER_PANEL;
