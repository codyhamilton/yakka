// Extra scene rows for the Phase 10 acceptance proof only. Everything here is
// additive: the committed unit fixtures and the P10 stub bodies keep their
// default values, and this module is imported by the acceptance spec alone.
//
// The extra shapes are exactly the ones the phase outcome names: a long-history
// bucket grid, an all-unpriced and a partially priced group, a colon-sensitive
// check, and two cohorts of the same grain plus one of a different grain.

import { cohortDefinition, encodeCohort } from '../../web/js/core/selection-model.js';

const DAY = 86400e3;

export function population(grain, unit, n, extra = {}) {
  return { grain, unit, scope_n: n, cohort_n: n, eligible_n: n, returned_n: n, missing_by_reason: {}, relation: null, ...extra };
}

// ---------------------------------------------------------------------------
// Long history: the server answers `bucket=auto` with year buckets and marks
// the response coarsened, so the proof can read the effective bucket from the
// body rather than from a client guess.
// ---------------------------------------------------------------------------

export const LONG_HISTORY_YEARS = Array.from({ length: 11 }, (_, index) => `${2016 + index}-01-01T00:00:00Z`);

export function longHistoryBody({ measure = 'cost_usd', dims = ['model'] } = {}) {
  const groups = dims.length ? ['claude', 'gpt'] : [''];
  const rows = [];
  for (const [groupIndex, group] of groups.entries()) {
    for (const [index, t] of LONG_HISTORY_YEARS.entries()) {
      rows.push({ t, k: group ? [group] : [], v: Number((1.5 + groupIndex * 0.75 + index * 0.1).toFixed(4)) });
    }
  }
  return {
    measure, bucket: 'year', requested_bucket: 'auto', coarsened: true,
    dims, rows, population: population('time', 'bucket', rows.length)
  };
}

// ---------------------------------------------------------------------------
// Cost honesty: three summary shapes so a priced zero is never confused with
// all-unpriced, and a partially priced group keeps its lower bound.
// ---------------------------------------------------------------------------

export const PARTIAL_SUMMARY = { model_calls: 64, unpriced_calls: 3, cost_usd: 4.25 };
export const ALL_UNPRICED_SUMMARY = { model_calls: 5, unpriced_calls: 5, cost_usd: 0 };
export const PRICED_ZERO_SUMMARY = { model_calls: 5, unpriced_calls: 0, cost_usd: 0 };

// A mix scene that carries every special group the contract keeps apart.
export const SPECIAL_MIX_ROWS = [
  { k: ['shell', 'unknown'], v: 4 },
  { k: ['shell', '(mixed)'], v: 2 },
  { k: ['read', '(none)'], v: 3 },
  { k: ['read', '(multi)'], v: 1 }
];

// ---------------------------------------------------------------------------
// Quality: a check whose name contains a colon, so the band lens is
// `band:design:clarity` and the exclude grammar must resolve it longest-first.
// ---------------------------------------------------------------------------

export const COLON_CHECK = 'design:clarity';
export const SECOND_CHECK = 'structure';

export const QUALITY_CATALOGUE = {
  kind: 'design',
  checks: [{ name: COLON_CHECK }, { name: SECOND_CHECK }]
};

export function qualityScores(check = COLON_CHECK) {
  const scale = check === SECOND_CHECK ? 0.8 : 1;
  return {
    kind: 'design',
    checks: [{
      name: check, n: 12, min: 0.2, p25: 0.5, median: 0.7 * scale, p75: 0.85, max: 1, scorer: 'jev-1',
      groups: [
        { key: 'harness:orca', n: 7, min: 0.3, p25: 0.5, median: 0.72 * scale, p75: 0.86, max: 1 },
        { key: 'harness:claude-code', n: 5, min: 0.2, p25: 0.45, median: 0.66 * scale, p75: 0.8, max: 0.94 }
      ],
      omitted_groups: 1, omitted_n: 2
    }],
    population: population('content', 'content_hash', 14)
  };
}

export function qualitySeries(check = COLON_CHECK) {
  return {
    kind: 'design', bucket: 'day',
    checks: [{
      name: check,
      points: [
        { t: '2026-09-01T00:00:00Z', n: 4, p25: 0.4, median: 0.6, p75: 0.8, groups: [
          { key: 'session_model:claude', n: 3, p25: 0.4, median: 0.6, p75: 0.8 },
          { key: 'session_model:(mixed)', n: 1, p25: 0.3, median: 0.5, p75: 0.7 }
        ] },
        { t: '2026-09-02T00:00:00Z', n: 5, p25: 0.45, median: 0.65, p75: 0.85, groups: [
          { key: 'session_model:claude', n: 4, p25: 0.45, median: 0.65, p75: 0.85 }
        ] }
      ]
    }],
    population: population('content', 'content_hash', 9)
  };
}

export const QUALITY_BASELINES = {
  kind: 'design',
  population: 'content',
  scorers: {
    'jev-1': {
      [COLON_CHECK]: { n: 40, p25: 0.45, median: 0.65, p75: 0.85 },
      [SECOND_CHECK]: { n: 22, p25: 0.3, median: 0.55, p75: 0.75 }
    },
    'jev-0': {
      [COLON_CHECK]: { n: 0, p25: null, median: null, p75: null },
      [SECOND_CHECK]: { n: 0, p25: null, median: null, p75: null }
    }
  }
};

export const QUALITY_ARTIFACTS = {
  rows: [
    { id: 'h1', m: { 'score:design:clarity': 0.2, 'score:structure': 0.4 }, l: { path: 'docs/a.md', repo_id: 'repo-a', kind: 'design', scorer: 'jev-1', content_hash: 'h1' } },
    { id: 'h2', m: { 'score:design:clarity': 0.9, 'score:structure': 0.7 }, l: { path: 'docs/b.md', repo_id: 'repo-b', kind: 'design', scorer: 'jev-1', content_hash: 'h2' } },
    { id: 'h3', m: { 'score:design:clarity': null, 'score:structure': null }, l: { path: 'docs/c.md', repo_id: 'repo-a', kind: 'brief', scorer: 'jev-1', content_hash: 'h3' } }
  ],
  population: population('artifact', 'file', 3, { missing_by_reason: { unscored: 1 } })
};

export const QUALITY_BANDS = {
  rows: [
    { k: ['low', 'design'], v: 2 }, { k: ['mid', 'design'], v: 3 }, { k: ['high', 'design'], v: 1 },
    { k: ['unscored', 'design'], v: 1 }, { k: ['baseline_unavailable', 'design'], v: 1 }
  ],
  omitted_groups: 1, omitted_n: 1,
  population: population('artifact', 'file', 8)
};

// ---------------------------------------------------------------------------
// Cohorts: A and B share the session grain; C is an artifact cohort.
// ---------------------------------------------------------------------------

const FINITE = { from: '2026-09-01T00:00:00Z', to: '2026-09-15T00:00:00Z' };

function cohort(grain, value, op = 'include') {
  return encodeCohort(cohortDefinition({
    grain,
    scope: FINITE,
    predicate: { in: { lens: grain === 'session' ? 'harness' : 'kind', values: [value] } },
    op
  }));
}

export const COHORT_A = cohort('session', 'orca');
export const COHORT_B = cohort('session', 'claude-code', 'exclude');
export const COHORT_ARTIFACT = cohort('artifact', 'design');

export { DAY };
