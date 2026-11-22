// One frame for every panel: title, chart tag, the shared state vocabulary,
// data-idle, badges, chip/chooser/inspector slots, and the population/basis
// readouts. It calls a panel module's load() and renders its result; it does
// not draw charts and does not edit any chart module.

import { badgeModel, createBadges } from '../charts/badges.js';
import { classifyResult, isSettled, unsupportedText } from '../core/panel-state.js';
import { applicability, applicabilityState as applicabilityResultState } from '../core/filter-applicability.js';
import { captionFor } from './captions.js';

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

export function createPanelFrame({ panel, spec = {}, scope = {}, transport, scheduler, tenant = '', schema = null, doc = globalThis.document, onEditFilters = null, editFilters = null, onAllHistory = null, onResetFilters = null } = {}) {
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

  const caption = text(doc, 'p', 'workspace-panel-caption', '');

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
  status.setAttribute('role', 'status');
  const population = doc.createElement('p');
  population.className = 'workspace-panel-population';
  const basis = doc.createElement('p');
  basis.className = 'workspace-panel-basis';
  const inspectorSlot = doc.createElement('div');
  inspectorSlot.className = 'workspace-panel-inspector';
  const meta = doc.createElement('div');
  meta.className = 'workspace-panel-meta';
  meta.append(status, population, basis);
  element.append(caption, chipSlot, chooserSlot, body, meta, inspectorSlot);

  let controller = null;
  let state = 'loading';

  const declaredApplies = panel.applies !== undefined || panel.scopeFilters !== undefined;

  function renderCaption(result = null) {
    caption.textContent = captionFor(panel, spec, { scope, schema, result });
    return caption.textContent;
  }

  function ignoredFrom(result) {
    const lists = [
      result?.ignoredFilters,
      result?.ignored_filters,
      result?.body?.ignored_filters,
      result?.raw?.ignored_filters,
      result?.response?.ignored_filters
    ];
    return [...new Set(lists.flatMap(list => Array.isArray(list) ? list.map(String) : []))];
  }

  function addEditFilters() {
    const handler = editFilters || onEditFilters || panel.editFilters;
    if (typeof handler !== 'function') return;
    const button = text(doc, 'button', 'workspace-panel-edit-filters', 'Edit filters');
    button.type = 'button';
    button.addEventListener('click', handler);
    status.append(button);
  }

  function recovery(label, handler) {
    if (typeof handler !== 'function') return;
    const button = text(doc, 'button', 'workspace-panel-recovery', label);
    button.type = 'button';
    button.addEventListener('click', handler);
    status.append(button);
  }

  function tableCaption() {
    return String(panel.tableCaption || panel.title || panel.id);
  }

  function sanitizedCode(value) {
    const code = String(value || '').trim();
    return /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : '';
  }

  function showApplicability(result) {
    const next = applicabilityResultState(result);
    if (!next) return false;
    body.replaceChildren();
    setState('unsupported', { renderStatus: false });
    status.textContent = next.message;
    addEditFilters();
    return true;
  }

  function setState(next, options = {}) {
    state = next;
    element.dataset.state = next;
    element.dataset.idle = isSettled(next) ? 'true' : 'false';
    if (options.inFlight !== undefined) element.dataset.inFlight = String(options.inFlight);
    badges.update(badgeModel(badgeInput(options)));
    status.replaceChildren();
    // Opt-in: a panel that owns its exact T1–T4 rows in the table body passes
    // renderStatus:false so the generic frame vocabulary does not double it.
    if (options.renderStatus === false) return;
    if (next === 'loading') {
      status.setAttribute('aria-busy', 'true');
      status.textContent = `Loading ${tableCaption()}…`;
      return;
    }
    status.removeAttribute('aria-busy');
    if (next === 'ready') {
      status.textContent = '';
      return;
    }
    if (next === 'empty') {
      status.append(text(doc, 'strong', '', 'No records match these filters.'));
      recovery('All history', onAllHistory);
      recovery('Reset filters', onResetFilters);
      return;
    }
    if (next === 'error') {
      status.append(text(doc, 'strong', '', `Could not load ${tableCaption()}.`));
      const code = sanitizedCode(options.code);
      if (code) status.append(doc.createTextNode(` (${code})`));
      addRetry(options.retry);
      return;
    }
    if (next === 'unauthorized') {
      if (Number(options.status) === 403 || String(options.code) === '403') {
        status.append(text(doc, 'strong', '', 'You do not have access to this tenant'));
      } else {
        status.append(text(doc, 'strong', '', 'Sign in to load this table.'));
        const link = text(doc, 'a', '', 'Sign in');
        link.href = `/login${globalThis.location?.search || ''}`;
        status.append(link);
      }
      return;
    }
    if (next === 'busy') {
      status.append(text(doc, 'strong', '', `The server is busy; could not load ${tableCaption()}.`));
      addRetry(options.retry);
      return;
    }
    if (next === 'timeout') {
      status.append(text(doc, 'strong', '', `The request timed out; could not load ${tableCaption()}.`));
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
    renderCaption();
    if (!panel.load) {
      setState('unsupported', { missing: panel.id, reason: 'no loader', source: 'this phase' });
      return;
    }
    if (declaredApplies) {
      const pre = applicability({ panel, spec, scope, schema });
      if (!pre.applicable) {
        showApplicability(pre);
        return;
      }
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
    renderCaption(result);
    const withRetry = (classified.state === 'error' || classified.state === 'cancelled') && typeof classified.retry !== 'function'
      ? { ...classified, retry: load }
      : classified;
    if (withRetry.state === 'unsupported' && withRetry.applicability) {
      showApplicability(withRetry);
      return;
    }
    if (declaredApplies && withRetry.state !== 'error' && withRetry.state !== 'cancelled') {
      const post = applicability({ panel, spec, scope, schema, ignoredFilters: ignoredFrom(result) });
      if (!post.applicable) {
        showApplicability(post);
        return;
      }
    }
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
  renderCaption();
  return { element, load, destroy, setState, setPopulation, setBasis, caption, chipSlot, chooserSlot, inspectorSlot, get state() { return state; } };
}
