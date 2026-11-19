// Deterministic fixture shapes generated from the committed manifest counts.
// Test-only: this module is never shipped and product code never imports it.

import { readFileSync } from 'node:fs';

const manifestPath = new URL('../../../yakka/internal/analyticsfixture/manifest.json', import.meta.url);
export const FIXTURE = JSON.parse(readFileSync(manifestPath, 'utf8'));
export const COUNTS = FIXTURE.populations;

const FEATURES = {
  bucket_auto: true,
  entities_session: true,
  entities_time: true,
  entities_artifact: true,
  entities_plan: true,
  entities_execution: true,
  exclude: true,
  scores_by_lens: true,
  artifact_content: true,
  activity: true,
  analytics_activity: true,
  cohort: true
};

export function makeSchema({ legacy = false, missingFeature = '' } = {}) {
  const features = { ...FEATURES };
  if (missingFeature) features[missingFeature] = false;
  if (legacy) {
    for (const key of Object.keys(features)) features[key] = false;
    features.bucket_auto = false;
  }
  const grain = (measures, lenses) => ({ measures, lenses, modes: ['list', 'aggregate'], filters: lenses, predicate: { measures, lenses, undefined: [] } });
  return {
    measures: [
      { name: 'cost_usd', unit: 'USD', dims: [] },
      { name: 'model_calls', unit: 'calls', dims: [] },
      { name: 'commits', unit: 'commits', dims: [] }
    ],
    buckets: legacy ? ['day', 'week'] : ['hour', 'day', 'week', 'month', 'year'],
    resolutions: { auto: true, year: true, multi_year_steps: [2, 5, 10, 20, 50, 100] },
    budgets: legacy
      ? { max_cells: 20000, top_max: 500, page_max: 500 }
      : { max_cells: 20000, deadline_s: 30, top_max: 500, page_max: 500, scatter_points: 5000, content_bytes: 16777216, explore_page_max: 500, heavy_read_concurrency: 4, scope_elements: 64, scope_values: 64, value_bytes: { default: 256, id: 1024 } },
    grains: {
      session: grain(['cost_usd', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'tokens_reasoning', 'model_calls', 'commits', 'unpriced_calls', 'hook_events'], ['harness', 'session_model', 'session_repo', 'model', 'id']),
      artifact: grain(['versions', 'score:design', 'cost_usd'], ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'id']),
      execution: grain(['ts', 'session_cost_usd'], ['shape', 'plan', 'repo_id', 'harness', 'session_model', 'id']),
      plan: grain(['artifacts', 'versions', 'associated_cost_usd'], ['repo_id', 'harness', 'session_model', 'id']),
      content: grain(['score'], ['harness', 'session_model', 'repo_id', 'plan', 'scorer', 'band', 'id']),
      time: grain(['cost_usd', 'model_calls', 'commits'], ['id'])
    },
    lenses: { harness: { grains: ['session', 'plan', 'execution'] }, session_model: { grains: ['session', 'plan', 'execution'] } },
    coverage: {
      first_ts: '2020-01-01T00:00:00Z',
      last_ts: '2026-10-01T00:00:00Z',
      last_received_at: '2026-10-01T00:00:00Z',
      scorer_configured: true,
      pending: 0,
      compaction: 'none'
    },
    features
  };
}

export function activityProbe() {
  return {
    mode: 'probe',
    counts: { session_start: COUNTS.sessions_one_repo + COUNTS.sessions_many_repos, artifact_version: COUNTS.artifact_brief_versions, execution: COUNTS.execution_shapes, rejection: COUNTS.rejections_precheck + COUNTS.rejections_screen },
    watermark: 'MTAwMA',
    ignored_filters: []
  };
}

export function summary() {
  return {
    from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z',
    conversations: COUNTS.sessions_one_repo + COUNTS.sessions_many_repos + COUNTS.sessions_no_repo,
    hook_events: COUNTS.hook_events,
    artifact_versions: COUNTS.artifact_design_versions + COUNTS.artifact_brief_versions + COUNTS.artifact_report_versions,
    distinct_content: COUNTS.scored_hashes,
    commits: COUNTS.execution_shapes,
    model_calls: COUNTS.model_calls,
    unpriced_calls: COUNTS.unpriced_beyond_conversation_cap,
    cost_usd: 12.5,
    rejections: { precheck: COUNTS.rejections_precheck, screen: COUNTS.rejections_screen }
  };
}

export function activityList() {
  return {
    mode: 'list',
    rows: [
      { event_time: '2026-10-01T00:00:00Z', type: 'session_start', identity: 'fixture-session', conversation_id: 'fixture-session', harness: 'orca' },
      { event_time: '2026-09-30T00:00:00Z', type: 'artifact_version', identity: 'fixture-version', conversation_id: 'fixture-session', repo_id: 'fixture-repo', path: 'docs/plans/20-fixture/DESIGN.md', kind: 'design' }
    ],
    population: { grain: 'activity', unit: 'typed_observation', scope_n: 2, cohort_n: 2, eligible_n: 2, returned_n: 2, missing_by_reason: {}, by_type: {} }
  };
}

export function population(grain, unit, n) {
  return { grain, unit, scope_n: n, cohort_n: n, eligible_n: n, returned_n: n, missing_by_reason: {}, relation: null };
}

// Deterministic `/v1/analytics/explore` ledger: one row per event, newest first,
// carrying the CONTRACTS.md 7.2 row fields. Every row has a distinct `ts`, so
// the row identity (which includes `ts`) is unique and order is non-increasing.
export const EXPLORE_TOTAL = 20050;

const pad = (value, width) => String(value).padStart(width, '0');

let exploreCache = null;

export function exploreRows() {
  if (exploreCache) return exploreCache;
  const base = Date.parse('2026-10-01T00:00:00Z');
  const rows = [];
  for (let index = 0; index < EXPLORE_TOTAL; index += 1) {
    const ts = new Date(base - index * 1000).toISOString();
    if (index % 1000 === 500) {
      rows.push({
        type: 'rejection', ts, harness: '', repo_id: '', plan: '', kind: '', event: '', tool: '',
        norm_event: '', model: '', path: '', conversation_id: '', source: '', sha: '',
        screen_verdict: 'pass', rejection_stage: 'screen', cost_usd: 0, priced: false
      });
      continue;
    }
    if (index % 997 === 300) {
      rows.push({
        type: 'artifact_version', ts, harness: 'orca', repo_id: 'repo-a', plan: '20', kind: 'design',
        event: '', tool: '', norm_event: '', model: '', path: 'docs/plans/20-analytics-reset/DESIGN.md',
        conversation_id: '', source: 'commit', sha: '', screen_verdict: '', rejection_stage: '',
        cost_usd: undefined, priced: false
      });
      continue;
    }
    if (index % 991 === 200) {
      rows.push({
        type: 'commit', ts, harness: 'orca', repo_id: 'repo-a', plan: '20', kind: '', event: '', tool: '',
        norm_event: '', model: '', path: '', conversation_id: `conv-${pad(index % 97, 3)}`, source: 'commit',
        sha: `sha-${pad(index, 6)}`, screen_verdict: '', rejection_stage: '', cost_usd: undefined, priced: false
      });
      continue;
    }
    const unpriced = index % 250 === 7;
    rows.push({
      type: 'hook_event', ts, harness: 'orca',
      repo_id: index % 3 === 0 ? 'repo-a' : 'repo-b', plan: '20',
      kind: index % 2 === 0 ? 'design' : 'brief',
      event: ['PreToolUse', 'PostToolUse', 'UserPromptSubmit'][index % 3],
      tool: ['Bash', 'Read', 'Edit'][index % 3],
      norm_event: ['tool', 'prompt', 'stop'][index % 3],
      model: index % 4 === 0 ? 'claude' : '',
      path: index % 5 === 0 ? `docs/plans/20-analytics-reset/reports/${index}.md` : '',
      conversation_id: `conv-${pad(index % 97, 3)}`,
      source: index % 2 === 0 ? 'worktree' : 'commit', sha: '',
      screen_verdict: '', rejection_stage: '',
      cost_usd: unpriced ? 0 : 0.01 + (index % 50) / 100, priced: !unpriced
    });
  }
  exploreCache = rows;
  return rows;
}

// Opaque, deterministic keyset cursor over the fixed row array.
export function encodeExploreCursor(offset) {
  return Buffer.from(`explore:${offset}`, 'utf8').toString('base64url');
}

export function decodeExploreCursor(cursor) {
  if (!cursor) return 0;
  let text = '';
  try { text = Buffer.from(String(cursor), 'base64url').toString('utf8'); } catch { return 0; }
  const match = /^explore:(\d+)$/.exec(text);
  return match ? Number(match[1]) : 0;
}

export function explorePage({ cursor = '', limit = 0 } = {}) {
  const rows = exploreRows();
  const start = Math.min(Math.max(0, decodeExploreCursor(cursor)), rows.length);
  const size = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : rows.length;
  const end = Math.min(start + size, rows.length);
  const more = end < rows.length;
  return {
    rows: rows.slice(start, end),
    truncated: more,
    ...(more ? { next: encodeExploreCursor(end) } : {})
  };
}

