// `/ops` page module, lazy-loaded by the router. It mounts one panel frame for
// the `ops-footprint` entry and names the unit that owns every value. Nothing
// here guesses admin rights: `/v1/admin/status` answers 403 or the data.

import { createScheduler } from './core/request-scheduler.js';
import { createTransport } from '../contract/transport.js';
import { createPanelFrame } from './panels/panel-frame.js';
import { hasPanel, registerPanel } from './panels/registry.js';
import { OPS_PANEL, renderOpsStatus } from './panels/ops-footprint.js';

export const title = 'Operations';
export const phase = 9;

const scheduler = createScheduler();
const transport = createTransport(scheduler);
let stylesLoaded = false;
let controller = null;
let runSequence = 0;

function loadStyles(doc) {
  if (stylesLoaded || doc.querySelector('link[href="/css/ops.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/ops.css';
  doc.head.append(link);
}

function register() {
  if (!hasPanel(OPS_PANEL.id)) registerPanel(OPS_PANEL);
}

export function render(root, doc = globalThis.document, { signal } = {}) {
  loadStyles(doc);
  register();
  root.replaceChildren();

  const heading = doc.createElement('h1');
  heading.textContent = title;
  const intro = doc.createElement('p');
  intro.className = 'ops-intro';
  intro.textContent = 'Read-only server status for an authorised administrator. Every tenant is shown separately.';
  root.append(heading, intro);

  const frame = createPanelFrame({ panel: OPS_PANEL, transport, scheduler, doc });
  // The entry is table-only; this names the representation without drawing a chart.
  frame.element.dataset.chart = 'table';
  root.append(frame.element);
  const body = frame.element.querySelector('.workspace-panel-body');

  async function run() {
    controller?.abort();
    controller = new AbortController();
    const id = ++runSequence;
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 1 });
    const result = await OPS_PANEL.load({ signal: controller.signal, scheduler, transport });
    if (id !== runSequence || signal?.aborted) return;
    if (result.state === 'error' || result.state === 'cancelled') result.retry = run;
    frame.setState(result.state, result);
    if (result.state === 'ready') renderOpsStatus(body, result, doc);
    else body.replaceChildren();
    if (result.population) frame.setPopulation(result.population);
    frame.setBasis(result.basis || '');
  }

  run();
  return root;
}

export default { title, phase, render };
