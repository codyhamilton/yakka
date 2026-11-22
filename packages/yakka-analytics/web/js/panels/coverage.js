// `coverage`: typed availability rows with units and denominators. It reads
// `/schema.coverage` and `/summary`; overlapping populations are never summed
// into one blended percentage.

import { formatCount } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { emptyCausesFor, ensurePulseStyles, scopeParams, summaryIsEmpty, table, whenPanelBody } from './pulse-strips.js';
import { registerCaption } from './captions.js';

export const COVERAGE_CAPTION = 'These rows show the latest retained records and missing prices or scores; missing data is not zero activity.';
export const COVERAGE_COLUMNS = ['Source', 'Latest retained timestamp', 'Age', 'Missing-data count', 'Unit'];
export const COVERAGE_METADATA_WARNING = 'Coverage metadata describes all retained data in the selected tenant; time, repository and kind do not narrow these rows, and missing data is not zero activity.';
registerCaption('coverage', () => COVERAGE_CAPTION);

// Explicit unit conversions. Event bounds (`first_ts`, `last_ts`) are Unix
// seconds; receive time (`last_received_at`) is Unix nanoseconds. A string is
// already an RFC3339 timestamp. There is no magnitude heuristic.
export function eventTimeText(value) {
  if (value === null || value === undefined || value === '') return 'not supplied';
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'not supplied';
  }
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 'not supplied';
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'not supplied';
}

export function receiveTimeText(value) {
  if (value === null || value === undefined || value === '') return 'not supplied';
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'not supplied';
  }
  const nanos = Number(value);
  if (!Number.isFinite(nanos)) return 'not supplied';
  const date = new Date(Math.floor(nanos / 1e6));
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'not supplied';
}

