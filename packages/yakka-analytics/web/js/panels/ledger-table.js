// `ledger-table` event panel: the windowed event table over `/v1/analytics/explore`.
// It owns the request parameters, cursor paging (append + dedupe), the table
// renderer, unpriced rendering and the basis text. Pure helpers are exported so
// the node checks and the explorer can share one definition.

import { formatNumber } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';

export const LEDGER_ROUTE = 'explore';

// The shared-filter dimensions this panel actually sends. A scope element
// outside this set is named "not applied here" and never sent.
export const DECLARED_FILTERS = [
  'repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id'
];

export const DECLARED_FILTER_SET = new Set(DECLARED_FILTERS);

export const ROW_FIELDS = [
  'type', 'ts', 'harness', 'repo_id', 'plan', 'kind', 'event', 'tool', 'norm_event', 'model',
  'path', 'conversation_id', 'source', 'sha', 'screen_verdict', 'rejection_stage', 'cost_usd', 'priced'
];

export const BASIS = 'event ts for facts and rejections; commit-sourced artifact versions carry Bash-hook time; late arrivals can appear after their event time';

const WINDOW_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 };

// The event grain's declared filter set, for the shared chips/tray modules.
// This is the panel's own declaration; it adds nothing to the server.
export const LEDGER_SCHEMA = { grains: { event: { filters: [...DECLARED_FILTERS] } } };

export const EMPTY_COLUMNS = [];

function iso(value) {
  return new Date(value).toISOString();
}

// Absolute window. `from`/`to` in the URL take precedence over `win`; a relative
// window is frozen to absolute bounds so every cursor page sends the same filter.
export function resolveWindow(state = {}, now = Date.now(), resolved = null) {
  if (resolved && typeof resolved === 'object') {
    return {
      from: resolved.all ? '' : (resolved.from ? iso(resolved.from) : ''),
      to: resolved.to ? iso(resolved.to) : iso(now),
      all: resolved.all === true
    };
  }
  const from = state.from ? iso(state.from) : '';
  const to = state.to ? iso(state.to) : '';
  if (from || to) {
    const absoluteTo = to || iso(now);
    const absoluteFrom = from || iso(Date.parse(absoluteTo) - 30 * 86400e3);
    return { from: absoluteFrom, to: absoluteTo, all: false };
  }
  const win = String(state.win || '30d');
  if (win === 'all') return { from: '', to: iso(now), all: true };
  const match = /^(\d+)([hdwmy])$/.exec(win);
  if (!match) return { from: iso(now - 30 * 86400e3), to: iso(now), all: false };
  return { from: iso(now - Number(match[1]) * WINDOW_MS[match[2]]), to: iso(now), all: false };
}

// Shared filter -> `/explore` query parameters. Only the declared filters are
// sent; an exclude on another lens is left out (and named by the explorer).
export function filterToParameters(state = {}, { now = Date.now(), window = null } = {}) {
  const params = new URLSearchParams();
  const resolved = resolveWindow(state, now, window);
  if (resolved.all) params.set('all', '1');
  if (resolved.from) params.set('from', resolved.from);
  if (resolved.to) params.set('to', resolved.to);
  const tz = state.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  params.set('tz', tz);
  for (const key of DECLARED_FILTERS) {
    for (const value of state.filters?.[key] || []) params.append(key, value);
  }
  for (const raw of state.exclude || []) {
    const at = String(raw).indexOf(':');
    const lens = at === -1 ? '' : String(raw).slice(0, at);
    if (DECLARED_FILTER_SET.has(lens)) params.append('exclude', raw);
  }
  return params;
}

// The next page reuses the frozen filter and only adds the cursor and limit;
// the server binds the cursor to the canonical filter string.
export function pageParameters(base, { cursor = '', limit = null } = {}) {
  const params = new URLSearchParams(base);
  if (cursor) params.set('cursor', cursor);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  return params;
}

// A row's identity across pages. Separators cannot collide with the pick
// grammar (comma/pipe are stripped), and every fact-bearing field participates.
export function rowKey(row = {}) {
  return ROW_FIELDS
    .map(field => String(row[field] ?? '').replace(/[,|]/g, ';'))
    .join('\u001f');
}

// The entity a selected row resolves to: session via conversation_id, artifact
// via repo/path, otherwise the row itself. Selection and tray actions use this
// key, not the per-row identity, so a cohort predicate names the entity.
export function entityKeyForRow(row = {}) {
  if (row.conversation_id) return String(row.conversation_id);
  if (row.repo_id && row.path) return `${row.repo_id}\u001f${row.path}`;
  return rowKey(row);
}

