// The selection tray: it states grain, Boolean predicate and counts with units,
// and offers Make cohort A-D, Filter all, Exclude, Zoom, Open as list and
// Clear. Counts come from the panel's typed population; nothing here invents a
// count. Scope is frozen to absolute bounds when promoted to a cohort.

import {
  COHORT_KEYS, cohortDefinition, decodePick, encodeCohort, fitsViewUrl, formatSelection,
  selectionPredicate, validateCohort
} from './selection-model.js';
import { stateUrl } from './chips.js';

const WINDOW_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 };

export function absoluteScope(state = {}, now = Date.now()) {
  if (state.from || state.to) return { from: state.from || null, to: state.to || null, tz: state.tz || null };
  const to = new Date(now).toISOString();
  if (!state.win || state.win === 'all') return { from: null, to, tz: state.tz || null };
  const match = /^(\d+)([hdwmy])$/.exec(state.win);
  if (!match) return { from: null, to, tz: state.tz || null };
  const from = new Date(now - Number(match[1]) * WINDOW_MS[match[2]]).toISOString();
  return { from, to, tz: state.tz || null };
}

function splitExclude(value) {
  const text = String(value || '');
  const at = text.indexOf(':');
  return at === -1 ? { lens: 'exclude', value: text } : { lens: text.slice(0, at), value: text.slice(at + 1) };
}

function applies(key, { schema, grain }) {
  const filters = schema?.grains?.[grain]?.filters;
  if (!Array.isArray(filters)) return true;
  return filters.includes(key) || ['repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id'].includes(key);
}

export function scopeElements(state = {}, { schema = null, grain = '' } = {}) {
  const include = [];
  for (const [lens, values] of Object.entries(state.filters || {})) {
    if (!applies(lens, { schema, grain })) continue;
    if (values?.length) include.push({ lens, values: [...values] });
  }
  const exclude = [];
  for (const raw of state.exclude || []) {
    const { lens, value } = splitExclude(raw);
    if (applies(lens, { schema, grain })) exclude.push({ lens, values: [value] });
  }
  return { include, exclude };
}

export function selectionTrayModel({ state = {}, pick = null, grain = '', unit = 'row', population = null, selection = null } = {}) {
  const keys = pick || decodePick(state.pick);
  const selected = (keys.include || []).length;
  const scope = population?.scope_n ?? null;
  const sampled = selection?.sampled ?? (population?.sampled ? population?.returned_n ?? null : null);
  const time = grain === 'time' || Boolean(state.sel);
  return {
    grain,
    unit,
    selected,
    scope,
    sampled,
    time,
    predicate: selectionPredicate(keys),
    text: formatSelection({ unit, selected, scope, sampled })
  };
}

// Promotes a selection to a cohort definition. The source scope is frozen to
// the current absolute window and the panel's applied include/exclude elements.
export function buildCohort({ state = {}, pick = null, grain = '', schema = null, op = 'include', now = Date.now() } = {}) {
  const keys = pick || decodePick(state.pick);
  const predicate = selectionPredicate(keys);
  if (!predicate) throw new Error('a cohort needs a non-empty selection');
  const scope = { ...absoluteScope(state, now), ...scopeElements(state, { schema, grain }) };
  return cohortDefinition({ grain, scope, predicate, op });
}

export function nextCohortSlot(state = {}) {
  for (const key of COHORT_KEYS) if (!state.cohorts?.[key]) return key;
  return null;
}

const OPEN_DESTINATIONS = {
  session: '/sessions', execution: '/sessions', plan: '/plans', artifact: '/artifact', content: '/artifact', time: '/ledger'
};

export function openListDestination(grain) {
  return OPEN_DESTINATIONS[grain] || '/ledger';
}

function copyState(state) {
  return {
    ...state,
    filters: Object.fromEntries(Object.entries(state.filters || {}).map(([key, values]) => [key, [...(values || [])]])),
    cohorts: { ...(state.cohorts || {}) },
    exclude: [...(state.exclude || [])]
  };
}

export function writeCohort(state, slot, cohort) {
  const next = copyState(state);
  next.cohorts[slot] = encodeCohort(cohort);
  return next;
}