// The full `/v1/admin/status` shape (CONTRACTS.md 6): server summary, optional
// volume, and two tenants so cross-tenant separation is visible. Times are Unix
// seconds and sizes are bytes.
export function adminStatus() {
  return {
    version: 'fixture-2',
    scoring: { scorer: true, checks: false, rescorable: true },
    volume: { total_bytes: 1073741824, free_bytes: 536870912 },
    tenants: [
      {
        id: 'alpha',
        name: 'Alpha',
        facts: 10,
        compaction: 'none',
        footprint: { ledger_bytes: 1000, wal_bytes: 0, archive_bytes: 2048, archive_files: 2, blob_bytes: 3072, blobs: 3, pending_bytes: 0, pending: 0, other_bytes: 0 },
        screens: {
          verdicts: { design: 4, brief: 1 },
          scored_content: 7,
          score_rows: 9,
          rejections: [{ stage: 'screen', pattern: 'missing-report', count: 2, last: 1700000000 }],
          total_rejections: 2
        },
        failures: [{ stage: 'screen', pattern: 'missing-report', reason: 'no report', path: 'docs/01.md', content_hash: 'hash-a', at: 1700000000 }],
        rescore: { running: true, total: 5, done: 3, failed: 0, started: 1700000000, finished: 0 }
      },
      {
        id: 'beta',
        name: 'Beta',
        facts: 20,
        compaction: 'partial',
        footprint: { ledger_bytes: 2000, wal_bytes: 4, archive_bytes: 0, archive_files: 0, blob_bytes: 0, blobs: 0, pending_bytes: 8, pending: 1, other_bytes: 0 },
        screens: { verdicts: {}, scored_content: 0, score_rows: 0, rejections: null, total_rejections: 0 },
        failures: [],
        rescore: { running: false, total: 2, done: 2, failed: 1, started: 1700000000, finished: 1700000100, error: 'one item failed' }
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// P10 scene: a deterministic schema and fixture for the Trends and Compare
// presets. It is opt-in through the stub's `p10` state flag; the default
// makeSchema()/summary() bodies above stay byte-identical.
// ---------------------------------------------------------------------------

export const P10 = {
  day: 86400e3,
  start: Date.parse('2026-09-01T00:00:00Z'),
  models: ['claude', 'gpt'],
  harnesses: ['orca', 'claude-code'],
  repos: ['repo-a', 'repo-b'],
  sessionModels: ['claude', '(mixed)'],
  sessionRepos: ['repo-a', '(multi)', '(none)'],
  tools: ['Bash', 'Read'],
  toolKinds: ['shell', 'read'],
  kinds: ['design', 'brief']
};

const P10_MEASURES = [
  { name: 'cost_usd', unit: 'USD', dims: ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'conversation_id'] },
  { name: 'model_calls', unit: 'calls', dims: ['model', 'harness', 'session_model', 'session_repo', 'repo_id'] },
  { name: 'unpriced_calls', unit: 'calls', dims: ['model', 'harness', 'repo_id'] },
  { name: 'tokens_in', unit: 'tokens', dims: ['model', 'harness', 'session_model', 'repo_id'] },
  { name: 'tokens_out', unit: 'tokens', dims: ['model', 'harness', 'session_model', 'repo_id'] },
  { name: 'tokens_cache_read', unit: 'tokens', dims: ['model', 'harness', 'repo_id'] },
  { name: 'tokens_cache_write', unit: 'tokens', dims: ['model', 'harness', 'repo_id'] },
  { name: 'tokens_reasoning', unit: 'tokens', dims: ['model', 'harness', 'repo_id'] },
  { name: 'hook_events', unit: 'events', dims: ['harness', 'repo_id', 'tool', 'tool_kind', 'model', 'weekday', 'hour_of_day'] },
  { name: 'conversations', unit: 'sessions', dims: ['harness', 'repo_id', 'model'] },
  { name: 'artifact_versions', unit: 'versions', dims: ['harness', 'repo_id', 'kind', 'plan', 'source'] },
  { name: 'commits', unit: 'commits', dims: ['harness', 'repo_id'] },
  { name: 'rejections', unit: 'rejections', dims: ['stage'] }
];

export function p10Schema() {
  const grain = (measures, lenses, filters = lenses) => ({
    measures, lenses, filters, modes: ['list', 'aggregate'],
    predicate: { measures, lenses, undefined: [] }
  });
  return {
    measures: P10_MEASURES.map(item => ({ ...item, dims: item.dims.slice() })),
    buckets: ['none', 'hour', 'day', 'week', 'month', 'year'],
    resolutions: { auto: true, year: true, multi_year_steps: [2, 5, 10, 20, 50, 100] },
    budgets: {
      max_cells: 20000, deadline_s: 30, top_max: 3, page_max: 500, scatter_points: 5000,
      content_bytes: 16777216, explore_page_max: 500, heavy_read_concurrency: 4,
      scope_elements: 64, scope_values: 64, value_bytes: { default: 256, id: 1024 }
    },
    grains: {
      session: grain(['cost_usd', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'tokens_reasoning', 'model_calls', 'commits', 'unpriced_calls', 'hook_events'], ['harness', 'session_model', 'session_repo', 'model', 'id']),
      artifact: grain(['versions', 'score:design', 'cost_usd'], ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'id']),
      execution: grain(['ts', 'session_cost_usd'], ['shape', 'plan', 'repo_id', 'harness', 'session_model', 'id']),
      plan: grain(['artifacts', 'versions', 'associated_cost_usd'], ['repo_id', 'harness', 'session_model', 'id']),
      content: grain(['score'], ['harness', 'session_model', 'repo_id', 'plan', 'scorer', 'band', 'id']),
      time: grain(P10_MEASURES.map(item => item.name), ['id'])
    },
    lenses: {
      harness: { grains: ['session', 'plan', 'execution', 'time'] },
      session_model: { grains: ['session', 'plan', 'execution', 'time'] }
    },
    coverage: {
      first_ts: '2026-09-01T00:00:00Z',
      last_ts: '2026-11-01T00:00:00Z',
      last_received_at: '2026-11-01T00:00:00Z',
      scorer_configured: true,
      pending: 0,
      compaction: 'none'
    },
    features: { ...FEATURES }
  };
}

function groupsFor(dim) {
  if (dim === 'model') return P10.models;
  if (dim === 'harness') return P10.harnesses;
  if (dim === 'session_model') return P10.sessionModels;
  if (dim === 'session_repo') return P10.sessionRepos;
  if (dim === 'repo_id') return P10.repos;
  if (dim === 'tool') return P10.tools;
  if (dim === 'tool_kind') return P10.toolKinds;
  if (dim === 'kind') return P10.kinds;
  if (dim === 'plan') return ['20', '21'];
  if (dim === 'source') return ['worktree', 'commit'];
  if (dim === 'stage') return ['precheck', 'screen'];
  return ['all'];
}

// Current windows end at `now`; a previous equal-length window ends one span
// earlier. This is relative to the run clock, so it never depends on the date.
export function p10Phase({ from = '', to = '' } = {}) {
  const now = Date.now();
  const end = to ? Date.parse(to) : now;
  return Number.isFinite(end) && Math.abs(now - end) <= 2 * P10.day ? 1 : 0;
}

function groupValue(measure, groupIndex, index, phase) {
  if (measure === 'cost_usd') return Number((1.5 + groupIndex * 0.75 + index * 0.1 + phase * 0.5).toFixed(4));
  if (measure === 'commits') return 2 + ((index + groupIndex + phase) % 5);
  if (measure === 'hook_events') return 8 + ((index * 3 + groupIndex * 5 + phase * 2) % 17);
  if (measure === 'conversations') return 1 + ((index + groupIndex + phase) % 4);
  if (measure === 'artifact_versions') return 1 + ((index + groupIndex) % 3);
  if (measure === 'rejections') return (index + groupIndex) % 3;
  if (measure === 'model_calls') return 3 + ((index * 2 + groupIndex + phase) % 9);
  if (measure === 'unpriced_calls') return (index + groupIndex + phase) % 2;
  if (measure.startsWith('tokens_')) return 400 + index * 120 + groupIndex * 250 + phase * 300;
  return index + groupIndex + 1;
}

function rankValue(measure, group, phase) {
  const base = measure === 'cost_usd' ? 12 : measure === 'commits' ? 5 : 10;
  if (group === 'claude') return base + phase * 4;
  return Math.max(0, base - phase * 3);
}

export function p10Query({ measure = 'cost_usd', dims = [], bucket = 'auto', from = '', to = '' } = {}) {
  const phase = p10Phase({ from, to });
  const requested = bucket || 'auto';
  const effective = requested === 'auto' ? 'day' : requested;
  const lenses = dims.filter(Boolean);
  if (lenses.includes('weekday') || lenses.includes('hour_of_day')) {
    const rows = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        rows.push({ k: [weekday, hour], v: 1 + ((weekday * 24 + hour + phase * 3) % 11) });
      }
    }
    return {
      measure, bucket: 'none', requested_bucket: requested, coarsened: false,
      dims: lenses, rows, population: population('time', 'bucket', rows.length)
    };
  }
  if (lenses.length >= 2) {
    const parents = groupsFor(lenses[0]);
    const children = groupsFor(lenses[1]);
    const rows = [];
    parents.forEach((parent, parentIndex) => {
      children.forEach((child, childIndex) => {
        rows.push({ k: [parent, child], v: groupValue(measure, parentIndex, childIndex, phase) });
      });
    });
    return {
      measure, bucket: 'none', requested_bucket: requested, coarsened: false,
      dims: lenses, rows, population: population('time', 'group', rows.length)
    };
  }
  if (effective === 'none') {
    if (!lenses.length) {
      const rows = [{ k: [], v: lenses.length ? 0 : 20 + phase * 5 }];
      return { measure, bucket: 'none', requested_bucket: requested, coarsened: false, dims: lenses, rows, population: population('time', 'bucket', 1) };
    }
    const groups = groupsFor(lenses[0]);
    const rows = groups.map(group => ({ k: [group], v: rankValue(measure, group, phase) }));
    return { measure, bucket: 'none', requested_bucket: requested, coarsened: false, dims: lenses, rows, population: population('time', 'group', rows.length) };
  }
  const step = effective === 'week' ? 7 : effective === 'month' ? 30 : 1;
  const count = effective === 'day' ? 14 : effective === 'week' ? 3 : 2;
  const buckets = Array.from({ length: count }, (_, index) => new Date(P10.start + index * step * P10.day).toISOString());
  const rows = [];
  if (!lenses.length) {
    buckets.forEach((t, index) => rows.push({ t, k: [], v: groupValue(measure, 0, index, phase) }));
  } else {
    const groups = groupsFor(lenses[0]);
    for (const group of groups) {
      const groupIndex = groups.indexOf(group);
      buckets.forEach((t, index) => rows.push({ t, k: [group], v: groupValue(measure, groupIndex, index, phase) }));
    }
  }
  const coarsened = requested !== 'auto' && requested !== effective;
  return {
    measure, bucket: effective, requested_bucket: requested, coarsened,
    window: { from: from || '2026-09-01T00:00:00Z', to: to || '2026-09-15T00:00:00Z' },
    dims: lenses, rows,
    population: population('time', 'bucket', rows.length)
  };
}

const COST_BINS = [
  { lo: 0, hi: 0.01 }, { lo: 0.01, hi: 0.05 }, { lo: 0.05, hi: 0.1 },
  { lo: 0.1, hi: 0.25 }, { lo: 0.25, hi: 0.5 }, { lo: 0.5, hi: 1 }, { lo: 1, hi: null }
];

export function p10Distribution({ measure = 'cost_usd', grain = 'call', dim = '', from = '', to = '' } = {}) {
  const phase = p10Phase({ from, to });
  const groups = dim ? groupsFor(dim) : ['all'];
  const rows = groups.map((key, index) => {
    const n = 18 + index * 6 + phase * 2;
    const unpriced = measure === 'cost_usd' ? (index === 1 ? 2 : 0) : 0;
    const summary = measure === 'cost_usd'
      ? { min: 0.002, p25: 0.02 + index * 0.01, median: 0.04 + index * 0.01, p75: 0.09 + index * 0.02, p95: 0.2 + index * 0.03, max: 0.4 + index * 0.05 }
      : { min: 1, p25: 200, median: 400 + index * 20, p75: 800 + index * 30, p95: 1500, max: 3000 };
    const bins = COST_BINS.map((bin, binIndex) => ({
      lo: bin.lo,
      ...(bin.hi === null ? {} : { hi: bin.hi }),
      n: 2 + ((binIndex + index + phase) % 4)
    }));
    return { k: key, n, unpriced, ...summary, bins };
  });
  return {
    measure, grain, ...(dim ? { dim } : {}),
    rows,
    ignored_filters: [],
    population: population('session', 'call', rows.reduce((sum, row) => sum + row.n, 0))
  };
}

export function p10Summary() {
  return {
    from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z',
    conversations: 12, hook_events: 240, artifact_versions: 30, distinct_content: 18, commits: 9,
    model_calls: 64, unpriced_calls: 3, cost_usd: 4.25,
    rejections: { precheck: 1, screen: 2 }
  };
}

export function p10Scores() {
  return {
    kind: 'design',
    checks: [
      { name: 'clarity', n: 12, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1, scorer: 'jev-1', groups: [
        { k: 'harness:orca', n: 7, min: 0.3, p25: 0.5, median: 0.72, p75: 0.86, max: 1 },
        { k: 'harness:claude-code', n: 5, min: 0.2, p25: 0.45, median: 0.66, p75: 0.8, max: 0.94 }
      ] },
      { name: 'structure', n: 9, min: 0.1, p25: 0.4, median: 0.6, p75: 0.8, max: 0.95, scorer: 'jev-1', groups: [
        { k: 'harness:orca', n: 5, min: 0.2, p25: 0.42, median: 0.62, p75: 0.82, max: 0.95 },
        { k: 'harness:claude-code', n: 4, min: 0.1, p25: 0.35, median: 0.58, p75: 0.78, max: 0.9 }
      ] }
    ]
  };
}

export function p10ScoreSeries() {
  const points = [
    { t: '2026-09-01T00:00:00Z', n: 6, p25: 0.4, median: 0.6, p75: 0.8, groups: [
      { k: 'session_model:claude', n: 4, p25: 0.45, median: 0.64, p75: 0.82 },
      { k: 'session_model:(mixed)', n: 2, p25: 0.35, median: 0.55, p75: 0.76 }
    ] },
    { t: '2026-09-02T00:00:00Z', n: 5, p25: 0.42, median: 0.62, p75: 0.81, groups: [
      { k: 'session_model:claude', n: 3, p25: 0.48, median: 0.67, p75: 0.84 },
      { k: 'session_model:(mixed)', n: 2, p25: 0.38, median: 0.57, p75: 0.77 }
    ] }
  ];
  return { kind: 'design', bucket: 'day', checks: [{ name: 'clarity', points }] };
}

export function p10Baselines() {
  return { kind: 'design', population: 'content', scorers: { 'jev-1': { clarity: { n: 40, p25: 0.45, median: 0.65, p75: 0.85 } } } };
}

export function p10Entities(grain = 'session') {
  if (grain === 'artifact') {
    const rows = [
      { l: { path: 'docs/a.md', repo_id: 'repo-a', content_hash: 'hash-a', kind: 'design', 'band:clarity': 'top' }, m: { 'score:clarity': 0.82, 'score:structure': 0.7 } },
      { l: { path: 'docs/b.md', repo_id: 'repo-b', content_hash: 'hash-b', kind: 'brief', 'band:clarity': 'mid' }, m: { 'score:clarity': 0.6, 'score:structure': 0.55 } },
      { l: { path: 'docs/c.md', repo_id: 'repo-a', content_hash: 'hash-c', kind: 'design', 'band:clarity': 'bottom' }, m: { 'score:clarity': 0.3, 'score:structure': 0.4 } }
    ];
    return { rows, population: { ...population('artifact', 'file', rows.length) } };
  }
  return { rows: [], population: population(grain, grain, 0) };
}

export function p10Fixture() {
  return {
    schema: p10Schema(),
    query: p10Query,
    distribution: p10Distribution,
    summary: p10Summary,
    scores: p10Scores,
    scoreSeries: p10ScoreSeries,
    baselines: p10Baselines,
    entities: p10Entities,
    groupsFor: groupsFor,
    phase: p10Phase
  };
}

// ---------------------------------------------------------------------------
// P11 scene: the scatter lab's schema and deterministic session scatter/list
// bodies. Opt-in through the stub's `p11` flag; the default and P10 bodies
// above stay byte-identical.
// ---------------------------------------------------------------------------

