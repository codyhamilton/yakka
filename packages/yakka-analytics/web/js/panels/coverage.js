// `coverage`: typed availability rows with units and denominators. It reads
// `/schema.coverage` and `/summary`; overlapping populations are never summed
// into one blended percentage.

import { formatCount } from '../charts/formatters.js';
import { cancelledState, errorState, unsupportedState } from '../core/panel-state.js';
import { ensurePulseStyles, scopeParams, table, whenPanelBody } from './pulse-strips.js';

function timeText(value) {
  if (value === null || value === undefined || value === '') return 'not supplied';
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : 'not supplied';
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

function countText(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'not supplied';
  return formatCount(Number(value), { unit });
}

// Map the two responses to row groups, each naming its own unit. No group is
// divided by another to produce a single blended percentage.
export function coverageModel({ coverage = null, summary = null } = {}) {
  const cov = coverage && typeof coverage === 'object' ? coverage : {};
  const sum = summary && typeof summary === 'object' ? summary : {};
  const facts = cov.facts && typeof cov.facts === 'object' ? cov.facts : null;
  const groups = [];

  const factRows = [];
  if (facts) {
    for (const [type, entry] of Object.entries(facts)) {
      factRows.push([type, timeText(entry?.first_ts), timeText(entry?.last_ts), timeText(entry?.last_received_at)]);
    }
  } else {
    for (const [label, value] of [['first', cov.first_ts], ['last', cov.last_ts], ['received', cov.last_received_at]]) {
      if (value !== undefined) factRows.push([label, 'not supplied', timeText(value), 'not supplied']);
    }
  }
  groups.push({
    key: 'facts',
    title: 'Facts by type (first / last event time, last receive time — UTC)',
    columns: [{ label: 'Fact type' }, { label: 'First event' }, { label: 'Last event' }, { label: 'Last received' }],
    rows: factRows,
    empty: 'not supplied',
    units: 'one row per fact type; times are UTC ISO strings'
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

export async function load({ scope = {}, transport, tenant, signal, doc = globalThis.document } = {}) {
  ensurePulseStyles(doc);
  try {
    const [{ body: schema }, { response, body: summary }] = await Promise.all([
      transport.schema(tenant),
      transport.get('summary', scopeParams(scope), { tenant, signal, stateKey: 'coverage-summary' })
    ]);
    if (!response.ok) {
      return errorState({ message: summary?.error || `The server returned ${response.status}.`, code: summary?.code || String(response.status || '') });
    }
    const coverage = schema?.coverage || null;
    if (!coverage && !summary) {
      return unsupportedState({ feature: 'Coverage', reason: 'the server publishes neither /schema.coverage nor /summary', source: 'this plan\'s server phases' });
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