// Page append: preserve order, skip rows already shown, report what happened.
export function appendPage(existing = [], incoming = []) {
  const rows = [...existing];
  const seen = new Set(rows.map(rowKey));
  let added = 0;
  let duplicates = 0;
  for (const row of incoming) {
    const key = rowKey(row);
    if (seen.has(key)) { duplicates += 1; continue; }
    seen.add(key);
    rows.push(row);
    added += 1;
  }
  return { rows, added, duplicates };
}

export function displayedCount(rows = []) {
  return rows.length;
}

// The count of rows shown is never presented as a total when more remain.
export function pagingSummary({ shown = 0, truncated = false, hasNext = false } = {}) {
  const count = formatNumber(Number(shown) || 0);
  if (truncated && !hasNext) return `${count} rows shown; the server reported more rows but returned no cursor.`;
  if (hasNext) return `${count} rows shown; more rows remain.`;
  return `${count} rows shown; end of the ledger.`;
}

// `unpriced` is never `$0`; an absent cost is unpriced, not a free row.
export function formatRowCost(row = {}) {
  if (row.priced === false) return 'unpriced';
  if (row.cost_usd === null || row.cost_usd === undefined || row.cost_usd === '') return 'unpriced';
  const number = Number(row.cost_usd);
  if (!Number.isFinite(number)) return 'unpriced';
  return `$${number.toFixed(2)}`;
}

export function unpricedCount(rows = []) {
  return rows.reduce((total, row) => total + (formatRowCost(row) === 'unpriced' ? 1 : 0), 0);
}

export function costNote(rows = []) {
  const unpriced = unpricedCount(rows);
  if (!unpriced) return '';
  return `Cost shown is a lower bound; ${formatNumber(unpriced)} unpriced row${unpriced === 1 ? '' : 's'}.`;
}

// The contract's row-to-entity mapping for tray and inspector actions.
export function selectionGrain(rows = []) {
  if (!rows.length) return { grain: 'event', key: '', unit: 'event row' };
  const conversations = new Set(rows.map(row => row.conversation_id).filter(Boolean));
  if (conversations.size === 1 && rows.every(row => row.conversation_id)) {
    return { grain: 'session', key: [...conversations][0], unit: 'event row' };
  }
  const artifacts = rows.filter(row => row.repo_id && row.path);
  if (artifacts.length === rows.length) return { grain: 'artifact', key: artifacts[0].path, unit: 'event row' };
  return { grain: 'event', key: rows.map(rowKey).join(','), unit: 'event row' };
}

// The server's answer, classified into the one panel-state vocabulary.
export function mapExploreResponse({ status = 0, body = null } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!status) return errorState({ message: 'The server did not answer.', code: '' });
  if (status === 404) {
    return unsupportedState({
      feature: 'the /explore route', reason: 'this server does not serve it',
      source: 'the analytics server', nearest: 'a board over the same window'
    });
  }
  if (status === 409) {
    return errorState({ message: payload.error || 'analytics data changed during pagination; restart from the first page', code: payload.code || 'cursor_stale' });
  }
  if (status >= 400) return errorState({ message: payload.error || `The server returned ${status}.`, code: payload.code || String(status) });
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const next = typeof payload.next === 'string' && payload.next ? payload.next : null;
  const truncated = payload.truncated === true;
  if (!rows.length) return emptyState([]);
  return {
    state: 'ready', rows, next, truncated,
    population: payload.population && typeof payload.population === 'object' ? payload.population : null,
    basis: BASIS
  };
}

export function mapLoadError(error) {
  if (error?.name === 'AbortError') return cancelledState();
  return errorState({ message: error?.message || 'The ledger request failed.' });
}

// Fetch one page. Throws only on an abort; every other answer is classified.
export async function fetchLedgerPage({ transport, params, signal, stateKey = 'ledger', tenant = '' } = {}) {
  const { response, body } = await transport.get(LEDGER_ROUTE, params, { signal, stateKey, tenant });
  return mapExploreResponse({ status: response.status, body });
}

// --- Rendering -----------------------------------------------------------

