// Deterministic test-only data for the Phase 8 bars gallery. Product code must
// never import this module. No clocks, no randomness: every value is listed.

export const MEASURES = [
  { key: 'sessions', label: 'Sessions', unit: 'sessions', kind: 'count' },
  { key: 'calls', label: 'Calls', unit: 'calls', kind: 'count' },
  { key: 'cost', label: 'Cost', unit: 'USD', kind: 'money' }
];

export const SLOPE_SERIES = [
  { key: 'before', label: 'Before', unit: 'sessions', kind: 'count' },
  { key: 'after', label: 'After', unit: 'sessions', kind: 'count' }
];

export const FIXED_NEUTRAL_KEYS = ['(mixed)', '(none)', '(multi)', 'unknown', 'unscored', '(other)'];
export const REQUIRED_KEYS = ['model:atlas', 'harness:orca', 'repo:core', 'kind:test'];

const RANKED = [
  ['model:atlas', 120],
  ['harness:orca', 96],
  ['repo:core', 84],
  ['kind:test', 72],
  ['model:beacon', 60],
  ['harness:pine', 48],
  ['repo:docs', 36],
  ['(mixed)', 30],
  ['(none)', 24],
  ['(multi)', 18],
  ['unknown', 12],
  ['unscored', 6]
];

const STACKED = [
  ['model:atlas', 40, 80, 12.5],
  ['harness:orca', 30, 60, 9],
  ['repo:core', 25, 50, 7.5],
  ['kind:test', 20, 40, 6],
  ['model:beacon', 15, 30, 4.5],
  ['(mixed)', 12, 24, 3.6],
  ['(none)', 10, 20, 3],
  ['(multi)', 9, 18, 2.7],
  ['unknown', 8, 16, 2.4],
  ['unscored', 6, 12, 1.8],
  ['(other)', 5, 10, 1.5]
];

const SLOPE = [
  ['model:atlas', 80, 120],
  ['harness:orca', 70, 95],
  ['repo:core', 60, 50],
  ['kind:test', 50, 70],
  ['model:beacon', 40, 30],
  ['(mixed)', 30, 35],
  ['(none)', 20, 18],
  ['(multi)', 10, 14]
];

export function rankedRows() {
  return RANKED.map(([key, value]) => ({ key, values: { sessions: value }, n: value }));
}

export function stackedRows() {
  return STACKED.map(([key, sessions, calls, cost]) => ({ key, values: { sessions, calls, cost }, n: sessions }));
}

export function percentRows() {
  return stackedRows();
}

export function lollipopRows() {
  return rankedRows();
}

export function slopeRows() {
  return SLOPE.map(([key, before, after]) => ({ key, values: { before, after }, n: before }));
}

export function rankedTop() {
  return 5;
}

export function rankedOtherTotal() {
  return RANKED.slice(rankedTop()).reduce((sum, [, value]) => sum + value, 0);
}
