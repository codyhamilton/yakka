// `/sessions` and `/sessions/<id>` explorer module, lazy-loaded by the router.
// The list is a server-sorted, cursor-paged table over
// `/v1/analytics/entities?grain=session`; the detail is the bounded
// `/v1/analytics/conversation` timeline drawn by `session-lanes`. It reuses the
// shared chips, selection tray, inspector, panel frame and lane element and
// adds no route, grain, join, chart type or gesture.

import { decodeUrlState } from '../../contract/url-state.js';
import { parseRoute } from '../core/router.js';
import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { createPanelFrame } from '../panels/panel-frame.js';
import { mountPanelViews } from '../panels/p10-shared.js';
import { hasPanel, registerPanel } from '../panels/registry.js';
import { addFilterChip, createChips, resetScopeState, stateUrl } from '../core/chips.js';
import { buildCohort, createSelectionTray, nextCohortSlot, writeCohort } from '../core/selection-tray.js';
import { createInspector } from '../core/inspector.js';
import { cancelledState, emptyCauses, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatNumber } from '../charts/formatters.js';
import { DECLARED_FILTERS, filterToParameters, ledgerPageLimit, pageParameters, resolveWindow, sanitizeApiCode } from '../panels/ledger-table.js';
import { filterLabel, refusalMessage } from '../core/filter-applicability.js';
import { hasUnsafeLegacyRecordFilters, LEGACY_RECORD_FILTER_MESSAGE } from '../core/record-filter-capability.js';
import {
  SESSION_LANES_PANEL, SESSION_LANES_CAPTION, SESSION_LANES_TABLE_COLUMNS, SESSION_RECORD_COLUMNS,
  SESSION_MARK_LIMIT, conversationCoverage, coverageLines, ensureSessionsStyles, fetchConversation,
  plottedStatement, renderSessionLanes, sessionLaneModelFromRows, sessionRecordCells, sessionRecordsModel
} from '../panels/session-lanes.js';

export const title = 'Sessions';
export const phase = 11;

// S-sessions offers only these measures in its server sort, in contract order.
export const SESSION_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'hook_events', 'commits', 'artifact_versions', 'duration_s'
];

export const SESSION_MEASURE_LABELS = {
  cost_usd: 'Cost',
  model_calls: 'Calls',
  unpriced_calls: 'Unpriced',
  hook_events: 'Hook events',
  commits: 'Commits',
  artifact_versions: 'Artifact versions',
  duration_s: 'Span seconds'
};

export const SESSION_FIELDS = [
  'id', 'l.harness', 'session_model', 'session_repo', 'm.cost_usd', 'model_calls', 'unpriced_calls',
  'hook_events', 'commits', 'artifact_versions', 'duration_s'
];

export const SESSION_FILTERS = ['harness', 'session_model', 'session_repo', 'origin', 'has_artifacts', 'id'];
export const DEFAULT_SORT = 'cost_usd:desc';

export const SESSIONS_LIST_PANEL = {
  id: 'sessions-list',
  title: 'Sessions',
  grain: 'session',
  measures: SESSION_MEASURES,
  lenses: SESSION_FILTERS,
  charts: [],
  table: true,
  caption: 'The selected measure sorts this server-paged session list; measures are in-window and cost is a lower bound when calls are unpriced.',
  requires: ['entities_session'],
  caveats: 'Server-sorted, cursor-paged session list. Measures are in-window; cost is a lower bound when calls are unpriced and never $0.',
  measureBasis: 'session facts.ts window; totals come from the server population, never a returned page'
};

const scheduler = createScheduler();
const transport = createTransport(scheduler);

export const SESSION_LIST_COLUMNS = [
  { key: 'select', label: 'Select', width: '32px' },
  { key: 'id', label: 'Session ID', width: '180px', text: true },
  { key: 'harness', label: 'Harness', width: '90px', lens: true },
  { key: 'session_model', label: 'Model', width: '140px', lens: true },
  { key: 'session_repo', label: 'Repository', width: '180px', lens: true },
  { key: 'cost_usd', label: 'Cost USD', width: '100px', measure: true },
  { key: 'model_calls', label: 'Calls', width: '70px', measure: true },
  { key: 'unpriced_calls', label: 'Unpriced', width: '70px', measure: true },
  { key: 'hook_events', label: 'Hook events', width: '80px', measure: true },
  { key: 'commits', label: 'Commits', width: '70px', measure: true },
  { key: 'artifact_versions', label: 'Artifact versions', width: '80px', measure: true },
  { key: 'duration_s', label: 'Span seconds', width: '90px', measure: true },
  { key: 'open', label: 'Open', width: '70px' }
];

const LIST_COLUMNS = SESSION_LIST_COLUMNS.filter(column => column.lens || column.measure);

// `sort` is not a shared-filter key, so decodeUrlState keeps it under `unknown`.
export function parseSort(raw, allowed = SESSION_MEASURES) {
  const text = String(raw || '');
  const at = text.lastIndexOf(':');
  const measure = at === -1 ? text : text.slice(0, at);
  const dir = at === -1 ? '' : text.slice(at + 1);
  const fallback = allowed.includes('cost_usd') ? 'cost_usd' : (allowed[0] || 'cost_usd');
  if (!text) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  if (!allowed.includes(measure)) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  const direction = dir === 'asc' ? 'asc' : 'desc';
  return { measure, dir: direction, raw: `${measure}:${direction}` };
}

// The capability intersection, in the contract's visible order.
export function allowedMeasures(schema) {
  const published = schema?.grains?.session?.measures;
  if (!Array.isArray(published) || !published.length) return SESSION_MEASURES.slice();
  const names = new Set(published.filter(name => typeof name === 'string' && name));
  const filtered = SESSION_MEASURES.filter(name => names.has(name));
  return filtered.length ? filtered : SESSION_MEASURES.slice();
}

export function allowedFilters(schema) {
  const published = schema?.grains?.session?.filters;
  if (!Array.isArray(published) || !published.length) return SESSION_FILTERS.slice();
  return published.filter(name => typeof name === 'string' && name);
}

// Session-specific filter names are not in the shared FILTERS set, so the URL
// codec keeps them under `unknown`. Fold only declared names into `filters` so
// the builder, chips and tray see one scope; a removed key is not resurrected.
export function readScope(state = {}, filters = SESSION_FILTERS) {
  const merged = { ...state, filters: { ...(state.filters || {}) }, unknown: { ...(state.unknown || {}) } };
  for (const key of filters) {
    const values = merged.unknown[key];
    if (!Array.isArray(values) || !values.length) continue;
    merged.filters[key] = [...(merged.filters[key] || []), ...values];
    delete merged.unknown[key];
  }
  return merged;
}

function lensOf(raw) {
  const text = String(raw || '');
  const at = text.indexOf(':');
  return at === -1 ? '' : text.slice(0, at);
}

// The shared Repository control writes `repo_id`; the session grain names the
// same lens `session_repo`. Carry the global value into the route's declared
// filter so a repository selection cannot leak other repositories' rows.
const REPO_SCOPE_FILTER = 'repo_id';
const SESSION_REPO_FILTER = 'session_repo';

function sessionRepoValues(scope = {}) {
  return new Set([
    ...(scope.filters?.[SESSION_REPO_FILTER] || []),
    ...(scope.filters?.[REPO_SCOPE_FILTER] || [])
  ]);
}