export function ageText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return 'not supplied';
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function epochSeconds(value) {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// The retained observations themselves, with explicit units. A schema without
// `facts` keeps the legacy top-level bounds (RFC3339 strings in fixtures).
function observationRows(coverage = {}) {
  const facts = coverage.facts && typeof coverage.facts === 'object' ? coverage.facts : null;
  if (facts) {
    return Object.entries(facts).map(([type, entry]) => ({
      type,
      first: eventTimeText(entry?.first_ts),
      last: eventTimeText(entry?.last_ts),
      received: receiveTimeText(entry?.last_received_at),
      firstSeconds: epochSeconds(entry?.first_ts),
      lastSeconds: epochSeconds(entry?.last_ts),
      usage: type === 'usage'
    }));
  }
  if (coverage.first_ts === undefined && coverage.last_ts === undefined && coverage.last_received_at === undefined) return [];
  return [{
    type: 'all',
    first: eventTimeText(coverage.first_ts),
    last: eventTimeText(coverage.last_ts),
    received: receiveTimeText(coverage.last_received_at),
    firstSeconds: epochSeconds(coverage.first_ts),
    lastSeconds: epochSeconds(coverage.last_ts),
    usage: false
  }];
}

function usageRow(coverage = {}, now) {
  const usage = coverage.usage && typeof coverage.usage === 'object' ? coverage.usage : null;
  if (!usage) return null;
  const seconds = epochSeconds(usage.last_ts);
  return {
    first: eventTimeText(usage.first_ts),
    last: eventTimeText(usage.last_ts),
    received: receiveTimeText(usage.last_received_at),
    age: seconds === null ? 'not supplied' : ageText(now - seconds * 1000)
  };
}

// One short, honest summary: latest retained event and its age, latest usage
// separately, the available range, attribution and scored hashes. It never
// claims the archive is complete.
export function coverageSnapshot(coverage = null, now = Date.now()) {
  const cov = coverage && typeof coverage === 'object' ? coverage : {};
  const rows = observationRows(cov);
  let latest = null;
  let earliest = null;
  for (const row of rows) {
    if (row.lastSeconds !== null && (latest === null || row.lastSeconds > latest.lastSeconds)) latest = row;
    if (row.firstSeconds !== null && (earliest === null || row.firstSeconds < earliest.firstSeconds)) earliest = row;
  }
  const usage = usageRow(cov, now);
  const sessions = cov.sessions && typeof cov.sessions === 'object' ? cov.sessions : null;
  const scored = cov.scored_content_by_kind && typeof cov.scored_content_by_kind === 'object' ? cov.scored_content_by_kind : null;
  let scoredTotal = 0;
  let hashTotal = 0;
  if (scored) {
    for (const entry of Object.values(scored)) {
      if (Number.isFinite(Number(entry?.scored))) scoredTotal += Number(entry.scored);
      if (Number.isFinite(Number(entry?.total))) hashTotal += Number(entry.total);
    }
  }
  return {
    rows,
    latest: latest
      ? { type: latest.type, at: latest.last, age: ageText(now - latest.lastSeconds * 1000) }
      : null,
    received: latest ? { type: latest.type, at: latest.received } : null,
    usage,
    range: earliest && latest ? { from: earliest.first, to: latest.last } : null,
    sessions,
    scored: scored ? { scored: scoredTotal, total: hashTotal } : null
  };
}

function countText(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return formatCount(Number(value), { unit: '' });
}

const FACT_UNITS = {
  artifact_version: 'versions',
  artifact_versions: 'versions',
  commit: 'commits',
  commits: 'commits',
  hook_event: 'events',
  hook_events: 'events',
  rejection: 'rejections',
  rejections: 'rejections',
  session_start: 'sessions',
  session_action: 'session events',
  execution: 'executions',
  usage: 'calls'
};

function factUnit(type) {
  return FACT_UNITS[type] || 'records';
}

function latestMs(row) {
  const seconds = row?.lastSeconds;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

// One table, one row per source. Fact types, usage and scored-content kinds are
// kept in their own units and are never divided into a blended percentage.
export function coverageModel({ coverage = null, summary = null, now = Date.now() } = {}) {
  const cov = coverage && typeof coverage === 'object' ? coverage : {};
  const sum = summary && typeof summary === 'object' ? summary : {};
  const rows = [];

  const facts = observationRows(cov);
  if (facts.length && !(cov.facts && typeof cov.facts === 'object')) {
    const entry = facts[0];
    const at = latestMs(entry);
    rows.push({
      source: 'all',
      latest: entry.received,
      age: at === null ? '—' : ageText(now - at),
      missing: '—',
      unit: 'records'
    });
  } else {
    for (const entry of facts) {
      const at = latestMs(entry);
      rows.push({
        source: entry.type,
        latest: entry.received,
        age: at === null ? '—' : ageText(now - at),
        missing: '—',
        unit: factUnit(entry.type)
      });
    }
  }

  const unpriced = Number(sum.unpriced_calls);
  const unpricedText = Number.isFinite(unpriced) ? formatCount(unpriced, { unit: '' }) : '—';
  const usage = cov.usage && typeof cov.usage === 'object' ? cov.usage : null;
  if (usage) {
    const seconds = epochSeconds(usage.last_ts);
    const received = usage.last_received_at;
    const at = seconds !== null ? seconds * 1000 : null;
    rows.push({
      source: 'usage',
      latest: receiveTimeText(received),
      age: at === null ? '—' : ageText(now - at),
      missing: unpricedText,
      unit: 'unpriced calls'
    });
  } else if (Number.isFinite(unpriced)) {
    rows.push({ source: 'usage', latest: '—', age: '—', missing: unpricedText, unit: 'unpriced calls' });
  }

  const scored = cov.scored_content_by_kind && typeof cov.scored_content_by_kind === 'object' ? cov.scored_content_by_kind : null;
  if (scored) {
    for (const [kind, entry] of Object.entries(scored)) {
      const total = Number(entry?.total);
      const done = Number(entry?.scored);
      const missing = Number.isFinite(total) && Number.isFinite(done) ? formatCount(Math.max(0, total - done), { unit: '' }) : '—';
      rows.push({ source: `scores:${kind}`, latest: '—', age: '—', missing, unit: 'content hashes' });
    }
  }

  rows.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return { rows, columns: COVERAGE_COLUMNS };
}

export function renderCoverage(container, model, doc = globalThis.document) {
  ensurePulseStyles(doc);
  container.replaceChildren();
  const wrapper = doc.createElement('div');
  wrapper.className = 'pulse-coverage';
  const warning = doc.createElement('p');
  warning.className = 'pulse-note';
  warning.textContent = COVERAGE_METADATA_WARNING;
  const node = table(doc, {
    caption: 'Latest retained records and missing prices or scores',
    columns: model.columns.map(label => ({ label })),
    rows: model.rows.map(row => [row.source, row.latest, row.age, row.missing, row.unit]),
    empty: 'No retained coverage recorded.'
  });
  wrapper.append(warning, node);
  container.append(wrapper);
  return container;
}

export async function load({ scope = {}, spec = {}, transport, tenant, signal, doc = globalThis.document, clear = null, readContext = null, schema = null } = {}) {
  ensurePulseStyles(doc);
  try {
    const params = readContext ? readContext.paramsFor() : scopeParams(scope);
    const resolvedSchema = schema ? { body: schema } : await transport.schema(tenant);
    const { response, body: summary } = await transport.get('summary', params, { tenant, signal, stateKey: 'coverage-summary' });
    if (!response.ok) {
      return errorState({ message: summary?.error || `The server returned ${response.status}.`, code: summary?.code || String(response.status || '') });
    }
    const coverage = resolvedSchema?.body?.coverage || null;
    if (!coverage && !summary) {
      return unsupportedState({ feature: 'Coverage', reason: 'the server publishes neither /schema.coverage nor /summary', source: 'this plan\'s server phases' });
    }
    if (summaryIsEmpty(summary)) {
      whenPanelBody('coverage', doc, host => host.replaceChildren());
      const causes = emptyCausesFor(scope, clear);
      const all = (readContext?.window?.all === true) || (!scope.from && !scope.to && (!scope.win || scope.win === 'all'));
      if (!all) causes.push({ kind: 'window', label: 'No observations in this window — view all history', clear: typeof clear === 'function' ? () => clear({ kind: 'window' }) : null });
      if (!causes.length) causes.push({ kind: 'scope', label: `no coverage data in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    const model = coverageModel({ coverage, summary });
    whenPanelBody('coverage', doc, host => renderCoverage(host, model, doc));
    return {
      state: 'ready',
      rows: model.rows,
      basis: 'tenant-wide coverage metadata plus the current summary; every value names its unit',
      population: { unit: 'source', returned_n: model.rows.length, eligible_n: model.rows.length }
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The coverage request failed.' });
  }
}

export const COVERAGE_PANEL = {
  id: 'coverage',
  title: 'Data coverage',
  grain: 'typed populations',
  measures: ['model_calls', 'unpriced_calls', 'artifact_versions'],
  lenses: ['kind', 'stage', 'source'],
  charts: [],
  table: true,
  requires: [],
  caveats: 'Tenant metadata in its own units; no single blended percentage. Missing data is not zero activity. Time, repository and kind do not narrow the metadata rows.',
  measureBasis: 'tenant-wide /schema.coverage; summary uses the current event-time window',
  requests: () => [
    { route: '/v1/analytics/schema', method: 'GET' },
    { route: '/v1/analytics/summary', method: 'GET', params: {} }
  ],
  load
};

export default COVERAGE_PANEL;
