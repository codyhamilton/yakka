// `/ledger` page module, lazy-loaded by the router. It mounts one
// `ledger-table` panel frame over `/v1/analytics/explore` and wires the shared
// chips, selection tray and inspector. The router and app.js are untouched.

import { decodeUrlState } from '../../contract/url-state.js';
import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { createPanelFrame } from '../panels/panel-frame.js';
import { hasPanel, registerPanel } from '../panels/registry.js';
import { createChips, addFilterChip, resetScopeState, stateUrl } from '../core/chips.js';
import { buildCohort, createSelectionTray, nextCohortSlot, writeCohort } from '../core/selection-tray.js';
import { createInspector } from '../core/inspector.js';
import { decodePick, encodePick } from '../core/selection-model.js';
import { emptyCauses } from '../core/panel-state.js';
import { currentEventCounts } from '../core/event-counts.js';
import {
  BASIS, DECLARED_FILTERS, LEDGER_CAPTION, LEDGER_LOADING_MORE_TEXT, LEDGER_MORE_TEXT,
  LEDGER_PANEL, LEDGER_RETRY_NEXT_TEXT, LEDGER_SCHEMA,
  appendPage, fetchLedgerPage, filterToParameters, formatRowCost, ledgerPageLimit, ledgerPopulationText,
  ledgerRowElement, mapLoadError, entityKeyForRow, pageParameters, renderLedgerNotes, renderLedgerState,
  renderLedgerTable, retryNextPage, rowKey, selectionGrain
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
  let pageLimit = 100;
  let disposed = false;
  let runId = 0;
  let pending = false;
  let nextPageError = '';
  let moreButton = null;
  let populationNode = null;
  let countsWatch = null;
  let tableShell = null;

  function countsModel() {
    const state = doc.querySelector?.('.event-counts')?.dataset?.state || '';
    if (state === 'success') return { counts: currentEventCounts(), state: 'ready' };
    return { counts: null, state };
  }

  function updatePopulation() {
    if (!populationNode) return;
    const { counts, state } = countsModel();
    const text = ledgerPopulationText({ loaded: rows.length, counts, state });
    if (populationNode.textContent !== text) populationNode.textContent = text;
  }

  function watchCounts() {
    if (typeof MutationObserver !== 'function' || !doc?.querySelector) return;
    let strip = doc.querySelector('.event-counts');
    let observer = null;
    const observeStrip = () => {
      if (!strip) return;
      observer = new MutationObserver(() => updatePopulation());
      observer.observe(strip, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-state'] });
      updatePopulation();
    };
    observeStrip();
    if (!strip) {
      observer = new MutationObserver(() => {
        strip = doc.querySelector('.event-counts');
        if (!strip) return;
        observer.disconnect();
        observeStrip();
      });
      observer.observe(doc.body || doc.documentElement, { childList: true, subtree: true });
    }
    countsWatch = { disconnect() { observer?.disconnect(); observer = null; } };
  }

  function allHistory() {
    return { ...state, win: 'all', from: '', to: '' };
  }

  function resetFilters() {
    return resetScopeState(state);
  }

  function commitScope(next) {
    router.pushScope(stateUrl(next, '', '/ledger'));
  }

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

  function renderFooter() {
    body.querySelector('.ledger-footer')?.remove();
    const footer = doc.createElement('div');
    footer.className = 'ledger-footer';

    populationNode = doc.createElement('p');
    populationNode.className = 'ledger-population';
    footer.append(populationNode);

    const noteHost = doc.createElement('div');
    renderLedgerNotes(noteHost, { rows, summary: 'Each row is one retained record; rows shown are the loaded pages, never a total.', doc });
    footer.append(noteHost);

    if (nextPageError) {
      const failure = doc.createElement('p');
      failure.className = 'ledger-next-error';
      failure.textContent = nextPageError;
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'ledger-load-more ledger-retry-next';
      retry.textContent = retryNextPage({ page: 'next', result: { state: 'error' } }).label || LEDGER_RETRY_NEXT_TEXT;
      retry.addEventListener('click', () => { nextPageError = ''; loadMore(); });
      footer.append(failure, retry);
    } else if (cursor) {
      moreButton = doc.createElement('button');
      moreButton.type = 'button';
      moreButton.className = 'ledger-load-more';
      moreButton.textContent = pending ? LEDGER_LOADING_MORE_TEXT : LEDGER_MORE_TEXT;
      moreButton.disabled = pending;
      moreButton.addEventListener('click', () => loadMore());
      footer.append(moreButton);
    } else {
      moreButton = null;
    }

    body.append(footer);
    updatePopulation();
    updateSelectionUI();
  }

  function showFirstPage() {
    tableShell = renderLedgerTable(body, {
      rows, selected, doc,
      onInspect: inspectRow,
      onSelect: selectRow
    });
    renderFooter();
  }

  function appendLoaded(newRows) {
    if (!tableShell) { showFirstPage(); return; }
    for (const row of newRows) {
      tableShell.body.append(ledgerRowElement(doc, row, { selected, body: tableShell.body, onInspect: inspectRow, onSelect: selectRow }));
    }
    renderFooter();
  }

  function stateHandlers() {
    return {
      'all-history': () => commitScope(allHistory()),
      'reset-filters': () => commitScope(resetFilters()),
      retry: () => firstPage()
    };
  }

  function clearPageState() {
    rows = [];
    cursor = '';
    truncated = false;
    nextPageError = '';
    pending = false;
    moreButton = null;
    populationNode = null;
    tableShell = null;
  }

  function attachPopulation() {
    populationNode = doc.createElement('p');
    populationNode.className = 'ledger-population';
    body.append(populationNode);
    updatePopulation();
  }

  function showFirstPageError(result) {
    clearPageState();
    frame.setState(result.state === 'unsupported' ? 'unsupported' : 'error', { ...result, renderStatus: false });
    renderLedgerState(body, 'error', {
      doc,
      caption: LEDGER_CAPTION,
      status: result.status,
      code: result.code,
      retry: firstPage,
      handlers: stateHandlers()
    });
    attachPopulation();
  }

  async function firstPage() {
    const id = ++runId;
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    clearPageState();
    frame.setState('loading', { inFlight: 1, renderStatus: false });
    renderLedgerState(body, 'loading', { doc, caption: LEDGER_CAPTION });
    base = readContext?.paramsFor
      ? readContext.paramsFor()
      : filterToParameters(state, { now: Date.now(), window: readContext?.window || null });
    try {
      const result = await fetchLedgerPage({ transport, params: pageParameters(base, { limit: pageLimit }), signal: controller.signal, stateKey: 'ledger', tenant });
      if (disposed || id !== runId) return;
      if (result.state === 'ready') {
        rows = result.rows;
        cursor = result.next || '';
        truncated = result.truncated;
        frame.setState('ready', { renderStatus: false });
        showFirstPage();
      } else if (result.state === 'empty') {
        clearPageState();
        frame.setState('empty', { causes: ledgerTableCauses(state, url => router.pushScope(url)), renderStatus: false });
        renderLedgerState(body, 'empty', { doc, caption: LEDGER_CAPTION, handlers: stateHandlers() });
        attachPopulation();
      } else {
        showFirstPageError(result);
      }
    } catch (error) {
      if (disposed || id !== runId) return;
      showFirstPageError(mapLoadError(error));
    }
  }

  async function loadMore() {
    if (!cursor || pending) return;
    const id = ++runId;
    pending = true;
    nextPageError = '';
    if (moreButton) {
      moreButton.disabled = true;
      moreButton.textContent = LEDGER_LOADING_MORE_TEXT;
    }
    try {
      const result = await fetchLedgerPage({ transport, params: pageParameters(base, { cursor, limit: pageLimit }), signal: controller.signal, stateKey: 'ledger', tenant });
      if (disposed || id !== runId) return;
      if (result.state !== 'ready') {
        pending = false;
        if (result.state === 'cancelled') return;
        nextPageError = retryNextPage({ page: 'next', result }).retryNextPage
          ? 'Could not load the next page.'
          : 'The next page did not arrive.';
        renderFooter();
        return;
      }
      const before = rows.length;
      const merged = appendPage(rows, result.rows);
      rows = merged.rows;
      cursor = result.next || '';
      truncated = result.truncated;
      pending = false;
      frame.setState('ready', { renderStatus: false });
      appendLoaded(rows.slice(before));
    } catch (error) {
      if (disposed || id !== runId) return;
      pending = false;
      const result = mapLoadError(error);
      if (result.state === 'cancelled') return;
      nextPageError = 'Could not load the next page.';
      renderFooter();
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

  watchCounts();
  resolvePageLimit().then(limit => {
    if (disposed) return;
    pageLimit = ledgerPageLimit(limit);
    firstPage();
  });

  function destroy() {
    disposed = true;
    controller.abort();
    countsWatch?.disconnect();
    inspector.destroy();
  }

  return destroy;
}

export default { title, phase, render };