function appendSessionRepo(params, scope, filters) {
  if (!filters.includes(SESSION_REPO_FILTER)) return;
  for (const value of sessionRepoValues(scope)) params.append(SESSION_REPO_FILTER, value);
}

function appendSessionRepoExclude(params, raw, filters) {
  const lens = lensOf(raw);
  if (lens === REPO_SCOPE_FILTER && filters.includes(SESSION_REPO_FILTER)) {
    params.append('exclude', `${SESSION_REPO_FILTER}:${String(raw).slice(lens.length + 1)}`);
    return;
  }
  if (filters.includes(lens)) params.append('exclude', raw);
}

function declaredSessionFilters(filters) {
  return filters.includes(SESSION_REPO_FILTER) && !filters.includes(REPO_SCOPE_FILTER)
    ? [...filters, REPO_SCOPE_FILTER]
    : filters;
}

export function unappliedFilter(state = {}, filters = SESSION_FILTERS) {
  const declared = new Set(filters);
  for (const key of Object.keys(state.filters || {})) if (!declared.has(key)) return key;
  for (const raw of state.exclude || []) {
    const lens = lensOf(raw);
    if (lens && !declared.has(lens)) return lens;
  }
  for (const key of Object.keys(state.unknown || {})) if (key !== 'sort') return key;
  return '';
}

// Only contract filter names, the frozen window, sort and paging are sent.
export function sessionListParams({ state = {}, filters = SESSION_FILTERS, measures = SESSION_MEASURES, sort = DEFAULT_SORT, limit = null, cursor = '', now = Date.now(), window = null } = {}) {
  const scope = readScope(state, filters);
  const params = new URLSearchParams();
  const resolved = resolveWindow(scope, now, window);
  if (resolved.all) params.set('all', '1');
  if (resolved.from) params.set('from', resolved.from);
  if (resolved.to) params.set('to', resolved.to);
  const tz = scope.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  params.set('tz', tz);
  params.set('grain', 'session');
  params.set('fields', SESSION_FIELDS.join(','));
  for (const key of filters) {
    if (key === SESSION_REPO_FILTER) continue;
    for (const value of scope.filters?.[key] || []) params.append(key, value);
  }
  appendSessionRepo(params, scope, filters);
  for (const raw of scope.exclude || []) appendSessionRepoExclude(params, raw, filters);
  params.set('sort', parseSort(sort, measures).raw);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function sessionPageParams(base, { cursor = '', limit = null } = {}) {
  const params = new URLSearchParams(base);
  if (cursor) params.set('cursor', cursor);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  return params;
}

export function mapSessionListResponse({ status = 0, body = null } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!status) return { ...errorState({ message: 'The server did not answer.', code: '' }), status };
  if (status === 404) {
    return unsupportedState({
      feature: '/entities?grain=session', reason: 'this server does not serve it', source: 'the analytics server',
      nearest: 'the LEDGER over the same window'
    });
  }
  if (status >= 400) return { ...errorState({ message: payload.error || `The server returned ${status}.`, code: payload.code || String(status) }), status };
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const next = typeof payload.next === 'string' && payload.next ? payload.next : null;
  const population = payload.population && typeof payload.population === 'object' ? payload.population : null;
  if (!rows.length) return emptyState([]);
  return { state: 'ready', rows, next, population, basis: 'session facts.ts window; measures over the applied scope; totals come from the server population, never a page' };
}

export function mergeSessionRows(existing = [], incoming = []) {
  const rows = [...existing];
  const seen = new Set(rows.map(row => String(row.id)));
  let added = 0;
  for (const row of incoming) {
    const key = String(row.id);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    added += 1;
  }
  return { rows, added };
}

export function formatSessionCost(row = {}) {
  if (row.flags?.unpriced) return 'unpriced';
  if (row.m?.cost_usd === null || row.m?.cost_usd === undefined) return 'unpriced';
  const number = Number(row.m.cost_usd);
  if (!Number.isFinite(number)) return 'unpriced';
  const unpriced = Number(row.m.unpriced_calls) || 0;
  return unpriced ? `$${number.toFixed(2)} (lower bound)` : `$${number.toFixed(2)}`;
}

export function populationText(population, rows = []) {
  const page = Number(population?.returned_n ?? rows.length);
  const loaded = rows.length;
  const scope = Number(population?.scope_n ?? page);
  const unit = population?.unit || 'session';
  if (loaded > page) {
    return `${formatNumber(loaded)} loaded; ${formatNumber(page)} on this page; ${formatNumber(scope)} ${unit}${scope === 1 ? '' : 's'} total`;
  }
  return `${formatNumber(page)} of ${formatNumber(scope)} ${unit}${scope === 1 ? '' : 's'} shown`;
}

// Counts describe the rows on screen only; they are never presented as totals.
export function sessionCoverageNotes({ population = null, rows = [] } = {}) {
  const notes = [];
  for (const [reason, count] of Object.entries(population?.missing_by_reason || {})) {
    notes.push(`${formatNumber(Number(count) || 0)} ${String(reason).replace(/_/g, ' ')}`);
  }
  const allUnpriced = rows.filter(row => row.flags?.unpriced || row.m?.cost_usd === null).length;
  const lowerBound = rows.filter(row => row.flags?.lower_bound).length;
  const unattributed = rows.filter(row => row.l?.session_repo === '(none)').length;
  if (allUnpriced) notes.push(`${formatNumber(allUnpriced)} shown session${allUnpriced === 1 ? '' : 's'} all-unpriced`);
  if (lowerBound) notes.push(`${formatNumber(lowerBound)} shown lower-bound`);
  if (unattributed) notes.push(`${formatNumber(unattributed)} shown with no session repo`);
  return notes;
}

export function formatTotals(totals = {}) {
  const rows = [];
  const push = (label, value) => rows.push({ label, value });
  push('Model calls', formatNumber(Number(totals.model_calls) || 0));
  const unpriced = Number(totals.unpriced_calls) || 0;
  if (totals.cost_usd === null || totals.cost_usd === undefined) push('Cost', 'unpriced');
  else if (unpriced > 0) push('Cost', `$${Number(totals.cost_usd).toFixed(4)} (lower bound; ${formatNumber(unpriced)} unpriced)`);
  else push('Cost', `$${Number(totals.cost_usd).toFixed(4)}`);
  push('Tokens in', formatNumber(Number(totals.tokens_in) || 0));
  push('Tokens out', formatNumber(Number(totals.tokens_out) || 0));
  push('Unpriced calls', formatNumber(unpriced));
  return rows;
}

function planOfPath(path) {
  const match = /^docs\/plans\/([^/]+)\//.exec(String(path || ''));
  return match ? match[1] : '';
}

