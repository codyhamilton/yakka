// `pulse-strips`: one strip per headline measure with the change against the
// previous equal-length period. It reads `/summary` for counts and money and
// `/scores` for the quality median. Pure window/strip helpers are exported for
// the node checks; the panel only renders what the server returned.

import { formatCount, formatMoney, formatNumber } from '../charts/formatters.js';
import { cancelledState, errorState } from '../core/panel-state.js';

export const WINDOW_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 };

export const STRIP_MEASURES = [
  { key: 'cost_usd', label: 'Cost', kind: 'money', unit: 'USD' },
  { key: 'model_calls', label: 'Model calls', kind: 'count', unit: 'calls' },
  { key: 'conversations', label: 'Sessions', kind: 'count', unit: 'sessions' },
  { key: 'hook_events', label: 'Events', kind: 'count', unit: 'events' },
  { key: 'artifact_versions', label: 'Artifacts', kind: 'count', unit: 'versions' },
  { key: 'commits', label: 'Commits', kind: 'count', unit: 'commits' },
  { key: 'rejections', label: 'Rejections', kind: 'count', unit: 'rejections' },
  { key: 'quality_median', label: 'Quality median', kind: 'ratio', unit: 'score' }
];

const SCOPE_KEYS = new Set(['win', 'from', 'to', 'tz', 'cohorts', 'sel', 'hide', 'cmp', 'pick']);

// Request parameters for a panel scope. The transport adds `tz` when absent
// and the shared filter names pass through unchanged.
export function scopeParams(scope = {}) {
  const params = new URLSearchParams();
  if (scope.from || scope.to) {
    if (scope.from) params.set('from', scope.from);
    if (scope.to) params.set('to', scope.to);
  } else if (scope.win) params.set('win', scope.win);
  if (scope.tz) params.set('tz', scope.tz);
  for (const [key, value] of Object.entries(scope)) {
    if (SCOPE_KEYS.has(key)) continue;
    if (Array.isArray(value)) { for (const item of value) params.append(key, item); }
    else if (typeof value === 'string' && value) params.set(key, value);
  }
  return params;
}

export function windowParams(win) {
  const params = new URLSearchParams();
  if (!win) return params;
  params.set('from', new Date(win.from).toISOString());
  params.set('to', new Date(win.to).toISOString());
  return params;
}

// Current absolute window, or null for all-history (and for a bare `all`).
export function currentWindow(scope = {}, now = Date.now()) {
  if (scope.from || scope.to) {
    const from = scope.from ? Date.parse(scope.from) : null;
    const to = scope.to ? Date.parse(scope.to) : now;
    if (from === null || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
    return { from, to };
  }
  const match = /^(\d+)([hdwmy])$/.exec(String(scope.win || ''));
  if (!match) return null;
  const to = now;
  const from = now - Number(match[1]) * WINDOW_MS[match[2]];
  return { from, to };
}

// The equal-length window immediately before the current one. `all` has no
// previous period, and neither does an unbounded or invalid window.
export function previousWindow(scope = {}, now = Date.now()) {
  if (!scope.from && !scope.to && (!scope.win || scope.win === 'all')) return null;
  const current = currentWindow(scope, now);
  if (!current) return null;
  const span = current.to - current.from;
  if (!(span > 0)) return null;
  return { from: current.from - span, to: current.from };
}

export function panelBody(panelId, doc = globalThis.document) {
  return doc.querySelector(`[data-panel="${panelId}"] .workspace-panel-body`);
}

// A board appends its panel frames only after starting their loads, so a panel
// renders on the microtask after the frame is in the document. This is plain
// scheduling, not a timing assertion or a test branch.
export function whenPanelBody(panelId, doc, paint) {
  const host = panelBody(panelId, doc);
  if (host) { paint(host); return; }
  queueMicrotask(() => {
    const later = panelBody(panelId, doc);
    if (later) paint(later);
  });
}

let stylesLoaded = false;
export function ensurePulseStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/pulse.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/pulse.css';
  doc.head.append(link);
}

export function rejectionTotal(rejections) {
  if (!rejections || typeof rejections !== 'object') return null;
  const precheck = Number(rejections.precheck);
  const screen = Number(rejections.screen);
  if (!Number.isFinite(precheck) && !Number.isFinite(screen)) return null;
  return (Number.isFinite(precheck) ? precheck : 0) + (Number.isFinite(screen) ? screen : 0);
}

export function formatStripCost({ cost_usd: cost, unpriced_calls: unpriced, priced_calls: priced } = {}) {
  if (cost === null || cost === undefined) return 'unpriced';
  const count = Number(unpriced) || 0;
  if (priced === 0 && count > 0) return 'unpriced';
  return formatMoney(Number(cost), { unpriced: count, lowerBound: count > 0 });
}

