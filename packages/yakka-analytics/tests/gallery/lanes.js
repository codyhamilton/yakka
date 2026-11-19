// Gallery for <yk-lanes>. External modules only; deterministic data from the
// test-only fixture. No timers and no sleep: settle every element, then idle.

import '/js/charts/yk-lanes.js';
import {
  KINDS, LANES, ganttRows, ganttSpec, laneWindow, timelineRows, timelineSpec
} from '/gallery/fixture-lanes.js';

const log = document.getElementById('event-log');
const elements = [];

function mount(hostId, id, spec, data) {
  const host = document.getElementById(hostId);
  const element = document.createElement('yk-lanes');
  element.id = id;
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

mount('timeline-host', 'lanes-timeline', timelineSpec(), timelineRows());
mount('gantt-host', 'lanes-gantt', ganttSpec(), ganttRows());

await Promise.all(elements.map(element => element.whenSettled()));
window.__lanes = {
  elements,
  fixture: {
    lanes: LANES,
    kinds: KINDS,
    timeline: timelineRows(),
    gantt: ganttRows(),
    timelineWindow: laneWindow(timelineRows()),
    ganttWindow: laneWindow(ganttRows())
  }
};
document.documentElement.dataset.idle = 'true';