// Observed identities only. A repo comes from the event when the conversation
// spans several; a plan is read from the stored path. Nothing is inferred beyond
// what the response carries.
export function sessionArtifactLinks(conversation = {}) {
  const events = Array.isArray(conversation.events) ? conversation.events : [];
  const singleRepo = Array.isArray(conversation.repos) && conversation.repos.length === 1 ? conversation.repos[0] : '';
  const seen = new Set();
  const links = [];
  for (const event of events) {
    if (String(event.type) !== 'artifact_version' || !event.path) continue;
    const repo = event.repo_id || singleRepo || '';
    const hash = event.sha || event.content_hash || '';
    const key = `${repo}\u001f${event.path}\u001f${hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ repo_id: repo, path: event.path, hash, plan: event.plan || planOfPath(event.path) });
  }
  return links;
}

export function sessionPlanLinks(conversation = {}) {
  const singleRepo = Array.isArray(conversation.repos) && conversation.repos.length === 1 ? conversation.repos[0] : '';
  const seen = new Set();
  const links = [];
  for (const artifact of sessionArtifactLinks(conversation)) {
    if (!artifact.plan) continue;
    const repo = artifact.repo_id || singleRepo || '';
    const key = `${repo}\u001f${artifact.plan}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ repo_id: repo, plan: artifact.plan });
  }
  return links;
}

export function artifactHref(link = {}) {
  const params = new URLSearchParams();
  if (link.repo_id) params.set('repo_id', link.repo_id);
  if (link.path) params.set('path', link.path);
  if (link.hash) params.set('hash', link.hash);
  return `/artifact?${params.toString()}`;
}

export function planHref(link = {}) {
  return `/plans/${encodeURIComponent(link.repo_id || '')}/${encodeURIComponent(link.plan || '')}`;
}

// Only absolute bounds are sent to /conversation; a relative board window stays
// on the board. `cohort=` is never sent to /conversation.
export function conversationScope(state = {}) {
  return { from: state.from || '', to: state.to || '' };
}

// --- Session detail sources ----------------------------------------------

// The selected-window read is the session grain's own exact identity; the
// explore read is the retained-event ledger for that exact conversation.
const SESSION_GRAIN_FILTERS = new Set(['harness', 'session_model', 'session_repo', 'model']);
const SESSION_EXPLORE_FILTERS = new Set(DECLARED_FILTERS);
const SESSION_SCOPE_KEYS = new Set(['win', 'from', 'to', 'tz', 'all', 'cohorts', 'sel', 'pick', 'hide', 'cmp', 'exclude', 'sort', 'id']);

export const SESSION_RECORDS_MORE = 'Load more session events';
export const SESSION_RECORDS_EMPTY = 'No records match these filters.';

function activeSessionFilters(state = {}) {
  const names = new Set();
  for (const key of Object.keys(state.filters || {})) {
    if (!SESSION_SCOPE_KEYS.has(key) && (state.filters[key] || []).length) names.add(key);
  }
  for (const [key, values] of Object.entries(state.unknown || {})) {
    if (SESSION_SCOPE_KEYS.has(key)) continue;
    if ((values || []).length) names.add(key);
  }
  for (const raw of state.exclude || []) {
    const at = String(raw).indexOf(':');
    if (at > 0) names.add(String(raw).slice(0, at));
  }
  return names;
}

function sessionCohortActive(state = {}) {
  return Object.values(state.cohorts || {}).some(text => Boolean(text));
}

function sessionRefusal(state, supported) {
  const labels = new Set();
  if (sessionCohortActive(state)) labels.add('cohort');
  for (const name of activeSessionFilters(state)) {
    if (supported.has(name)) continue;
    labels.add(filterLabel(name));
  }
  const sorted = [...labels].sort();
  if (!sorted.length) return null;
  return { labels: sorted, message: refusalMessage(sorted) };
}

