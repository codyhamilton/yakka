// `pulse-strips`: one strip per headline measure with the change against the
// previous equal-length period. It reads `/summary` for counts and money and
// `/scores` for the quality median. Pure window/strip helpers are exported for
// the node checks; the panel only renders what the server returned.

import { formatCount, formatMoney, formatNumber } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import { resolveReadContext } from '../core/read-context.js';

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

// Request parameters for a panel scope. Relative windows resolve to absolute
// bounds here, so no panel ever sends `win`; the shared filter names pass
// through unchanged.
export function scopeParams(scope = {}) {
  return resolveReadContext({ state: scope }).paramsFor();
}

export function windowParams(win) {
  const params = new URLSearchParams();
  if (!win) return params;
  params.set('from', new Date(win.from).toISOString());
  params.set('to', new Date(win.to).toISOString());
  return params;
}

// A comparison read keeps the committed scope (tenant, repository, kind,
// timezone, excludes, cohorts) and replaces only the time bounds with the
// previous equal-length period. Dropping the other parameters would mix an
// unfiltered population into a filtered view.
export function previousParams(baseParams, prev) {
  const params = new URLSearchParams(baseParams);
  params.delete('all');
  params.delete('from');
  params.delete('to');
  if (prev) {
    params.set('from', new Date(prev.from).toISOString());
    params.set('to', new Date(prev.to).toISOString());
  }
  return params;
}

const SCOPE_ONLY_KEYS = new Set(['win', 'from', 'to', 'tz', 'cohorts', 'sel', 'hide', 'cmp', 'pick']);

// Applied scope causes for an empty result: only the shared filters, excludes,
// cohorts or selection the panel's scope actually carries, each with a clear
// callback. The board wraps the callback with its router handle; the panel
// never imports the router. Nothing is guessed.
export function emptyCausesFor(scope = {}, clear = null) {
  const causes = [];
  const handle = request => (typeof clear === 'function' ? () => clear(request) : null);
  for (const [key, raw] of Object.entries(scope)) {
    if (SCOPE_ONLY_KEYS.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value !== 'string' || !value) continue;
      if (key === 'exclude') {
        causes.push({ kind: 'filter', key: 'exclude', label: `exclude ${value}`, clear: handle({ kind: 'filter', key: 'exclude', value }) });
      } else {
        causes.push({ kind: 'filter', key, label: `${key}: ${value}`, clear: handle({ kind: 'filter', key, value }) });
      }
    }
  }
  for (const [slot, text] of Object.entries(scope.cohorts || {})) {
    if (!text) continue;
    causes.push({ kind: 'cohort', key: slot, label: `cohort ${slot.slice(1).toUpperCase()}`, clear: handle({ kind: 'cohort', key: slot }) });
  }
  if (scope.pick) causes.push({ kind: 'selection', key: 'pick', label: 'selection', clear: handle({ kind: 'selection', key: 'pick' }) });
  else if (scope.sel) causes.push({ kind: 'selection', key: 'sel', label: 'selection', clear: handle({ kind: 'selection', key: 'sel' }) });
  return causes;
}

// True only when a summary explicitly reports every recognised headline measure
// as zero. A missing field is "not supplied", never zero, so an older or absent
// response is not treated as an empty scope.
export function summaryIsEmpty(summary) {
  if (!summary || typeof summary !== 'object') return false;
  let known = 0;
  for (const key of ['conversations', 'hook_events', 'artifact_versions', 'distinct_content', 'commits', 'model_calls', 'unpriced_calls']) {
    if (summary[key] === undefined || summary[key] === null) continue;
    known += 1;
    if (Number(summary[key]) !== 0) return false;
  }
  if (summary.cost_usd !== undefined && summary.cost_usd !== null) {
    known += 1;
    if (Number(summary.cost_usd) !== 0) return false;
  }
  if (summary.rejections && typeof summary.rejections === 'object') {
    known += 1;
    const total = (Number(summary.rejections.precheck) || 0) + (Number(summary.rejections.screen) || 0);
    if (total !== 0) return false;
  }
  return known > 0;
}

// Current absolute window, or null for all-history (and for a bare `all`).
export function currentWindow(scope = {}, now = Date.now()) {
  if (scope.win === 'all') return null;
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
function renderToken(doc) {
  return doc?.documentElement?.dataset?.renderGeneration ?? '';
}

export function whenPanelBody(panelId, doc, paint) {
  // A later route bumps documentElement.dataset.renderGeneration. Painting by
  // panel id after that would write this response into the new destination.
  const generation = renderToken(doc);
  const paintIfCurrent = host => {
    if (renderToken(doc) !== generation) return;
    paint(host);
  };
  const host = panelBody(panelId, doc);
  if (host) { paintIfCurrent(host); return; }
  queueMicrotask(() => {
    const later = panelBody(panelId, doc);
    if (later) paintIfCurrent(later);
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

function previousFromContext(readContext) {
  if (!readContext || readContext.window?.all || !readContext.window?.from) return null;
  const from = Date.parse(readContext.window.from);
  const to = Date.parse(readContext.window.to);
  const span = to - from;
  if (!Number.isFinite(span) || !(span > 0)) return null;
  return { from: from - span, to: from };
}

export async function load({ scope = {}, transport, tenant, signal, doc = globalThis.document, clear = null, readContext = null } = {}) {
  ensurePulseStyles(doc);
  try {
    const currentParams = readContext ? readContext.paramsFor() : scopeParams(scope);
    const current = await fetchSummary(transport, currentParams, { tenant, signal, stateKey: 'pulse-summary' });
    if (summaryIsEmpty(current)) {
      whenPanelBody('pulse-strips', doc, host => host.replaceChildren());
      const causes = emptyCausesFor(scope, clear);
      if (!causes.length) causes.push({ kind: 'scope', label: `no measures in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    const prev = readContext ? previousFromContext(readContext) : previousWindow(scope);
    let previous = null;
    if (prev) {
      try { previous = await fetchSummary(transport, previousParams(currentParams, prev), { tenant, signal, stateKey: 'pulse-summary-prev' }); } catch { previous = null; }
    }
    let scores = null;
    try {
      const scoreParams = readContext ? readContext.paramsFor({ kind: 'design' }) : (() => {
        const params = scopeParams(scope);
        params.set('kind', 'design');
        return params;
      })();
      const { response, body } = await transport.get('scores', scoreParams, { tenant, signal, stateKey: 'pulse-scores' });
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
