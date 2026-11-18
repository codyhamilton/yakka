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
      session: grain(['cost_usd', 'model_calls', 'commits', 'unpriced_calls', 'hook_events'], ['harness', 'session_model', 'session_repo', 'id']),
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