// The records/timeline read. The exact conversation id is forced; shared
// filters ride only when the event grain declares them.
export function sessionExploreParams(id, state = {}, { window = null, limit = null, cursor = '' } = {}) {
  const params = filterToParameters(state, { window });
  params.delete('conversation_id');
  params.set('conversation_id', String(id || ''));
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function sessionRecordsRefusal(state = {}) {
  return sessionRefusal(state, SESSION_EXPLORE_FILTERS);
}

// The selected-window summary read: `/entities?grain=session&id=` with only the
// session grain's declared filters and the applied window.
export function sessionWindowParams(id, state = {}, { window = null, limit = null } = {}) {
  const params = new URLSearchParams();
  const resolved = resolveWindow(state, Date.now(), window);
  if (resolved.all) params.set('all', '1');
  if (resolved.from) params.set('from', resolved.from);
  if (resolved.to) params.set('to', resolved.to);
  params.set('tz', state.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  params.set('grain', 'session');
  params.set('id', String(id || ''));
  for (const key of SESSION_GRAIN_FILTERS) {
    if (key === SESSION_REPO_FILTER) continue;
    for (const value of state.filters?.[key] || []) params.append(key, value);
  }
  appendSessionRepo(params, state, [...SESSION_GRAIN_FILTERS]);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  return params;
}

export function sessionSelectedRefusal(state = {}) {
  return sessionRefusal(state, new Set([...SESSION_GRAIN_FILTERS, REPO_SCOPE_FILTER]));
}

// The whole-session exception read. `/conversation` accepts the exact identity
// and absolute bounds only; it is never presented as filtered.
export function sessionWholeParams(id, state = {}, { window = null } = {}) {
  const params = new URLSearchParams();
  const resolved = resolveWindow(state, Date.now(), window);
  if (resolved.from) params.set('from', resolved.from);
  if (resolved.to) params.set('to', resolved.to);
  params.set('id', String(id || ''));
  return params;
}

export function sessionBackDestination(search = '') {
  return `/sessions${String(search || '')}`;
}

export function sessionLedgerDestination(id, search = '') {
  const params = new URLSearchParams();
  params.set('conversation_id', String(id || ''));
  const scope = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  for (const [key, value] of scope) {
    if (key === 'conversation_id') continue;
    params.append(key, value);
  }
  return `/ledger?${params.toString()}`;
}

function routeAdapter() {
  const navigate = url => {
    globalThis.history.pushState(null, '', url);
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  };
  return { push: navigate, pushScope: navigate, replaceTransient: url => globalThis.history.replaceState(null, '', url) };
}

function pushSort(measure, dir) {
  const params = new URLSearchParams(globalThis.location?.search || '');
  params.set('sort', `${measure}:${dir}`);
  globalThis.history.pushState(null, '', `${globalThis.location.pathname}?${params.toString()}`);
  globalThis.dispatchEvent(new PopStateEvent('popstate'));
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function cellText(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function register() {
  if (!hasPanel(SESSION_LANES_PANEL.id)) registerPanel(SESSION_LANES_PANEL);
}

// --- List ----------------------------------------------------------------

// T1–T3 vocabulary for the sessions table.
export function sessionStateModel(state = 'loading', { status = 0, code = '', retry = false } = {}) {
  if (state === 'loading') return { state, text: 'Loading Sessions…', busy: true, detail: '', code: '', actions: [] };
  if (state === 'empty') {
    return { state, text: 'No records match these filters.', busy: false, detail: '', code: '', actions: [
      { id: 'all-history', label: 'All history' }, { id: 'reset-filters', label: 'Reset filters' }
    ] };
  }
  const clean = sanitizeApiCode(code);
  const numeric = Number(status) || 0;
  const failure = (detail, actions = []) => ({ state: 'error', text: 'Could not load Sessions.', busy: false, detail, code: clean, actions });
  if (numeric === 401) return failure('', [{ id: 'sign-in', label: 'Sign in', href: '/login' }]);
  if (numeric === 403) return failure('You do not have access to this tenant');
  if (numeric === 503 || state === 'busy') return failure('The server is busy; retry shortly.', retry ? [{ id: 'retry', label: 'Retry' }] : []);
  if (state === 'timeout' || /timeout/i.test(clean)) return failure('The read timed out; retry.', retry ? [{ id: 'retry', label: 'Retry' }] : []);
  return failure('', retry ? [{ id: 'retry', label: 'Retry' }] : []);
}

function sessionStateRow(doc, model, handlers = {}) {
  const tr = el(doc, 'tr', 'sessions-state-row');
  tr.dataset.state = model.state;
  const cell = el(doc, 'td', 'sessions-state-cell');
  cell.colSpan = SESSION_LIST_COLUMNS.length;
  cell.append(el(doc, 'span', 'sessions-state-text', model.text));
  if (model.detail) cell.append(el(doc, 'span', 'sessions-state-detail', ` ${model.detail}`));
  if (model.code) cell.append(el(doc, 'code', 'sessions-state-code', ` ${model.code}`));
  for (const item of model.actions || []) {
    const button = item.href ? el(doc, 'a', 'sessions-state-action', item.label) : el(doc, 'button', 'sessions-state-action', item.label);
    if (item.href) button.href = item.href;
    else { button.type = 'button'; button.addEventListener('click', () => handlers[item.id]?.()); }
    button.dataset.action = item.id;
    cell.append(doc.createTextNode(' '), button);
  }
  tr.append(cell);
  return tr;
}

function renderSessionsTable(container, { rows = [], selected = new Map(), doc = globalThis.document, onInspect, onSelect, onOpen, status = null, handlers = {} } = {}) {
  container.replaceChildren();
  const wrapper = el(doc, 'div', 'sessions-table-wrap');
  const table = doc.createElement('table');
  table.className = 'sessions-table';
  table.append(el(doc, 'caption', 'sessions-caption', `Sessions, ${formatNumber(rows.length)} rows shown. Identity is the conversation id; open one for its bounded timeline.`));
  const colgroup = doc.createElement('colgroup');
  for (const column of SESSION_LIST_COLUMNS) {
    const col = doc.createElement('col');
    col.setAttribute('width', String(parseInt(column.width, 10)));
    colgroup.append(col);
  }
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const column of SESSION_LIST_COLUMNS) {
    const th = el(doc, 'th', '', column.label); th.scope = 'col'; head.append(th);
  }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  tbody.className = 'sessions-body';
  if (status) {
    tbody.append(sessionStateRow(doc, status, handlers));
    if (status.busy) tbody.setAttribute('aria-busy', 'true');
  } else {
    for (const row of rows) {
      const key = String(row.id);
      const state = selected.get(key) === 'exclude' ? 'exclude' : selected.has(key) ? 'include' : '';
      const tr = doc.createElement('tr');
      tr.className = 'session-row';
      tr.dataset.sessionId = key;
      tr.dataset.entityKey = key;
      if (state) tr.dataset.selected = state;
      tr.tabIndex = 0;

      const selectCell = el(doc, 'td', 'sessions-select');
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.className = 'session-row-check';
      box.checked = selected.has(key);
      box.setAttribute('aria-label', `Select session ${key}`);
      box.addEventListener('click', event => {
        event.stopPropagation();
        onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' });
      });
      selectCell.append(box);
      tr.append(selectCell, el(doc, 'td', 'sessions-id', key));

      for (const column of LIST_COLUMNS) {
        const text = column.key === 'cost_usd' ? formatSessionCost(row) : cellText(row.m?.[column.key] ?? row.l?.[column.key]);
        const td = el(doc, 'td', column.measure ? 'numeric' : '', text);
        td.dataset.key = column.key;
        if (text !== '—') td.title = text;
        tr.append(td);
      }

      const openCell = el(doc, 'td', 'sessions-open-cell');
      const open = el(doc, 'button', 'session-open', 'Open');
      open.type = 'button';
      open.addEventListener('click', event => { event.stopPropagation(); onOpen?.(row); });
      openCell.append(open);
      tr.append(openCell);

      tr.addEventListener('click', event => {
        if (event.target.closest('input,button,a')) return;
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' });
          return;
        }
        onInspect?.(row, tr);
      });
      tr.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); onInspect?.(row, tr); }
        else if (event.key === ' ') { event.preventDefault(); onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' }); }
        else if (event.key === 'o' || event.key === 'O') { event.preventDefault(); onOpen?.(row); }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const all = [...tbody.querySelectorAll('.session-row')];
          const at = all.indexOf(tr);
          all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        }
      });
      tbody.append(tr);
    }
  }
  table.append(colgroup, thead, tbody);
  wrapper.append(table);
  container.append(wrapper);
  return container;
}

function listCauses(scope, push) {
  const filters = [];
  for (const [key, values] of Object.entries(scope.filters || {})) {
    for (const value of values || []) {
      filters.push({
        key, label: `${key}: ${value}`,
        clear: () => {
          const next = { ...scope, filters: { ...(scope.filters || {}) } };
          next.filters[key] = (next.filters[key] || []).filter(item => item !== value);
          if (!next.filters[key].length) delete next.filters[key];
          push(stateUrl(next, '', '/sessions'));
        }
      });
    }
  }
  return emptyCauses({ filters });
}

