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

export function p11Entities(grain = 'session') {
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

export function p11Fixture() {
  return {
    schema: p11Schema(),
    scatter: p11Scatter,
    entities: p11Entities,
    aggregate: p11Aggregate,
    sessionRows: p11SessionRows,
    sessionId: p11SessionId
  };
}
