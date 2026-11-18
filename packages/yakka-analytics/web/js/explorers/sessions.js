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
import { hasPanel, registerPanel } from '../panels/registry.js';
import { addFilterChip, createChips, stateUrl } from '../core/chips.js';
import { buildCohort, createSelectionTray, nextCohortSlot, writeCohort } from '../core/selection-tray.js';
import { createInspector } from '../core/inspector.js';
import { cancelledState, emptyCauses, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatNumber } from '../charts/formatters.js';
import { resolveWindow } from '../panels/ledger-table.js';
import {
  SESSION_LANES_PANEL, conversationCoverage, coverageLines, ensureSessionsStyles, fetchConversation,
  renderSessionLanes
} from '../panels/session-lanes.js';

export const title = 'Sessions';
export const phase = 11;

export const SESSION_MEASURES = [
  'cost_usd', 'unpriced_calls', 'model_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'commits', 'artifact_versions',
  'distinct_content', 'duration_s', 'first_ts', 'last_ts'
];

export const SESSION_FILTERS = ['harness', 'session_model', 'session_repo', 'origin', 'has_artifacts', 'id'];
export const DEFAULT_SORT = 'last_ts:desc';

export const SESSIONS_LIST_PANEL = {
  id: 'sessions-list',
  title: 'Sessions',
  grain: 'session',
  measures: SESSION_MEASURES,
  lenses: SESSION_FILTERS,
  charts: [],
  table: true,
  requires: ['entities_session'],
  caveats: 'Server-sorted, cursor-paged session list. Measures are in-window; cost is a lower bound when calls are unpriced and never $0.',
  measureBasis: 'session facts.ts window; totals come from the server population, never a returned page'
};

const scheduler = createScheduler();
const transport = createTransport(scheduler);

const LIST_COLUMNS = [
  { key: 'harness', label: 'Harness', lens: true },
  { key: 'session_model', label: 'Session model', lens: true },
  { key: 'session_repo', label: 'Session repo', lens: true },
  { key: 'cost_usd', label: 'Cost', measure: true },
  { key: 'model_calls', label: 'Calls', measure: true },
  { key: 'unpriced_calls', label: 'Unpriced', measure: true },
  { key: 'hook_events', label: 'Events', measure: true },
  { key: 'commits', label: 'Commits', measure: true },
  { key: 'artifact_versions', label: 'Artifacts', measure: true },
  { key: 'duration_s', label: 'Span (s)', measure: true }
];

// `sort` is not a shared-filter key, so decodeUrlState keeps it under `unknown`.
export function parseSort(raw, allowed = SESSION_MEASURES) {
  const text = String(raw || '');
  const at = text.lastIndexOf(':');
  const measure = at === -1 ? text : text.slice(0, at);
  const dir = at === -1 ? '' : text.slice(at + 1);
  const fallback = allowed.includes('last_ts') ? 'last_ts' : (allowed[0] || 'last_ts');
  if (!text) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  if (!allowed.includes(measure)) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  const direction = dir === 'asc' ? 'asc' : 'desc';
  return { measure, dir: direction, raw: `${measure}:${direction}` };
}

