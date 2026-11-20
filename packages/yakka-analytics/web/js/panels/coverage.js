// `coverage`: typed availability rows with units and denominators. It reads
// `/schema.coverage` and `/summary`; overlapping populations are never summed
// into one blended percentage.

import { formatCount } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { emptyCausesFor, ensurePulseStyles, scopeParams, summaryIsEmpty, table, whenPanelBody } from './pulse-strips.js';

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
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'not supplied';
  return formatCount(Number(value), { unit });
}

// Map the two responses to row groups, each naming its own unit. No group is
// divided by another to produce a single blended percentage.
export function coverageModel({ coverage = null, summary = null, now = Date.now() } = {}) {
  const cov = coverage && typeof coverage === 'object' ? coverage : {};
  const sum = summary && typeof summary === 'object' ? summary : {};
  const groups = [];

  const factRows = observationRows(cov).map(row => [row.type, row.first, row.last, row.received]);
  groups.push({
    key: 'facts',
    title: 'Facts by type (first / last event time UTC seconds, last receive time UTC nanoseconds)',
    columns: [{ label: 'Fact type' }, { label: 'First event' }, { label: 'Last event' }, { label: 'Last received' }],
    rows: factRows,
    empty: 'not supplied',
    units: 'one row per fact type; event seconds and receive nanoseconds are converted by their declared unit'
  });

  const snapshot = coverageSnapshot(cov, now);
  const summaryRows = [
    ['Latest retained event', snapshot.latest ? `${snapshot.latest.at} (${snapshot.latest.age} ago)` : 'not supplied'],
    ['Latest usage event', snapshot.usage ? `${snapshot.usage.last} (${snapshot.usage.age} ago)` : 'not supplied'],
    ['Available historical range', snapshot.range ? `${snapshot.range.from} → ${snapshot.range.to}` : 'not supplied'],
    ['Sessions with / without a derived repo', snapshot.sessions
      ? `${countText(snapshot.sessions.with_session_repo, 'sessions')} / ${countText(snapshot.sessions.without_session_repo, 'sessions')}`
      : 'not supplied'],
    ['Scored / total content hashes', snapshot.scored ? `${countText(snapshot.scored.scored, 'hashes')} / ${countText(snapshot.scored.total, 'hashes')}` : 'not supplied']
  ];
  groups.push({
    key: 'latest',
    title: 'Retained observation summary — not a completeness claim',
    columns: [{ label: 'Observation' }, { label: 'Value' }],
    rows: summaryRows,
    empty: 'not supplied',
    units: 'latest event and usage are separate observations; age is measured from the selected render time'
  });

  const sessions = cov.sessions && typeof cov.sessions === 'object' ? cov.sessions : null;
  groups.push({
    key: 'sessions',
    title: 'Session repo attribution (sessions)',
    columns: [{ label: 'Population', numeric: true }],
    rows: sessions
      ? [
          ['All sessions', countText(sessions.total, 'sessions')],
          ['With a derived repo', countText(sessions.with_session_repo, 'sessions')],
          ['Without a derived repo', countText(sessions.without_session_repo, 'sessions')]
        ]
      : [['Sessions', 'not supplied']],
    empty: 'not supplied',
    units: 'sessions; the two attributed groups partition the total'
  });

  const scored = cov.scored_content_by_kind && typeof cov.scored_content_by_kind === 'object' ? cov.scored_content_by_kind : null;
  const scoredRows = scored
    ? Object.entries(scored).map(([kind, entry]) => [kind, countText(entry?.scored, 'hashes'), countText(entry?.total, 'hashes')])
    : [];
  groups.push({
    key: 'scored',
    title: 'Scored / total distinct content hashes per kind',
    columns: [{ label: 'Kind' }, { label: 'Scored', numeric: true }, { label: 'Total', numeric: true }],
    rows: scoredRows,
    empty: 'not supplied',
    units: 'distinct content hashes per kind'
  });

  const calls = Number(sum.model_calls);
  const unpriced = Number(sum.unpriced_calls);
  const priced = Number.isFinite(calls) && Number.isFinite(unpriced) ? calls - unpriced : null;
  groups.push({
    key: 'pricing',
    title: 'Priced / total model calls',
    columns: [{ label: 'Population', numeric: true }],
    rows: [
      ['Total calls', countText(Number.isFinite(calls) ? calls : null, 'calls')],
      ['Priced calls', countText(priced, 'calls')],
      ['Unpriced calls', countText(Number.isFinite(unpriced) ? unpriced : null, 'calls')]
    ],
    empty: 'not supplied',
    units: 'model calls; unpriced calls are never counted as $0'
  });

  const source = sum.by_source && typeof sum.by_source === 'object' ? sum.by_source : null;
  groups.push({
    key: 'source',
    title: 'Data by source (server-defined source rows)',
    columns: [{ label: 'Source', numeric: true }],
    rows: source ? Object.entries(source).map(([key, value]) => [key, countText(value, 'rows')]) : [['By source', 'not supplied']],
    empty: 'not supplied',
    units: 'rows in the server-defined by_source groups'
  });

  const rejections = sum.rejections && typeof sum.rejections === 'object' ? sum.rejections : null;
  groups.push({
    key: 'rejections',
    title: 'Rejected by stage',
    columns: [{ label: 'Stage', numeric: true }],
    rows: rejections
      ? [
          ['Precheck', countText(rejections.precheck, 'rejections')],
          ['Screen', countText(rejections.screen, 'rejections')]
        ]
      : [['Rejections', 'not supplied']],
    empty: 'not supplied',
    units: 'rejections per stage; stages are separate populations'
  });

  const screens = sum.screens && typeof sum.screens === 'object' ? sum.screens : null;
  groups.push({
    key: 'screens',
    title: 'Screen state',
    columns: [{ label: 'State', numeric: true }],
    rows: screens
      ? Object.entries(screens).map(([key, value]) => [key, countText(value, 'screens')])
      : [['Screens', 'not supplied']],
    empty: 'not supplied',
    units: 'screens by state'
  });

  const stateRows = [
    ['Compaction', cov.compaction || 'not supplied'],
    ['Pending', countText(cov.pending, 'items')],
    ['Screen gaps', countText(cov.screen_gaps, 'gaps')],
    ['Scorer configured', cov.scorer_configured === undefined ? 'not supplied' : cov.scorer_configured ? 'yes' : 'no']
  ];
  if (cov.revisions && typeof cov.revisions === 'object') {
    for (const [key, value] of Object.entries(cov.revisions)) stateRows.push([`Revision ${key}`, String(value)]);
  }
  groups.push({
    key: 'state',
    title: 'Compaction, pending and scoring state',
    columns: [{ label: 'State' }, { label: 'Value' }],
    rows: stateRows,
    empty: 'not supplied',
    units: 'gauges and configured flags; not summed'
  });

  return { groups };
}

