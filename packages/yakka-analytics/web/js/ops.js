// `/ops` page module, lazy-loaded by the router. Region order is fixed:
// Tenant health, Retained storage (the administrator-session read), then the
// recent retained records from `/explore`. Nothing here guesses admin rights.

import { createScheduler } from './core/request-scheduler.js';
import { createTransport } from '../contract/transport.js';
import { rememberedTenant } from '../contract/session-gate.js';
import { formatNumber } from './charts/formatters.js';
import { registerCaption } from './panels/captions.js';
import { appendPage, fetchLedgerPage, ledgerPageLimit, pageParameters } from './panels/ledger-table.js';
import {
  ADMIN_ONLY_TEXT, FOOTPRINT_CAPTION, FOOTPRINT_EMPTY_TEXT, FOOTPRINT_ERROR_TEXT, FOOTPRINT_LOADING_TEXT,
  OPS_PANEL, renderFootprint
} from './panels/ops-footprint.js';

export const title = 'Operations';
export const phase = 9;

export const HEALTH_CAPTION = 'Tenant health';
export const HEALTH_LOADING_TEXT = 'Loading Tenant health…';
export const HEALTH_ERROR_TEXT = 'Could not load Tenant health.';
export const RECORDS_CAPTION = 'Recent retained records';
export const RECORDS_LOADING_TEXT = 'Loading Recent retained records…';
export const RECORDS_EMPTY_TEXT = 'No records match these filters.';
export const RECORDS_ERROR_TEXT = 'Could not load Recent retained records.';
export const RECORDS_MORE_TEXT = 'Load more events';
export const RECORDS_LOADING_MORE_TEXT = 'Loading…';
export const RECORDS_RETRY_NEXT_TEXT = 'Retry next page';
export const METADATA_NOTICE = 'All retained data in selected tenant; analytics time and repository filters do not apply.';

export const RECORD_COLUMNS = Object.freeze([
  { key: 'time', label: 'Time', width: 150 },
  { key: 'type', label: 'Type', width: 120 },
  { key: 'path', label: 'Path/event', width: null },
  { key: 'stage', label: 'Stage', width: 100 }
]);

registerCaption('ops-footprint', FOOTPRINT_CAPTION);

const scheduler = createScheduler();
const transport = createTransport(scheduler);
let stylesLoaded = false;

