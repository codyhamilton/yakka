// Gallery for <yk-matrix>. External modules only; deterministic data from the
// test-only fixture. No timers and no sleep: settle every element, then idle.

import '/js/charts/yk-matrix.js';
import { calendarRows, calendarSpec, heatmapRows, heatmapSpec } from '/gallery/fixture-matrix.js';

const log = document.getElementById('event-log');
const elements = [];
const brushCounts = {};

function mount(hostId, id, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-matrix');
  element.id = id;
  element.spec = spec;
  element.data = data;
  brushCounts[id] = 0;
  for (const name of ['select', 'inspect', 'brush', 'open', 'filter', 'cohort', 'legend']) {
    element.addEventListener(name, event => {
      if (name === 'brush') brushCounts[id] += 1;
      log.dataset.lastEvent = name;
      log.dataset.lastChart = id;
      log.textContent = `${id} ${name}: ${JSON.stringify(event.detail)}`;
    });
  }
  host.append(element);
  elements.push(element);
  return element;
}

mount('heatmap-host', 'matrix-heatmap', heatmapSpec(), heatmapRows());
mount('calendar-host', 'matrix-calendar', calendarSpec(), calendarRows());
mount('states-host', 'matrix-empty', heatmapSpec({ type: 'heatmap', empty: { reason: 'filters: model:atlas' } }), []);
mount('states-host', 'matrix-unsupported', heatmapSpec({ type: 'heatmap', unsupported: { reason: 'grain hour is not joinable with measure sessions' } }), heatmapRows());

await Promise.all(elements.map(element => element.whenSettled()));
window.__matrix = {
  elements,
  brushCounts,
  fixture: {
    heatRows: heatmapRows(),
    heatSpec: heatmapSpec(),
    calendarRows: calendarRows(),
    calendarSpec: calendarSpec()
  }
};
document.documentElement.dataset.idle = 'true';
