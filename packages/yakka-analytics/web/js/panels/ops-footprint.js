// `ops-footprint` tenant panel: the only surface that reads /v1/admin/status.
// It selects the committed tenant by exact id, renders the retained-byte
// categories as bars and an exact-byte table, and states the server's refusal
// honestly. No tenant is summed with another and no admin right is inferred.

import { formatNumber } from '../charts/formatters.js';
import { cancelledState, errorState } from '../core/panel-state.js';
import { mountPanelViews } from './p10-shared.js';

export const STATUS_ROUTE = 'admin/status';
export const STATE_KEY = 'ops-status';
export const FOOTPRINT_CAPTION = 'Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used.';
export const ADMIN_ONLY_TEXT = 'Storage information is available to server administrators only.';
export const FOOTPRINT_LOADING_TEXT = 'Loading Retained storage…';
export const FOOTPRINT_EMPTY_TEXT = 'No records match these filters.';
export const FOOTPRINT_ERROR_TEXT = 'Could not load Retained storage.';

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

const CATEGORIES = [
  ['ledger_bytes', 'Ledger'],
  ['wal_bytes', 'WAL'],
  ['archive_bytes', 'Archive'],
  ['blob_bytes', 'Blobs'],
  ['pending_bytes', 'Pending'],
  ['other_bytes', 'Other']
];

function missing(value) {
  return value === null || value === undefined || value === '';
}

