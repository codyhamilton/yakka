// Gallery for the 7-03 gesture engine. External modules only; deterministic
// data from the shared fixture. Two linked charts over the same entity keys,
// and a test-only <output> that mirrors the settled inspect/select/brush state.

import { SERIES, timeSeries } from '/gallery/fixture.js';
import '/js/charts/yk-chart.js';

const rows = timeSeries({ points: 40 });
const log = document.getElementById('gesture-state');

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

function mirror(chart, name, detail) {
  log.dataset.chart = chart;
  log.dataset.lastEvent = name;
  log.dataset.key = detail?.key ?? detail?.selection?.include?.[0] ?? '';
  log.textContent = `${chart} ${name}: ${JSON.stringify(detail)}`;
}

const elements = [];
function mount(id, spec, data) {
  const host = document.getElementById('linked-host');
  const element = document.createElement('yk-chart');
  element.id = id;
  element.dataset.gallery = spec.chart;
  element.spec = spec;
  element.data = data;
  for (const name of ['select', 'inspect', 'brush', 'zoom', 'pan', 'filter', 'open', 'cohort']) {
    element.addEventListener(name, event => mirror(id, name, event.detail));
  }
  host.append(element);
  elements.push(element);
  return element;
}

const line = mount('gestures-a', baseSpec('gestures-a'), rows);
const area = mount('gestures-b', baseSpec('gestures-b', { type: 'area' }), rows);

await Promise.all(elements.map(element => element.whenSettled()));
window.__gestures = { elements, rows, line, area };
document.documentElement.dataset.idle = 'true';