export const P11 = {
  start: Date.parse('2026-09-01T00:00:00Z'),
  populationN: 1880,
  eligibleN: 1700,
  returnedN: 38,
  sessionModels: ['claude', 'gpt', '(mixed)', '(none)'],
  harnesses: ['orca', 'claude-code'],
  sessionRepos: ['repo-a', 'repo-b', '(multi)', '(none)']
};

const P11_SESSION_MEASURES = [
  'cost_usd', 'unpriced_calls', 'model_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'commits', 'artifact_versions',
  'distinct_content', 'duration_s', 'first_ts', 'last_ts'
];

const P11_SESSION_LENSES = ['harness', 'session_model', 'session_repo', 'origin', 'has_artifacts', 'id'];

const P11_ARTIFACT_MEASURES = [
  'versions', 'distinct_writing_sessions', 'first_ts', 'last_ts', 'content_bytes',
  'score:clarity', 'score:structure',
  'writing_session_cost_usd', 'writing_session_model_calls', 'writing_session_tokens_in',
  'writing_session_tokens_out', 'writing_session_tokens_cache_read', 'writing_session_tokens_cache_write',
  'writing_session_tokens_reasoning', 'writing_session_hook_events'
];

const P11_ARTIFACT_LENSES = [
  'kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'screen_verdict',
  'scorer', 'band:clarity', 'band:structure', 'id'
];

const P11_PLAN_MEASURES = [
  'artifacts', 'versions', 'sessions', 'shared_sessions', 'associated_cost_usd', 'unpriced_calls',
  'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
  'design_score:clarity', 'design_score:structure', 'span_days', 'first_ts', 'last_ts'
];

const P11_PLAN_LENSES = ['repo_id', 'harness', 'session_model', 'id'];

const P11_TIME_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions',
  'distinct_content', 'commits', 'rejections'
];

export function p11Schema() {
  const grain = (measures, lenses) => ({
    measures, lenses, filters: lenses, modes: ['list', 'scatter', 'aggregate'],
    predicate: { measures, lenses, undefined: [] }
  });
  return {
    measures: P11_SESSION_MEASURES.map(name => ({ name, unit: sessionUnit(name), dims: [] })),
    buckets: ['none', 'hour', 'day', 'week', 'month', 'year'],
    resolutions: { auto: true, year: true, multi_year_steps: [2, 5, 10, 20, 50, 100] },
    budgets: {
      max_cells: 20000, deadline_s: 30, top_max: 500, page_max: 500, scatter_points: 5000,
      content_bytes: 16777216, explore_page_max: 500, heavy_read_concurrency: 4,
      scope_elements: 64, scope_values: 64, value_bytes: { default: 256, id: 1024 }
    },
    grains: {
      session: grain(P11_SESSION_MEASURES.slice(), P11_SESSION_LENSES.slice()),
      artifact: grain(P11_ARTIFACT_MEASURES.slice(), P11_ARTIFACT_LENSES.slice()),
      plan: grain(P11_PLAN_MEASURES.slice(), P11_PLAN_LENSES.slice()),
      time: grain(P11_TIME_MEASURES.slice(), ['id']),
      execution: grain(['session_cost_usd', 'brief_score:clarity', 'report_score:clarity', 'ts'], ['shape', 'plan', 'repo_id', 'harness', 'session_model', 'id']),
      content: grain(['score'], ['harness', 'session_model', 'repo_id', 'plan', 'scorer', 'screen_verdict', 'band', 'id'])
    },
    lenses: {
      harness: { grains: ['session', 'artifact', 'plan', 'execution'] },
      session_model: { grains: ['session', 'artifact', 'plan', 'execution'] },
      session_repo: { grains: ['session', 'artifact', 'plan'] },
      origin: { grains: ['session'] },
      has_artifacts: { grains: ['session'] },
      id: { identity: true }
    },
    coverage: {
      first_ts: '2026-09-01T00:00:00Z',
      last_ts: '2026-11-01T00:00:00Z',
      last_received_at: '2026-11-01T00:00:00Z',
      scorer_configured: true,
      pending: 0,
      compaction: 'none'
    },
    features: { ...FEATURES }
  };
}

function sessionUnit(name) {
  if (name === 'cost_usd') return 'USD';
  if (name.startsWith('tokens_')) return 'tokens';
  if (name === 'duration_s') return 'seconds';
  if (name === 'first_ts' || name === 'last_ts') return 'epoch seconds';
  if (name === 'commits') return 'commits';
  if (name === 'artifact_versions') return 'versions';
  if (name === 'distinct_content') return 'content hashes';
  if (name === 'hook_events') return 'events';
  return 'calls';
}

export function p11SessionId(index) {
  return `conv-${String(index).padStart(3, '0')}`;
}

// 40 deterministic rows; indices 7 and 27 have a null `commits` axis, so the
// scatter draws 38 marks and the typed population still counts them.
export function p11SessionRows() {
  const rows = [];
  for (let index = 0; index < 40; index += 1) {
    const nullY = index % 20 === 7;
    const base = Math.floor(P11.start / 1000) + index * 60;
    rows.push({
      id: p11SessionId(index),
      m: {
        cost_usd: Number((0.5 + (index % 13) * 0.37).toFixed(4)),
        unpriced_calls: index % 5,
        model_calls: 3 + (index % 9),
        tokens_in: 400 + index * 120,
        tokens_out: 200 + index * 80,
        tokens_cache_read: index * 40,
        tokens_cache_write: index * 10,
        tokens_reasoning: index * 7,
        hook_events: 8 + ((index * 3) % 17),
        commits: nullY ? null : index % 6,
        artifact_versions: 1 + (index % 4),
        distinct_content: index % 3,
        duration_s: 600 + index * 90,
        first_ts: base,
        last_ts: base + 600
      },
      l: {
        harness: P11.harnesses[index % 2],
        session_model: P11.sessionModels[index % 4],
        session_repo: P11.sessionRepos[index % 4],
        origin: index % 3 === 0 ? 'review' : 'agent',
        has_artifacts: index % 2 === 0 ? 'true' : 'false'
      },
      flags: { sampled: true }
    });
  }
  return rows;
}

function fixedBins(total, edges) {
  const bins = [];
  let assigned = 0;
  edges.forEach(([lo, hi], index) => {
    const last = index === edges.length - 1;
    const n = last ? total - assigned : Math.floor(total / edges.length) + (index % 3);
    assigned += n;
    bins.push({ lo, ...(hi === null ? {} : { hi }), n });
  });
  return bins;
}

export function p11Scatter({ fields = [] } = {}) {
  const rows = p11SessionRows();
  return {
    grain: 'session',
    mode: 'scatter',
    fields: fields.length ? fields : ['cost_usd', 'commits', 'unpriced_calls'],
    sampled: true,
    sample_rule: 'sha256(conversation_id) mod 100 < 3',
    population_n: P11.populationN,
    returned_n: P11.returnedN,
    rows,
    marginals: {
      cost_usd: { unit: 'USD', bins: fixedBins(P11.populationN, [[0, 0.5], [0.5, 1], [1, 2], [2, 5], [5, null]]) },
      commits: { unit: 'commits', bins: fixedBins(P11.eligibleN, [[0, 1], [1, 3], [3, 5], [5, null]]) },
      unpriced_calls: { unit: 'calls', bins: fixedBins(P11.populationN, [[0, 1], [1, 2], [2, 4], [4, null]]) }
    },
    population: {
      grain: 'session', unit: 'session', scope_n: P11.populationN, cohort_n: P11.populationN,
      eligible_n: P11.eligibleN, returned_n: P11.returnedN,
      missing_by_reason: { missing_axis: P11.populationN - P11.eligibleN }, relation: null
    }
  };
}

// Artifact scatter rows: two kinds (design, brief), two checks (clarity,
// structure), two writing-session models, one unscored row, one unpriced
// writing session (null cost), one partial (lower-bound) cost and one
// content_unavailable row. Identities are (repo_id, path); the hash rides in
// the lens so the artifact destination can name it.
export function p11ArtifactRows() {
  const base = Math.floor(P11.start / 1000);
  const make = (index, repo, path, kind, model, hash, clarity, structure, cost, bytes, flags) => ({
    id: { repo_id: repo, path },
    m: {
      versions: 1 + (index % 3),
      distinct_writing_sessions: 1 + (index % 2),
      first_ts: base + index * 3600,
      last_ts: base + index * 3600 + 900,
      content_bytes: bytes,
      'score:clarity': clarity,
      'score:structure': structure,
      writing_session_cost_usd: cost,
      writing_session_model_calls: 4 + index,
      writing_session_tokens_in: 400 + index * 100,
      writing_session_tokens_out: 200 + index * 50,
      writing_session_tokens_cache_read: index * 20,
      writing_session_tokens_cache_write: index * 5,
      writing_session_tokens_reasoning: index * 3,
      writing_session_hook_events: 6 + index
    },
    l: {
      kind, plan: '20', repo_id: repo, harness: index % 2 ? 'claude-code' : 'orca',
      session_model: model, source: 'worktree', screen_verdict: 'pass', scorer: 'jev-1',
      'band:clarity': clarity === null ? 'unscored' : (index % 2 ? 'mid' : 'top'),
      'band:structure': structure === null ? 'unscored' : 'mid',
      content_hash: hash
    },
    flags
  });
  return [
    make(0, 'repo-a', 'docs/plans/20-analytics-reset/DESIGN.md', 'design', 'claude', 'hash-a', 0.82, 0.70, 1.25, 4096, { sampled: false }),
    make(1, 'repo-a', 'docs/plans/20-analytics-reset/briefs/11-02-artifact-plan-scatter.md', 'brief', 'gpt', 'hash-b', 0.55, 0.60, 2.50, 8192, { sampled: false }),
    make(2, 'repo-b', 'docs/plans/20-analytics-reset/briefs/11-01-scatter-foundation.md', 'brief', 'claude', 'hash-c', 0.70, null, 0.90, 2048, { lower_bound: true }),
    make(3, 'repo-b', 'docs/plans/20-analytics-reset/briefs/11-03-time-scatter.md', 'brief', 'gpt', 'hash-d', null, 0.40, null, 1024, { unscored: true, unpriced: true, unpriced_calls: 3 }),
    make(4, 'repo-a', 'docs/plans/20-analytics-reset/briefs/11-01-scatter-foundation.md', 'brief', 'claude', 'hash-e', 0.82, 0.70, 1.25, null, { content_unavailable: true }),
    make(5, 'repo-b', 'docs/plans/20-analytics-reset/DESIGN.md', 'design', 'gpt', 'hash-f', 0.60, 0.65, 0.75, 3072, { sampled: false })
  ];
}

export function p11ArtifactScatter({ fields = [] } = {}) {
  const rows = p11ArtifactRows();
  return {
    grain: 'artifact',
    mode: 'scatter',
    fields: fields.length ? fields : ['writing_session_cost_usd', 'score:clarity'],
    sampled: false,
    population_n: rows.length,
    returned_n: rows.length,
    rows,
    marginals: {
      writing_session_cost_usd: {
        unit: 'USD',
        bins: [{ lo: 0, hi: 0.5, n: 1 }, { lo: 0.5, hi: 1, n: 2 }, { lo: 1, hi: 2, n: 2 }, { lo: 2, hi: null, n: 1 }]
      },
      'score:clarity': {
        unit: 'score',
        bins: [{ lo: 0, hi: 0.5, n: 1 }, { lo: 0.5, hi: 0.7, n: 2 }, { lo: 0.7, hi: 0.85, n: 2 }, { lo: 0.85, hi: null, n: 1 }]
      }
    },
    population: {
      grain: 'artifact', unit: 'artifact', scope_n: 6, cohort_n: 6, eligible_n: 5, returned_n: 6,
      missing_by_reason: { unscored: 1, missing_axis: 1 }, relation: null
    }
  };
}

// Plan scatter rows: two plans sharing one session, complete_share present and
// no_executions, one unpriced (null) associated cost and a design score that is
// present on one plan and null on the other.
export function p11PlanRows() {
  const base = Math.floor(P11.start / 1000);
  return [
    {
      id: { repo_id: 'repo-a', plan: '20' },
      m: {
        artifacts: 4, versions: 9, sessions: 3, shared_sessions: 1,
        associated_cost_usd: 5.5, unpriced_calls: 2,
        executions_complete: 3, executions_unreported: 0, executions_started: 1,
        complete_share: 0.75, 'design_score:clarity': 0.80, 'design_score:structure': 0.70,
        span_days: 12, first_ts: base, last_ts: base + 12 * 86400
      },
      l: { repo_id: 'repo-a', harness: 'orca', session_model: 'claude' },
      flags: { shared_session: true }
    },
    {
      id: { repo_id: 'repo-b', plan: '21' },
      m: {
        artifacts: 2, versions: 3, sessions: 2, shared_sessions: 1,
        associated_cost_usd: null, unpriced_calls: 5,
        executions_complete: 0, executions_unreported: 0, executions_started: 0,
        complete_share: null, 'design_score:clarity': null, 'design_score:structure': null,
        span_days: 4, first_ts: base + 86400, last_ts: base + 5 * 86400
      },
      l: { repo_id: 'repo-b', harness: 'claude-code', session_model: 'gpt' },
      flags: { no_executions: true, unpriced: true }
    }
  ];
}