function asNumber(value) {
  if (missing(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asString(value) {
  return missing(value) ? null : String(value);
}

// Binary display, unit named on the value; a missing byte count is unavailable.
export function formatBytes(value) {
  const number = asNumber(value);
  if (number === null) return '—';
  let amount = Math.max(0, number);
  let index = 0;
  while (amount >= 1024 && index < BYTE_UNITS.length - 1) { amount /= 1024; index += 1; }
  const rounded = index === 0 ? String(Math.round(amount)) : amount >= 100 ? amount.toFixed(0) : amount.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  return `${rounded} ${BYTE_UNITS[index]}`;
}

export function formatCount(value) {
  const number = asNumber(value);
  return number === null ? '—' : formatNumber(number);
}

export function formatUnixSeconds(value) {
  const number = asNumber(value);
  if (number === null) return '—';
  if (number === 0) return 'never';
  return new Date(number * 1000).toISOString();
}

// Bytes descending, category ascending; an unavailable value sorts last.
export function footprintRows(tenant = {}) {
  const footprint = tenant && typeof tenant.footprint === 'object' ? tenant.footprint : null;
  const rows = CATEGORIES.map(([key, label]) => ({ key, label, bytes: asNumber(footprint?.[key]) }));
  return rows.sort((left, right) => {
    const a = left.bytes === null ? -Infinity : left.bytes;
    const b = right.bytes === null ? -Infinity : right.bytes;
    if (a !== b) return b - a;
    return left.label.localeCompare(right.label);
  });
}

export function mapTenant(tenant = {}) {
  const source = tenant && typeof tenant === 'object' ? tenant : {};
  return {
    id: asString(source.id),
    name: asString(source.name),
    error: asString(source.error) || '',
    footprint: source.footprint && typeof source.footprint === 'object' ? source.footprint : null
  };
}

// 403 is the server's administrator-session refusal, never an owner guess.
export function mapStatusResponse({ status, body, tenant = '' } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (status === 403) {
    return { state: 'unsupported', message: ADMIN_ONLY_TEXT, reason: 'administrator only' };
  }
  if (status === 401) {
    return errorState({ message: 'The session is not signed in.', code: '401' });
  }
  if (!status || status >= 400) {
    return errorState({
      message: payload.error || `The server returned ${status ?? 'no status'}.`,
      code: payload.code || (status ? String(status) : '')
    });
  }
  const tenants = Array.isArray(payload.tenants) ? payload.tenants.map(mapTenant) : null;
  const selected = tenants ? tenants.find(item => item.id === String(tenant)) || null : null;
  return {
    state: 'ready',
    version: asString(payload.version),
    tenants,
    selected,
    tenantFound: Boolean(selected),
    basis: 'server status snapshot (point in time), not a historical series'
  };
}

function el(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function svgNode(doc, tag) {
  return doc.createElementNS('http://www.w3.org/2000/svg', tag);
}

function bars(doc, rows) {
  const host = el(doc, 'div', 'ops-footprint-chart');
  const max = Math.max(1, ...rows.map(row => (row.bytes === null ? 0 : row.bytes)));
  const height = Math.max(160, rows.length * 26 + 40);
  const svg = svgNode(doc, 'svg');
  svg.setAttribute('viewBox', `0 0 640 ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', FOOTPRINT_CAPTION);
  host.append(svg);
  const labelWidth = 120;
  const left = labelWidth;
  const right = 620;
  rows.forEach((row, index) => {
    const y = 12 + index * 26;
    const label = svgNode(doc, 'text');
    label.setAttribute('x', '6');
    label.setAttribute('y', String(y + 13));
    label.setAttribute('class', 'ops-chart-label');
    label.textContent = row.label;
    svg.append(label);
    if (row.bytes === null) {
      const missingText = svgNode(doc, 'text');
      missingText.setAttribute('x', String(left + 4));
      missingText.setAttribute('y', String(y + 13));
      missingText.setAttribute('class', 'ops-chart-missing');
      missingText.textContent = 'not supplied';
      svg.append(missingText);
      return;
    }
    const width = Math.max(row.bytes > 0 ? 1 : 0, (right - left) * (row.bytes / max));
    const bar = svgNode(doc, 'rect');
    bar.setAttribute('x', String(left));
    bar.setAttribute('y', String(y));
    bar.setAttribute('width', String(width));
    bar.setAttribute('height', '16');
    bar.setAttribute('class', 'ops-chart-bar');
    const title = svgNode(doc, 'title');
    title.textContent = `${row.label}: ${formatCount(row.bytes)} bytes (${formatBytes(row.bytes)})`;
    bar.append(title);
    svg.append(bar);
    const value = svgNode(doc, 'text');
    value.setAttribute('x', String(Math.min(right - 4, left + width + 6)));
    value.setAttribute('y', String(y + 13));
    value.setAttribute('class', 'ops-chart-value');
    value.textContent = formatBytes(row.bytes);
    svg.append(value);
  });
  const axis = svgNode(doc, 'line');
  axis.setAttribute('x1', String(left));
  axis.setAttribute('x2', String(left));
  axis.setAttribute('y1', '4');
  axis.setAttribute('y2', String(height - 24));
  axis.setAttribute('class', 'ops-chart-grid');
  svg.append(axis);
  axisLabel(doc, svg, left, 12 + rows.length * 26 + 8, '0');
  axisLabel(doc, svg, right, 12 + rows.length * 26 + 8, 'Bytes retained (binary units)', 'end');
  return host;
}

function axisLabel(doc, svg, x, y, text, anchor = 'start') {
  const node = svgNode(doc, 'text');
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('text-anchor', anchor);
  node.setAttribute('class', 'ops-chart-label');
  node.textContent = text;
  svg.append(node);
}

function footprintTable(doc, rows) {
  const table = el(doc, 'table', 'ops-table ops-footprint-table');
  const caption = el(doc, 'caption', '', 'Retained storage');
  table.append(caption);
  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const [label, width] of [['Storage category', 240], ['Retained bytes', 160], ['Display size', null]]) {
    const cell = el(doc, 'th', '', label);
    cell.scope = 'col';
    if (width) cell.setAttribute('width', String(width));
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement('tbody');
  for (const row of rows) {
    const tr = doc.createElement('tr');
    tr.append(el(doc, 'td', '', row.label));
    tr.append(el(doc, 'td', '', row.bytes === null ? '—' : formatCount(row.bytes)));
    tr.append(el(doc, 'td', '', formatBytes(row.bytes)));
    body.append(tr);
  }
  table.append(head, body);
  return table;
}

export function renderFootprint(container, result, doc = globalThis.document) {
  container.replaceChildren();
  if (!result || result.state !== 'ready') return container;
  if (!result.tenants) {
    container.append(el(doc, 'p', 'ops-missing', 'Tenants: not supplied by the server.'));
    return container;
  }
  if (!result.tenantFound) {
    container.append(el(doc, 'p', 'ops-missing', 'This tenant was not reported by the server.'));
    return container;
  }
  const rows = footprintRows(result.selected);
  const views = mountPanelViews({
    panelId: 'ops-footprint', chart: bars(doc, rows), table: footprintTable(doc, rows),
    doc, defaultView: 'chart', label: 'Retained storage view'
  });
  container.append(views.element);
  return container;
}

async function load({ transport, signal, tenant = '' } = {}) {
  try {
    const { response, body } = await transport.request(STATUS_ROUTE, { signal, stateKey: STATE_KEY });
    return mapStatusResponse({ status: response.status, body, tenant });
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The status request failed.' });
  }
}

export const OPS_PANEL = {
  id: 'ops-footprint',
  title: 'Retained storage',
  grain: 'tenant',
  measures: ['bytes'],
  lenses: [],
  charts: ['bars'],
  table: true,
  requires: [],
  caveats: 'Administrator-only, point-in-time server status for the selected tenant. Read-only.',
  measureBasis: 'server status snapshot, point in time',
  caption: FOOTPRINT_CAPTION,
  requests: () => [{ route: `/v1/${STATUS_ROUTE}`, method: 'GET', session: true }],
  load
};

export default OPS_PANEL;