export function allowedMeasures(schema) {
  const published = schema?.grains?.session?.measures;
  if (!Array.isArray(published) || !published.length) return SESSION_MEASURES.slice();
  const filtered = published.filter(name => SESSION_MEASURES.includes(name));
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
export function sessionListParams({ state = {}, filters = SESSION_FILTERS, measures = SESSION_MEASURES, sort = DEFAULT_SORT, limit = null, cursor = '', now = Date.now() } = {}) {
  const scope = readScope(state, filters);
  const params = new URLSearchParams();
  const window = resolveWindow(scope, now);
  if (window.all) params.set('all', '1');
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  const tz = scope.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  params.set('tz', tz);
  params.set('grain', 'session');
  for (const key of filters) {
    for (const value of scope.filters?.[key] || []) params.append(key, value);
  }
  for (const raw of scope.exclude || []) {
    const lens = lensOf(raw);
    if (filters.includes(lens)) params.append('exclude', raw);
  }
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
  if (!status) return errorState({ message: 'The server did not answer.', code: '' });
  if (status === 404) {
    return unsupportedState({
      feature: '/entities?grain=session', reason: 'this server does not serve it', source: 'the analytics server',
      nearest: 'the LEDGER over the same window'
    });
  }
  if (status >= 400) return errorState({ message: payload.error || `The server returned ${status}.`, code: payload.code || String(status) });
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

function renderSessionsTable(container, { rows = [], selected = new Map(), doc = globalThis.document, onInspect, onSelect, onOpen } = {}) {
  container.replaceChildren();
  const table = doc.createElement('table');
  table.className = 'sessions-table';
  table.append(el(doc, 'caption', '', `Sessions, ${formatNumber(rows.length)} rows shown. Identity is the conversation id; open one for its bounded timeline.`));
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const label of ['Select', 'Conversation', ...LIST_COLUMNS.map(column => column.label), 'Open']) {
    const th = el(doc, 'th', '', label); th.scope = 'col'; head.append(th);
  }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  tbody.className = 'sessions-body';
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
    tr.append(selectCell);
    tr.append(el(doc, 'td', 'sessions-id', key));

    for (const column of LIST_COLUMNS) {
      const text = column.key === 'cost_usd' ? formatSessionCost(row) : cellText(row.m?.[column.key] ?? row.l?.[column.key]);
      const td = el(doc, 'td', column.measure ? 'numeric' : '', text);
      td.dataset.key = column.key;
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
  table.append(thead, tbody);
  container.append(table);
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

function renderList(root, doc, { signal } = {}) {
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

  function openRow(row) {
    router.push(`/sessions/${encodeURIComponent(String(row.id))}`);
  }

  function inspectRow(row, opener) {
    inspector.open({
      grain: 'session', key: String(row.id), title: `Session ${row.id}`,
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
    notes.append(el(doc, 'p', 'sessions-note', cursor ? 'More sessions remain; use Load more.' : 'End of the server result.'));
    body.append(notes);
    updateSelectionUI();
    if (cursor) {
      const more = el(doc, 'button', 'sessions-load-more', 'Load more');
      more.type = 'button';
      more.addEventListener('click', () => { more.disabled = true; loadMore(); });
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
      option.textContent = name;
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
      option.textContent = value;
      option.selected = value === sort.dir;
      direction.append(option);
    }
    direction.addEventListener('change', () => pushSort(sort.measure, direction.value));
    sortBar.append(measure, direction);
    sortBar.append(el(doc, 'span', 'session-sort-current', `server sort: ${sort.raw}`));
  }

  async function firstPage() {
    const id = ++runId;
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 1 });
    base = sessionListParams({ state: currentScope(), filters, measures, sort: sort.raw, limit: pageLimit });
    try {
      const { response, body: payload } = await transport.get('entities', base, { signal: controller.signal, stateKey: 'sessions' });
      if (disposed || id !== runId) return;
      const result = mapSessionListResponse({ status: response.status, body: payload });
      if (result.state === 'ready') {
        rows = result.rows;
        population = result.population;
        cursor = result.next || '';
        frame.setState('ready', {});
        frame.setPopulation(population);
        show();
      } else if (result.state === 'empty') {
        rows = []; population = null; cursor = '';
        body.replaceChildren(); notes.replaceChildren();
        frame.setState('empty', { causes: listCauses(currentScope(), url => router.pushScope(url)) });
      } else {
        result.retry = firstPage;
        body.replaceChildren();
        frame.setState(result.state, result);
      }
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = error?.name === 'AbortError'
        ? cancelledState({ retry: firstPage })
        : errorState({ message: error?.message || 'The sessions request failed.', retry: firstPage });
      frame.setState(result.state, result);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    const id = ++runId;
    frame.setState('loading', { inFlight: 1 });
    try {
      const { response, body: payload } = await transport.get('entities', sessionPageParams(base, { cursor, limit: pageLimit }), { signal: controller.signal, stateKey: 'sessions' });
      if (disposed || id !== runId) return;
      const result = mapSessionListResponse({ status: response.status, body: payload });
      if (result.state !== 'ready') { result.retry = loadMore; frame.setState(result.state, result); return; }
      rows = mergeSessionRows(rows, result.rows).rows;
      population = result.population || population;
      cursor = result.next || '';
      frame.setState('ready', {});
      frame.setPopulation(population);
      show();
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = error?.name === 'AbortError'
        ? cancelledState({ retry: loadMore })
        : errorState({ message: error?.message || 'The next page failed.', retry: loadMore });
      frame.setState(result.state, result);
    }
  }

  function paintScope() {
    const scope = currentScope();
    chips.update({ state: scope, search: '', schema: schema || { grains: { session: { filters } } }, grain: 'session', unmapped: unappliedFilter(scope, filters) });
    renderSort();
  }

  async function start() {
    let body = null;
    try {
      const result = await transport.schema('');
      if (result.response.ok) body = result.body;
    } catch { body = null; }
    if (disposed) return;
    schema = body;
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
      item.append(anchor, doc.createTextNode(' — artifact reader is Phase 12'));
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
      item.append(anchor, doc.createTextNode(' — plan detail is Phase 12'));
      list.append(item);
    }
    section.append(list);
  }
  host.append(section);
}

function renderDetail(root, doc, { signal, id } = {}) {
  ensureSessionsStyles(doc);
  register();
  root.replaceChildren();
  const heading = el(doc, 'h1', '', `Session ${id}`);
  const back = el(doc, 'a', 'sessions-back', 'Back to sessions');
  back.href = '/sessions';
  root.append(heading, back);

  const frame = createPanelFrame({ panel: SESSION_LANES_PANEL, scope: { id }, transport, scheduler, doc });
  frame.element.dataset.chart = 'lanes';
  root.append(frame.element);
  const body = frame.element.querySelector('.workspace-panel-body');
  const header = el(doc, 'div', 'session-detail-facts');
  const coverageSlot = el(doc, 'div', 'session-coverage');
  const ledgerSlot = el(doc, 'p', 'session-ledger');
  frame.chipSlot.append(header, coverageSlot, ledgerSlot);

  let disposed = false;
  let controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  async function loadDetail() {
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 1 });
    try {
      const result = await fetchConversation({ transport, id, scope: conversationScope(decodeUrlState(globalThis.location?.search || '')), signal: controller.signal, stateKey: 'sessions-detail' });
      if (disposed) return;
      if (result.state !== 'ready') { result.retry = loadDetail; frame.setState(result.state, result); return; }
      const conversation = result.conversation;
      const coverage = conversationCoverage(conversation);
      header.replaceChildren();
      const dl = doc.createElement('dl');
      dl.append(el(doc, 'dt', '', 'Conversation'), el(doc, 'dd', '', conversation.conversation_id || id));
      dl.append(el(doc, 'dt', '', 'Harness'), el(doc, 'dd', '', cellText(conversation.harness)));
      dl.append(el(doc, 'dt', '', 'Models'), el(doc, 'dd', '', (conversation.models || []).join(', ') || '—'));
      dl.append(el(doc, 'dt', '', 'Repos'), el(doc, 'dd', '', (conversation.repos || []).join(', ') || '—'));
      dl.append(el(doc, 'dt', '', 'First'), el(doc, 'dd', '', cellText(conversation.first_ts)));
      dl.append(el(doc, 'dt', '', 'Last'), el(doc, 'dd', '', cellText(conversation.last_ts)));
      header.append(dl);

      coverageSlot.replaceChildren();
      for (const line of coverageLines(coverage)) coverageSlot.append(el(doc, 'p', 'session-coverage-line', line));
      renderTotals(coverageSlot, 'Whole-run totals', conversation.totals, doc);
      if (conversation.window_totals) renderTotals(coverageSlot, 'Window totals', conversation.window_totals, doc);
      renderLinks(coverageSlot, conversation, doc);

      ledgerSlot.replaceChildren();
      const ledger = el(doc, 'a', 'session-ledger-link', 'Paged ledger for omitted events');
      ledger.href = `/ledger?conversation_id=${encodeURIComponent(conversation.conversation_id || id)}`;
      ledgerSlot.append(ledger, doc.createTextNode(' — reaches events beyond the /conversation cap.'));

      renderSessionLanes(body, conversation, doc);
      frame.setState('ready', {});
      frame.setBasis('event ts (UTC); marks are returned events only; whole-run totals and the cap are stated separately');
    } catch (error) {
      if (disposed) return;
      const result = error?.name === 'AbortError'
        ? cancelledState({ retry: loadDetail })
        : errorState({ message: error?.message || 'The conversation request failed.', retry: loadDetail });
      frame.setState(result.state, result);
    }
  }

  loadDetail();
  return () => { disposed = true; controller.abort(); };
}

export function render(root, doc = globalThis.document, { signal } = {}) {
  const route = parseRoute(globalThis.location?.pathname || '/', globalThis.location?.search || '');
  if (route.sessionId) return renderDetail(root, doc, { signal, id: route.sessionId });
  return renderList(root, doc, { signal });
}

export default { title, phase, render };