function renderList(root, doc, { signal, tenant = '', readContext = null } = {}) {
  ensureSessionsStyles(doc);
  root.replaceChildren();
  root.append(el(doc, 'h1', '', title));
  root.append(el(doc, 'p', 'sessions-intro', 'Sessions sorted by any published session measure, paged by the server cursor. Lenses narrow the scope; totals come from the server population, never a partial page.'));

  const state = readScope(decodeUrlState(globalThis.location?.search || ''));
  const url = new URLSearchParams(globalThis.location?.search || '');
  const frame = createPanelFrame({ panel: SESSIONS_LIST_PANEL, scope: state, transport, scheduler, doc });
  frame.element.dataset.chart = 'table';
  frame.setBasis(SESSIONS_LIST_PANEL.measureBasis);
  root.append(frame.element);
  const body = frame.element.querySelector('.workspace-panel-body');

  const router = routeAdapter();
  const chips = createChips({ doc, router, path: '/sessions' });
  frame.chipSlot.append(chips.element);
  const sortBar = el(doc, 'div', 'session-sort');
  frame.chooserSlot.append(sortBar);
  const notes = el(doc, 'div', 'sessions-footer');
  const inspector = createInspector({ doc, router, onAction: detail => handleInspector(detail) });
  const tray = createSelectionTray({ doc, router, path: '/sessions' });
  root.append(tray.element, inspector.element);

  let schema = null;
  let recordFiltersSupported = false;
  let measures = SESSION_MEASURES.slice();
  let filters = SESSION_FILTERS.slice();
  let sort = parseSort(url.get('sort'), measures);
  let rows = [];
  let population = null;
  let cursor = '';
  let pageLimit;
  let base = null;
  let disposed = false;
  let runId = 0;
  let controller = new AbortController();
  let pending = false;
  let nextPageError = '';
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const selected = new Map();

  function currentScope() {
    return readScope(decodeUrlState(globalThis.location?.search || ''), filters);
  }

  function updateSelectionUI() {
    for (const tr of body.querySelectorAll('.session-row')) {
      const key = tr.dataset.entityKey;
      if (selected.has(key)) tr.dataset.selected = selected.get(key);
      else delete tr.dataset.selected;
      const box = tr.querySelector('.session-row-check');
      if (box) box.checked = selected.has(key);
    }
    updateTray();
  }

  function selectedRows() {
    return rows.filter(row => selected.has(String(row.id)));
  }

  function updateTray() {
    const scope = currentScope();
    const chosen = selectedRows();
    const picked = { include: chosen.filter(row => selected.get(String(row.id)) === 'include').map(row => String(row.id)), exclude: chosen.filter(row => selected.get(String(row.id)) === 'exclude').map(row => String(row.id)) };
    tray.update({
      state: scope, pick: picked, grain: 'session', unit: 'session',
      population: { scope_n: population?.scope_n ?? rows.length, eligible_n: population?.eligible_n ?? rows.length, returned_n: rows.length },
      selection: { include: picked.include, exclude: picked.exclude, sampled: false },
      schema: schema || { grains: { session: { filters } } }, search: '', now: Date.now(),
      onClear: () => clearSelection()
    });
  }

  function clearSelection() {
    selected.clear();
    const params = new URLSearchParams(globalThis.location?.search || '');
    params.delete('pick');
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${params.toString() ? `?${params}` : ''}`);
    updateSelectionUI();
  }

  function selectRow(row, { mode = 'include' } = {}) {
    const key = String(row.id);
    if (selected.get(key) === mode) selected.delete(key);
    else selected.set(key, mode);
    updateSelectionUI();
  }

  function detailDestination(row) {
    const params = new URLSearchParams(globalThis.location?.search || '');
    params.delete('sort');
    params.delete('cursor');
    params.delete('pick');
    const query = params.toString();
    return `/sessions/${encodeURIComponent(String(row.id))}${query ? `?${query}` : ''}`;
  }

  function openRow(row) {
    router.push(detailDestination(row));
  }

  function inspectRow(row, opener) {
    inspector.open({
      grain: 'session', key: String(row.id), title: `Session ${row.id}`, destination: detailDestination(row),
      facts: [
        { label: 'Conversation', value: row.id },
        { label: 'Harness', value: row.l?.harness },
        { label: 'Session model', value: row.l?.session_model },
        { label: 'Session repo', value: row.l?.session_repo },
        { label: 'Origin', value: row.l?.origin },
        { label: 'Has artifacts', value: row.l?.has_artifacts },
        { label: 'Cost', value: formatSessionCost(row) },
        { label: 'Calls', value: row.m?.model_calls },
        { label: 'Unpriced calls', value: row.m?.unpriced_calls }
      ],
      unit: 'session', population: { scope_n: population?.scope_n ?? rows.length, returned_n: rows.length },
      opener: opener || null, url: globalThis.location.href
    });
  }

  function handleInspector(detail) {
    if (!detail || ['close', 'open', 'copy'].includes(detail.action)) return;
    const key = String(detail.key ?? '');
    const scope = currentScope();
    if (detail.action === 'filter') {
      router.pushScope(stateUrl(addFilterChip(scope, 'id', key), '', '/sessions'));
      return;
    }
    if (detail.action === 'exclude' || detail.action === 'cohort') {
      if (!key) return;
      const op = detail.action === 'exclude' ? 'exclude' : 'include';
      const next = op === 'exclude' ? { ...scope, cmp: 'cohorts' } : scope;
      let cohort;
      try {
        cohort = buildCohort({ state: scope, pick: { include: [key], exclude: [] }, grain: 'session', schema: schema || { grains: { session: { filters } } }, op });
      } catch { return; }
      router.pushScope(stateUrl(writeCohort(next, nextCohortSlot(scope) || 'ca', cohort), '', '/sessions'));
    }
  }

  function show() {
    renderSessionsTable(body, { rows, selected, doc, onInspect: inspectRow, onSelect: selectRow, onOpen: openRow });
    const lensBar = el(doc, 'div', 'sessions-lenses');
    const seen = new Set();
    for (const row of rows) {
      for (const lens of ['harness', 'session_model', 'session_repo']) {
        const value = row.l?.[lens];
        if (!value) continue;
        const key = `${lens}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const button = el(doc, 'button', 'session-lens', `${lens}: ${value}`);
        button.type = 'button';
        button.addEventListener('click', () => router.pushScope(stateUrl(addFilterChip(currentScope(), lens, value), '', '/sessions')));
        lensBar.append(button);
      }
    }
    body.append(lensBar);
    notes.replaceChildren();
    notes.append(el(doc, 'p', 'sessions-population', populationText(population, rows)));
    const coverage = sessionCoverageNotes({ population, rows });
    if (coverage.length) notes.append(el(doc, 'p', 'sessions-coverage', coverage.join(' · ')));
    notes.append(el(doc, 'p', 'sessions-note', cursor ? 'More sessions remain; load another page.' : 'End of the server result.'));
    body.append(notes);
    updateSelectionUI();
    if (nextPageError) {
      const failure = el(doc, 'p', 'sessions-next-error', nextPageError);
      const retry = el(doc, 'button', 'sessions-load-more sessions-retry-next', 'Retry next page');
      retry.type = 'button';
      retry.addEventListener('click', () => { nextPageError = ''; loadMore(); });
      body.append(failure, retry);
    } else if (cursor) {
      const more = el(doc, 'button', 'sessions-load-more', pending ? 'Loading…' : 'Load more sessions');
      more.type = 'button';
      more.disabled = pending;
      more.addEventListener('click', () => loadMore());
      body.append(more);
    }
  }

  function renderSort() {
    sortBar.replaceChildren();
    sortBar.append(el(doc, 'span', 'session-sort-label', 'Sort by'));
    const measure = doc.createElement('select');
    measure.className = 'session-sort-measure';
    measure.setAttribute('aria-label', 'Sort measure');
    for (const name of measures) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = SESSION_MEASURE_LABELS[name] || name;
      option.selected = name === sort.measure;
      measure.append(option);
    }
    measure.addEventListener('change', () => pushSort(measure.value, sort.dir));
    const direction = doc.createElement('select');
    direction.className = 'session-sort-direction';
    direction.setAttribute('aria-label', 'Sort direction');
    for (const value of ['desc', 'asc']) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = value === 'desc' ? 'Descending' : 'Ascending';
      option.selected = value === sort.dir;
      direction.append(option);
    }
    direction.addEventListener('change', () => pushSort(sort.measure, direction.value));
    sortBar.append(measure, direction);
    sortBar.append(el(doc, 'span', 'session-sort-current', `server sort: ${sort.raw}`));
  }

  function commitScope(next) {
    router.pushScope(stateUrl(next, '', '/sessions'));
  }

  function allHistory() {
    return { ...currentScope(), win: 'all', from: '', to: '' };
  }

  function resetFilters() {
    return resetScopeState(currentScope());
  }

  function stateHandlers() {
    return {
      'all-history': () => commitScope(allHistory()),
      'reset-filters': () => commitScope(resetFilters()),
      retry: () => firstPage()
    };
  }

  function renderState(kind, result = {}) {
    rows = []; population = null; cursor = ''; pending = false; nextPageError = '';
    notes.replaceChildren();
    body.replaceChildren();
    renderSessionsTable(body, {
      rows: [], selected, doc,
      status: sessionStateModel(kind, { status: result.status, code: result.code, retry: kind === 'error' }),
      handlers: stateHandlers()
    });
    if (kind === 'empty') {
      body.append(el(doc, 'p', 'sessions-state-hint', 'Loaded rows are never presented as a total.'));
    }
    frame.setState(kind, { ...result, renderStatus: false });
  }

  async function firstPage() {
    const id = ++runId;
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    if (!recordFiltersSupported && hasUnsafeLegacyRecordFilters(currentScope())) {
      rows = []; population = null; cursor = '';
      body.replaceChildren();
      frame.setState('unsupported', { renderStatus: false });
      const status = frame.element.querySelector('.workspace-panel-status');
      if (status) status.textContent = LEGACY_RECORD_FILTER_MESSAGE;
      return;
    }
    rows = []; population = null; cursor = ''; pending = false; nextPageError = '';
    notes.replaceChildren();
    body.replaceChildren();
    renderSessionsTable(body, { rows: [], selected, doc, status: sessionStateModel('loading'), handlers: stateHandlers() });
    frame.setState('loading', { inFlight: 1, renderStatus: false });
    base = sessionListParams({ state: currentScope(), filters, measures, sort: sort.raw, limit: pageLimit, window: readContext?.window || null });
    try {
      const { response, body: payload } = await transport.get('entities', base, { tenant, signal: controller.signal, stateKey: 'sessions' });
      if (disposed || id !== runId) return;
      const result = mapSessionListResponse({ status: response.status, body: payload });
      if (result.state === 'ready') {
        rows = result.rows;
        population = result.population;
        cursor = result.next || '';
        nextPageError = '';
        frame.setState('ready', {});
        frame.setPopulation(population);
        show();
      } else if (result.state === 'empty') {
        renderState('empty');
      } else if (result.state === 'error') {
        renderState('error', result);
      } else {
        result.retry = firstPage;
        body.replaceChildren();
        frame.setState(result.state, result);
      }
    } catch (error) {
      if (disposed || id !== runId) return;
      if (error?.name === 'AbortError') return;
      renderState('error', { status: Number(error?.status) || 0, code: error?.code || '' });
    }
  }

  async function loadMore() {
    if (!cursor || pending) return;
    pending = true;
    nextPageError = '';
    show();
    try {
      const { response, body: payload } = await transport.get('entities', sessionPageParams(base, { cursor, limit: pageLimit }), { tenant, signal: controller.signal, stateKey: 'sessions' });
      if (disposed) return;
      const result = mapSessionListResponse({ status: response.status, body: payload });
      pending = false;
      if (result.state !== 'ready') {
        if (result.state === 'cancelled') return;
        nextPageError = 'Could not load the next page.';
        show();
        return;
      }
      rows = mergeSessionRows(rows, result.rows).rows;
      population = result.population || population;
      cursor = result.next || '';
      show();
    } catch (error) {
      if (disposed) return;
      pending = false;
      if (error?.name === 'AbortError') return;
      nextPageError = 'Could not load the next page.';
      show();
    }
  }

  function paintScope() {
    const scope = currentScope();
    chips.update({ state: scope, search: '', schema: schema || { grains: { session: { filters } } }, grain: 'session', unmapped: unappliedFilter(scope, declaredSessionFilters(filters)) });
    renderSort();
  }

  async function start() {
    let body = null;
    try {
      const result = await transport.schema(tenant);
      if (result.response.ok) body = result.body;
    } catch { body = null; }
    if (disposed) return;
    schema = body;
    recordFiltersSupported = schema?.features?.record_filters === true;
    measures = allowedMeasures(schema);
    filters = allowedFilters(schema);
    sort = parseSort(url.get('sort'), measures);
    pageLimit = Number(schema?.budgets?.page_max);
    if (!Number.isFinite(pageLimit) || pageLimit <= 0) pageLimit = null;
    if (schema?.features && schema.features.entities_session === false) {
      frame.setState('unsupported', { missing: 'entities_session', reason: 'not advertised by this server', source: 'this plan\'s server phases', nearest: 'the ledger' });
      return;
    }
    paintScope();
    firstPage();
  }

  start();

  return () => { disposed = true; controller.abort(); inspector.destroy(); };
}

