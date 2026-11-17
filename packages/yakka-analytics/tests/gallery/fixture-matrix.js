// Deterministic test-only data for the Phase 8 matrix gallery. Product code
// must never import this module. No clocks, no randomness: every value is
// listed, and the shared entity keys drive the heatmap rows and calendar cells.

export const DAY = 24 * 60 * 60 * 1000;
export const CAL_START = Date.UTC(2021, 0, 4);
export const SHARED_ENTITY_KEYS = ['model:atlas', 'harness:orca', 'repo:core', 'kind:test'];
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const MEASURE = { key: 'sessions', label: 'Sessions', unit: 'sessions', kind: 'count' };

export const HEAT_ROWS = [
  { key: 'model:atlas', label: 'Atlas' },
  { key: 'harness:orca', label: 'Orca' },
  { key: 'repo:core', label: 'Core' },
  { key: 'kind:test', label: 'Tests' }
];

export const HEAT_COLUMNS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' }
];

const HEAT_VALUES = [
  [12, 18, 9, 22, 15],
  [8, 14, 20, 10, 16],
  [5, 11, 7, 13, 9],
  [3, 6, 4, 8, 2]
];

export const CAL_VALUES = [
  4, 8, 6, 10, 7, 2, 1,
  5, 9, 12, 7, 11, 3, 2,
  6, 10, 8, 14, 9, 4, 3
];

export function heatmapRows() {
  const rows = [];
  for (const [rowIndex, row] of HEAT_ROWS.entries()) {
    for (const [columnIndex, column] of HEAT_COLUMNS.entries()) {
      const value = HEAT_VALUES[rowIndex][columnIndex];
      rows.push({
        key: row.key,
        row: row.key,
        column: column.key,
        values: { sessions: value },
        n: value
      });
    }
  }
  return rows;
}

export function calendarRows() {
  return CAL_VALUES.map((value, index) => ({
    key: SHARED_ENTITY_KEYS[index % SHARED_ENTITY_KEYS.length],
    row: `w${Math.floor(index / 7)}`,
    column: WEEKDAY_KEYS[index % 7],
    x: CAL_START + index * DAY,
    values: { sessions: value },
    n: value
  }));
}

export function heatmapSpec(overrides = {}) {
  return {
    chart: 'matrix',
    type: 'heatmap',
    title: 'Sessions by entity and weekday',
    units: 'sessions',
    ramp: 'sequential',
    rows: HEAT_ROWS.map(item => ({ ...item })),
    columns: HEAT_COLUMNS.map(item => ({ ...item })),
    x: { label: 'Weekday', kind: 'text' },
    series: [{ ...MEASURE }],
    timeBasis: { note: 'fixture; categorical' },
    ...overrides
  };
}

export function calendarSpec(overrides = {}) {
  return {
    chart: 'matrix',
    type: 'calendar',
    title: 'Sessions by day',
    units: 'sessions',
    ramp: 'sequential',
    columns: WEEKDAY_KEYS.map(key => ({ key, label: key })).slice(0, 7),
    x: { label: 'Day', kind: 'time' },
    series: [{ ...MEASURE }],
    timeBasis: { clock: 'fixture; UTC calendar days' },
    ...overrides
  };
}