export function p11PlanScatter({ fields = [] } = {}) {
  const rows = p11PlanRows();
  return {
    grain: 'plan',
    mode: 'scatter',
    fields: fields.length ? fields : ['associated_cost_usd', 'artifacts'],
    sampled: false,
    population_n: rows.length,
    returned_n: rows.length,
    rows,
    marginals: {
      associated_cost_usd: {
        unit: 'USD',
        bins: [{ lo: 0, hi: 2, n: 1 }, { lo: 2, hi: 5, n: 0 }, { lo: 5, hi: null, n: 1 }]
      },
      artifacts: {
        unit: 'artifacts',
        bins: [{ lo: 0, hi: 2, n: 1 }, { lo: 2, hi: 4, n: 0 }, { lo: 4, hi: null, n: 1 }]
      }
    },
    population: {
      grain: 'plan', unit: 'plan', scope_n: 2, cohort_n: 2, eligible_n: 1, returned_n: 2,
      missing_by_reason: { no_executions: 1, missing_axis: 1 }, relation: null
    }
  };
}

export function p11Scores({ kind = 'design' } = {}) {
  return { kind, checks: [{ name: 'clarity', n: 6 }, { name: 'structure', n: 4 }] };
}

export function p11Entities(grain = 'session') {
  if (grain === 'artifact') {
    const rows = p11ArtifactRows();
    return {
      grain, rows,
      population: {
        grain, unit: 'artifact', scope_n: rows.length, cohort_n: rows.length,
        eligible_n: rows.length, returned_n: rows.length, missing_by_reason: {}, relation: null
      }
    };
  }
  if (grain === 'plan') {
    const rows = p11PlanRows();
    return {
      grain, rows,
      population: {
        grain, unit: 'plan', scope_n: rows.length, cohort_n: rows.length,
        eligible_n: rows.length, returned_n: rows.length, missing_by_reason: {}, relation: null
      }
    };
  }
  const rows = p11SessionRows();
  return {
    grain,
    rows,
    population: {
      grain, unit: grain, scope_n: P11.populationN, cohort_n: P11.populationN,
      eligible_n: P11.populationN, returned_n: rows.length, missing_by_reason: {}, relation: null
    }
  };
}

export function p11Aggregate({ grain = 'session', stat = 'count' } = {}) {
  return {
    grain,
    mode: 'aggregate',
    stat,
    population: {
      grain, unit: grain, scope_n: 143, cohort_n: 143, eligible_n: 143,
      returned_n: 1, missing_by_reason: {}, relation: null
    }
  };
}

// ---------------------------------------------------------------------------
// P11 time scatter: five half-open daily buckets on one shared grid. The first
// and last are partial at the inclusive source-window edges; one bucket has a
// null commits measure; the last bucket is all-rejection and resolves to a
// valid, empty contributing-session selection. Adding these bodies leaves every
// P10, default and 11-01/11-02 body byte-identical.
// ---------------------------------------------------------------------------

const P11_TIME_START = Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000);
const P11_TIME_WINDOW = { from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z', tz: 'UTC' };

export function p11TimeRows() {
  const bucket = index => ({ t: P11_TIME_START + index * 86400, tz: 'UTC' });
  return [
    { id: bucket(0), m: { cost_usd: 1, commits: 2, rejections: 1 }, l: {}, flags: { partial: true } },
    { id: bucket(1), m: { cost_usd: 2, commits: 3, rejections: 0 }, l: {}, flags: {} },
    { id: bucket(2), m: { cost_usd: 3.5, commits: 1, rejections: 2 }, l: {}, flags: {} },
    { id: bucket(3), m: { cost_usd: 5, commits: null, rejections: 0 }, l: {}, flags: {} },
    { id: bucket(4), m: { cost_usd: 9.5, commits: 0, rejections: 4 }, l: {}, flags: { partial: true, all_rejections: true } }
  ];
}

export function p11TimeScatter({ fields = [] } = {}) {
  const rows = p11TimeRows();
  return {
    grain: 'time',
    mode: 'scatter',
    fields: fields.length ? fields : ['cost_usd', 'commits'],
    bucket: 'day',
    bucket_step: 1,
    requested_bucket: 'auto',
    coarsened: false,
    window: { ...P11_TIME_WINDOW },
    partial: { edge: true, buckets: [rows[0].id, rows[4].id] },
    sampled: false,
    population_n: rows.length,
    returned_n: rows.length,
    rows,
    marginals: {
      cost_usd: {
        unit: 'USD',
        bins: [{ lo: 0, hi: 2, n: 1 }, { lo: 2, hi: 4, n: 2 }, { lo: 4, hi: null, n: 2 }]
      },
      commits: {
        unit: 'commits',
        bins: [{ lo: 0, hi: 1, n: 1 }, { lo: 1, hi: 3, n: 2 }, { lo: 3, hi: null, n: 1 }]
      }
    },
    population: {
      grain: 'time', unit: 'bucket', scope_n: rows.length, cohort_n: rows.length,
      eligible_n: 4, returned_n: rows.length, missing_by_reason: { missing_axis: 1 }, relation: null
    }
  };
}

function rangeLow(node, measure) {
  if (!node || typeof node !== 'object') return null;
  if (node.range && node.range.measure === measure) return Number(node.range.lo);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = rangeLow(child, measure);
        if (found !== null) return found;
      }
    } else if (value && typeof value === 'object') {
      const found = rangeLow(value, measure);
      if (found !== null) return found;
    }
  }
  return null;
}

function timePredicateIsAllRejections(predicate) {
  if (!predicate) return false;
  let node = predicate;
  if (typeof predicate === 'string') {
    try { node = JSON.parse(predicate); } catch { return false; }
  }
  const low = rangeLow(node, 'cost_usd');
  return low !== null && low >= 9;
}

// The aggregate count behind a time region. A bucket whose only rejections are
// unassociated is a valid empty selection: zero contributing sessions, with the
// missing/orphan counts still reconciling and never folded into a session count.
export function p11TimeAggregate({ predicate = '' } = {}) {
  const empty = timePredicateIsAllRejections(predicate);
  const target = empty
    ? { unit: 'session', scope_n: P11.populationN, cohort_n: 0 }
    : { unit: 'session', scope_n: P11.populationN, cohort_n: 7 };
  return {
    grain: 'time',
    mode: 'aggregate',
    stat: 'count',
    population: {
      grain: 'time', unit: 'bucket', scope_n: 5, cohort_n: 5, eligible_n: 5, returned_n: 1,
      missing_by_reason: {},
      relation: {
        source_grain: 'time', target_grain: 'time', mapping: 'contributing_session', op: 'include',
        resolved_n: empty ? 0 : 7, resolved_unit: 'session',
        target_sessions: target,
        associations: empty
          ? [
            {
              side: 'source', contributor: 'rejection', unit: 'rejection', total_n: 4, associated_n: 0,
              missing_by_reason: { no_conversation_id: 2, orphan_conversation_id: 2 }, treatment: 'selected'
            },
            {
              side: 'target', contributor: 'rejection', unit: 'rejection', total_n: 5, associated_n: 0,
              missing_by_reason: { no_conversation_id: 1, orphan_conversation_id: 4 }, treatment: 'dropped'
            }
          ]
          : [
            {
              side: 'source', contributor: 'rejection', unit: 'rejection', total_n: 9, associated_n: 5,
              missing_by_reason: { no_conversation_id: 2, orphan_conversation_id: 2 }, treatment: 'selected'
            },
            {
              side: 'target', contributor: 'rejection', unit: 'rejection', total_n: 11, associated_n: 8,
              missing_by_reason: { no_conversation_id: 1, orphan_conversation_id: 2 }, treatment: 'dropped'
            }
          ]
      }
    }
  };
}


// ---------------------------------------------------------------------------
// P11 sessions: the server-sorted list pages and the bounded conversation.
// Additive bodies; the scatter/list/aggregate shapes above are untouched.
// ---------------------------------------------------------------------------

export function p11SessionListRows() {
  return p11SessionRows().map((row, index) => {
    const flags = { ...(row.flags || {}) };
    delete flags.sampled;
    const m = { ...row.m };
    if (index === 4) {
      m.cost_usd = null;
      m.unpriced_calls = 5;
      flags.unpriced = true;
    }
    if (index === 9) flags.lower_bound = true;
    return { ...row, m, flags };
  });
}

function p11Cursor(offset) {
  return Buffer.from(`p11:${offset}`, 'utf8').toString('base64');
}

function p11CursorOffset(cursor) {
  if (!cursor) return 0;
  try {
    const text = Buffer.from(String(cursor), 'base64').toString('utf8');
    const match = /^p11:(\d+)$/.exec(text);
    return match ? Number(match[1]) : 0;
  } catch { return 0; }
}

// Server-sorted, opaque keyset cursor pages. The page size is capped at 20 so
// the list proves a real second page even though the client asks for page_max.
export function p11SessionList({ sort = 'last_ts:desc', limit = 20, cursor = '', filters = {} } = {}) {
  let rows = p11SessionListRows();
  for (const [key, values] of Object.entries(filters || {})) {
    if (!Array.isArray(values) || !values.length) continue;
    rows = rows.filter(row => values.includes(row.l?.[key] ?? row.m?.[key]));
  }
  const at = String(sort || '').lastIndexOf(':');
  const measure = at === -1 ? String(sort || 'last_ts') : String(sort).slice(0, at);
  const dir = at !== -1 && String(sort).slice(at + 1) === 'asc' ? 'asc' : 'desc';
  rows.sort((a, b) => {
    const av = a.m?.[measure];
    const bv = b.m?.[measure];
    if (av === bv) return String(a.id).localeCompare(String(b.id));
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1);
  });
  const offset = p11CursorOffset(cursor);
  const size = Math.max(1, Math.min(Number(limit) || 20, 20));
  const page = rows.slice(offset, offset + size);
  const nextOffset = offset + page.length;
  const body = {
    grain: 'session',
    rows: page,
    population: {
      grain: 'session', unit: 'session', scope_n: rows.length, cohort_n: rows.length,
      eligible_n: rows.length, returned_n: page.length, missing_by_reason: {}, relation: null
    }
  };
  if (nextOffset < rows.length) body.next = p11Cursor(nextOffset);
  return body;
}

const P11_TOOL_KINDS = ['shell', 'read', 'edit', 'search', 'web'];
const P11_TOOL_NAMES = { shell: 'Bash', read: 'Read', edit: 'Edit', search: 'Grep', web: 'WebFetch' };

// 5,000 returned events of 5,123. Ten returned model calls are unpriced; three
// more unpriced calls sit beyond the cap, so displayed markers reconcile only
// with returned events while the whole-run unpriced total stays larger.
export function p11ConversationEvents(index = 0) {
  const base = Math.floor(P11.start / 1000) + index * 60;
  const iso = seconds => new Date(seconds * 1000).toISOString();
  const events = [];
  for (let i = 0; i < 5000; i += 1) {
    const ts = iso(base + i * 10);
    if (i % 500 === 49) {
      events.push({
        ts, type: 'hook_event', norm_event: 'usage', event: 'usage', tool: '', model: i % 1000 === 49 ? 'claude' : 'gpt',
        tokens: { in: 100 + i, out: 40 + (i % 30), cache_read: 10, cache_write: 2, reasoning: 1 },
        priced: false
      });
      continue;
    }
    if (i % 500 === 99) {
      events.push({
        ts, type: 'hook_event', norm_event: 'usage', event: 'usage', tool: '', model: i % 1000 === 99 ? 'claude' : 'gpt',
        tokens: { in: 200 + i, out: 60 + (i % 20), cache_read: 20, cache_write: 4, reasoning: 2 },
        cost_usd: 0.0025, priced: true
      });
      continue;
    }
    if (i === 100) {
      events.push({
        ts, type: 'artifact_version', norm_event: 'artifact_version', event: 'artifact_version', tool: '', model: '',
        path: 'docs/plans/20-analytics-reset/DESIGN.md', kind: 'design', source: 'worktree', sha: 'hash-design',
        repo_id: 'repo-a', plan: '20-analytics-reset'
      });
      continue;
    }
    if (i === 250) {
      events.push({
        ts, type: 'artifact_version', norm_event: 'artifact_version', event: 'artifact_version', tool: '', model: '',
        path: 'docs/plans/20-analytics-reset/briefs/11-04-sessions.md', kind: 'brief', source: 'worktree', sha: 'hash-brief',
        repo_id: 'repo-a', plan: '20-analytics-reset'
      });
      continue;
    }
    if (i === 350) {
      events.push({ ts, type: 'commit', norm_event: 'commit', event: 'commit', tool: '', model: '', source: 'commit', sha: 'commit-sha', repo_id: 'repo-a' });
      continue;
    }
    if (i === 400) {
      events.push({
        ts, type: 'artifact_version', norm_event: 'artifact_version', event: 'artifact_version', tool: '', model: '',
        path: 'docs/plans/20-analytics-reset/reports/11-04-sessions.md', kind: 'report', source: 'worktree', sha: 'hash-report',
        repo_id: 'repo-b', plan: '20-analytics-reset'
      });
      continue;
    }
    const toolKind = P11_TOOL_KINDS[i % P11_TOOL_KINDS.length];
    events.push({
      ts, type: 'hook_event', norm_event: 'tool_use', event: 'PreToolUse', tool: P11_TOOL_NAMES[toolKind], tool_kind: toolKind,
      model: ''
    });
  }
  return events;
}

