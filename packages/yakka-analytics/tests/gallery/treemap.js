// Gallery for <yk-treemap>. External modules only; deterministic data from the
// test-only fixture. No timers and no sleep: settle every element, then idle.

import '/js/charts/yk-treemap.js';
import {
  PARENTS, REQUIRED_KEYS, TAIL_KEYS, parentTotal, tailTotal, treemapRows, treemapSpec
} from '/gallery/fixture-treemap.js';

const log = document.getElementById('event-log');
const elements = [];

function mount(hostId, id, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-treemap');
  element.id = id;
  element.dataset.gallery = spec.chart;
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

mount('treemap-host', 'treemap-composition', treemapSpec(), treemapRows());
mount('states-host', 'treemap-empty', treemapSpec({ chart: 'treemap', empty: { reason: 'filters: model:atlas' } }), []);
mount('states-host', 'treemap-unsupported', treemapSpec({ chart: 'treemap', unsupported: { reason: 'grain quarter is not joinable with measure sessions' } }), treemapRows());

await Promise.all(elements.map(element => element.whenSettled()));
window.__treemap = {
  elements,
  fixture: {
    parents: PARENTS.map(parent => ({ ...parent })),
    requiredKeys: [...REQUIRED_KEYS],
    tailKeys: [...TAIL_KEYS],
    rows: treemapRows(),
    spec: treemapSpec(),
    parentTotals: PARENTS.map(parent => ({ key: parent.key, total: parentTotal(parent.key) })),
    tailTotal: tailTotal()
  }
};
document.documentElement.dataset.idle = 'true';