function el(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function cellText(row, field) {
  const value = row?.[field];
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

const COLUMNS = [
  { field: 'ts', label: 'Time (UTC)' },
  { field: 'type', label: 'Type' },
  { field: 'norm_event', label: 'Event' },
  { field: 'harness', label: 'Harness' },
  { field: 'repo_id', label: 'Repo' },
  { field: 'plan', label: 'Plan' },
  { field: 'kind', label: 'Kind' },
  { field: 'tool', label: 'Tool' },
  { field: 'model', label: 'Model' },
  { field: 'conversation_id', label: 'Conversation' },
  { field: 'path', label: 'Path' },
  { field: 'source', label: 'Source' },
  { field: 'rejection_stage', label: 'Stage' },
  { field: 'cost_usd', label: 'Cost', cost: true }
];

// A real table with a caption, scoped headers, checkbox selection, keyboard row
// navigation and visible focus. Selection and inspection are emitted through
// callbacks; the table never fetches.
export function renderLedgerTable(container, { rows = [], selected = new Map(), doc = globalThis.document, onInspect, onSelect } = {}) {
  container.replaceChildren();
  const wrapper = el(doc, 'div', 'ledger-table-wrap');
  const table = el(doc, 'table', 'ledger-table');
  table.append(el(doc, 'caption', 'ledger-caption', `Windowed events, ${formatNumber(rows.length)} rows shown. Every row is one event; cost is per row.`));

  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  const selectHead = el(doc, 'th', 'ledger-select-head', 'Select');
  selectHead.scope = 'col';
  headRow.append(selectHead);
  for (const column of COLUMNS) {
    const th = el(doc, 'th', column.cost ? 'numeric' : '', column.label);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);

  const body = doc.createElement('tbody');
  body.className = 'ledger-body';

  rows.forEach((row, index) => {
    const key = rowKey(row);
    const entityKey = entityKeyForRow(row);
    const state = selected.get(entityKey) === 'exclude' ? 'exclude' : selected.has(entityKey) ? 'include' : '';
    const tr = el(doc, 'tr', 'ledger-row');
    tr.dataset.rowKey = key;
    tr.dataset.entityKey = entityKey;
    tr.dataset.type = row.type || '';
    tr.dataset.ts = row.ts || '';
    if (state) tr.dataset.selected = state;
    tr.tabIndex = 0;
    tr.setAttribute('role', 'row');

    const selectCell = el(doc, 'td', 'ledger-select');
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.className = 'ledger-row-check';
    box.checked = selected.has(entityKey);
    box.setAttribute('aria-label', `Select ${row.type || 'event'} at ${row.ts || 'unknown time'}`);
    box.addEventListener('click', event => {
      event.stopPropagation();
      onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' });
    });
    selectCell.append(box);
    tr.append(selectCell);

    for (const column of COLUMNS) {
      tr.append(el(doc, 'td', column.cost ? 'numeric ledger-cost' : '', column.cost ? formatRowCost(row) : cellText(row, column.field)));
    }
    tr.addEventListener('click', event => {
      if (event.target.closest('input,button,a')) return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' });
        return;
      }
      onInspect?.(row, tr);
    });
    tr.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); onInspect?.(row, tr); return; }
      if (event.key === ' ') { event.preventDefault(); onSelect?.(row, { mode: event.altKey ? 'exclude' : 'include' }); return; }
      if (event.key === 'x' || event.key === 'X') { event.preventDefault(); onSelect?.(row, { mode: 'exclude' }); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const all = [...body.querySelectorAll('.ledger-row')];
        const at = all.indexOf(tr);
        const nextAt = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : at + (event.key === 'ArrowDown' ? 1 : -1);
        all[Math.max(0, Math.min(all.length - 1, nextAt))]?.focus();
      }
    });
    body.append(tr);
  });

  table.append(head, body);
  wrapper.append(table);
  container.append(wrapper);
  return container;
}

// A small, honest footer: declared filters, rows shown and the unpriced lower bound.
export function renderLedgerNotes(container, { rows = [], summary = '', declared = DECLARED_FILTERS, doc = globalThis.document } = {}) {
  const note = el(doc, 'p', 'ledger-notes');
  const parts = [summary, `applies: ${declared.join(', ')}`, costNote(rows)].filter(Boolean);
  note.textContent = parts.join(' · ');
  container.append(note);
}

// The panel's first page; the explorer owns "Load more", so this is the shape a
// frame-driven caller would get. It never requests page one twice on its own.
export async function loadLedger({ scope = {}, transport, signal, tenant = '', stateKey = 'ledger', limit = null } = {}) {
  const base = filterToParameters(scope, { now: Date.now() });
  try {
    const result = await fetchLedgerPage({ transport, params: pageParameters(base, { limit }), signal, stateKey, tenant });
    return result;
  } catch (error) {
    return mapLoadError(error);
  }
}

export const LEDGER_PANEL = {
  id: 'ledger-table',
  title: 'Event ledger',
  grain: 'event',
  measures: [],
  lenses: [...DECLARED_FILTERS],
  charts: [],
  table: true,
  requires: [],
  caveats: 'Windowed event rows paged by cursor. Rejections use the server receive time; commit-sourced versions carry Bash-hook time; late arrivals can appear after their event time. Cost is per row and unpriced rows are never $0.',
  measureBasis: BASIS,
  filters: DECLARED_FILTERS,
  requests: () => [{ route: '/v1/analytics/explore', method: 'GET' }],
  load: (context = {}) => loadLedger({
    scope: context.scope || {},
    transport: context.transport,
    signal: context.signal,
    tenant: context.tenant || ''
  })
};

export default LEDGER_PANEL;
