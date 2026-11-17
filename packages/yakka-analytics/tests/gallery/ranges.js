// Gallery for <yk-ranges>. External modules only; deterministic data from the
// test-only fixture. No timers and no sleep: settle every element, then idle.

import '/js/charts/yk-ranges.js';
import {
  BASELINE, boxRows, boxSpec, dotsRows, dotsSpec, histogramRows, histogramSpec, stripRows, stripSpec
} from '/gallery/fixture-ranges.js';

const log = document.getElementById('event-log');
const elements = [];

function mount(hostId, id, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-ranges');
  element.id = id;
  element.dataset.gallery = spec.type || 'state';
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

mount('box-host', 'ranges-box', boxSpec(), boxRows());
mount('histogram-host', 'ranges-histogram', histogramSpec(), histogramRows());
mount('strip-host', 'ranges-strip', stripSpec(), stripRows());
mount('dots-host', 'ranges-dots', dotsSpec(), dotsRows());
mount('states-host', 'ranges-empty', { ...boxSpec(), chart: 'ranges', empty: { reason: 'filters: model:atlas' } }, []);
mount('states-host', 'ranges-unsupported', {
  ...boxSpec(),
  chart: 'ranges',
  unsupported: { reason: 'grain quarter is not joinable with measure sessions' }
}, boxRows());

await Promise.all(elements.map(element => element.whenSettled()));
window.__ranges = {
  elements,
  fixture: {
    baseline: { ...BASELINE },
    box: boxRows(),
    histogram: histogramRows(),
    strip: stripRows(),
    dots: dotsRows(),
    specs: { box: boxSpec(), histogram: histogramSpec(), strip: stripSpec(), dots: dotsSpec() }
  }
};
document.documentElement.dataset.idle = 'true';
