// Deterministic test-only data for the Phase 8 lanes gallery. Product code
// must never import this module. No clocks, no randomness: every timestamp is
// listed. The shared entity keys are model:atlas, harness:orca, repo:core and
// kind:test; one marker is priced and one is unpriced.

export const HOUR = 60 * 60 * 1000;
export const START = Date.UTC(2024, 0, 2, 9, 0, 0);

export const LANES = [
  { key: 'model:atlas', label: 'Atlas' },
  { key: 'harness:orca', label: 'Orca' },
  { key: 'repo:core', label: 'Core' }
];

export const KINDS = [
  { key: 'kind:test', label: 'Test', kind: 'count', unit: 'events' },
  { key: 'kind:artifact', label: 'Artifact', kind: 'count', unit: 'artifacts' },
  { key: 'kind:call', label: 'Model call', kind: 'money', unit: 'USD' }
];

const TIMELINE = [
  { key: 'model:atlas', lane: 'model:atlas', kind: 'kind:call', at: START + 0 * HOUR, priced: true, values: { cost: 12.5 } },
  { key: 'harness:orca', lane: 'harness:orca', kind: 'kind:test', at: START + 2 * HOUR, priced: true, values: { events: 4 } },
  { key: 'repo:core', lane: 'repo:core', kind: 'kind:artifact', at: START + 5 * HOUR, priced: true, values: { artifacts: 2 } },
  { key: 'kind:test', lane: 'model:atlas', kind: 'kind:call', at: START + 7 * HOUR, priced: false, values: { cost: 0 } },
  { key: 'model:beacon', lane: 'harness:orca', kind: 'kind:test', at: START + 10 * HOUR, priced: true, values: { events: 3 } },
  { key: 'repo:docs', lane: 'repo:core', kind: 'kind:artifact', at: START + 12 * HOUR, priced: true, values: { artifacts: 1 } }
];

const GANTT = [
  { key: 'model:atlas', lane: 'model:atlas', kind: 'kind:test', start: START + 1 * HOUR, end: START + 6 * HOUR, values: { events: 5 } },
  { key: 'harness:orca', lane: 'harness:orca', kind: 'kind:test', start: START + 3 * HOUR, end: START + 9 * HOUR, values: { events: 2 } },
  { key: 'repo:core', lane: 'repo:core', kind: 'kind:artifact', start: START + 2 * HOUR, end: START + 4 * HOUR, values: { artifacts: 2 } },
  { key: 'kind:test', lane: 'model:atlas', kind: 'kind:call', start: START + 5 * HOUR, end: START + 11 * HOUR, values: { cost: 12.5 } },
  { key: 'repo:docs', lane: 'repo:core', kind: 'kind:artifact', start: START + 3 * HOUR, end: START + 8 * HOUR, values: { artifacts: 1 } }
];

export function timelineRows() {
  return TIMELINE.map(item => ({ ...item, values: { ...item.values } }));
}

export function ganttRows() {
  return GANTT.map(item => ({ ...item, values: { ...item.values } }));
}

export function timelineSpec() {
  return {
    chart: 'lanes',
    type: 'timeline',
    title: 'Entity events over time',
    units: 'events · artifacts · USD',
    timeBasis: { clock: 'artifact/event facts.ts' },
    x: { label: 'Time', kind: 'time' },
    series: KINDS.map(item => ({ ...item })),
    lanes: LANES.map(item => ({ ...item }))
  };
}

export function ganttSpec() {
  return {
    chart: 'lanes',
    type: 'gantt',
    title: 'Plan spans over time',
    units: 'events · artifacts · USD',
    timeBasis: { clock: 'artifact/event facts.ts' },
    x: { label: 'Start', kind: 'time' },
    series: KINDS.map(item => ({ ...item })),
    lanes: LANES.map(item => ({ ...item }))
  };
}

export function laneWindow(items) {
  const times = items.flatMap(item => (item.start === undefined ? [item.at] : [item.start, item.end]));
  return { min: Math.min(...times), max: Math.max(...times) };
}