export function renderCoverage(container, model, doc = globalThis.document) {
  ensurePulseStyles(doc);
  container.replaceChildren();
  const wrapper = doc.createElement('div');
  wrapper.className = 'pulse-coverage';
  const heading = doc.createElement('p');
  heading.className = 'pulse-basis';
  heading.textContent = 'Basis: tenant-wide /schema.coverage plus /summary for the current scope. Each group names its own unit and denominator; overlapping populations are not summed.';
  wrapper.append(heading);
  for (const group of model.groups) {
    const section = doc.createElement('section');
    section.className = 'pulse-coverage-group';
    const title = doc.createElement('h3');
    title.textContent = group.title;
    section.append(title, table(doc, {
      caption: group.units,
      columns: group.columns,
      rows: group.rows,
      empty: group.empty
    }));
    wrapper.append(section);
  }
  container.append(wrapper);
  return container;
}

export async function load({ scope = {}, transport, tenant, signal, doc = globalThis.document, clear = null, readContext = null } = {}) {
  ensurePulseStyles(doc);
  try {
    const params = readContext ? readContext.paramsFor() : scopeParams(scope);
    const [{ body: schema }, { response, body: summary }] = await Promise.all([
      transport.schema(tenant),
      transport.get('summary', params, { tenant, signal, stateKey: 'coverage-summary' })
    ]);
    if (!response.ok) {
      return errorState({ message: summary?.error || `The server returned ${response.status}.`, code: summary?.code || String(response.status || '') });
    }
    const coverage = schema?.coverage || null;
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
      groups: model.groups,
      basis: 'tenant-wide coverage plus the current summary; every value names its unit',
      population: { unit: 'typed population', returned_n: model.groups.length, eligible_n: model.groups.length }
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The coverage request failed.' });
  }
}

export const COVERAGE_PANEL = {
  id: 'coverage',
  title: 'Coverage',
  grain: 'typed populations',
  measures: ['model_calls', 'unpriced_calls', 'artifact_versions'],
  lenses: ['kind', 'stage', 'source'],
  charts: [],
  table: true,
  requires: [],
  caveats: 'Typed populations with their own units and denominators; no single blended percentage. Missing fields are named, never zeroed.',
  measureBasis: 'tenant-wide /schema.coverage; summary uses the current event-time window',
  requests: () => [
    { route: '/v1/analytics/schema', method: 'GET' },
    { route: '/v1/analytics/summary', method: 'GET', params: {} }
  ],
  load
};

export default COVERAGE_PANEL;
