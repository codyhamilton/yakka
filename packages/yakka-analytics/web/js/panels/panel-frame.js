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

// A panel result may carry the badge flags directly rather than under meta.
// Fold those flags into the coverage the existing badge module already reads.
function badgeInput(result = {}) {
  const meta = result.meta && typeof result.meta === 'object' ? { ...result.meta } : {};
  const flags = {
    partial: result.partial,
    sampled: result.sampled,
    coarsened: result.coarsened,
    clipped: result.clipped,
    lowerBound: result.lowerBound ?? result.lower_bound
  };
  if (Array.isArray(meta.coverage)) {
    for (const [kind, value] of Object.entries(flags)) if (value && !meta.coverage.includes(kind)) meta.coverage.push(kind);
  } else {
    meta.coverage = { ...(meta.coverage || {}) };
    for (const [kind, value] of Object.entries(flags)) if (value) meta.coverage[kind] = true;
  }
  return meta;
}

export function createPanelFrame({ panel, spec = {}, scope = {}, transport, scheduler, tenant = '', schema = null, doc = globalThis.document } = {}) {
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
    badges.update(badgeModel(badgeInput(options)));
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
    const signal = controller.signal;
    setState('loading', { inFlight: 1 });
    let result;
    try {
      result = await panel.load({ scope, spec, signal, scheduler, transport, tenant, schema });
    } catch (error) {
      if (signal.aborted) return;
      if (error?.name === 'AbortError') { setState('cancelled', { retry: load }); return; }
      setState('error', { message: error?.message || 'Panel failed to load.', retry: load });
      return;
    }
    if (signal.aborted) return;
    const classified = classifyResult(result);
    const withRetry = (classified.state === 'error' || classified.state === 'cancelled') && typeof classified.retry !== 'function'
      ? { ...classified, retry: load }
      : classified;
    setState(withRetry.state, withRetry);
    if (withRetry.population) setPopulation(withRetry.population);
    if (withRetry.basis) setBasis(withRetry.basis);
  }

  function destroy() {
    controller?.abort();
    element.remove();
  }

  setState('loading', { inFlight: 0 });
  setBasis(panel.measureBasis || '');
  return { element, load, destroy, setState, setPopulation, setBasis, chipSlot, chooserSlot, inspectorSlot, get state() { return state; } };
}
