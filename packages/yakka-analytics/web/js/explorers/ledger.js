// `/ledger` page module, lazy-loaded by the router. It mounts one
// `ledger-table` panel frame over `/v1/analytics/explore` and wires the shared
// chips, selection tray and inspector. The router and app.js are untouched.

import { decodeUrlState } from '../../contract/url-state.js';
import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { createPanelFrame } from '../panels/panel-frame.js';
import { hasPanel, registerPanel } from '../panels/registry.js';
import { createChips, addFilterChip, stateUrl } from '../core/chips.js';
import { buildCohort, createSelectionTray, nextCohortSlot, writeCohort } from '../core/selection-tray.js';
import { createInspector } from '../core/inspector.js';
import { decodePick, encodePick } from '../core/selection-model.js';
import { emptyCauses } from '../core/panel-state.js';
import {
  BASIS, DECLARED_FILTERS, LEDGER_PANEL, LEDGER_SCHEMA,
  appendPage, fetchLedgerPage, filterToParameters, formatRowCost, mapLoadError,
  entityKeyForRow, pageParameters, pagingSummary, renderLedgerNotes, renderLedgerTable, rowKey, selectionGrain
} from '../panels/ledger-table.js';

export const title = 'Ledger';
export const phase = 9;

const scheduler = createScheduler();
const transport = createTransport(scheduler);
let stylesLoaded = false;