export function p11Conversation(id = '') {
  const match = /^conv-(\d{3})$/.exec(String(id));
  if (!match && id !== 'conv-20b') return null;
  const index = match ? Number(match[1]) : 0;
  if (index < 0 || index >= 40) return null;
  const events = p11ConversationEvents(index);
  const base = Math.floor(P11.start / 1000) + index * 60;
  return {
    conversation_id: id,
    harness: 'orca',
    repos: ['repo-a', 'repo-b'],
    models: ['claude', 'gpt'],
    first_ts: new Date(base * 1000).toISOString(),
    last_ts: new Date((base + 5000 * 10) * 1000).toISOString(),
    totals: {
      model_calls: 21, tokens_in: 2100, tokens_out: 840, tokens_cache_read: 120, tokens_cache_write: 24,
      tokens_reasoning: 12, cost_usd: 3.75, unpriced_calls: 13
    },
    window_totals: {
      model_calls: 5, tokens_in: 500, tokens_out: 200, tokens_cache_read: 30, tokens_cache_write: 6,
      tokens_reasoning: 3, cost_usd: 0.75, unpriced_calls: 3
    },
    returned_events: events.length,
    total_events: 5123,
    returned_unpriced_calls: 10,
    total_unpriced_calls: 13,
    events,
    truncated: true
  };
}

export function p11Entity({ grain = 'session', id = '' } = {}) {
  if (grain !== 'session') return null;
  return p11Conversation(id);
}

export function p11Fixture() {
  return {
    schema: p11Schema(),
    scatter: p11Scatter,
    artifactScatter: p11ArtifactScatter,
    planScatter: p11PlanScatter,
    timeScatter: p11TimeScatter,
    timeAggregate: p11TimeAggregate,
    scores: p11Scores,
    entities: p11Entities,
    aggregate: p11Aggregate,
    sessionRows: p11SessionRows,
    artifactRows: p11ArtifactRows,
    planRows: p11PlanRows,
    timeRows: p11TimeRows,
    sessionId: p11SessionId,
    sessionList: p11SessionList,
    conversation: p11Conversation,
    entity: p11Entity
  };
}

// ---------------------------------------------------------------------------
// P12 scene: the workflow panels' plan, execution and event bodies. Opt-in
// through the stub's `p12` flag; every default, P10 and P11 body stays
// byte-identical. Plans are deterministic, page on an opaque cursor and keep
// one plan with no executions and one all-unpriced associated cost.
// ---------------------------------------------------------------------------

export const P12 = {
  start: Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000),
  repos: ['repo-a', 'repo-b'],
  planCount: 10
};

const P12_PLAN_MEASURES = [
  'artifacts', 'versions', 'sessions', 'shared_sessions', 'associated_cost_usd', 'unpriced_calls',
  'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
  'design_score:clarity', 'design_score:structure', 'span_days', 'first_ts', 'last_ts'
];

const P12_PLAN_LENSES = ['repo_id', 'harness', 'session_model', 'id'];

const P12_EXECUTION_MEASURES = [
  'ts', 'session_cost_usd', 'brief_score:preview', 'brief_score:clean',
  'report_score:preview', 'report_score:clean'
];

const P12_EXECUTION_LENSES = ['shape', 'plan', 'repo_id', 'harness', 'session_model', 'id'];

const P12_ARTIFACT_MEASURES = [
  'versions', 'distinct_writing_sessions', 'first_ts', 'last_ts', 'content_bytes',
  'score:clarity', 'score:structure'
];

const P12_ARTIFACT_LENSES = ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'id'];

function p12PlanUnit(name) {
  if (name === 'associated_cost_usd') return 'USD';
  if (name === 'complete_share') return 'ratio';
  if (name === 'first_ts' || name === 'last_ts') return 'epoch seconds';
  if (name === 'span_days') return 'days';
  if (name === 'artifacts') return 'artifacts';
  if (name === 'versions') return 'versions';
  if (name === 'sessions' || name === 'shared_sessions') return 'sessions';
  if (name === 'unpriced_calls') return 'calls';
  if (name.startsWith('executions_')) return 'executions';
  return 'score';
}

export function p12Schema() {
  const grain = (measures, lenses, { modes = ['list'], filters = lenses } = {}) => ({
    measures: measures.slice(), lenses: lenses.slice(), modes: modes.slice(), filters: filters.slice(),
    predicate: { measures: measures.slice(), lenses: lenses.slice(), undefined: [] }
  });
  const p10 = p10Schema();
  const p11 = p11Schema();
  const mergeGrain = (base = {}, additions = {}) => {
    const measures = [...new Set([...(base.measures || []), ...(additions.measures || [])])];
    const lenses = [...new Set([...(base.lenses || []), ...(additions.lenses || [])])];
    const filters = [...new Set([...(base.filters || []), ...(additions.filters || [])])];
    const modes = [...new Set([...(base.modes || []), ...(additions.modes || [])])];
    return { ...base, ...additions, measures, lenses, filters, modes,
      predicate: { measures, lenses, undefined: [] } };
  };
  const p12Plan = grain(P12_PLAN_MEASURES, P12_PLAN_LENSES, { modes: ['list', 'scatter', 'aggregate'] });
  const p12Artifact = grain(P12_ARTIFACT_MEASURES, P12_ARTIFACT_LENSES, { modes: ['list', 'scatter', 'aggregate'] });
  const p12Execution = grain(P12_EXECUTION_MEASURES, P12_EXECUTION_LENSES, { modes: ['list', 'scatter', 'aggregate'], filters: ['plan', 'repo_id'] });
  const lenses = {};
  for (const source of [p10.lenses, p11.lenses]) for (const [name, lens] of Object.entries(source || {})) {
    lenses[name] = { ...lenses[name], ...lens,
      grains: [...new Set([...(lenses[name]?.grains || []), ...(lens.grains || [])])] };
  }
  lenses.harness = { ...lenses.harness, grains: [...new Set([...(lenses.harness?.grains || []), 'plan', 'execution', 'artifact'])] };
  lenses.session_model = { ...lenses.session_model, grains: [...new Set([...(lenses.session_model?.grains || []), 'plan', 'execution', 'artifact'])] };
  lenses.id = { identity: true };
  const grains = { ...p11.grains,
    plan: mergeGrain(p11.grains.plan, p12Plan),
    artifact: mergeGrain(mergeGrain(p10.grains.artifact, p11.grains.artifact), p12Artifact),
    execution: mergeGrain(p11.grains.execution, p12Execution)
  };
  const measuresByName = new Map();
  for (const measure of [...(p10.measures || []), ...(p11.measures || []),
    ...P12_PLAN_MEASURES.map(name => ({ name, unit: p12PlanUnit(name), dims: [] }))]) measuresByName.set(measure.name, measure);
  return {
    measures: [...measuresByName.values()],
    buckets: ['none', 'hour', 'day', 'week', 'month', 'year'],
    resolutions: { auto: true, year: true, multi_year_steps: [2, 5, 10, 20, 50, 100] },
    // A small page_max lets the suite exercise both collections' second page
    // without loading a thousand rows, and keeps the process-shape top honest.
    budgets: {
      max_cells: 20000, deadline_s: 30, top_max: 100, page_max: 4, scatter_points: 5000,
      content_bytes: 16777216, explore_page_max: 500, heavy_read_concurrency: 4,
      scope_elements: 64, scope_values: 64, value_bytes: { default: 256, id: 1024 }
    },
    grains: {
      ...grains,
      content: grain(['score'], ['harness', 'session_model', 'repo_id', 'plan', 'scorer', 'band', 'id'])
    },
    lenses,
    coverage: {
      first_ts: '2026-09-01T00:00:00Z',
      last_ts: '2026-11-01T00:00:00Z',
      last_received_at: '2026-11-01T00:00:00Z',
      scorer_configured: true,
      pending: 0,
      compaction: 'none'
    },
    features: { ...FEATURES }
  };
}

const P12_PLAN_SPECS = [
  ['repo-a', '20', { complete: 3, unreported: 1, started: 1, cost: 5.5, unpriced: 2, shared: 1, flags: { shared_session: true } }],
  ['repo-a', '21', { complete: 0, unreported: 0, started: 0, cost: 0, unpriced: 0, shared: 0, flags: { no_executions: true } }],
  ['repo-b', '22', { complete: 1, unreported: 0, started: 0, cost: null, unpriced: 5, shared: 0, flags: { associated_cost_lower_bound: true, associated_cost_null_reason: 'all_unpriced' } }],
  ['repo-a', '23', { complete: 0, unreported: 2, started: 0, cost: 1.25, unpriced: 0, shared: 1, flags: { shared_session: true } }],
  ['repo-b', '24', { complete: 2, unreported: 0, started: 1, cost: 3, unpriced: 0, shared: 0, flags: {} }],
  ['repo-a', '25', { complete: 1, unreported: 1, started: 1, cost: 0, unpriced: 0, shared: 0, flags: {} }],
  ['repo-b', '26', { complete: 4, unreported: 0, started: 0, cost: 9.5, unpriced: 0, shared: 0, flags: {} }],
  ['repo-a', '27', { complete: 0, unreported: 0, started: 2, cost: 2, unpriced: 1, shared: 0, flags: { associated_cost_lower_bound: true } }],
  ['repo-b', '28', { complete: 2, unreported: 1, started: 0, cost: 4.25, unpriced: 0, shared: 0, flags: {} }],
  ['repo-a', '29', { complete: 1, unreported: 0, started: 0, cost: 1, unpriced: 0, shared: 0, flags: {} }]
];

export function p12PlanRows() {
  return P12_PLAN_SPECS.map(([repo, plan, spec], index) => {
    const total = spec.complete + spec.unreported + spec.started;
    const last = P12.start + (12 - index) * 86400;
    const first = last - (index + 2) * 3600;
    const flags = { ...spec.flags };
    if (total === 0) flags.complete_share_null_reason = 'no_executions';
    return {
      id: { repo_id: repo, plan },
      m: {
        artifacts: 3 + (index % 3),
        versions: 5 + index,
        sessions: 3 + (index % 4),
        shared_sessions: spec.shared,
        associated_cost_usd: spec.cost,
        unpriced_calls: spec.unpriced,
        executions_complete: spec.complete,
        executions_unreported: spec.unreported,
        executions_started: spec.started,
        complete_share: total ? spec.complete / total : null,
        'design_score:clarity': total ? 0.8 - index * 0.01 : null,
        'design_score:structure': total ? 0.7 - index * 0.01 : null,
        span_days: (last - first) / 86400,
        first_ts: first,
        last_ts: last
      },
      l: {
        repo_id: repo,
        harness: index % 2 === 0 ? 'orca' : 'claude-code',
        session_model: index % 2 === 0 ? 'claude' : 'gpt'
      },
      flags
    };
  });
}

function p12Encode(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function p12Decode(text) {
  if (!text) return {};
  try { return JSON.parse(Buffer.from(String(text), 'base64url').toString('utf8')); } catch { return {}; }
}

function p12Page(rows, limit, cursor) {
  const offset = Math.max(0, Number(p12Decode(cursor).offset) || 0);
  const size = Math.max(1, Math.floor(Number(limit) || 12));
  const page = rows.slice(offset, offset + size);
  const next = offset + size < rows.length ? p12Encode({ offset: offset + size }) : null;
  return { page, next };
}

function p12Sort(rows, field, direction) {
  const sign = direction === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a.m?.[field];
    const bv = b.m?.[field];
    const an = av === null || av === undefined;
    const bn = bv === null || bv === undefined;
    if (an && bn) return String(a.id.repo_id).localeCompare(b.id.repo_id) || String(a.id.plan).localeCompare(b.id.plan);
    if (an) return 1;
    if (bn) return -1;
    if (av !== bv) return sign * (av - bv);
    return String(a.id.repo_id).localeCompare(b.id.repo_id) || String(a.id.plan).localeCompare(b.id.plan);
  });
}

