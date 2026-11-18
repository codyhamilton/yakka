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

export function adminStatus() {
  return { version: 'fixture', scoring: { scorer: true, checks: true, rescorable: true }, tenants: [{ id: 'fixture-tenant', name: 'Fixture' }] };
}