function loadStyles(doc) {
  if (stylesLoaded || doc.querySelector('link[href="/css/ledger.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/ledger.css';
  doc.head.append(link);
}

function register() {
  if (!hasPanel(LEDGER_PANEL.id)) registerPanel(LEDGER_PANEL);
}

function splitExclude(raw) {
  const text = String(raw || '');
  const at = text.indexOf(':');
  return at === -1 ? '' : text.slice(0, at);
}

// A scope element the panel does not apply, named without claiming it applied.
function unappliedFilter(state) {
  const declared = new Set(DECLARED_FILTERS);
  for (const key of Object.keys(state.filters || {})) if (!declared.has(key)) return key;
  for (const raw of state.exclude || []) {
    const lens = splitExclude(raw);
    if (lens && !declared.has(lens)) return lens;
  }
  for (const key of Object.keys(state.unknown || {})) return key;
  return '';
}

function currentState() {
  return decodeUrlState(globalThis.location?.search || '');
}

function replacePick(pick) {
  const params = new URLSearchParams(globalThis.location?.search || '');
  if (pick) params.set('pick', pick);
  else params.delete('pick');
  const query = params.toString();
  globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${query ? `?${query}` : ''}`);
}

// The shared chips/tray navigate through the app router; an explicit synthetic
// popstate re-renders the explorer in place, and the browser's own Back still
// restores the prior scope through app.js's router.
function routeAdapter() {
  const navigate = url => {
    globalThis.history.pushState(null, '', url);
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  };
  return { push: navigate, pushScope: navigate, replaceTransient: url => globalThis.history.replaceState(null, '', url) };
}

function ledgerTableCauses(state, push) {
  const filters = [];
  for (const [key, values] of Object.entries(state.filters || {})) {
    for (const value of values || []) {
      filters.push({
        key, label: `${key}: ${value}`,
        clear: () => {
          const next = { ...state, filters: { ...(state.filters || {}) } };
          next.filters[key] = (next.filters[key] || []).filter(item => item !== value);
          if (!next.filters[key].length) delete next.filters[key];
          push(stateUrl(next, '', '/ledger'));
        }
      });
    }
  }
  return emptyCauses({ filters });
}

export function render(root, doc = globalThis.document, { signal, tenant = '', readContext = null } = {}) {
  loadStyles(doc);
  register();
  root.replaceChildren();

  const heading = doc.createElement('h1');
  heading.textContent = title;
  const intro = doc.createElement('p');
  intro.className = 'ledger-intro';
  intro.textContent = 'The windowed event ledger. Every applied scope filter is a removable chip; filters this panel does not send are named, never claimed. Paging follows the server cursor.';
  root.append(heading, intro);

  const state = currentState();
  const frame = createPanelFrame({ panel: LEDGER_PANEL, scope: state, transport, scheduler, doc });
  frame.element.dataset.chart = 'table';
  frame.setBasis(BASIS);
  root.append(frame.element);
  const body = frame.element.querySelector('.workspace-panel-body');
  const notes = doc.createElement('div');
  notes.className = 'ledger-footer';

  const router = routeAdapter();
  const chips = createChips({ doc, router, path: '/ledger' });
  frame.chipSlot.append(chips.element);

  const declaredLine = doc.createElement('p');
  declaredLine.className = 'ledger-declared';
  declaredLine.textContent = `This panel applies: ${DECLARED_FILTERS.join(', ')}.`;
  frame.chooserSlot.append(declaredLine);
  const unmapped = unappliedFilter(state);
  if (unmapped) frame.chooserSlot.append(Object.assign(doc.createElement('p'), { className: 'ledger-unapplied', textContent: `not applied here: ${unmapped}` }));

  chips.update({ state, search: '', schema: LEDGER_SCHEMA, grain: 'event', unmapped, onClearSelection: () => clearSelection() });

  const inspector = createInspector({ doc, router, onAction: detail => handleInspector(detail, state, router) });
  const tray = createSelectionTray({ doc, router, path: '/ledger' });
  root.append(tray.element, inspector.element);

  const pick = decodePick(state.pick);
  const selected = new Map();
  for (const key of pick.include) selected.set(key, 'include');
  for (const key of pick.exclude) selected.set(key, 'exclude');

  let controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let rows = [];
  let base = null;
  let cursor = '';
  let truncated = false;
  let pageLimit;
  let disposed = false;
  let runId = 0;

  function selectedRows() {
    return rows.filter(row => selected.has(entityKeyForRow(row)));
  }

  function updateSelectionUI() {
    for (const tr of body.querySelectorAll('.ledger-row')) {
      const key = tr.dataset.entityKey;
      if (selected.has(key)) tr.dataset.selected = selected.get(key);
      else delete tr.dataset.selected;
      const box = tr.querySelector('.ledger-row-check');
      if (box) box.checked = selected.has(key);
    }
    updateTray();
  }

  function updateTray() {
    const chosen = selectedRows();
    const grain = selectionGrain(chosen);
    const currentPick = decodePick(currentState().pick);
    tray.update({
      state: currentState(),
      pick: currentPick,
      grain: grain.grain,
      unit: 'event row',
      population: { scope_n: rows.length, returned_n: rows.length, eligible_n: rows.length },
      selection: { include: currentPick.include, exclude: currentPick.exclude, sampled: false },
      schema: LEDGER_SCHEMA,
      search: '',
      now: Date.now(),
      onClear: () => clearSelection()
    });
  }

  function clearSelection() {
    selected.clear();
    replacePick('');
    updateSelectionUI();
  }

  function selectRow(row, { mode = 'include' } = {}) {
    const key = entityKeyForRow(row);
    if (selected.get(key) === mode) selected.delete(key);
    else selected.set(key, mode);
    const include = [...selected.entries()].filter(([, value]) => value === 'include').map(([value]) => value);
    const exclude = [...selected.entries()].filter(([, value]) => value === 'exclude').map(([value]) => value);
    replacePick(encodePick({ include, exclude }));
    updateSelectionUI();
  }

  function inspectRow(row, opener) {
    const grain = selectionGrain([row]);
    inspector.open({
      grain: grain.grain,
      key: grain.key || rowKey(row),
      title: `${row.type || 'event'} at ${row.ts || 'unknown time'}`,
      facts: [
        { label: 'Type', value: row.type },
        { label: 'Time', value: row.ts },
        { label: 'Conversation', value: row.conversation_id },
        { label: 'Repo', value: row.repo_id },
        { label: 'Plan', value: row.plan },
        { label: 'Kind', value: row.kind },
        { label: 'Path', value: row.path },
        { label: 'Stage', value: row.rejection_stage },
        { label: 'Cost', value: formatRowCost(row) }
      ],
      unit: 'event row',
      population: { scope_n: rows.length, returned_n: rows.length },
      opener: opener || null,
      url: globalThis.location.href
    });
  }

  function handleInspector(detail, current, activeRouter) {
    if (!detail || ['close', 'open', 'copy'].includes(detail.action)) return;
    const row = rows.find(item => entityKeyForRow(item) === String(detail.key)) || null;
    const grain = row ? selectionGrain([row]).grain : detail.grain;
    if (detail.action === 'filter') {
      const key = row?.conversation_id ? 'conversation_id' : row?.repo_id ? 'repo_id' : '';
      if (!key) return;
      activeRouter.pushScope(stateUrl(addFilterChip(current, key, row[key]), '', '/ledger'));
      return;
    }
    if (detail.action === 'exclude' || detail.action === 'cohort') {
      if (!detail.key || grain === 'event') return;
      const op = detail.action === 'exclude' ? 'exclude' : 'include';
      const nextState = op === 'exclude' ? { ...current, cmp: 'cohorts' } : current;
      const cohort = buildCohort({ state: current, pick: { include: [String(detail.key)], exclude: [] }, grain, schema: LEDGER_SCHEMA, op });
      activeRouter.pushScope(stateUrl(writeCohort(nextState, nextCohortSlot(current) || 'ca', cohort), '', '/ledger'));
    }
  }

  function renderRows(summary) {
    renderLedgerTable(body, {
      rows, selected, doc,
      onInspect: inspectRow,
      onSelect: selectRow
    });
    notes.replaceChildren();
    renderLedgerNotes(notes, { rows, summary, doc });
    body.append(notes);
  }

  function show() {
    const summaryText = pagingSummary({ shown: rows.length, truncated, hasNext: Boolean(cursor) });
    renderRows(summaryText);
    updateSelectionUI();
    if (cursor) {
      const more = doc.createElement('button');
      more.type = 'button';
      more.className = 'ledger-load-more';
      more.textContent = 'Load more';
      more.addEventListener('click', () => { more.disabled = true; loadMore(); });
      body.append(more);
    }
  }

  async function firstPage() {
    const id = ++runId;
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 1 });
    base = filterToParameters(state, { now: Date.now(), window: readContext?.window || null });
    try {
      const result = await fetchLedgerPage({ transport, params: pageParameters(base, { limit: pageLimit }), signal: controller.signal, stateKey: 'ledger', tenant });
      if (disposed || id !== runId) return;
      if (result.state === 'ready') {
        rows = result.rows;
        cursor = result.next || '';
        truncated = result.truncated;
        frame.setState('ready', {});
        show();
      } else if (result.state === 'empty') {
        rows = [];
        cursor = '';
        truncated = false;
        frame.setState('empty', { causes: ledgerTableCauses(state, url => router.pushScope(url)) });
        body.replaceChildren();
        notes.replaceChildren();
      } else {
        rows = [];
        body.replaceChildren();
        result.retry = firstPage;
        frame.setState(result.state, result);
      }
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = mapLoadError(error);
      result.retry = firstPage;
      frame.setState(result.state, result);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    const id = ++runId;
    frame.setState('loading', { inFlight: 1 });
    try {
      const result = await fetchLedgerPage({ transport, params: pageParameters(base, { cursor, limit: pageLimit }), signal: controller.signal, stateKey: 'ledger', tenant });
      if (disposed || id !== runId) return;
      if (result.state !== 'ready') {
        result.retry = loadMore;
        frame.setState(result.state, result);
        return;
      }
      const merged = appendPage(rows, result.rows);
      rows = merged.rows;
      cursor = result.next || '';
      truncated = result.truncated;
      frame.setState('ready', {});
      show();
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = mapLoadError(error);
      result.retry = loadMore;
      frame.setState(result.state, result);
    }
  }

  // The page budget comes from the server schema; the client hard-codes none.
  async function resolvePageLimit() {
    try {
      const { response, body } = await transport.schema(tenant);
      if (!response.ok || !body) return undefined;
      const budgets = body.budgets || {};
      const candidates = [budgets.explore_page_max, budgets.page_max].map(Number).filter(value => Number.isFinite(value) && value > 0);
      return candidates.length ? Math.min(...candidates) : undefined;
    } catch {
      return undefined;
    }
  }

  resolvePageLimit().then(limit => {
    if (disposed) return;
    pageLimit = limit;
    firstPage();
  });

  function destroy() {
    disposed = true;
    controller.abort();
    inspector.destroy();
  }

  return destroy;
}

export default { title, phase, render };
