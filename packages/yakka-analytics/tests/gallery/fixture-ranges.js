// Deterministic test-only data for the Phase 8 ranges gallery. Product code
// must never import this module. No clocks, no randomness: every value is listed.

export const REQUIRED_KEYS = ['model:atlas', 'harness:orca', 'repo:core', 'kind:test'];

export const BOX_ROWS = [
  { key: 'model:atlas', values: { min: 1.5, q1: 4, median: 7.25, q3: 11.5, max: 24, p95: 21.4 }, n: 120, unpriced: 3 },
  { key: 'harness:orca', values: { min: 0.75, q1: 3, median: 5.5, q3: 9, max: 18, p95: 15.2 }, n: 96, unpriced: 0 },
  { key: 'repo:core', values: { min: 0.5, q1: 2.5, median: 4.75, q3: 8, max: 14, p95: 12.6 }, n: 84, unpriced: 1 },
  { key: 'kind:test', values: { min: 0.25, q1: 1.5, median: 3.25, q3: 6, max: 11, p95: 9.4 }, n: 72 }
];

export const BASELINE = { from: 4, to: 8, label: 'all-time median band' };

export const BINS = [
  { from: 0, to: 10 },
  { from: 10, to: 20 },
  { from: 20, to: 30 },
  { from: 30, to: 40 },
  { from: 40, to: 50 }
];

const HISTOGRAM = [
  ['bin:0-10', 0, 10, 18],
  ['bin:10-20', 10, 20, 42],
  ['bin:20-30', 20, 30, 27],
  ['bin:30-40', 30, 40, 0],
  ['bin:40-50', 40, 50, 4]
];

const STRIP = [
  ['model:atlas', 12.4, true],
  ['model:atlas', 18.1, false],
  ['model:atlas', 9.7, true],
  ['harness:orca', 22.5, true],
  ['harness:orca', 15.3, true],
  ['harness:orca', 11.8, false],
  ['repo:core', 8.2, false],
  ['repo:core', 13.6, false],
  ['repo:core', 19.4, true],
  ['kind:test', 6.5, true],
  ['kind:test', 10.2, false],
  ['kind:test', 14.9, false]
];

const DOTS = [
  ['model:atlas', 18400, 120],
  ['harness:orca', 15200, 96],
  ['repo:core', 12850, 84],
  ['kind:test', 10400, 72]
];

export function boxRows() {
  return BOX_ROWS.map(row => ({ key: row.key, values: { ...row.values }, n: row.n, unpriced: row.unpriced }));
}

export function histogramRows() {
  return HISTOGRAM.map(([key, from, to, count]) => ({ key, bin: { from, to }, values: { calls: count } }));
}

export function stripRows() {
  return STRIP.map(([key, latency, sampled], index) => ({
    key,
    group: key,
    values: { latency },
    sampled,
    ...(sampled ? { n: 6 } : {})
  }));
}

export function dotsRows() {
  return DOTS.map(([key, tokens, n]) => ({ key, values: { tokens }, n }));
}

export function boxSpec() {
  return {
    chart: 'ranges',
    type: 'box',
    title: 'Session cost by model',
    units: 'USD',
    timeBasis: { note: 'session cost distribution; measure axis' },
    x: { label: 'Entity', kind: 'text' },
    series: [{ key: 'cost', label: 'Cost', unit: 'USD', kind: 'money' }],
    baseline: { ...BASELINE }
  };
}

export function histogramSpec() {
  return {
    chart: 'ranges',
    type: 'histogram',
    title: 'Calls per session',
    units: 'calls',
    timeBasis: { note: 'session call distribution; fixed bins' },
    x: { label: 'Call bin', kind: 'text' },
    series: [{ key: 'calls', label: 'Calls', unit: 'calls', kind: 'count' }],
    bins: BINS.map(bin => ({ ...bin }))
  };
}

export function stripSpec() {
  return {
    chart: 'ranges',
    type: 'strip',
    title: 'Latency observations',
    units: 'ms',
    timeBasis: { note: 'session latency observations' },
    x: { label: 'Model', kind: 'text' },
    series: [{ key: 'latency', label: 'Latency', unit: 'ms', kind: 'number' }],
    sample: { n: 6, total: 24 }
  };
}

export function dotsSpec() {
  return {
    chart: 'ranges',
    type: 'dots',
    title: 'Tokens per model',
    units: 'tokens',
    timeBasis: { note: 'aggregated session tokens' },
    x: { label: 'Tokens', kind: 'number', unit: 'tokens' },
    series: [{ key: 'tokens', label: 'Tokens', unit: 'tokens', kind: 'count' }]
  };
}

export function stripSample() {
  return { n: 6, total: 24 };
}