// --- Detail --------------------------------------------------------------

function renderTotals(host, label, totals, doc) {
  if (!totals) return;
  const section = el(doc, 'section', 'session-totals');
  section.append(el(doc, 'h3', '', label));
  const dl = doc.createElement('dl');
  for (const row of formatTotals(totals)) dl.append(el(doc, 'dt', '', row.label), el(doc, 'dd', '', row.value));
  section.append(dl);
  host.append(section);
}

function renderLinks(host, conversation, doc) {
  const artifacts = sessionArtifactLinks(conversation);
  const plans = sessionPlanLinks(conversation);
  const section = el(doc, 'section', 'session-written');
  section.append(el(doc, 'h3', '', 'Observed artifacts and plans'));
  if (!artifacts.length && !plans.length) section.append(el(doc, 'p', 'session-note', 'No artifact or plan identity is present in the returned events.'));
  if (artifacts.length) {
    const list = el(doc, 'ul', 'session-artifacts');
    for (const link of artifacts) {
      const item = doc.createElement('li');
      const anchor = el(doc, 'a', 'session-artifact-link', link.path);
      anchor.href = artifactHref(link);
      item.append(anchor, doc.createTextNode(' — opens the artifact reader'));
      list.append(item);
    }
    section.append(list);
  }
  if (plans.length) {
    const list = el(doc, 'ul', 'session-plans');
    for (const link of plans) {
      const item = doc.createElement('li');
      const anchor = el(doc, 'a', 'session-plan-link', `${link.repo_id}/${link.plan}`);
      anchor.href = planHref(link);
      item.append(anchor, doc.createTextNode(' — opens the plan detail'));
      list.append(item);
    }
    section.append(list);
  }
  host.append(section);
}

function detailSection(doc, className, title) {
  const section = el(doc, 'section', `session-detail-section ${className}`);
  section.dataset.section = className;
  section.dataset.state = 'loading';
  const status = el(doc, 'p', 'session-detail-status', 'Loading…');
  status.setAttribute('aria-live', 'polite');
  const body = el(doc, 'div', 'session-detail-body');
  section.append(el(doc, 'h2', '', title), status, body);
  return {
    section, status, body,
    state(next, text) {
      section.dataset.state = next;
      status.textContent = text || '';
      if (next !== 'loading' && next !== 'ready') body.replaceChildren();
    }
  };
}

function measureStrip(doc, key, title) {
  const strip = el(doc, 'section', `session-measure-strip session-measure-${key}`);
  strip.dataset.strip = key;
  strip.dataset.state = 'loading';
  strip.append(el(doc, 'h3', '', title));
  const note = el(doc, 'p', 'session-strip-note', '');
  const body = el(doc, 'div', 'session-strip-body');
  strip.append(note, body);
  return { strip, note, body, state(next, text) { strip.dataset.state = next; note.textContent = text || ''; if (next !== 'ready') body.replaceChildren(); } };
}

