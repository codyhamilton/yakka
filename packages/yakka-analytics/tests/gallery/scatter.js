// Gallery for 7-04: numeric scatter and ECDF. Deterministic data from the
// shared fixture, external modules only, no timers. The page sets idle once
// every chart has settled.

import { SCATTER_BUDGET, scatterPoints } from '/gallery/fixture.js';
import '/js/charts/yk-chart.js';

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'star', 'ring', 'cross'];

const raw = scatterPoints(SCATTER_BUDGET);
const points = raw.map((point, index) => ({
  ...point,
  group: point.sampled ? 'cohort:alpha' : 'model:atlas',
  shape: SHAPES[index % SHAPES.length]
}));
const sampled = points.filter(point => point.sampled);

const log = document.getElementById('scatter-state');
const elements = [];

function mirror(chart, name, detail) {
  log.dataset.chart = chart;
  log.dataset.lastEvent = name;
  log.dataset.keys = (detail?.keys || []).length;
  log.textContent = `${chart} ${name}: ${JSON.stringify(detail)}`;
}

function mount(hostId, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-chart');
  element.id = spec.chart;
  element.dataset.gallery = spec.chart;
  element.spec = spec;
  element.data = data;
  for (const name of ['select', 'inspect', 'brush']) {
    element.addEventListener(name, event => mirror(spec.chart, name, event.detail));
  }
  host.append(element);
  elements.push(element);
  return element;
}

const scatterSpec = {
  chart: 'scatter',
  title: 'Artifacts against cost',
  x: { label: 'Cost', kind: 'number', unit: 'USD' },
  y: { label: 'Artifacts', kind: 'number' },
  colour: { key: 'group' },
  shape: { key: 'shape' },
  size: { key: 'values.score', min: 2.5, max: 8, domain: [0, 1] },
  values: [{ key: 'score', label: 'Score', kind: 'number' }]
};

const sampleSpec = {
  ...scatterSpec,
  chart: 'scatter-sampled',
  type: 'scatter',
  title: 'Sampled artifacts against cost',
  sample: { n: sampled.length, total: points.length }
};

const ecdfData = [];
for (let index = 0; index < 240; index += 1) {
  const group = index % 2 === 0 ? 'cohort:alpha' : 'cohort:beta';
  ecdfData.push({
    key: `${group}:${index}`,
    x: ((index * 37) % 100) + (index % 3) * 0.25,
    group
  });
}

const ecdfSpec = {
  chart: 'ecdf',
  title: 'Score distribution',
  x: { label: 'Score', kind: 'number' },
  y: { label: 'Fraction', kind: 'percent', unit: '%' },
  series: [
    { key: 'cohort:alpha', label: 'Cohort A' },
    { key: 'cohort:beta', label: 'Cohort B' }
  ]
};

const scatter = mount('scatter-host', scatterSpec, points);
const sample = mount('sample-host', sampleSpec, sampled);
const ecdf = mount('ecdf-host', ecdfSpec, ecdfData);

await Promise.all(elements.map(element => element.whenSettled()));
window.__scatter = { elements, points, sampled, ecdfData, scatter, sample, ecdf, scatterSpec, ecdfSpec };
document.documentElement.dataset.idle = 'true';
