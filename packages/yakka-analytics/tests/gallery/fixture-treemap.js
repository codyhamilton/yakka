// Deterministic test-only data for the Phase 8 treemap gallery. Product code
// must never import this module. No clocks, no randomness: every value is
// listed. The measure is composed over two lenses (repo then model); parents
// are repo lens values, children are model lens values, and repo:ops/repo:tools
// are undeclared so the tail becomes one labelled `(other)` cell.

export const MEASURE = { key: 'sessions', label: 'Sessions', unit: 'sessions', kind: 'count' };

export const PARENTS = [
  { key: 'repo:core', label: 'Core' },
  { key: 'repo:docs', label: 'Docs' },
  { key: '(mixed)', label: 'mixed' },
  { key: '(none)', label: 'none' },
  { key: '(multi)', label: 'multi' },
  { key: 'unknown', label: 'unknown' },
  { key: 'unscored', label: 'unscored' }
];

export const FIXED_NEUTRAL_KEYS = ['(mixed)', '(none)', '(multi)', 'unknown', 'unscored', '(other)'];

export const REQUIRED_KEYS = ['model:atlas', 'model:beacon', 'repo:core', 'repo:docs'];

const ROWS = [
  ['model:atlas', 'repo:core', 'Atlas', 120],
  ['model:beacon', 'repo:core', 'Beacon', 80],
  ['model:cedar', 'repo:core', 'Cedar', 40],
  ['model:atlas', 'repo:docs', 'Atlas', 60],
  ['model:beacon', 'repo:docs', 'Beacon', 30],
  ['(mixed)', '(mixed)', 'mixed', 24],
  ['(none)', '(none)', 'none', 18],
  ['(multi)', '(multi)', 'multi', 12],
  ['unknown', 'unknown', 'unknown', 9],
  ['unscored', 'unscored', 'unscored', 6],
  ['model:cedar', 'repo:ops', 'Cedar', 15],
  ['model:delta', 'repo:tools', 'Delta', 10]
];

export const TAIL_KEYS = ['repo:ops', 'repo:tools'];

export function treemapRows() {
  return ROWS.map(([key, parent, label, value]) => ({
    key,
    parent,
    label,
    value,
    values: { sessions: value },
    n: value
  }));
}

export function parentTotal(key) {
  return ROWS
    .filter(([, parent]) => parent === key)
    .reduce((total, [, , , value]) => total + value, 0);
}

export function tailTotal() {
  return ROWS
    .filter(([, parent]) => TAIL_KEYS.includes(parent))
    .reduce((total, [, , , value]) => total + value, 0);
}

export function treemapSpec(overrides = {}) {
  return {
    chart: 'treemap',
    type: 'treemap',
    title: 'Sessions by repo then model',
    units: 'sessions',
    timeBasis: { note: 'fixture; categorical' },
    x: { label: 'Parent', kind: 'text' },
    series: [{ ...MEASURE }],
    parents: PARENTS.map(parent => ({ ...parent })),
    ...overrides
  };
}