function recordsTable(doc, columns, rows, stateModel = null) {
  const wrapper = el(doc, 'div', 'session-records-wrap');
  const table = el(doc, 'table', 'session-records');
  table.append(el(doc, 'caption', '', 'Session records'));
  const colgroup = doc.createElement('colgroup');
  for (const column of columns) {
    const col = doc.createElement('col');
    if (column.width) col.setAttribute('width', String(column.width));
    colgroup.append(col);
  }
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const column of columns) {
    const th = el(doc, 'th', column.time ? 'numeric' : '', column.label);
    th.scope = 'col';
    if (column.width) th.setAttribute('width', String(column.width));
    head.append(th);
  }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  if (stateModel) {
    const row = el(doc, 'tr', 'session-records-state-row');
    row.dataset.state = stateModel.state;
    const cell = el(doc, 'td', 'session-records-state-cell');
    cell.colSpan = columns.length;
    cell.append(el(doc, 'span', 'session-records-state-text', stateModel.text));
    if (stateModel.detail) cell.append(el(doc, 'span', 'session-detail-state-detail', ` ${stateModel.detail}`));
    row.append(cell);
    tbody.append(row);
    if (stateModel.state === 'loading') tbody.setAttribute('aria-busy', 'true');
  } else {
    for (const source of rows) {
      const tr = el(doc, 'tr', 'session-record-row');
      const cells = sessionRecordCells(source);
      cells.forEach((value, index) => {
        const td = el(doc, 'td', columns[index]?.cost || columns[index]?.time ? 'numeric' : '', value);
        if (value !== '—') td.title = value;
        tr.append(td);
      });
      tbody.append(tr);
    }
  }
  table.append(colgroup, thead, tbody);
  wrapper.append(table);
  return { wrapper, table, tbody };
}