export function p12PlanEntities({ sort = 'executions_unreported:desc', limit = 12, cursor = '', filters = {}, cohort = false } = {}) {
  let rows = p12PlanRows();
  const lens = name => Array.isArray(filters[name]) ? filters[name] : (filters[name] ? [filters[name]] : []);
  const repos = lens('repo_id');
  const harnesses = lens('harness');
  const models = lens('session_model');
  if (repos.length) rows = rows.filter(row => repos.includes(row.id.repo_id));
  if (harnesses.length) rows = rows.filter(row => harnesses.includes(row.l.harness));
  if (models.length) rows = rows.filter(row => models.includes(row.l.session_model));
  const at = String(sort).lastIndexOf(':');
  const field = at >= 0 ? sort.slice(0, at) : 'last_ts';
  const direction = at >= 0 ? sort.slice(at + 1) : 'desc';
  rows = p12Sort(rows, field, direction);
  const scopeN = rows.length;
  const { page, next } = p12Page(rows, limit, cursor);
  const noExecutions = rows.filter(row => row.flags?.no_executions).length;
  return {
    grain: 'plan', sort, rows: page, next,
    population: {
      grain: 'plan', unit: 'plan', scope_n: scopeN, cohort_n: scopeN, eligible_n: scopeN,
      returned_n: page.length, missing_by_reason: noExecutions ? { no_executions: noExecutions } : {},
      relation: cohort
        ? {
          source_grain: 'plan', target_grain: 'plan', mapping: 'associated_sessions', op: 'include',
          resolved_n: 6, resolved_unit: 'session', associations: []
        }
        : null
    }
  };
}

// Plan scatter over the whole ten-plan population. The sampled variant uses the
// same deterministic rule as the server, keeps the whole-population marginals,
// and a null axis stays in the population but out of the marks (never zero).
export function p12PlanScatter({ fields = [], sampled = false } = {}) {
  const names = fields.length ? fields : ['associated_cost_usd', 'artifacts'];
  const all = p12PlanRows().map(row => ({
    id: row.id,
    m: Object.fromEntries(names.map(name => [name, row.m?.[name] ?? null])),
    l: { repo_id: row.l.repo_id, harness: row.l.harness, session_model: row.l.session_model },
    flags: row.flags
  }));
  const points = sampled ? all.slice(0, 5) : all;
  return {
    grain: 'plan', mode: 'scatter', fields: names,
    sampled, sample_rule: sampled ? 'lowest SHA-256 of repo_id and plan' : '',
    population_n: all.length, returned_n: points.length,
    rows: points,
    marginals: {
      associated_cost_usd: {
        unit: 'USD',
        bins: [{ lo: 0, hi: 2, n: 4 }, { lo: 2, hi: 6, n: 5 }, { lo: 6, hi: null, n: 1 }]
      },
      artifacts: {
        unit: 'artifacts',
        bins: [{ lo: 0, hi: 2, n: 0 }, { lo: 2, hi: 4, n: 7 }, { lo: 4, hi: null, n: 3 }]
      }
    },
    population: {
      grain: 'plan', unit: 'plan', scope_n: all.length, cohort_n: all.length, eligible_n: all.length,
      returned_n: points.length, missing_by_reason: { no_executions: 1, missing_axis: 1 }, relation: null
    },
    sample_limit: 5000
  };
}

// A bounded count for a scatter rectangle. The count is the server's typed
// population, never a browser sum of the drawn marks.
export function p12PlanAggregate({ stat = 'count', predicate = '' } = {}) {
  const selected = predicate ? 3 : P12_PLAN_SPECS.length;
  return {
    grain: 'plan', mode: 'aggregate', stat,
    population: {
      grain: 'plan', unit: 'plan', scope_n: P12_PLAN_SPECS.length, cohort_n: selected,
      eligible_n: selected, returned_n: 1, missing_by_reason: {}, relation: null
    }
  };
}

function p12ExecutionBase() {
  const start = P12.start;
  return [
    { repo: 'repo-a', plan: '20', conv: 'conv-shared', brief: 'docs/plans/20-analytics-reset/briefs/12-01.md', shape: 'complete', at: start + 9000, cost: 0.25, flags: {} },
    { repo: 'repo-a', plan: '20', conv: 'conv-20b', brief: 'docs/plans/20-analytics-reset/briefs/12-02.md', shape: 'complete', at: start + 8000, cost: 4, flags: { session_cost_lower_bound: true } },
    { repo: 'repo-a', plan: '20', conv: 'conv-20c', brief: 'docs/plans/20-analytics-reset/briefs/12-03.md', shape: 'complete', at: start + 7000, cost: null, flags: { session_cost_null_reason: 'all_unpriced' } },
    { repo: 'repo-a', plan: '20', conv: 'conv-20d', brief: 'docs/plans/20-analytics-reset/briefs/12-04.md', shape: 'unreported', at: start + 6000, cost: 1.5, flags: {} },
    { repo: 'repo-a', plan: '20', conv: 'conv-20e', brief: 'docs/plans/20-analytics-reset/briefs/12-05.md', shape: 'started', at: start + 5000, cost: 2, flags: {} },
    { repo: 'repo-a', plan: '23', conv: 'conv-shared', brief: 'docs/plans/20-analytics-reset/briefs/23-01.md', shape: 'complete', at: start + 4000, cost: 0.75, flags: {} },
    // Plan-detail scene executions: every shape, priced/unpriced/lower-bound.
    { repo: 'acme/widgets', plan: '20-analytics-reset', conv: 'conv-detail-a', brief: 'docs/plans/20-analytics-reset/briefs/3-01-foundations.md', shape: 'complete', at: start + 1200, cost: 0.5, flags: {} },
    { repo: 'acme/widgets', plan: '20-analytics-reset', conv: 'conv-detail-b', brief: 'docs/plans/20-analytics-reset/briefs/12-01-detail.md', shape: 'complete', at: start + 1100, cost: 4, flags: { session_cost_lower_bound: true } },
    { repo: 'acme/widgets', plan: '20-analytics-reset', conv: 'conv-detail-b', brief: 'docs/plans/20-analytics-reset/briefs/99-01-orphan.md', shape: 'unreported', at: start + 1000, cost: null, flags: { session_cost_null_reason: 'all_unpriced' } },
    { repo: 'acme/widgets', plan: '20-analytics-reset', conv: 'conv-detail-a', brief: 'docs/plans/20-analytics-reset/briefs/12-01-detail.md', shape: 'started', at: start + 900, cost: 2, flags: {} }
  ];
}

export function p12ExecutionRows() {
  return p12ExecutionBase().map((row, index) => ({
    id: { repo_id: row.repo, conversation_id: row.conv, brief_path: row.brief },
    m: {
      ts: row.at,
      session_cost_usd: row.cost,
      'brief_score:preview': 0.6 + index * 0.02,
      'brief_score:clean': 0.7 + index * 0.02,
      'report_score:preview': 0.5 + index * 0.02,
      'report_score:clean': 0.75
    },
    l: {
      shape: row.shape, plan: row.plan, repo_id: row.repo,
      harness: row.repo === 'repo-a' ? 'orca' : 'claude-code',
      session_model: row.repo === 'repo-a' ? 'claude' : 'gpt'
    },
    flags: { ...row.flags }
  }));
}

export function p12ExecutionEntities({ plan = '', repo_id = '', limit = 12, cursor = '' } = {}) {
  let rows = p12ExecutionRows();
  if (plan) rows = rows.filter(row => row.l.plan === plan);
  if (repo_id) rows = rows.filter(row => row.l.repo_id === repo_id);
  rows = rows.slice().sort((a, b) => (b.m.ts - a.m.ts)
    || String(a.id.conversation_id).localeCompare(b.id.conversation_id)
    || String(a.id.brief_path).localeCompare(b.id.brief_path));
  const scopeN = rows.length;
  const { page, next } = p12Page(rows, limit, cursor);
  return {
    grain: 'execution', rows: page, next,
    population: {
      grain: 'execution', unit: 'repo_id,conversation_id,brief_path', scope_n: scopeN,
      cohort_n: scopeN, eligible_n: scopeN, returned_n: page.length, missing_by_reason: {}, relation: null
    }
  };
}

function p12EventBase() {
  const s = P12.start;
  const plan20 = [
    { path: 'docs/plans/20-analytics-reset/DESIGN.md', conv: 'conv-shared', event: 'write', type: 'artifact_version', at: s + 9800 },
    { path: 'docs/plans/20-analytics-reset/DESIGN.md', conv: 'conv-shared', event: 'write', type: 'artifact_version', at: s + 9400 },
    { path: 'docs/plans/20-analytics-reset/briefs/12-01.md', conv: 'conv-shared', event: 'write', type: 'artifact_version', at: s + 8800 },
    { path: 'docs/plans/20-analytics-reset/briefs/12-02.md', conv: 'conv-20b', event: 'write', type: 'artifact_version', at: s + 8200 },
    { path: 'docs/plans/20-analytics-reset/reports/12-01.md', conv: 'conv-20b', event: 'write', type: 'artifact_version', at: s + 7600 },
    { path: 'docs/plans/20-analytics-reset/reports/12-02.md', conv: 'conv-20c', event: 'write', type: 'artifact_version', at: s + 7000 },
    { path: '', conv: 'conv-shared', event: 'commit', type: 'commit', at: s + 9100 },
    { path: 'docs/plans/20-analytics-reset/briefs/12-03.md', conv: 'conv-20c', event: 'write', type: 'artifact_version', at: s + 6400 },
    { path: 'docs/plans/20-analytics-reset/reports/12-03.md', conv: 'conv-20d', event: 'write', type: 'artifact_version', at: s + 5800 }
  ];
  const plan23 = [
    { path: 'docs/plans/20-analytics-reset/briefs/23-01.md', conv: 'conv-shared', event: 'write', type: 'artifact_version', at: s + 4200 },
    { path: 'docs/plans/20-analytics-reset/reports/23-01.md', conv: 'conv-shared', event: 'write', type: 'artifact_version', at: s + 3800 }
  ];
  // Plan-detail scene: mixed artifact_version and non-artifact events for the
  // sessions that wrote an artifact under the plan, including an unpaired brief.
  const detail = [
    { path: 'docs/plans/20-analytics-reset/DESIGN.md', conv: 'conv-detail-a', event: 'write', type: 'artifact_version', at: s + 12000 },
    { path: 'docs/plans/20-analytics-reset/briefs/3-01-foundations.md', conv: 'conv-detail-b', event: 'write', type: 'artifact_version', at: s + 11900 },
    { path: '', conv: 'conv-detail-a', event: 'commit', type: 'commit', at: s + 11800 },
    { path: 'docs/plans/20-analytics-reset/briefs/12-01-detail.md', conv: 'conv-detail-a', event: 'write', type: 'artifact_version', at: s + 11700 },
    { path: 'docs/plans/20-analytics-reset/reports/12-01-detail.md', conv: 'conv-detail-a', event: 'write', type: 'artifact_version', at: s + 11600 },
    { path: 'docs/plans/20-analytics-reset/briefs/99-01-orphan.md', conv: 'conv-detail-b', event: 'write', type: 'artifact_version', at: s + 11500 },
    { path: '', conv: 'conv-detail-b', event: 'run', type: 'hook', at: s + 11400 },
    { path: 'docs/plans/20-analytics-reset/reports/12-01-detail.md', conv: 'conv-detail-b', event: 'write', type: 'artifact_version', at: s + 11300 }
  ];
  return { 'repo-a|20': plan20, 'repo-a|23': plan23, 'acme/widgets|20-analytics-reset': detail };
}

export function p12PlanEvents({ repo_id = '', plan = '', limit = 500, cursor = '' } = {}) {
  const all = p12EventBase()[`${repo_id}|${plan}`] || [];
  const rows = all
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.at - a.row.at) || String(a.row.type).localeCompare(b.row.type) || (a.index - b.index))
    .map(({ row, index }) => ({
      repo_id, plan, path: row.path, conversation_id: row.conv,
      event: row.event, event_type: row.type, ts: row.at, rowid: index
    }));
  const scopeN = rows.length;
  const { page, next } = p12Page(rows, limit, cursor);
  return {
    grain: 'plan', id: { repo_id, plan }, collection: 'events', rows: page, next,
    population: {
      grain: 'plan_events', unit: 'events', scope_n: scopeN, cohort_n: scopeN,
      eligible_n: scopeN, returned_n: page.length, missing_by_reason: {}
    }
  };
}

// ---------------------------------------------------------------------------
// P12 plan-detail scene (unit 12-06). Additive: one fully populated plan with a
// percent-encoded repo id, one plan whose design content is unavailable, one
// plan with no collections at all, and a plan absent from the served list. The
// list itself (P12_PLAN_SPECS) and every P10/P11 body stay byte-identical.
// ---------------------------------------------------------------------------

