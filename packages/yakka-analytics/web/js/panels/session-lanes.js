// `session-lanes`: one session's returned events as lanes over `/conversation`.
// Tool events are grouped by `tool_kind`, model calls sit in one call lane with
// a cumulative cost of the returned priced calls, and artifacts/commits name
// their identity. An unpriced call is a hollow marker and is never `$0`.
// Displayed markers reconcile to returned events only; the omitted tail is
// named with the paged ledger link, never folded into the visible counts.

import '../charts/yk-lanes.js';
import { buildLanesModel } from '../charts/yk-lanes.js';
import { formatNumber } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import { whenPanelBody } from './pulse-strips.js';

export const CONVERSATION_CAP = 5000;

const TOOL_KINDS = new Set(['shell', 'read', 'edit', 'search', 'web', 'agent', 'plan', 'mcp', 'other']);

let stylesLoaded = false;
export function ensureSessionsStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/sessions.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/sessions.css';
  doc.head?.append(link);
}

function asString(value) {
  return value === null || value === undefined ? '' : String(value);
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'unpriced';
  return `$${number.toFixed(4)}`;
}

// One event -> one marker. A marker is never dropped: an event the contract
// does not classify lands in `events`, so displayed markers equal returned
// events. Model-call pricing comes from the server's `priced` flag.
export function classifyConversationEvent(event = {}) {
  const type = asString(event.type);
  if (type === 'artifact_version') {
    return { kind: 'artifact', lane: 'artifacts', label: 'Artifact version', priced: true };
  }
  if (type === 'commit') {
    return { kind: 'commit', lane: 'commits', label: 'Commit', priced: true };
  }
  const norm = asString(event.norm_event);
  const isCall = norm === 'usage' || (event.model && (event.cost_usd !== undefined || event.tokens));
  if (isCall) {
    const hasCost = event.cost_usd !== undefined && event.cost_usd !== null && Number.isFinite(Number(event.cost_usd));
    return { kind: 'model_call', lane: 'model_calls', label: event.model ? `Model call (${event.model})` : 'Model call', priced: event.priced !== false && hasCost };
  }
  const toolKind = asString(event.tool_kind);
  const kind = TOOL_KINDS.has(toolKind) ? toolKind : (event.tool ? 'other' : '');
  if (event.tool || kind) {
    const lane = `tool:${kind}`;
    return { kind: `tool:${kind}`, lane, label: `Tool · ${kind}`, toolKind: kind, priced: true };
  }
  return { kind: norm || type || 'event', lane: 'events', label: norm || type || 'Event', priced: true };
}

// The lanes data plus the event table and the cost reconciliation. `priced`
// rides on every marker so `<yk-lanes>` draws unpriced calls hollow.
export function sessionLaneModel(conversation = {}) {
  const events = Array.isArray(conversation.events) ? conversation.events : [];
  const lanes = [];
  const series = [];
  const data = [];
  const tableRows = [];
  let cumulative = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;

  const lane = (key, label) => {
    if (!lanes.some(item => item.key === key)) lanes.push({ key, label });
  };
  const kindSeries = (key, label, unit) => {
    if (!series.some(item => item.key === key)) series.push({ key, label, unit, kind: 'count' });
  };

  events.forEach((event, index) => {
    const classified = classifyConversationEvent(event);
    let displayCost = '';
    if (classified.kind === 'model_call') {
      if (classified.priced) {
        const cost = Number(event.cost_usd);
        cumulative += Number.isFinite(cost) ? cost : 0;
        pricedCalls += 1;
        displayCost = money(event.cost_usd);
      } else {
        unpricedCalls += 1;
        displayCost = 'unpriced';
      }
    } else if (event.cost_usd !== undefined && event.cost_usd !== null && classified.priced) {
      displayCost = money(event.cost_usd);
    }
    lane(classified.lane, laneLabel(classified));
    kindSeries(classified.kind, classified.label, 'events');
    data.push({
      key: `${index}:${asString(event.ts)}:${classified.kind}`,
      kind: classified.kind,
      lane: classified.lane,
      at: event.ts,
      priced: classified.priced,
      values: {
        type: asString(event.type),
        event: asString(event.event),
        tool: asString(event.tool),
        tool_kind: asString(event.tool_kind),
        model: asString(event.model),
        path: asString(event.path),
        cost: displayCost
      }
    });
    tableRows.push({
      index,
      key: `${index}:${asString(event.ts)}`,
      time: asString(event.ts),
      type: classified.kind === 'model_call' ? 'model_call' : (asString(event.type) || asString(event.norm_event) || 'event'),
      toolModel: classified.kind === 'model_call'
        ? (asString(event.model) || 'call')
        : classified.kind === 'artifact' || classified.kind === 'commit'
          ? (asString(event.path) || asString(event.sha) || classified.kind)
          : (asString(event.tool) || asString(event.norm_event) || classified.kind),
      cost: displayCost || '—',
      priced: classified.priced,
      cumulative: classified.kind === 'model_call' && classified.priced ? cumulative : null
    });
  });

  // Stable lane order: tool kinds, then calls, artifacts, commits, everything else.
  const order = ['tool:shell', 'tool:read', 'tool:edit', 'tool:search', 'tool:web', 'tool:agent', 'tool:plan', 'tool:mcp', 'tool:other', 'model_calls', 'artifacts', 'commits', 'events'];
  lanes.sort((a, b) => {
    const ai = order.indexOf(a.key); const bi = order.indexOf(b.key);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });

  const spec = {
    chart: 'lanes',
    type: 'timeline',
    title: 'Session timeline',
    timeBasis: 'event ts (UTC); the whole run in time order',
    lanes,
    series
  };
  return { spec, data, lanes, series, tableRows, pricedCalls, unpricedCalls, cumulativeCostUsd: cumulative };
}