export function createSelectionTray({ doc = globalThis.document, router, path = '/' } = {}) {
  const element = doc.createElement('section');
  element.className = 'selection-tray';
  element.setAttribute('aria-label', 'Selection');
  element.dataset.open = 'false';
  let context = {};

  function announce(message) {
    const status = element.querySelector('.selection-tray-status');
    if (status) status.textContent = message || '';
  }

  function commit(next, message) {
    const url = stateUrl(next, context.search || '', path);
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    if (!fitsViewUrl(query)) { announce('over the published URL budget; the scope is unchanged'); return; }
    router?.pushScope(url);
    if (message) announce(message);
  }

  function addCohort(slot, op = 'include') {
    let cohort;
    try {
      cohort = buildCohort({ state: context.state, pick: context.pick, grain: context.grain, schema: context.schema, op, now: context.now });
    } catch (error) {
      announce(error.message);
      return;
    }
    const check = validateCohort(cohort);
    if (!check.ok) { announce(`over budget: ${check.reason}; choose a smaller region`); return; }
    const key = String(slot).startsWith('c') ? String(slot) : `c${String(slot).toLowerCase()}`;
    const next = writeCohort(context.state, key, cohort);
    if (op === 'exclude' || context.action === 'filter-all') next.cmp = 'cohorts';
    commit(next);
  }

  function update(next = {}) {
    context = next;
    render();
  }

  function button(label, action, { disabled = false, slot = '' } = {}) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = 'selection-tray-action';
    node.dataset.action = action;
    if (slot) node.dataset.slot = slot;
    node.textContent = label;
    node.disabled = disabled;
    node.addEventListener('click', () => {
      if (action === 'make-cohort') addCohort(slot, 'include');
      else if (action === 'filter-all') {
        const target = nextCohortSlot(context.state);
        if (!target) { announce('all four cohort slots are defined; clear one first'); return; }
        context.action = 'filter-all';
        addCohort(target, 'include');
        context.action = '';
      } else if (action === 'exclude') {
        const target = nextCohortSlot(context.state);
        if (!target) { announce('all four cohort slots are defined; clear one first'); return; }
        addCohort(target, 'exclude');
      } else if (action === 'zoom') {
        const range = context.selection?.range;
        if (!range || !Number.isFinite(Number(range.from)) || !Number.isFinite(Number(range.to))) { announce('zoom needs a time selection'); return; }
        const n = copyState(context.state);
        n.from = new Date(Number(range.from)).toISOString();
        n.to = new Date(Number(range.to)).toISOString();
        n.sel = '';
        commit(n);
      } else if (action === 'open-list') {
        router?.push(openListDestination(context.grain));
      } else if (action === 'clear') {
        context.onClear?.();
      }
    });
    return node;
  }

  function render() {
    element.replaceChildren();
    const model = selectionTrayModel(context);
    if (!model.selected) { element.dataset.open = 'false'; element.hidden = true; return; }
    element.hidden = false;
    element.dataset.open = 'true';
    element.dataset.grain = model.grain || '';
    element.dataset.unit = model.unit || '';

    const heading = doc.createElement('h2');
    heading.className = 'selection-tray-title';
    heading.textContent = 'Selection';
    const summary = doc.createElement('p');
    summary.className = 'selection-tray-summary';
    summary.textContent = model.text;
    const grain = doc.createElement('p');
    grain.className = 'selection-tray-grain';
    grain.textContent = `${model.grain || 'unknown'} selection · ${model.unit || 'row'}`;
    const predicate = doc.createElement('p');
    predicate.className = 'selection-tray-predicate';
    predicate.textContent = model.predicate ? JSON.stringify(model.predicate) : 'no predicate';

    const actions = doc.createElement('div');
    actions.className = 'selection-tray-actions';
    for (const slot of ['A', 'B', 'C', 'D']) actions.append(button(`Make cohort ${slot}`, 'make-cohort', { slot }));
    actions.append(
      button('Filter all panels to this', 'filter-all'),
      button('Exclude this', 'exclude'),
      button('Zoom', 'zoom', { disabled: !model.time }),
      button('Open as list', 'open-list'),
      button('Clear', 'clear')
    );

    const status = doc.createElement('p');
    status.className = 'selection-tray-status';
    status.setAttribute('aria-live', 'polite');
    element.append(heading, summary, grain, predicate, actions, status);
  }

  render();
  return { element, update };
}
