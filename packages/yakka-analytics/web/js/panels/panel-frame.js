// One frame for every panel: title, chart tag, the shared state vocabulary,
// data-idle, badges, chip/chooser/inspector slots, and the population/basis
// readouts. It calls a panel module's load() and renders its result; it does
// not draw charts and does not edit any chart module.

import { badgeModel, createBadges } from '../charts/badges.js';
import { classifyResult, isSettled, unsupportedText } from '../core/panel-state.js';

function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

export function createPanelFrame({ panel, spec = {}, scope = {}, transport, scheduler, tenant = '', doc = globalThis.document } = {}) {
  if (!panel || !panel.id) throw new Error('panel frame needs a registered panel');
  const element = doc.createElement('section');
  element.className = 'workspace-panel';
  element.dataset.panel = panel.id;
  element.dataset.chart = panel.charts?.[0] || '';
  element.dataset.state = 'loading';
  element.dataset.idle = 'false';

  const heading = doc.createElement('header');
  heading.className = 'workspace-panel-header';
  heading.append(text(doc, 'h2', 'workspace-panel-title', panel.title || panel.id));
  const badges = createBadges(doc, []);
  heading.append(badges.element);
  element.append(heading);

  const chipSlot = doc.createElement('div');
  chipSlot.className = 'workspace-panel-chips';
  chipSlot.setAttribute('aria-label', 'Applied scope');
  const chooserSlot = doc.createElement('div');
  chooserSlot.className = 'workspace-panel-chooser';
  const body = doc.createElement('div');
  body.className = 'workspace-panel-body';
  const status = doc.createElement('p');
  status.className = 'workspace-panel-status';
  status.setAttribute('aria-live', 'polite');
  const population = doc.createElement('p');
  population.className = 'workspace-panel-population';
  const basis = doc.createElement('p');
  basis.className = 'workspace-panel-basis';
  const inspectorSlot = doc.createElement('div');
  inspectorSlot.className = 'workspace-panel-inspector';
  element.append(chipSlot, chooserSlot, body, status, population, basis, inspectorSlot);

  let controller = null;
  let state = 'loading';

  function setState(next, options = {}) {
    state = next;
    element.dataset.state = next;
    element.dataset.idle = isSettled(next) ? 'true' : 'false';
    if (options.inFlight !== undefined) element.dataset.inFlight = String(options.inFlight);
    badges.update(badgeModel(options.meta || {}));
    status.replaceChildren();
    if (next === 'loading') {
      const count = Number(options.inFlight) || 0;
      status.textContent = `Loading${count ? ` (${count} in flight)` : ''}…`;
      return;
    }
    if (next === 'ready') {
      status.textContent = '';
      return;
    }
    if (next === 'empty') {
      status.append(text(doc, 'strong', '', 'No rows match. '));
      const causes = options.causes || [];
      if (!causes.length) status.append(doc.createTextNode('The scope produced zero.'));
      for (const cause of causes) {
        status.append(doc.createTextNode(`${cause.label} `));
        if (cause.clear) {
          const button = text(doc, 'button', '', `Clear ${cause.kind}`);
          button.type = 'button';
          button.addEventListener('click', cause.clear);
          status.append(button);
        }
      }
      return;
    }
    if (next === 'error') {
      status.append(text(doc, 'strong', '', options.message || 'The server did not answer.'));
      if (options.code) status.append(doc.createTextNode(` (${options.code})`));
      addRetry(options.retry);
      return;
    }
    if (next === 'unsupported') {
      status.textContent = unsupportedText(options);
      return;
    }
    if (next === 'cancelled') {
      status.append(text(doc, 'strong', '', 'Request cancelled. '));
      addRetry(options.retry);
    }
  }

  function addRetry(retry) {
    if (typeof retry !== 'function') return;
    const button = text(doc, 'button', '', 'Retry');
    button.type = 'button';
    button.addEventListener('click', retry, { once: true });
    status.append(button);
  }

  function setPopulation(next) {
    if (!next) { population.textContent = ''; return; }
    const unit = next.unit || 'row';
    const returned = next.returned_n;
    const eligible = next.eligible_n ?? next.scope_n;
    population.textContent = `${returned ?? 0} of ${eligible ?? 0} ${unit}${next.relation?.resolved_n !== undefined ? ` · ${next.relation.resolved_n} ${next.relation.resolved_unit || 'session'} in cohort` : ''}`;
  }

  function setBasis(value) {
    basis.textContent = value ? `basis: ${value}` : '';
  }

  async function load() {
    if (!panel.load) {
      setState('unsupported', { missing: panel.id, reason: 'no loader', source: 'this phase' });
      return;
    }
    controller?.abort();
    controller = new AbortController();
    setState('loading', { inFlight: 1 });
    let result;
    try {
      result = await panel.load({ scope, spec, signal: controller.signal, scheduler, transport, tenant });
    } catch (error) {
      if (error?.name === 'AbortError') { setState('cancelled', { retry: load }); return; }
      setState('error', { message: error?.message || 'Panel failed to load.', retry: load });
      return;
    }
    const classified = classifyResult(result);
    setState(classified.state, classified);
    if (classified.population) setPopulation(classified.population);
    if (classified.basis) setBasis(classified.basis);
  }

  function destroy() {
    controller?.abort();
    element.remove();
  }

  setState('loading', { inFlight: 0 });
  setBasis(panel.measureBasis || '');
  return { element, load, destroy, setState, setPopulation, setBasis, chipSlot, chooserSlot, inspectorSlot, get state() { return state; } };
}