function laneLabel(classified) {
  if (classified.lane === 'model_calls') return 'Model calls';
  if (classified.lane === 'artifacts') return 'Artifacts written';
  if (classified.lane === 'commits') return 'Commits written';
  if (classified.lane === 'events') return 'Other events';
  return `Tools · ${classified.toolKind || 'other'}`;
}

// Returned-event reconciliation. The contract fields are read first; a legacy
// body without them falls back to the returned arrays, never inventing a total.
export function conversationCoverage(conversation = {}) {
  const events = Array.isArray(conversation.events) ? conversation.events : [];
  const returned = Number.isFinite(Number(conversation.returned_events)) ? Number(conversation.returned_events) : events.length;
  const total = Number.isFinite(Number(conversation.total_events)) ? Number(conversation.total_events) : returned;
  const derivedReturnedUnpriced = events.filter(event => classifyConversationEvent(event).kind === 'model_call' && classifyConversationEvent(event).priced === false).length;
  const returnedUnpriced = Number.isFinite(Number(conversation.returned_unpriced_calls)) ? Number(conversation.returned_unpriced_calls) : derivedReturnedUnpriced;
  const totalUnpriced = Number.isFinite(Number(conversation.total_unpriced_calls)) ? Number(conversation.total_unpriced_calls) : returnedUnpriced;
  const truncated = conversation.truncated === true || total > returned;
  return {
    returned,
    total,
    returnedUnpriced,
    totalUnpriced,
    cap: CONVERSATION_CAP,
    truncated,
    omitted: Math.max(0, total - returned),
    omittedUnpriced: Math.max(0, totalUnpriced - returnedUnpriced),
    returnedEvents: events.length
  };
}

