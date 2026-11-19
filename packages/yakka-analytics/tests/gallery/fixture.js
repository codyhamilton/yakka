// Deterministic test-only data for the Phase 7 gallery. Product code must
// never import this module. No clocks, no randomness beyond a fixed seed.

export const DAY = 24 * 60 * 60 * 1000;
export const START = Date.UTC(2021, 0, 1);
export const SCATTER_BUDGET = 5000;

export const ENTITY_KEYS = [
  'model:atlas',
  'model:beacon',
  'model:cedar',
  'harness:orca',
  'harness:pine',
  'repo:core',
  'repo:docs',
  'kind:test',
  'kind:build',
  'scorer:design',
  'stage:plan',
  'tool:bash',
  'cohort:alpha',
  'cohort:beta'
];

export const SERIES = [
  { key: 'model:atlas', label: 'Atlas', unit: 'events', kind: 'count' },
  { key: 'model:beacon', label: 'Beacon', unit: 'events', kind: 'count' },
  { key: 'harness:orca', label: 'Orca', unit: 'events', kind: 'count' },
  { key: 'repo:core', label: 'Core', unit: 'events', kind: 'count' }
];

export const BADGE_META = {
  resolution: { grain: 'time', bucket: 'day' },
  sample: { n: 5000, total: 12000 },
  coverage: { partial: true, sampled: true, coarsened: true, clipped: true, lowerBound: true },
  basis: 'artifact/event facts.ts; scores latest known'
};

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function timeSeries({ points = 1096, seed = 20, start = START } = {}) {
  const random = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < points; i += 1) {
    const values = {};
    for (let s = 0; s < SERIES.length; s += 1) {
      const base = 40 + s * 17;
      const wave = Math.round(12 * Math.sin((i / 30) + s));
      values[SERIES[s].key] = base + wave + Math.floor(random() * 9);
    }
    rows.push({ key: `day:${i}`, x: start + i * DAY, values, n: { [SERIES[0].key]: 100 + i } });
  }
  return rows;
}

export function scatterPoints(count = SCATTER_BUDGET, { seed = 41 } = {}) {
  const random = mulberry32(seed);
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const group = i % 5 === 0 ? 'sampled' : 'full';
    points.push({
      key: `point:${String(i).padStart(5, '0')}`,
      x: Math.round(random() * 100000) / 1000,
      y: Math.round(random() * 100000) / 1000,
      group,
      sampled: group === 'sampled',
      values: { score: Math.round(random() * 100) / 100, cost: Math.round(random() * 10000) / 100 }
    });
  }
  return points;
}

export function foundationsSpec() {
  return {
    title: 'Daily events',
    timeBasis: { clock: 'artifact/event facts.ts', score: 'latest known' },
    x: { label: 'Day', kind: 'number' },
    series: SERIES.map(series => ({ ...series }))
  };
}

export function scatterSpec() {
  return {
    title: 'Score against cost',
    x: { label: 'Score', kind: 'number', unit: '' },
    series: [
      { key: 'cost', label: 'Cost', kind: 'money', unit: 'USD' },
      { key: 'score', label: 'Score', kind: 'number' }
    ]
  };
}