export function formatRatio(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return 'not supplied';
  return formatNumber(Number(value), { digits: 2 });
}

function changeText(current, previous, kind) {
  if (current === null || current === undefined || previous === null || previous === undefined) return 'not supplied';
  const delta = Number(current) - Number(previous);
  if (!Number.isFinite(delta)) return 'not supplied';
  if (kind === 'ratio') return `${delta >= 0 ? '+' : ''}${formatNumber(delta, { digits: 2 })}`;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return `${sign}${formatCount(Math.abs(delta), { unit: kind === 'money' ? 'USD' : '' })}`;
}

// Pick the first check with a scored population. The panel names the kind,
// check, scorer and n; it never invents a median when the server omits one.
export function qualityMedian(scores, kind = 'design') {
  const checks = Array.isArray(scores?.checks) ? scores.checks : [];
  const scored = checks.filter(check => Number(check?.n) > 0 && check?.median !== null && check?.median !== undefined);
  const choice = scored[0] || checks[0] || null;
  if (!choice) return { kind, check: '', scorer: '', n: null, median: null, label: `${kind}: no checks` };
  return {
    kind,
    check: choice.name || '',
    scorer: choice.scorer || '',
    n: Number.isFinite(Number(choice.n)) ? Number(choice.n) : null,
    median: choice.median === null || choice.median === undefined || !Number.isFinite(Number(choice.median)) ? null : Number(choice.median),
    label: `${kind}/${choice.name || 'check'}${choice.scorer ? ` · ${choice.scorer}` : ''}`
  };
}

// The strip model used by the table and any bars. `previous` is null when the
// scope is all-history; that is rendered as "no previous period", never zero.
export function stripModel({ summary = {}, previous = null, scores = null, kind = 'design', scope = {} } = {}) {
  const hasPrevious = previous !== null && previous !== undefined;
  const median = qualityMedian(scores, kind);
  const rows = STRIP_MEASURES.map(measure => {
    let current = null;
    let before = null;
    let display = 'not supplied';
    let previousDisplay = hasPrevious ? 'not supplied' : 'no previous period';
    let split = '';
    if (measure.key === 'cost_usd') {
      current = summary.cost_usd === undefined ? null : summary.cost_usd;
      before = hasPrevious ? previous.cost_usd ?? null : null;
      display = formatStripCost({ cost_usd: current, unpriced_calls: summary.unpriced_calls, priced_calls: summary.priced_calls });
      if (hasPrevious) previousDisplay = formatStripCost({ cost_usd: before, unpriced_calls: previous.unpriced_calls, priced_calls: previous.priced_calls });
    } else if (measure.key === 'rejections') {
      current = rejectionTotal(summary.rejections);
      before = hasPrevious ? rejectionTotal(previous.rejections) : null;
      display = current === null ? 'not supplied' : formatCount(current, { unit: 'rejections' });
      if (hasPrevious) previousDisplay = before === null ? 'not supplied' : formatCount(before, { unit: 'rejections' });
      const pre = Number(summary.rejections?.precheck);
      const screen = Number(summary.rejections?.screen);
      if (Number.isFinite(pre) || Number.isFinite(screen)) split = `${Number.isFinite(pre) ? pre : 0} precheck + ${Number.isFinite(screen) ? screen : 0} screen`;
    } else if (measure.key === 'quality_median') {
      current = median.median;
      display = median.median === null ? 'not supplied' : formatRatio(median.median);
      previousDisplay = hasPrevious ? 'not supplied' : 'no previous period';
      split = `${median.label}${median.n === null ? '' : ` · n ${formatNumber(median.n)}`}`;
    } else {
      current = summary[measure.key] === undefined ? null : summary[measure.key];
      before = hasPrevious ? previous[measure.key] ?? null : null;
      display = current === null ? 'not supplied' : formatCount(current, { unit: measure.unit });
      if (hasPrevious) previousDisplay = before === null ? 'not supplied' : formatCount(before, { unit: measure.unit });
    }
    const change = hasPrevious ? changeText(current, before, measure.kind) : 'no previous period';
    return { key: measure.key, label: measure.label, unit: measure.unit, kind: measure.kind, current, previous: hasPrevious ? before : null, display, previousDisplay, change, split };
  });
  return { rows, hasPrevious, median, kind };
}

