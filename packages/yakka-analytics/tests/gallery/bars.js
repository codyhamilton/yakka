// Gallery for <yk-bars>. External modules only; deterministic data from the
// test-only fixture. No timers and no sleep: settle every element, then idle.

import '/js/charts/yk-bars.js';
import {
  MEASURES, SLOPE_SERIES, lollipopRows, percentRows, rankedOtherTotal, rankedRows, rankedTop, slopeRows, stackedRows
} from '/gallery/fixture-bars.js';

const log = document.getElementById('event-log');
const elements = [];

function baseSpec(type, overrides = {}) {
  return {
    chart: 'bars',
    type,
    title: `${type} sessions`,
    units: 'sessions',
    timeBasis: { note: 'fixture; categorical' },
    x: { label: 'Entity', kind: 'text' },
    series: [{ ...MEASURES[0] }],
    ...overrides
  };
}

function mount(hostId, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-bars');
  element.id = `bars-${spec.type}${hostId === 'states-host' ? `-${spec.chart}` : ''}`;
  element.dataset.gallery = spec.type;
  element.spec = spec;
  element.data = data;
  for (const name of ['select', 'inspect', 'brush', 'open', 'filter', 'cohort', 'legend']) {
    element.addEventListener(name, event => {
      log.dataset.lastEvent = name;
      log.textContent = `${name}: ${JSON.stringify(event.detail)}`;
    });
  }
  host.append(element);
  elements.push(element);
  return element;
}

mount('ranked-host', baseSpec('ranked', { top: rankedTop(), sort: 'desc' }), rankedRows());
mount('stacked-host', baseSpec('stacked', {
  title: 'Stacked calls by entity',
  units: 'sessions · calls · USD',
  series: MEASURES.map(item => ({ ...item }))
}), stackedRows());
mount('percent-host', baseSpec('percent', {
  title: '100 percent composition',
  units: 'share',
  series: MEASURES.map(item => ({ ...item }))
}), percentRows());
mount('lollipop-host', baseSpec('lollipop', { title: 'Lollipop sessions' }), lollipopRows());
mount('slope-host', baseSpec('slope', {
  title: 'Before and after',
  series: SLOPE_SERIES.map(item => ({ ...item }))
}), slopeRows());
mount('states-host', baseSpec('ranked', {
  chart: 'empty',
  empty: { reason: 'filters: model:atlas' }
}), []);
mount('states-host', baseSpec('ranked', {
  chart: 'unsupported',
  unsupported: { reason: 'grain quarter is not joinable with measure sessions' }
}), rankedRows());

await Promise.all(elements.map(element => element.whenSettled()));
window.__bars = {
  elements,
  fixture: {
    measures: MEASURES,
    slopeSeries: SLOPE_SERIES,
    ranked: rankedRows(),
    stacked: stackedRows(),
    percent: percentRows(),
    lollipop: lollipopRows(),
    slope: slopeRows(),
    top: rankedTop(),
    otherTotal: rankedOtherTotal()
  }
};
document.documentElement.dataset.idle = 'true';
