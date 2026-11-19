// `river`: the tenant's recent observations as one dense linked timeline.
// Rows come from `/activity?mode=list` and are drawn by the existing
// `<yk-lanes>` element (no new chart type). Follow is this panel's control:
// it probes only while visible, reports counts by observation type and moves
// the acknowledged watermark only when the user acknowledges.

import '../charts/yk-lanes.js';
import { formatNumber } from '../charts/formatters.js';
import { createFollow } from '../core/follow.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import { emptyCausesFor, ensurePulseStyles, scopeParams, whenPanelBody } from './pulse-strips.js';

export const OBSERVATION_TYPES = ['session_start', 'artifact_version', 'execution', 'rejection'];
const TYPE_LABELS = {
  session_start: 'Session start',
  artifact_version: 'Artifact version',
  execution: 'Execution',
  rejection: 'Rejection'
};
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
    population: payload.population || { unit: 'typed_observation', returned_n: rows.length, eligible_n: rows.length },
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

function renderRiver(host, result, context, doc) {
  const prior = host.querySelector('.river-follow');
  ensurePulseStyles(doc);
  const mount = renderFollow(host, doc, context);
  const wrapper = host.querySelector('.river') || el(doc, 'div', 'river');
  wrapper.replaceChildren();
  if (prior && prior.parentNode === host) prior.after(wrapper);
  if (!mount.bar.isConnected) host.prepend(mount.bar);
  host.append(wrapper);

  const basis = el(doc, 'p', 'pulse-basis', 'Basis: row clock is event time (UTC); late arrivals are reported by Follow by receive time.');
  wrapper.append(basis);
  if (result.ignoredFilters.length) {
    wrapper.append(el(doc, 'p', 'pulse-note', `Ignored filters (not applied by the server): ${result.ignoredFilters.join(', ')}.`));
  }
  const chart = doc.createElement('yk-lanes');
  chart.className = 'river-lanes';
  chart.setAttribute('aria-label', 'Recent session starts, artifact versions, executions and rejections');
  wrapper.append(chart);
  const model = laneRows(result.rows);
  chart.spec = {
    chart: 'lanes',
    type: 'timeline',
    title: 'Recent observations',
    timeBasis: 'activity event time',
    series: model.series
  };
  chart.data = model.data;
  if (result.next) wrapper.append(el(doc, 'p', 'pulse-note', 'More observations are available; the server returned a cursor.'));
  const legend = el(doc, 'p', 'pulse-note', `Observation types: ${OBSERVATION_TYPES.map(type => TYPE_LABELS[type]).join(', ')}. Each mark is one typed observation; its lane is its type.`);
  wrapper.append(legend);
  return chart;
}

export async function load({ scope = {}, transport, tenant, signal, doc = globalThis.document, clear = null } = {}) {
  ensurePulseStyles(doc);
  const context = {
    transport, tenant, doc, scope,
    refresh: () => load({ scope, transport, tenant, doc, signal: undefined, clear })
  };
  try {
    const params = scopeParams(scope);
    params.set('mode', 'list');
    const { response, body } = await transport.get('activity', params, { tenant, signal, stateKey: 'river' });
    const result = mapActivityList({ status: response.status, body });
    if (result.state === 'error') return result;
    if (result.state === 'empty') {
      whenPanelBody('river', doc, host => host.querySelector('.river')?.replaceChildren());
      const causes = emptyCausesFor(scope, clear);
      if (!causes.length) causes.push({ kind: 'scope', label: `no observations in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    whenPanelBody('river', doc, host => renderRiver(host, result, context, doc));
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The activity request failed.' });
  }
}

export const RIVER_PANEL = {
  id: 'river',
  title: 'River',
  grain: 'activity observation',
  measures: ['observation'],
  lenses: ['conversation_id', 'repo_id', 'harness', 'kind', 'plan', 'stage'],
  charts: ['lanes'],
  requires: ['activity'],
  caveats: 'Row clock is event time; late arrivals are reported by Follow by receive time. Follow advances its acknowledged watermark only when you acknowledge.',
  measureBasis: 'activity event time; Follow counts by receive time',
  requests: () => [
    { route: '/v1/analytics/activity', method: 'GET', params: { mode: 'list' } },
    { route: '/v1/analytics/activity', method: 'GET', params: { mode: 'probe', after: '<watermark>' } }
  ],
  load
};

export default RIVER_PANEL;