export function coverageLines(coverage = {}) {
  const lines = [];
  lines.push(`Returned ${formatNumber(coverage.returned)} of ${formatNumber(coverage.total)} events; /conversation caps events at ${formatNumber(coverage.cap)}.`);
  if (coverage.truncated) lines.push(`${formatNumber(coverage.omitted)} events are beyond the cap and are not in this timeline; the paged ledger reaches them.`);
  lines.push(`Returned unpriced calls: ${formatNumber(coverage.returnedUnpriced)} of ${formatNumber(coverage.totalUnpriced)}.`);
  if (coverage.omittedUnpriced) lines.push(`${formatNumber(coverage.omittedUnpriced)} unpriced call${coverage.omittedUnpriced === 1 ? '' : 's'} are beyond the cap and are not counted in the visible markers.`);
  return lines;
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Draw the composed lanes + the returned-event table into a panel body.
export function renderSessionLanes(host, conversation = {}, doc = globalThis.document) {
  ensureSessionsStyles(doc);
  host.replaceChildren();
  const model = sessionLaneModel(conversation);
  const lanesModel = buildLanesModel({ spec: model.spec, data: model.data });
  const chart = doc.createElement('yk-lanes');
  chart.className = 'session-lanes-chart';
  chart.setAttribute('aria-label', 'Session timeline of tool events, model calls, artifacts and commits');
  chart.spec = model.spec;
  chart.data = model.data;
  host.append(chart);

  const basis = el(doc, 'p', 'session-lanes-basis', 'Basis: each mark is one returned event; tool lanes are tool_kind, model calls carry the cumulative cost of returned priced calls, and unpriced calls are hollow.');
  host.append(basis);

  const table = doc.createElement('table');
  table.className = 'session-events';
  table.append(el(doc, 'caption', '', `Returned events, ${formatNumber(model.tableRows.length)} rows. Cost is per call; unpriced is never $0.`));
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const label of ['Time (UTC)', 'Type', 'Tool / model', 'Cost', 'Priced', 'Cumulative cost']) {
    const th = el(doc, 'th', '', label); th.scope = 'col'; head.append(th);
  }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  tbody.className = 'session-event-rows';
  for (const row of model.tableRows) {
    const tr = doc.createElement('tr');
    tr.className = 'session-event-row';
    tr.dataset.type = row.type;
    tr.dataset.priced = String(row.priced);
    for (const value of [row.time, row.type, row.toolModel, row.cost, row.priced ? 'priced' : 'unpriced', row.cumulative === null ? '—' : money(row.cumulative)]) {
      tr.append(el(doc, 'td', '', value));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  host.append(table);
  return { chart, table, model, lanesModel };
}

export function conversationParams(id, scope = {}) {
  const params = new URLSearchParams();
  params.set('id', id);
  if (scope.from) params.set('from', scope.from);
  if (scope.to) params.set('to', scope.to);
  return params;
}

export function mapConversationResponse({ status = 0, body = null } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!status) return errorState({ message: 'The server did not answer.', code: '' });
  if (status >= 400) return errorState({ message: payload.error || `The server returned ${status}.`, code: payload.code || String(status) });
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return emptyState([{ kind: 'scope', label: 'this conversation returned no events', clear: null }]);
  return { state: 'ready', conversation: payload, coverage: conversationCoverage(payload), basis: 'event ts (UTC); events are capped at 5,000 and totals cover the whole run' };
}

export async function fetchConversation({ transport, id, scope = {}, signal, tenant = '', stateKey = 'session-lanes' } = {}) {
  const { response, body } = await transport.get('conversation', conversationParams(id, scope), { signal, tenant, stateKey });
  return mapConversationResponse({ status: response.status, body });
}

export async function load(context = {}) {
  const { scope = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureSessionsStyles(doc);
  const id = asString(scope.id);
  if (!id) return errorState({ message: 'id required', code: 'id required' });
  try {
    const result = await fetchConversation({ transport, id, scope, signal, tenant });
    if (result.state === 'ready') {
      whenPanelBody('session-lanes', doc, host => renderSessionLanes(host, result.conversation, doc));
    }
    if (result.state === 'ready') {
      return { ...result, population: { unit: 'event', returned_n: result.coverage.returned, eligible_n: result.coverage.total } };
    }
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The conversation request failed.' });
  }
}

export const SESSION_LANES_PANEL = {
  id: 'session-lanes',
  title: 'Session lanes',
  grain: 'session',
  measures: ['model_calls', 'cost_usd'],
  lenses: ['tool_kind', 'session_model'],
  charts: ['lanes'],
  table: true,
  requires: ['entities_session'],
  caveats: 'Marks are returned /conversation events only; the route caps events at 5,000. Unpriced calls are hollow and never $0. Cumulative cost covers returned priced calls; whole-run totals are shown separately.',
  measureBasis: 'event ts (UTC); whole run, capped at 5,000 events',
  requests: () => [{ route: '/v1/analytics/conversation', method: 'GET', params: { id: '<conversation_id>' } }],
  load
};

export default SESSION_LANES_PANEL;