const P12_DETAIL_PLAN_SPECS = [
  ['acme/widgets', '20-analytics-reset', { complete: 2, unreported: 1, started: 1, cost: 3.5, unpriced: 1, shared: 1, artifacts: 6, versions: 12, sessions: 2, flags: { shared_session: true } }],
  ['repo-a', '20-analytics-reset', { complete: 2, unreported: 1, started: 1, cost: 2.5, unpriced: 1, shared: 1, artifacts: 1, versions: 2, sessions: 1, flags: { shared_session: true } }],
  ['repo-a', '21-empty', { complete: 0, unreported: 0, started: 0, cost: 0, unpriced: 0, shared: 0, artifacts: 1, versions: 1, sessions: 0, flags: { no_executions: true } }],
  ['repo-a', '22-empty', { complete: 0, unreported: 0, started: 0, cost: 0, unpriced: 0, shared: 0, artifacts: 0, versions: 0, sessions: 0, flags: { no_executions: true } }]
];

export function p12DetailPlanRows() {
  return P12_DETAIL_PLAN_SPECS.map(([repo, plan, spec], index) => {
    const total = spec.complete + spec.unreported + spec.started;
    const last = P12.start + (30 - index) * 86400;
    const first = last - (index + 2) * 3600;
    const flags = { ...spec.flags };
    if (total === 0) flags.complete_share_null_reason = 'no_executions';
    if (spec.unpriced > 0 && spec.cost !== null) flags.associated_cost_lower_bound = true;
    return {
      id: { repo_id: repo, plan },
      m: {
        artifacts: spec.artifacts, versions: spec.versions, sessions: spec.sessions,
        shared_sessions: spec.shared, associated_cost_usd: spec.cost, unpriced_calls: spec.unpriced,
        executions_complete: spec.complete, executions_unreported: spec.unreported, executions_started: spec.started,
        complete_share: total ? spec.complete / total : null,
        'design_score:clarity': spec.artifacts ? 0.9 : null,
        'design_score:structure': spec.artifacts ? 0.4 : null,
        span_days: (last - first) / 86400, first_ts: first, last_ts: last
      },
      l: { repo_id: repo, harness: 'orca', session_model: 'claude' },
      flags
    };
  });
}

// The plan row is named by (repo_id, plan); combined with the list population so
// a list plan can still open its detail. An unknown plan returns no rows.
export function p12PlanDetailPage({ repo_id = '', plan = '', limit = 4, cursor = '' } = {}) {
  const all = [...p12PlanRows(), ...p12DetailPlanRows()];
  const rows = all.filter(row => (!repo_id || row.id.repo_id === repo_id) && (!plan || row.id.plan === plan));
  const scopeN = rows.length;
  const { page, next } = p12Page(rows, limit, cursor);
  return {
    grain: 'plan', rows: page, next,
    population: { grain: 'plan', unit: 'plan', scope_n: scopeN, cohort_n: scopeN, eligible_n: scopeN, returned_n: page.length, missing_by_reason: {}, relation: null }
  };
}

function detailArtifactRow({ repo_id, plan, path, kind, versions, ts, content_bytes = 1024, content_unavailable = false, scores = {}, bands = {}, screen = 'pass', harness = 'orca', model = 'claude', writer = 'conv-detail-a', writerCost = 0.5, writerUnpriced = 0, writerLower = false }) {
  const m = { versions, distinct_writing_sessions: 1, first_ts: ts - 3600, last_ts: ts, latest_version_ts: ts, writing_session_cost_usd: writerCost, writing_session_model_calls: 3, writing_session_hook_events: 5 };
  const l = { repo_id, kind, plan, source: 'worktree', writing_session: writer, harness, session_model: model, screen_verdict: screen };
  const flags = { writing_session_unpriced_calls: writerUnpriced, writing_session_cost_lower_bound: writerLower, writing_session_is_captured_provenance: true, latest_version_outside_window: false };
  for (const [check, value] of Object.entries(scores)) {
    m[`score:${check}`] = value.score;
    m[`score_scorer:${check}`] = value.scorer;
    l[`band:${check}`] = bands[check] || null;
  }
  if (content_unavailable) { m.content_bytes = null; flags.content_unavailable = true; }
  else m.content_bytes = content_bytes;
  if (writerUnpriced > 0 && writerLower) flags.writing_session_cost_lower_bound = true;
  return { _ts: ts, id: { repo_id, path }, m, l, flags };
}

const P12_DETAIL_ARTIFACT_SPECS = {
  'acme/widgets|20-analytics-reset': [
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/DESIGN.md', kind: 'design', versions: 4, ts: P12.start + 12000, scores: { clarity: { score: 0.9, scorer: 'jev-1.13.0' }, structure: { score: 0.4, scorer: 'jev-1.13.0' } }, bands: { clarity: 'high', structure: 'low' }, writer: 'conv-detail-a', writerCost: 1.25, writerUnpriced: 2, writerLower: true }),
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/briefs/3-01-foundations.md', kind: 'brief', versions: 2, ts: P12.start + 11900, scores: { clarity: { score: 0.55, scorer: 'jev-1.13.0' } }, bands: { clarity: 'mid' }, writer: 'conv-detail-b' }),
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/briefs/12-01-detail.md', kind: 'brief', versions: 3, ts: P12.start + 11800, scores: { clarity: { score: 0.7, scorer: 'jev-1.13.0' } }, bands: { clarity: 'high' }, writer: 'conv-detail-a' }),
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/briefs/99-01-orphan.md', kind: 'brief', versions: 1, ts: P12.start + 11700, scores: {}, screen: 'unscreened', writer: 'conv-detail-b' }),
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/reports/12-01-detail.md', kind: 'report', versions: 2, ts: P12.start + 11600, content_unavailable: true, scores: { structure: { score: 0.85, scorer: 'jev-1.13.0' } }, bands: { structure: 'high' }, writer: 'conv-detail-a' }),
    detailArtifactRow({ repo_id: 'acme/widgets', plan: '20-analytics-reset', path: 'docs/plans/20-analytics-reset/reports/12-02-detail.md', kind: 'report', versions: 1, ts: P12.start + 11500, scores: {}, writer: 'conv-detail-b' })
  ],
  'repo-a|21-empty': [
    detailArtifactRow({ repo_id: 'repo-a', plan: '21-empty', path: 'docs/plans/21-empty/DESIGN.md', kind: 'design', versions: 1, ts: P12.start + 20000, scores: {}, screen: 'unscreened', writer: 'conv-empty' })
  ]
};

export function p12PlanArtifactEntities({ repo_id = '', plan = '', limit = 4, cursor = '' } = {}) {
  const all = (P12_DETAIL_ARTIFACT_SPECS[`${repo_id}|${plan}`] || []).slice().sort((a, b) => b._ts - a._ts);
  const { page, next } = p12Page(all, limit, cursor);
  return {
    grain: 'artifact', rows: page.map(({ _ts, ...row }) => row), next,
    population: { grain: 'artifact', unit: 'artifact', scope_n: all.length, cohort_n: all.length, eligible_n: all.length, returned_n: page.length, missing_by_reason: {}, relation: null }
  };
}

const P12_DETAIL_SESSIONS = {
  'acme/widgets|20-analytics-reset': [
    { conversation_id: 'conv-detail-a', ts: P12.start + 12000 },
    { conversation_id: 'conv-detail-b', ts: P12.start + 11900 }
  ]
};

export function p12PlanSessions({ repo_id = '', plan = '', limit = 4, cursor = '' } = {}) {
  const all = (P12_DETAIL_SESSIONS[`${repo_id}|${plan}`] || []).slice()
    .sort((a, b) => String(a.conversation_id).localeCompare(String(b.conversation_id)))
    .map(row => ({ repo_id, plan, path: '', conversation_id: row.conversation_id, event: '', event_type: '', ts: row.ts }));
  const { page, next } = p12Page(all, limit, cursor);
  return {
    grain: 'plan', id: { repo_id, plan }, collection: 'sessions', rows: page, next,
    population: { grain: 'plan_sessions', unit: 'sessions', scope_n: all.length, cohort_n: all.length, eligible_n: all.length, returned_n: page.length, missing_by_reason: {} }
  };
}

// Only conv-detail-a resolves; conv-detail-b stays listed as unavailable.
const P12_DETAIL_SESSION_ROWS = {
  'conv-detail-a': { id: { conversation_id: 'conv-detail-a' }, m: { cost_usd: 2.5, unpriced_calls: 1 }, l: { session_repo: 'acme/widgets', harness: 'orca', session_model: 'claude' }, flags: { cost_lower_bound: true } }
};

export function p12SessionEntities({ ids = [], limit = 4 } = {}) {
  const rows = ids.map(id => P12_DETAIL_SESSION_ROWS[id]).filter(Boolean).slice(0, Math.max(1, Number(limit) || 4));
  return {
    grain: 'session', rows,
    population: { grain: 'session', unit: 'session', scope_n: ids.length, cohort_n: ids.length, eligible_n: ids.length, returned_n: rows.length, missing_by_reason: {}, relation: null }
  };
}

// ---------------------------------------------------------------------------
// P12 artifact reader scene (unit 12-03). Additive to the workflow scene: one
// design artifact with two known bodies and four unavailable/oversized states,
// one long multi-chunk brief, one oversized report and one integrity failure.
// ---------------------------------------------------------------------------

const P12_HASH = {
  designV6: 'a6'.repeat(32),
  designV5: 'a5'.repeat(32),
  designV4: 'a4'.repeat(32),
  designV3: 'a3'.repeat(32),
  designV2: 'a2'.repeat(32),
  designV1: 'a1'.repeat(32),
  briefLong: 'b3'.repeat(32),
  oversize: 'c4'.repeat(32),
  integrity: 'c5'.repeat(32),
  diffA: 'd1'.repeat(32), diffB: 'd2'.repeat(32), other: 'd3'.repeat(32), diffLarge: 'd4'.repeat(32),
  detailDesign: 'e6'.repeat(32)
};

function p12Iso(offset) {
  return new Date((P12.start + offset) * 1000).toISOString();
}

const P12_DESIGN_A = [
  '# Design A',
  '',
  'Intro with <script>alert(1)</script> and <img src=x onerror=alert(1)> plus a [markdown link](https://example.com).',
  '',
  '## Phase 12',
  '',
  'Body A complete. This is the latest known body.',
  '',
  '### Phase 3 — Foundations',
  '',
  '- Outcome: Reader text renders as text nodes; the word complete is prose only.',
  '',
  '### Phase 7 — Unwritten',
  '',
  '- Outcome: This phase reads complete in prose but has no brief path.',
  '',
  'Text mentioning ### Phase 5 inside body prose is not a heading.',
  '',
  '```',
  '### Phase 99 — Fenced decoy',
  '- Outcome: this decoy must never appear',
  '```',
  '',
  '### Phase 12 — Detail',
  '',
  '- Outcome: Plan detail parses stored phases for display only.'
].join('\n');

const P12_DESIGN_B = [
  '# Design B',
  '',
  '## Notes',
  '',
  'Second known body, distinct from body A.'
].join('\n');

function p12LongBriefBody() {
  const lines = [
    '# Long brief',
    '',
    'Deterministic body with a fenced heading that must not enter the outline.',
    '',
    '```',
    '# fenced not a heading',
    '```',
    '',
    '## First section'
  ];
  for (let index = lines.length + 1; index <= 450; index += 1) lines.push(`line ${index}`);
  lines.push('## Second section');
  for (let index = 452; index <= 900; index += 1) lines.push(`line ${index}`);
  return lines.join('\n');
}

const P12_LONG_BRIEF = p12LongBriefBody();
const P12_DIFF_BEFORE = 'context line\nchanged old\nremoved line\n';
const P12_DIFF_AFTER = 'context line\nchanged new\nadded line';

function p12VersionSpec(repo, path, spec) {
  return {
    repo_id: repo,
    path,
    hash: spec.hash,
    ts: P12.start + spec.ts,
    received_at: p12Iso(spec.received),
    writing_session: spec.session,
    harness: spec.harness,
    session_model: spec.model,
    source: spec.source,
    sha: spec.sha,
    screen: spec.screen || null,
    scores: spec.scores || {},
    also_seen_sessions: spec.alsoSeen || 0
  };
}