function loadStyles(doc) {
  if (stylesLoaded || doc.querySelector('link[href="/css/ops.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/ops.css';
  doc.head.append(link);
}

function el(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function countCell(value) {
  const number = numberOrNull(value);
  return number === null ? '—' : formatNumber(number);
}

function kindFromScope(scope = {}) {
  const nested = scope?.filters?.kind;
  const direct = scope?.kind;
  const value = Array.isArray(nested) ? nested[0] : nested || (Array.isArray(direct) ? direct[0] : direct);
  return value ? String(value) : 'design';
}

export function healthRows({ summary = null, eventCounts = null, schema = null, kind = 'design' } = {}) {
  const coverage = schema?.coverage || {};
  const byKind = coverage?.scored_content_by_kind?.[kind] || null;
  const total = numberOrNull(byKind?.total);
  const scored = numberOrNull(byKind?.scored);
  const unscored = total !== null && scored !== null ? Math.max(0, total - scored) : null;
  return [
    {
      id: 'unpriced',
      measure: 'Unpriced calls',
      count: numberOrNull(summary?.unpriced_calls),
      meaning: 'Calls with no usable price'
    },
    {
      id: 'unscored',
      measure: `Unscored ${kind} content versions (all history)`,
      count: unscored,
      meaning: `Distinct content versions; ${METADATA_NOTICE}`
    },
    {
      id: 'rejected',
      measure: 'Rejected submissions',
      count: numberOrNull(eventCounts?.matched?.rejections),
      meaning: 'Submissions rejected at precheck or screen'
    },
    {
      id: 'unattributed',
      measure: 'Sessions without repository attribution (all history)',
      count: numberOrNull(coverage?.sessions?.without_session_repo),
      meaning: METADATA_NOTICE
    }
  ];
}

function recordType(type) {
  if (type === 'rejection') return 'Rejection';
  if (type === 'artifact_version') return 'Artifact version';
  if (type === 'hook_event') return 'Hook event';
  if (type === 'session_start') return 'Session start';
  if (type === 'execution') return 'Execution';
  if (type === 'commit') return 'Commit';
  return type ? String(type).replace(/_/g, ' ') : '—';
}

function recordTime(value) {
  const at = Date.parse(value || '');
  if (!Number.isFinite(at)) return '—';
  return new Date(at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export function recordCells(row = {}) {
  const path = row.path || row.event || '—';
  const link = row.repo_id && row.path
    ? `/artifact?${new URLSearchParams({ repo_id: row.repo_id, path: row.path })}`
    : '';
  return {
    time: recordTime(row.ts),
    type: recordType(row.type),
    path,
    stage: row.rejection_stage || '—',
    link
  };
}

export function recordsPagingText({ shown = 0, hasNext = false } = {}) {
  const count = formatNumber(Number(shown) || 0);
  return `${count} rows shown${hasNext ? '; more rows remain.' : '; end of the ledger.'}`;
}

function tableCols(doc, columns) {
  const group = doc.createElement('colgroup');
  for (const column of columns) {
    const col = doc.createElement('col');
    if (column.width) col.setAttribute('width', String(column.width));
    group.append(col);
  }
  return group;
}

function tableHead(doc, columns) {
  const head = doc.createElement('thead');
  const row = doc.createElement('tr');
  for (const column of columns) {
    const cell = el(doc, 'th', '', column.label);
    cell.scope = 'col';
    if (column.width) cell.setAttribute('width', String(column.width));
    row.append(cell);
  }
  head.append(row);
  return head;
}

function statusRow(doc, columns, text, { busy = false, code = '', onRetry = null, onAll = null, onReset = null } = {}) {
  const row = doc.createElement('tr');
  row.dataset.state = busy ? 'loading' : 'status';
  if (busy) row.setAttribute('aria-busy', 'true');
  const cell = el(doc, 'td', '', `${text}${code ? ` (${code})` : ''}`);
  cell.colSpan = columns.length;
  row.append(cell);
  const add = (label, handler) => {
    if (!handler) return;
    const button = el(doc, 'button', '', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    cell.append(' ', button);
  };
  add('Retry', onRetry);
  add('All history', onAll);
  add('Reset filters', onReset);
  return row;
}

function operationsTable(doc, { caption, columns, rows, state, message, code = '', onRetry = null, onAll = null, onReset = null } = {}) {
  const table = el(doc, 'table', 'ops-table');
  table.append(el(doc, 'caption', '', caption), tableCols(doc, columns), tableHead(doc, columns));
  const body = doc.createElement('tbody');
  if (state === 'loading' || state === 'error' || state === 'empty') {
    body.append(statusRow(doc, columns, message, { busy: state === 'loading', code, onRetry, onAll, onReset }));
  } else {
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const cellData of row) {
        const cell = el(doc, 'td', '', cellData.text);
        if (cellData.title) cell.title = cellData.title;
        if (cellData.link) {
          const link = el(doc, 'a', 'ops-record-open', cellData.text);
          link.href = cellData.link;
          cell.replaceChildren(link);
        }
        tr.append(cell);
      }
      body.append(tr);
    }
  }
  table.append(body);
  return table;
}

export function render(root, doc = globalThis.document, { signal, tenant = '', readContext = null } = {}) {
  loadStyles(doc);
  root.replaceChildren();
  root.append(el(doc, 'h1', '', title));

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let disposed = false;
  let tenantValue = tenant;
  let schema = null;
  let kind = kindFromScope(readContext?.scope || {});
  const baseParams = () => (readContext?.paramsFor ? readContext.paramsFor() : new URLSearchParams());

  const healthSection = el(doc, 'section', 'workspace-panel ops-health');
  const healthHeading = el(doc, 'h2', 'workspace-panel-title', HEALTH_CAPTION);
  const healthBody = el(doc, 'div', 'ops-health-body');
  healthSection.append(healthHeading, healthBody);
  root.append(healthSection);

  const footprintSection = el(doc, 'section', 'workspace-panel ops-footprint');
  footprintSection.dataset.panel = 'ops-footprint';
  footprintSection.dataset.chart = 'bars';
  footprintSection.dataset.state = 'loading';
  footprintSection.dataset.idle = 'false';
  footprintSection.append(el(doc, 'h2', 'workspace-panel-title', 'Retained storage'));
  footprintSection.append(el(doc, 'p', 'workspace-panel-caption', FOOTPRINT_CAPTION));
  const footprintBody = el(doc, 'div', 'ops-footprint-body');
  const footprintStatus = el(doc, 'p', 'workspace-panel-status');
  footprintStatus.setAttribute('aria-live', 'polite');
  footprintSection.append(footprintBody, footprintStatus);
  root.append(footprintSection);

  const recordsSection = el(doc, 'section', 'workspace-panel ops-records');
  recordsSection.append(el(doc, 'h2', 'workspace-panel-title', RECORDS_CAPTION));
  const recordsBody = el(doc, 'div', 'ops-records-body');
  const recordsFooter = el(doc, 'div', 'ops-records-footer');
  recordsSection.append(recordsBody, recordsFooter);
  root.append(recordsSection);

  function setFootprintState(state, message = '', code = '', retry = null) {
    footprintSection.dataset.state = state;
    footprintSection.dataset.idle = state === 'loading' ? 'false' : 'true';
    footprintStatus.replaceChildren();
    if (state === 'ready') return;
    footprintStatus.textContent = `${message}${code ? ` (${code})` : ''}`;
    if (retry) {
      const button = el(doc, 'button', '', 'Retry');
      button.type = 'button';
      button.addEventListener('click', retry, { once: true });
      footprintStatus.append(' ', button);
    }
  }

  async function loadHealth() {
    healthBody.replaceChildren(operationsTable(doc, {
      caption: HEALTH_CAPTION, columns: [
        { key: 'measure', label: 'Measure', width: 240 },
        { key: 'count', label: 'Count', width: 120 },
        { key: 'meaning', label: 'Meaning', width: null }
      ], state: 'loading', message: HEALTH_LOADING_TEXT, rows: []
    }));
    let summary = null;
    let eventCounts = null;
    let healthError = null;
    const countsRead = schema?.features?.event_counts
      ? transport.get('event-counts', baseParams(), { tenant: tenantValue, signal: controller.signal, stateKey: 'ops-event-counts' }).catch(error => ({ error }))
      : Promise.resolve(null);
    const [summaryResult, countsResult, schemaResult] = await Promise.all([
      transport.get('summary', baseParams(), { tenant: tenantValue, signal: controller.signal, stateKey: 'ops-summary' }).catch(error => ({ error })),
      countsRead,
      transport.schema(tenantValue).catch(error => ({ error }))
    ]);
    if (disposed) return;
    if (summaryResult?.response?.ok) summary = summaryResult.body;
    else healthError = { status: summaryResult?.response?.status || 0, code: summaryResult?.body?.code || '', message: summaryResult?.body?.error || '' };
    if (countsResult?.response?.ok) eventCounts = countsResult.body;
    if (schemaResult?.response?.ok) schema = schemaResult.body;
    const rows = healthRows({ summary, eventCounts, schema, kind });
    const table = operationsTable(doc, {
      caption: HEALTH_CAPTION,
      columns: [
        { key: 'measure', label: 'Measure', width: 240 },
        { key: 'count', label: 'Count', width: 120 },
        { key: 'meaning', label: 'Meaning', width: null }
      ],
      state: healthError ? 'error' : 'ready',
      message: HEALTH_ERROR_TEXT,
      code: healthError?.code || (healthError?.status ? String(healthError.status) : ''),
      onRetry: loadHealth,
      rows: rows.map(row => [
        { text: row.measure, title: row.measure },
        { text: countCell(row.count), title: countCell(row.count) },
        { text: row.meaning, title: row.meaning }
      ])
    });
    healthBody.replaceChildren(table);
  }

  async function loadFootprint() {
    setFootprintState('loading', FOOTPRINT_LOADING_TEXT);
    footprintBody.replaceChildren();
    const result = await OPS_PANEL.load({ transport, scheduler, signal: controller.signal, tenant: tenantValue });
    if (disposed) return;
    if (result.state === 'ready') {
      if (!result.tenants) {
        setFootprintState('error', FOOTPRINT_ERROR_TEXT, 'tenants missing');
        return;
      }
      if (!result.tenantFound) {
        setFootprintState('empty', FOOTPRINT_EMPTY_TEXT);
        return;
      }
      setFootprintState('ready');
      footprintBody.replaceChildren();
      renderFootprint(footprintBody, result, doc);
      return;
    }
    if (result.state === 'unsupported') {
      setFootprintState('unsupported', result.message || ADMIN_ONLY_TEXT);
      return;
    }
    if (result.state === 'cancelled') {
      setFootprintState('cancelled', 'Request cancelled.');
      return;
    }
    setFootprintState('error', result.message || FOOTPRINT_ERROR_TEXT, result.code || '', loadFootprint);
  }

  function recordRows(rows) {
    return rows.map(row => {
      const cells = recordCells(row);
      return [
        { text: cells.time, title: cells.time },
        { text: cells.type, title: cells.type },
        { text: cells.path, title: cells.path, link: cells.link },
        { text: cells.stage, title: cells.stage }
      ];
    });
  }

  let records = [];
  let nextCursor = null;
  let recordsState = 'loading';
  let recordsMessage = RECORDS_LOADING_TEXT;
  let recordsCode = '';
  let nextFailed = false;

  function paintRecords() {
    recordsBody.replaceChildren(operationsTable(doc, {
      caption: RECORDS_CAPTION,
      columns: RECORD_COLUMNS,
      state: recordsState,
      message: recordsMessage,
      code: recordsCode,
      onRetry: recordsState === 'error' ? loadRecords : null,
      onAll: recordsState === 'empty' ? () => reroute('&win=all') : null,
      onReset: recordsState === 'empty' ? () => reroute('') : null,
      rows: recordRows(records)
    }));
    recordsFooter.replaceChildren();
    if (recordsState === 'ready' && records.length) {
      recordsFooter.append(el(doc, 'p', 'ops-records-population', recordsPagingText({ shown: records.length, hasNext: Boolean(nextCursor) })));
      if (nextCursor) {
        const more = el(doc, 'button', 'ops-records-more', RECORDS_MORE_TEXT);
        more.type = 'button';
        more.addEventListener('click', loadMoreRecords);
        recordsFooter.append(more);
      }
    }
    if (nextFailed) {
      const retry = el(doc, 'button', 'ops-records-retry-next', RECORDS_RETRY_NEXT_TEXT);
      retry.type = 'button';
      retry.addEventListener('click', loadMoreRecords);
      recordsFooter.append(retry);
    }
  }

  function reroute(suffix = '') {
    const params = new URLSearchParams(globalThis.location?.search || '');
    if (suffix === '&win=all') { params.set('win', 'all'); params.delete('from'); params.delete('to'); }
    else {
      params.delete('from'); params.delete('to');
      params.set('win', '30d');
      for (const key of ['repo_id', 'kind', 'harness', 'model', 'plan', 'event', 'tool', 'source', 'conversation_id', 'exclude', 'cohort', 'pick', 'sel', 'hide']) params.delete(key);
    }
    globalThis.history.pushState(null, '', `/ops?${params.toString()}`);
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  }

  async function loadRecords() {
    recordsState = 'loading';
    recordsMessage = RECORDS_LOADING_TEXT;
    recordsCode = '';
    nextFailed = false;
    paintRecords();
    let result;
    try {
      result = await fetchLedgerPage({
        transport,
        params: pageParameters(baseParams(), { limit: ledgerPageLimit(schema?.budgets?.explore_page_max) }),
        signal: controller.signal,
        stateKey: 'ops-records',
        tenant: tenantValue
      });
    } catch (error) {
      if (disposed || error?.name === 'AbortError') return;
      result = { state: 'error', message: error?.message || RECORDS_ERROR_TEXT, code: '' };
    }
    if (disposed) return;
    if (result.state === 'ready') {
      records = result.rows;
      nextCursor = result.next;
      recordsState = 'ready';
      recordsMessage = '';
    } else if (result.state === 'empty') {
      records = [];
      nextCursor = null;
      recordsState = 'empty';
      recordsMessage = RECORDS_EMPTY_TEXT;
    } else {
      records = [];
      nextCursor = null;
      recordsState = 'error';
      recordsMessage = RECORDS_ERROR_TEXT;
      recordsCode = result.code || (result.status ? String(result.status) : '');
    }
    paintRecords();
  }

  async function loadMoreRecords() {
    if (!nextCursor) return;
    const button = recordsFooter.querySelector('.ops-records-more, .ops-records-retry-next');
    if (button) { button.disabled = true; button.textContent = RECORDS_LOADING_MORE_TEXT; }
    let result;
    try {
      result = await fetchLedgerPage({
        transport,
        params: pageParameters(baseParams(), { cursor: nextCursor, limit: ledgerPageLimit(schema?.budgets?.explore_page_max) }),
        signal: controller.signal,
        stateKey: 'ops-records-more',
        tenant: tenantValue
      });
    } catch (error) {
      if (disposed || error?.name === 'AbortError') return;
      result = { state: 'error', message: error?.message || RECORDS_ERROR_TEXT, code: '' };
    }
    if (disposed) return;
    if (result.state === 'ready' || result.state === 'empty') {
      const appended = appendPage(records, result.rows || []);
      records = appended.rows;
      nextCursor = result.state === 'ready' ? result.next : null;
      nextFailed = false;
      recordsState = 'ready';
      recordsMessage = '';
    } else {
      nextFailed = true;
      recordsMessage = RECORDS_ERROR_TEXT;
    }
    paintRecords();
  }

  async function start() {
    if (!tenantValue) {
      try {
        const result = await transport.request('me', { signal: controller.signal, stateKey: 'ops-me' });
        tenantValue = rememberedTenant(result?.body || {});
      } catch { tenantValue = ''; }
    }
    if (disposed) return;
    try {
      const result = await transport.schema(tenantValue);
      if (result.response.ok) schema = result.body;
    } catch { schema = null; }
    if (disposed) return;
    kind = kindFromScope(readContext?.scope || {});
    loadHealth();
    loadFootprint();
    loadRecords();
  }

  start();
  return () => { disposed = true; controller.abort(); };
}

export default { title, phase, render };
