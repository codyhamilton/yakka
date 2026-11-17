// Gallery for <yk-chart>. External modules only; deterministic data from the
// shared fixture. No timers and no sleep: settle all elements, then set idle.

import { SERIES, timeSeries } from '/gallery/fixture.js';
import '/js/charts/yk-chart.js';

const rows = timeSeries({ points: 60 });
const log = document.getElementById('event-log');

function baseSpec(chart, overrides = {}) {
  return {
    chart,
    title: 'Daily events',
    timeBasis: { clock: 'artifact/event facts.ts', score: 'latest known' },
    x: { label: 'Day', kind: 'time' },
    bucket: 'day',
    units: 'events',
    series: SERIES.map(series => ({ ...series })),
    ...overrides
  };
}

const elements = [];
function mount(hostId, spec, data, id = spec.chart) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-chart');
  element.id = id;
  element.dataset.gallery = spec.chart;
  element.spec = spec;
  element.data = data;
  for (const name of ['select', 'inspect', 'brush']) {
    element.addEventListener(name, event => {
      log.dataset.lastEvent = name;
      log.textContent = `${name}: ${JSON.stringify(event.detail)}`;
    });
  }
  host.append(element);
  elements.push(element);
  return element;
}

mount('line-host', baseSpec('line'), rows);
mount('area-host', baseSpec('area', { type: 'area' }), rows);
mount('columns-host', baseSpec('columns', { type: 'columns' }), rows);
mount('cumulative-host', baseSpec('cumulative', { mode: 'cumulative' }), rows);
mount('share-host', baseSpec('share', { mode: 'share' }), rows);

const syncA = mount('sync-host', baseSpec('sync-a', {
  scaleGroup: 'paired-days',
  series: [{ ...SERIES[0] }]
}), rows, 'sync-a');
const syncB = mount('sync-host', baseSpec('sync-b', {
  scaleGroup: 'paired-days',
  series: [{ ...SERIES[1] }]
}), rows, 'sync-b');

const thresholdSpec = baseSpec('thresholds', {
  series: [{ ...SERIES[0] }],
  thresholds: [
    { key: 'threshold:target', label: 'Target events', tone: 'good', value: 80, unit: 'events' },
    { key: 'threshold:band', label: 'Watch band', tone: 'warn', from: 50, to: 60, unit: 'events' }
  ]
});
mount('thresholds-host', thresholdSpec, rows);

mount('states-host', baseSpec('empty', {
  series: [{ ...SERIES[0] }],
  empty: { reason: 'filters: model:beacon; selection: 2020-02-01..2020-02-03' }
}), []);

mount('states-host', baseSpec('unsupported', {
  series: [{ ...SERIES[0] }],
  unsupported: { reason: 'grain quarter is not joinable with measure cost', nearest: 'day' }
}), rows);

await Promise.all(elements.map(element => element.whenSettled()));
window.__timeSeries = { elements, rows, syncA, syncB, thresholdSpec };
document.documentElement.dataset.idle = 'true';