const P12_ARTIFACT_SPECS = [
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/DESIGN.md',
    versions: [
      {
        hash: P12_HASH.designV6, received: 60000, ts: 59000, session: 'conv-20b', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-design-v6', screen: { verdict: 'unscreened', scorer: 'jev-1.13.0', at: p12Iso(60500) },
        scores: { clarity: { score: 0.9, scorer: 'jev-1.13.0' }, structure: { score: 0.4, scorer: 'jev-1.13.0' } }
      },
      {
        hash: P12_HASH.designV5, received: 50000, ts: 49000, session: 'conv-20c', harness: 'claude-code', model: 'gpt',
        source: 'commit', sha: 'sha-design-v5', screen: { verdict: 'pass', scorer: 'jev-1.13.0', at: p12Iso(50500) },
        scores: { clarity: { score: 0.2, scorer: 'jev-1.13.0' }, structure: { score: 0.85, scorer: 'jev-1.13.0' } }
      },
      {
        hash: P12_HASH.designV4, received: 40000, ts: 39000, session: 'conv-20d', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-design-v4', screen: { verdict: 'reject', scorer: 'jev-1.13.0', at: p12Iso(40500) },
        scores: { structure: { score: 0.6, scorer: 'jev-missing' } }
      },
      {
        hash: P12_HASH.designV3, received: 30000, ts: 29000, session: 'conv-20e', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-design-v3', screen: null, scores: {}
      },
      {
        hash: P12_HASH.designV2, received: 20000, ts: 19000, session: 'conv-20b', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-design-v2', screen: null, scores: {}
      },
      {
        hash: P12_HASH.designV1, received: 10000, ts: 9000, session: 'conv-20b', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-design-v1', screen: null, scores: {}
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/briefs/12-03.md',
    versions: [
      {
        hash: P12_HASH.briefLong, received: 70000, ts: 69000, session: 'conv-20c', harness: 'claude-code', model: 'gpt',
        source: 'worktree', sha: 'sha-brief-1203', screen: { verdict: 'pass', scorer: 'jev-1.13.0', at: p12Iso(70500) },
        scores: { clarity: { score: 0.55, scorer: 'jev-1.13.0' }, structure: { score: 0.6, scorer: 'jev-1.13.0' } }
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/reports/12-03.md',
    versions: [
      {
        hash: P12_HASH.designV4, received: 80000, ts: 79000, session: 'conv-20d', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-removed', screen: { verdict: 'reject', scorer: 'jev-1.13.0' }, scores: {}
      },
      {
        hash: P12_HASH.designV3, received: 70000, ts: 69000, session: 'conv-20d', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-pending', screen: null, scores: {}
      },
      {
        hash: P12_HASH.designV2, received: 60000, ts: 59000, session: 'conv-20d', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-notstored', screen: null, scores: {}
      },
      {
        hash: P12_HASH.designV1, received: 50000, ts: 49000, session: 'conv-20d', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-notfound', screen: null, scores: {}
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/reports/12-04.md',
    versions: [
      {
        hash: P12_HASH.oversize, received: 81000, ts: 80000, session: 'conv-20e', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-oversize', screen: null, scores: {}
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/reports/12-05.md',
    versions: [
      {
        hash: P12_HASH.integrity, received: 82000, ts: 81000, session: 'conv-20e', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-report-integrity', screen: null, scores: {}
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/briefs/diff-fixture.md',
    versions: [
      { hash: P12_HASH.diffB, received: 90000, ts: 89000, session: 'conv-20b', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-diff-b', scores: {} },
      { hash: P12_HASH.diffA, received: 88000, ts: 87000, session: 'conv-20c', harness: 'claude-code', model: 'gpt', source: 'commit', sha: 'sha-diff-a', scores: {} },
      { hash: P12_HASH.diffLarge, received: 86000, ts: 85000, session: 'conv-20d', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-diff-large', scores: {} },
      { hash: P12_HASH.designV2, received: 84000, ts: 83000, session: 'conv-20e', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-diff-missing', scores: {} }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/20-analytics-reset/IMPLEMENTATION.md',
    versions: [
      { hash: P12_HASH.other, received: 83000, ts: 82000, session: 'conv-20e', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-other', scores: {} }
    ]
  },
  {
    repo_id: 'repo-a', path: 'docs/a.md',
    versions: [{ hash: 'hash-a', received: 50000, ts: 49000, session: 'conv-000', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-p10-quality', scores: { clarity: { score: 0.82, scorer: 'jev-1.13.0' }, structure: { score: 0.7, scorer: 'jev-1.13.0' } } }]
  },
  { repo_id: 'repo-b', path: 'docs/b.md', versions: [{ hash: 'hash-b', received: 50000, ts: 49000, session: 'conv-001', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-p10-quality-b', scores: { clarity: { score: 0.6, scorer: 'jev-1.13.0' } } }] },
  { repo_id: 'repo-a', path: 'docs/c.md', versions: [{ hash: 'hash-c', received: 50000, ts: 49000, session: 'conv-002', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-p10-quality-c', scores: { clarity: { score: 0.3, scorer: 'jev-1.13.0' } } }] },
  {
    repo_id: 'acme/widgets',
    path: 'docs/plans/20-analytics-reset/DESIGN.md',
    versions: [
      {
        hash: P12_HASH.detailDesign, received: 120000, ts: 119000, session: 'conv-detail-a', harness: 'orca', model: 'claude',
        source: 'worktree', sha: 'sha-detail-design', screen: { verdict: 'pass', scorer: 'jev-1.13.0', at: p12Iso(120500) },
        scores: { clarity: { score: 0.9, scorer: 'jev-1.13.0' }, structure: { score: 0.4, scorer: 'jev-1.13.0' } }
      }
    ]
  },
  {
    repo_id: 'repo-a',
    path: 'docs/plans/21-empty/DESIGN.md',
    versions: [
      { hash: P12_HASH.designV2, received: 21000, ts: 20000, session: 'conv-empty', harness: 'orca', model: 'claude', source: 'worktree', sha: 'sha-empty-design', scores: {} }
    ]
  }
].map(spec => ({ ...spec, versions: spec.versions.map(version => p12VersionSpec(spec.repo_id, spec.path, version)) }));

const P12_CONTENT = new Map([
  ['hash-a', { repo_id: 'repo-a', paths: ['docs/a.md', 'docs/plans/20-analytics-reset/DESIGN.md'], text: '# Quality fixture\n\nP10 artifact destination resolves.', verdict: 'pass' }],
  ['hash-b', { repo_id: 'repo-b', path: 'docs/b.md', text: '# Quality fixture B', verdict: 'pass' }],
  ['hash-c', { repo_id: 'repo-a', path: 'docs/c.md', text: '# Quality fixture C', verdict: 'pass' }],
  [P12_HASH.designV6, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/DESIGN.md', text: P12_DESIGN_A, verdict: 'unscreened' }],
  [P12_HASH.designV5, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/DESIGN.md', text: P12_DESIGN_B, verdict: 'pass' }],
  [P12_HASH.briefLong, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/briefs/12-03.md', text: P12_LONG_BRIEF, verdict: 'pass' }],
  [P12_HASH.diffA, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/briefs/diff-fixture.md', text: P12_DIFF_BEFORE, verdict: 'pass' }],
  [P12_HASH.diffB, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/briefs/diff-fixture.md', text: P12_DIFF_AFTER, verdict: 'pass' }],
  [P12_HASH.diffLarge, { repo_id: 'repo-a', path: 'docs/plans/20-analytics-reset/briefs/diff-fixture.md', text: Array.from({ length: 2001 }, (_, index) => `large fixture line ${index + 1}`).join('\n'), verdict: 'pass' }],
  [P12_HASH.detailDesign, { repo_id: 'acme/widgets', path: 'docs/plans/20-analytics-reset/DESIGN.md', text: P12_DESIGN_A, verdict: 'pass' }]
]);

function p12ArtifactSpec(repo_id, path) {
  return P12_ARTIFACT_SPECS.find(spec => spec.repo_id === repo_id && spec.path === path) || null;
}

export function p12ArtifactRows(repo_id = '', path = '') {
  const spec = p12ArtifactSpec(repo_id, path);
  if (!spec) return [];
  return spec.versions.slice().sort((a, b) => (b.received_at.localeCompare(a.received_at)) || a.hash.localeCompare(b.hash));
}

function p12ArtifactRow(version) {
  return {
    content_hash: version.hash,
    ts: version.ts,
    received_at: version.received_at,
    writing_session: version.writing_session,
    writing_session_label: 'earliest observed writing session for this version',
    writing_session_is_captured_provenance: true,
    also_seen_sessions: version.also_seen_sessions,
    harness: version.harness,
    session_model: version.session_model,
    source: version.source,
    sha: version.sha,
    screen: version.screen,
    scores: version.scores
  };
}

export function p12ArtifactEntities({ repo_id = '', path = '', limit = 4, cursor = '' } = {}) {
  if (!p12ArtifactSpec(repo_id, path)) return null;
  const all = p12ArtifactRows(repo_id, path);
  const { page, next } = p12Page(all, limit, cursor);
  const latest = all[0] || null;
  return {
    grain: 'artifact',
    id: { repo_id, path },
    versions: all.length,
    latest: latest ? {
      content_hash: latest.hash,
      received_at: latest.received_at,
      writing_session: latest.writing_session,
      writing_session_label: 'earliest observed writing session for this version',
      writing_session_is_captured_provenance: true
    } : null,
    collection: 'versions',
    rows: page.map(p12ArtifactRow),
    next,
    population: {
      grain: 'artifact_version', unit: 'repo_id,path,content_hash', scope_n: all.length,
      cohort_n: all.length, eligible_n: all.length, returned_n: page.length, missing_by_reason: {}
    }
  };
}

// Exact content-route states: 200 bytes with the contract headers, or the
// server's JSON bodies and codes. No failure path carries a prefix.
export function p12Content(repo_id = '', path = '', hash = '') {
  const known = P12_ARTIFACT_SPECS.some(spec => spec.repo_id === repo_id && spec.path === path
    && spec.versions.some(version => version.hash === hash));
  if (!known) return { status: 404, body: { error: 'not found' } };
  if (hash === P12_HASH.designV1) return { status: 404, body: { error: 'not found' } };
  if (hash === P12_HASH.designV2) return { status: 404, body: { error: 'artifact content is unavailable', code: 'content_unavailable', reason: 'not_stored' } };
  if (hash === P12_HASH.designV3) return { status: 404, body: { error: 'artifact content is unavailable', code: 'content_unavailable', reason: 'pending' } };
  if (hash === P12_HASH.designV4) return { status: 404, body: { error: 'artifact content is unavailable', code: 'content_unavailable', reason: 'removed_by_screen' } };
  if (hash === P12_HASH.oversize) return { status: 413, body: { error: 'content exceeds the advertised byte budget', code: 'content_too_large', size_bytes: 20000000, limit_bytes: 16777216 } };
  if (hash === P12_HASH.integrity) return { status: 500, body: { error: 'stored content hash does not match its identity', code: 'content_integrity' } };
  const content = P12_CONTENT.get(hash);
  if (!content || content.repo_id !== repo_id || !(content.paths || [content.path]).includes(path)) return { status: 404, body: { error: 'not found' } };
  return {
    status: 200,
    text: content.text,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'X-Yakka-Screen-Verdict': content.verdict
    }
  };
}

const P12_CONTENT_BASELINES = {
  design: {
    'jev-1.13.0': {
      clarity: { n: 12, p25: 0.4, median: 0.6, p75: 0.8 },
      structure: { n: 12, p25: 0.5, median: 0.6, p75: 0.7 }
    },
    'jev-missing': {}
  },
  brief: {
    'jev-1.13.0': {
      clarity: { n: 8, p25: 0.3, median: 0.5, p75: 0.7 },
      structure: { n: 8, p25: 0.35, median: 0.55, p75: 0.65 }
    }
  }
};

export function p12Baselines({ kind = 'design', check = '', scorer = '' } = {}) {
  const base = P12_CONTENT_BASELINES[kind] || {};
  const scorers = {};
  for (const [name, checks] of Object.entries(base)) {
    if (scorer && scorer !== name) continue;
    const picked = {};
    for (const [checkName, row] of Object.entries(checks)) {
      if (check && check !== checkName) continue;
      picked[checkName] = row;
    }
    if (Object.keys(picked).length) scorers[name] = picked;
  }
  if (check && scorer) {
    if (!scorers[scorer]) scorers[scorer] = {};
    if (!scorers[scorer][check]) scorers[scorer][check] = { n: 0, p25: null, median: null, p75: null };
  }
  return { kind, population: 'content', scorers };
}

export function p12Fixture() {
  return {
    schema: p12Schema(),
    planRows: p12PlanRows,
    planEntities: p12PlanEntities,
    planScatter: p12PlanScatter,
    planAggregate: p12PlanAggregate,
    executionRows: p12ExecutionRows,
    executionEntities: p12ExecutionEntities,
    planEvents: p12PlanEvents,
    detailPlanRows: p12DetailPlanRows,
    planDetailPage: p12PlanDetailPage,
    planArtifactEntities: p12PlanArtifactEntities,
    planSessions: p12PlanSessions,
    sessionEntities: p12SessionEntities,
    artifactRows: p12ArtifactRows,
    artifactEntities: p12ArtifactEntities,
    content: p12Content,
    baselines: p12Baselines
  };
}