function laneTableView(doc, model) {
  const table = el(doc, 'table', 'session-lanes-table');
  table.append(el(doc, 'caption', '', 'Session event marks'));
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const label of SESSION_LANES_TABLE_COLUMNS) { const th = el(doc, 'th', '', label); th.scope = 'col'; head.append(th); }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  for (const row of model.tableRows) {
    const tr = doc.createElement('tr');
    for (const value of [row.time, row.type, row.repo_id || '—', row.plan || '—', row.path || '—', row.conversation_id || '—', row.cost]) {
      tr.append(el(doc, 'td', '', value === null || value === undefined || value === '' ? '—' : value));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return table;
}

function renderDetail(root, doc, { signal, id, tenant = '', readContext = null } = {}) {
  ensureSessionsStyles(doc);
  register();
  root.replaceChildren();
  const search = globalThis.location?.search || '';
  const state = readScope(decodeUrlState(search));
  const heading = el(doc, 'h1', '', `Session ${id}`);
  const back = el(doc, 'a', 'sessions-back', 'Back to sessions');
  back.href = sessionBackDestination(search);
  const ledger = el(doc, 'a', 'session-ledger-link', 'Open full ledger');
  ledger.href = sessionLedgerDestination(id, search);
  const links = el(doc, 'nav', 'session-detail-links');
  links.setAttribute('aria-label', 'Session navigation');
  links.append(back, ledger);
  root.append(heading, links);

  const identity = detailSection(doc, 'session-detail-identity', 'Identity');
  const strips = el(doc, 'div', 'session-measure-strips');
  const selected = measureStrip(doc, 'selected', 'Selected window');
  const whole = measureStrip(doc, 'whole', 'Whole session');
  strips.append(selected.strip, whole.strip);

  const frame = createPanelFrame({ panel: SESSION_LANES_PANEL, scope: { id }, transport, scheduler, doc });
  frame.element.dataset.chart = 'lanes';
  const body = frame.element.querySelector('.workspace-panel-body');
  const lanesSection = detailSection(doc, 'session-detail-lanes', 'Session events over time');
  const recordsSection = detailSection(doc, 'session-detail-records', 'Session records');
  body.replaceChildren(lanesSection.section);
  root.append(identity.section, strips, frame.element, recordsSection.section);

  let disposed = false;
  let controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let schema = null;
  let pageLimit = 100;
  let baseParams = null;
  let rows = [];
  let next = '';
  let pending = false;
  let recordsState = 'loading';
  let lanesState = 'loading';

  const get = (route, params, stateKey) => transport.get(route, params, { tenant, signal: controller.signal, stateKey });

  function renderSelected(row) {
    selected.body.replaceChildren();
    if (!row) {
      selected.state('empty', 'This session is not in the selected window.');
      return;
    }
    const dl = doc.createElement('dl');
    for (const item of formatTotals(row.m || {})) dl.append(el(doc, 'dt', '', item.label), el(doc, 'dd', '', item.value));
    selected.body.append(dl);
    selected.state('ready', `Selected window totals from /entities?grain=session&id=${encodeURIComponent(id)} with the applied filters.`);
  }

  function renderWhole(conversation) {
    whole.body.replaceChildren();
    const totals = conversation?.totals || null;
    if (!totals) {
      whole.state('error', 'Whole-session totals are unavailable.');
      return;
    }
    const dl = doc.createElement('dl');
    for (const item of formatTotals(totals)) dl.append(el(doc, 'dt', '', item.label), el(doc, 'dd', '', item.value));
    whole.body.append(dl);
    whole.state('ready', 'Whole session exception: these totals cover the whole run; the analytics filters do not narrow them.');
  }

  function renderRecords() {
    const table = recordsTable(doc, SESSION_RECORD_COLUMNS, rows);
    recordsSection.body.replaceChildren(table.wrapper);
    recordsSection.state('ready', '');
    if (next) {
      const more = el(doc, 'button', 'session-records-more', pending ? 'Loading…' : SESSION_RECORDS_MORE);
      more.type = 'button';
      more.disabled = pending;
      more.addEventListener('click', () => loadMore());
      recordsSection.body.append(more);
    }
    return table;
  }

  function renderRecordsState(nextState, text, detail = '') {
    recordsState = nextState;
    recordsSection.state(nextState === 'error' ? 'error' : nextState, '');
    const table = recordsTable(doc, SESSION_RECORD_COLUMNS, [], { state: nextState, text, detail });
    recordsSection.body.replaceChildren(table.wrapper);
    if (nextState === 'error' && next) {
      const retry = el(doc, 'button', 'session-records-retry', 'Retry next page');
      retry.type = 'button';
      retry.addEventListener('click', () => loadMore());
      recordsSection.body.append(retry);
    }
  }

  function renderLanes() {
    lanesSection.body.replaceChildren();
    if (!rows.length) {
      lanesSection.state('empty', 'No records match these filters.');
      lanesState = 'empty';
      return;
    }
    const model = sessionLaneModelFromRows(rows.slice(0, SESSION_MARK_LIMIT));
    const chart = doc.createElement('yk-lanes');
    chart.className = 'session-lanes-chart';
    chart.setAttribute('aria-label', 'Session events over time, one marker per loaded matching event');
    chart.spec = model.spec;
    chart.data = model.data;
    const views = mountPanelViews({ panelId: 'session-lanes-chart', chart, table: laneTableView(doc, model), doc, defaultView: 'chart', label: 'Session events view' });
    lanesSection.body.append(el(doc, 'p', 'session-lanes-caption', SESSION_LANES_CAPTION));
    lanesSection.body.append(el(doc, 'p', 'session-lanes-plotted', plottedStatement(model.data.length)));
    lanesSection.body.append(el(doc, 'p', 'session-lanes-basis', 'Each mark is one retained event; no duration is inferred between marks.'));
    lanesSection.body.append(views.element);
    lanesSection.state('ready', '');
    lanesState = 'ready';
  }

  async function loadMore() {
    if (pending || !next || !baseParams) return;
    pending = true;
    renderRecords();
    try {
      const params = pageParameters(baseParams, { cursor: next, limit: pageLimit });
      const { response, body: payload } = await get('explore', params, 'session-detail-events');
      if (disposed) return;
      if (!response.ok) {
        renderRecordsState('error', 'Could not load Session records.', sanitizeApiCode(payload?.code) || String(response.status));
        return;
      }
      const incoming = Array.isArray(payload.rows) ? payload.rows : [];
      rows = sessionRecordsModel(mergeRecordRows(rows, incoming));
      next = payload.next || '';
      renderRecords();
      renderLanes();
    } catch (error) {
      if (disposed || error?.name === 'AbortError') return;
      renderRecordsState('error', 'Could not load Session records.', sanitizeApiCode(error?.message) || '');
    } finally {
      pending = false;
    }
  }

  async function loadDetail() {
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 3 });
    identity.state('loading', 'Loading…');
    selected.state('loading', 'Loading…');
    whole.state('loading', 'Loading…');
    rows = [];
    next = '';
    recordsState = 'loading';
    lanesState = 'loading';
    renderRecordsState('loading', 'Loading Session records…');
    lanesSection.state('loading', 'Loading session events…');

    try {
      const result = await transport.schema(tenant);
      if (result?.response?.ok) schema = result.body;
    } catch { schema = null; }
    if (disposed) return;
    pageLimit = ledgerPageLimit(schema?.budgets?.explore_page_max);

    const recordsRefusal = sessionRecordsRefusal(state);
    const selectedRefusal = sessionSelectedRefusal(state);
    if (recordsRefusal) {
      renderRecordsState('unsupported', recordsRefusal.message);
      lanesSection.state('unsupported', recordsRefusal.message);
      lanesState = 'unsupported';
    }

    const wholeRequest = get('conversation', sessionWholeParams(id, state, { window: readContext?.window || null }), 'session-detail-whole');
    const selectedRequest = selectedRefusal ? null : get('entities', sessionWindowParams(id, state, { window: readContext?.window || null, limit: 1 }), 'session-detail-window');
    const recordsRequest = recordsRefusal ? null : (() => {
      baseParams = sessionExploreParams(id, state, { window: readContext?.window || null, limit: pageLimit });
      return get('explore', baseParams, 'session-detail-events');
    })();

    const [wholeResult, selectedResult, recordsResult] = await Promise.allSettled([
      wholeRequest, selectedRequest || Promise.resolve(null), recordsRequest || Promise.resolve(null)
    ]);
    if (disposed) return;

    // Whole-session identity and the labelled exception strip.
    const wholeAnswer = wholeResult.status === 'fulfilled' ? wholeResult.value : null;
    let frameError = null;
    if (wholeAnswer && wholeAnswer.response?.ok) {
      const conversation = wholeAnswer.body || {};
      identity.body.replaceChildren();
      const dl = doc.createElement('dl');
      dl.append(el(doc, 'dt', '', 'Conversation'), el(doc, 'dd', '', conversation.conversation_id || id));
      dl.append(el(doc, 'dt', '', 'Harness'), el(doc, 'dd', '', cellText(conversation.harness)));
      dl.append(el(doc, 'dt', '', 'Models'), el(doc, 'dd', '', (conversation.models || []).join(', ') || '—'));
      dl.append(el(doc, 'dt', '', 'Repos'), el(doc, 'dd', '', (conversation.repos || []).join(', ') || '—'));
      dl.append(el(doc, 'dt', '', 'First'), el(doc, 'dd', '', cellText(conversation.first_ts)));
      dl.append(el(doc, 'dt', '', 'Last'), el(doc, 'dd', '', cellText(conversation.last_ts)));
      identity.body.append(dl);
      renderLinks(identity.body, conversation, doc);
      identity.state('ready', '');
      renderWhole(conversation);
    } else {
      const status = wholeAnswer?.response?.status;
      const message = wholeAnswer?.body?.error || `Could not load this session (${status || 'no response'}).`;
      identity.body.replaceChildren(el(doc, 'p', 'session-detail-identity-id', `Conversation ${id}`));
      identity.state('error', message);
      whole.state('error', 'Whole-session totals are unavailable.');
      frameError = { message, retry: loadDetail };
    }

    // Selected-window summary, never substituted by the whole-run totals.
    if (selectedRefusal) {
      selected.body.replaceChildren();
      selected.state('unsupported', selectedRefusal.message);
    } else {
      const answer = selectedResult.status === 'fulfilled' ? selectedResult.value : null;
      if (answer && answer.response?.ok) {
        renderSelected((Array.isArray(answer.body?.rows) ? answer.body.rows : [])[0] || null);
      } else {
        selected.body.replaceChildren();
        selected.state('error', 'Could not load the selected window.');
      }
    }

    // Records and lanes, both from the same /explore read.
    if (!recordsRefusal) {
      const answer = recordsResult.status === 'fulfilled' ? recordsResult.value : null;
      if (answer && answer.response?.ok) {
        const incoming = Array.isArray(answer.body?.rows) ? answer.body.rows : [];
        rows = sessionRecordsModel(incoming);
        next = answer.body?.next || '';
        if (!rows.length) {
          renderRecordsState('empty', SESSION_RECORDS_EMPTY);
          lanesSection.state('empty', SESSION_RECORDS_EMPTY);
          lanesState = 'empty';
        } else {
          renderRecords();
          renderLanes();
        }
      } else {
        renderRecordsState('error', 'Could not load Session records.', sanitizeApiCode(answer?.body?.code) || String(answer?.response?.status || ''));
        lanesSection.state('error', 'Could not load Session events.');
        lanesState = 'error';
      }
    }

    if (frameError) frame.setState('error', frameError);
    else if (recordsRefusal) frame.setState('unsupported', { message: recordsRefusal.message });
    else if (recordsState === 'error') frame.setState('error', { message: 'Could not load Session records.', retry: loadDetail });
    else frame.setState('ready', {});
    frame.setBasis('event ts (UTC); one marker per loaded matching event; whole-session totals are a labelled exception');
  }

  loadDetail();
  return () => { disposed = true; controller.abort(); };
}

function mergeRecordRows(existing = [], incoming = []) {
  const seen = new Set(existing.map(row => `${row.ts}|${row.type}|${row.path || ''}|${row.event || ''}|${row.sha || ''}`));
  const merged = existing.slice();
  for (const row of incoming) {
    const key = `${row.ts}|${row.type}|${row.path || ''}|${row.event || ''}|${row.sha || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

export function render(root, doc = globalThis.document, { signal, tenant = '', readContext = null } = {}) {
  const route = parseRoute(globalThis.location?.pathname || '/', globalThis.location?.search || '');
  if (route.sessionId) return renderDetail(root, doc, { signal, id: route.sessionId, tenant, readContext });
  return renderList(root, doc, { signal, tenant, readContext });
}

export default { title, phase, render };