export function table(doc, { caption, columns, rows, empty = 'none reported' }) {
  const node = doc.createElement('table');
  node.className = 'pulse-table';
  const cap = doc.createElement('caption');
  cap.textContent = caption;
  node.append(cap);
  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const column of columns) {
    const cell = doc.createElement('th');
    if (column.numeric) cell.className = 'numeric';
    cell.scope = 'col';
    cell.textContent = column.label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement('tbody');
  if (!rows.length) {
    const row = doc.createElement('tr');
    const cell = doc.createElement('td');
    cell.colSpan = columns.length;
    cell.textContent = empty;
    row.append(cell);
    body.append(row);
  }
  for (const row of rows) {
    const tr = doc.createElement('tr');
    row.forEach((value, index) => {
      const cell = doc.createElement('td');
      if (columns[index]?.numeric) cell.className = 'numeric';
      cell.textContent = value;
      tr.append(cell);
    });
    body.append(tr);
  }
  node.append(head, body);
  return node;
}

export function renderStrips(container, model, doc = globalThis.document) {
  container.replaceChildren();
  const wrapper = doc.createElement('div');
  wrapper.className = 'pulse-strips';
  const basis = doc.createElement('p');
  basis.className = 'pulse-basis';
  basis.textContent = model.hasPrevious
    ? 'Basis: server summary for the current window against the previous equal-length window.'
    : 'Basis: server summary for the current window. All-history scope has no previous period.';
  wrapper.append(basis);
  const rows = model.rows.map(row => [
    row.label,
    row.display,
    row.previousDisplay,
    row.change,
    row.split || '—'
  ]);
  wrapper.append(table(doc, {
    caption: 'Headline measures, current period against the previous equal period',
    columns: [
      { label: 'Measure' }, { label: 'Current', numeric: true }, { label: 'Previous', numeric: true },
      { label: 'Change', numeric: true }, { label: 'Detail' }
    ],
    rows
  }));
  const flags = [];
  if (model.rows.some(row => String(row.display).includes('unpriced'))) flags.push('Unpriced cost is a lower bound and is never shown as $0.');
  if (flags.length) {
    const note = doc.createElement('p');
    note.className = 'pulse-note';
    note.textContent = flags.join(' ');
    wrapper.append(note);
  }
  container.append(wrapper);
  return container;
}

async function fetchSummary(transport, params, { tenant, signal, stateKey }) {
  const { response, body } = await transport.get('summary', params, { tenant, signal, stateKey });
  if (!response.ok) {
    const error = new Error(body?.error || `The server returned ${response.status}.`);
    error.code = body?.code || String(response.status || '');
    throw error;
  }
  return body && typeof body === 'object' ? body : {};
}

export async function load({ scope = {}, transport, tenant, signal, doc = globalThis.document } = {}) {
  ensurePulseStyles(doc);
  try {
    const current = await fetchSummary(transport, scopeParams(scope), { tenant, signal, stateKey: 'pulse-summary' });
    const prev = previousWindow(scope);
    let previous = null;
    if (prev) {
      try { previous = await fetchSummary(transport, windowParams(prev), { tenant, signal, stateKey: 'pulse-summary-prev' }); } catch { previous = null; }
    }
    let scores = null;
    try {
      const { response, body } = await transport.get('scores', new URLSearchParams({ kind: 'design' }), { tenant, signal, stateKey: 'pulse-scores' });
      if (response.ok) scores = body;
    } catch { scores = null; }
    const model = stripModel({ summary: current, previous, scores, kind: 'design', scope });
    const result = {
      state: 'ready',
      strips: model.rows,
      hasPrevious: model.hasPrevious,
      basis: model.hasPrevious ? 'summary; previous equal-length window' : 'summary; no previous period for all-history',
      population: { unit: 'measure', returned_n: model.rows.length, eligible_n: model.rows.length }
    };
    whenPanelBody('pulse-strips', doc, host => renderStrips(host, model, doc));
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The summary request failed.', code: error?.code || '' });
  }
}

export const PULSE_STRIPS_PANEL = {
  id: 'pulse-strips',
  title: 'Pulse',
  grain: 'time',
  measures: ['cost_usd', 'model_calls', 'conversations', 'hook_events', 'artifact_versions', 'commits', 'rejections'],
  lenses: [],
  charts: [],
  table: true,
  requires: [],
  caveats: 'Current period against the previous equal-length window. All-history has no previous period. Unpriced cost is a lower bound, never $0. Quality median names its kind, check, scorer and n.',
  measureBasis: 'summary event-time window; previous window is the equal length immediately before',
  requests: () => [
    { route: '/v1/analytics/summary', method: 'GET', params: { window: 'current' } },
    { route: '/v1/analytics/summary', method: 'GET', params: { window: 'previous' } },
    { route: '/v1/analytics/scores', method: 'GET', params: { kind: 'design' } }
  ],
  load
};

export default PULSE_STRIPS_PANEL;
