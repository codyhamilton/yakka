// Applicable scope/filter/cohort/selection chips and the legend-focus mapping.
// A chip removal is a scope change and pushes history through the router; the
// legend focus maps a series key to a contract lens name before it emits a
// board filter, and never emits a null filter.

import { encodeUrlState } from '../../contract/url-state.js';
import { decodeCohort, decodePick } from './selection-model.js';

// Chart legend namespaces -> contract filter names. `model` is the shared
// filter alias kept by 17.3.1; the contract lens is session_model.
const LEGEND_LENS = {
  model: 'session_model',
  harness: 'harness',
  repo: 'repo_id',
  kind: 'kind',
  plan: 'plan',
  tool: 'tool',
  scorer: 'scorer',
  stage: 'stage',
  source: 'source',
  screen: 'screen_verdict',
  band: 'band',
  event: 'event',
  conversation: 'conversation_id'
};

// Shared-filter dimensions every grain applies, even when the derived lens
// list for that grain differs. Used only to avoid a false "not applied".
const SHARED_DIMENSIONS = new Set(['repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id']);

export function legendFocusFilter(detail = {}, { series = [] } = {}) {
  const key = String(detail.key ?? '');
  const item = series.find(entry => entry.key === key || entry.name === key) || null;
  if (item) {
    if (!item.lens) return null;
    const lens = LEGEND_LENS[item.lens] || item.lens;
    const at = key.indexOf(':');
    const value = at > 0 && key.slice(0, at) === item.lens ? key.slice(at + 1) : key;
    if (!value) return null;
    return { filter: lens, value };
  }
  if (detail.filter && detail.value !== null && detail.value !== undefined && detail.value !== '') {
    return { filter: detail.filter, value: String(detail.value) };
  }
  const at = key.indexOf(':');
  if (at > 0) {
    const mapped = LEGEND_LENS[key.slice(0, at)];
    if (mapped) return { filter: mapped, value: key.slice(at + 1) };
  }
  return null;
}

export function unmappedFocusLabel(key) {
  return `not applied here: ${key}`;
}

export function filterApplies(key, { schema = null, grain = '', ignoredFilters = [] } = {}) {
  if ((ignoredFilters || []).includes(key)) return false;
  const grainEntry = schema?.grains?.[grain];
  const filters = grainEntry?.filters;
  if (!Array.isArray(filters)) return true;
  return filters.includes(key) || SHARED_DIMENSIONS.has(key);
}

function windowLabel(state) {
  if (state.from || state.to) return `${state.from || 'start'} → ${state.to || 'now'}`;
  return `window ${state.win || '30d'}`;
}

function cohortLabel(slot, text) {
  const definition = decodeCohort(text);
  const grain = definition?.grain ? ` · ${definition.grain}` : '';
  return `cohort ${slot}${grain}`;
}

function splitExclude(value) {
  const text = String(value || '');
  const at = text.indexOf(':');
  return at === -1 ? { lens: 'exclude', value: text } : { lens: text.slice(0, at), value: text.slice(at + 1) };
}

export function chipModel({ state = {}, schema = null, grain = '', ignoredFilters = [], unmapped = '' } = {}) {
  const chips = [];
  chips.push({ kind: 'scope', key: 'window', label: windowLabel(state), removable: true });
  if (state.tz) chips.push({ kind: 'scope', key: 'tz', value: state.tz, label: `tz ${state.tz}`, removable: true });
  for (const [key, values] of Object.entries(state.filters || {})) {
    const applied = filterApplies(key, { schema, grain, ignoredFilters });
    for (const value of values || []) {
      chips.push({ kind: 'filter', key, value, label: `${key}: ${value}`, applied, removable: true });
    }
  }
  for (const value of state.exclude || []) {
    const { lens } = splitExclude(value);
    chips.push({ kind: 'exclude', key: lens, value, label: `exclude ${value}`, applied: true, removable: true });
  }
  for (const [key, text] of Object.entries(state.cohorts || {})) {
    if (!text) continue;
    chips.push({ kind: 'cohort', key, slot: key.slice(1).toUpperCase(), value: text, label: cohortLabel(key.slice(1).toUpperCase(), text), applied: true, removable: true });
  }
  const pick = decodePick(state.pick);
  const selected = (pick.include || []).length + (pick.exclude || []).length;
  if (selected) chips.push({ kind: 'selection', key: 'pick', value: state.pick, label: `selection (${selected} ${selected === 1 ? 'mark' : 'marks'})`, applied: true, removable: true });
  if (unmapped) chips.push({ kind: 'unmapped', key: unmapped, label: unmappedFocusLabel(unmapped), applied: false, removable: false });
  return chips;
}

function copyState(state) {
  return {
    ...state,
    filters: Object.fromEntries(Object.entries(state.filters || {}).map(([key, values]) => [key, [...(values || [])]])),
    cohorts: { ...(state.cohorts || {}) },
    exclude: [...(state.exclude || [])]
  };
}

export function removeFilterChip(state, key, value) {
  const next = copyState(state);
  if (!next.filters[key]) return next;
  next.filters[key] = next.filters[key].filter(item => String(item) !== String(value));
  if (!next.filters[key].length) delete next.filters[key];
  return next;
}

export function addFilterChip(state, key, value) {
  const next = copyState(state);
  const values = new Set(next.filters[key] || []);
  values.add(String(value));
  next.filters[key] = [...values].sort();
  return next;
}

export function removeExcludeChip(state, value) {
  const next = copyState(state);
  next.exclude = next.exclude.filter(item => item !== value);
  return next;
}

export function removeCohortChip(state, key) {
  const next = copyState(state);
  next.cohorts[key] = '';
  return next;
}

export function removeScopeChip(state, key) {
  const next = copyState(state);
  if (key === 'window') { next.win = '30d'; next.from = ''; next.to = ''; }
  else if (key === 'from' || key === 'to') { next.win = '30d'; next.from = ''; next.to = ''; }
  else if (key === 'tz') next.tz = '';
  return next;
}

export function withPick(state, pick) {
  return { ...copyState(state), pick: pick || '' };
}

export function stateUrl(state, search = '', path = '') {
  const query = encodeUrlState(state, search).toString();
  return query ? `${path || ''}?${query}` : (path || '');
}

function removeChip(state, chip) {
  if (chip.kind === 'filter') return removeFilterChip(state, chip.key, chip.value);
  if (chip.kind === 'exclude') return removeExcludeChip(state, chip.value);
  if (chip.kind === 'cohort') return removeCohortChip(state, chip.key);
  return removeScopeChip(state, chip.key);
}

export function createChips({ doc = globalThis.document, router, path = '/' } = {}) {
  const element = doc.createElement('div');
  element.className = 'workspace-chips';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Applied scope');
  let context = {};

  function update(next = {}) {
    context = next;
    render();
  }

  function render() {
    element.replaceChildren();
    const model = chipModel(context);
    for (const chip of model) {
      const node = doc.createElement('span');
      node.className = 'workspace-chip';
      node.dataset.kind = chip.kind;
      if (chip.applied === false) node.dataset.applied = 'false';
      if (chip.slot) node.dataset.slot = chip.slot;
      if (chip.kind === 'cohort') node.style.setProperty('--chip-colour', `var(--yk-cohort-${chip.slot.toLowerCase()})`);
      node.append(doc.createTextNode(chip.label));
      if (chip.removable) {
        const remove = doc.createElement('button');
        remove.type = 'button';
        remove.className = 'workspace-chip-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `Remove ${chip.label}`);
        remove.addEventListener('click', () => {
          if (chip.kind === 'selection') { context.onClearSelection?.(); return; }
          const next = removeChip(context.state || {}, chip);
          router?.pushScope(stateUrl(next, context.search || '', path));
        });
        node.append(remove);
      }
      element.append(node);
    }
  }

  return { element, update };
}

// C11 Advanced scope rows. The window and tenant are never rows here: they are
// committed controls, not removable advanced predicates.
export function advancedScopeRows(state = {}) {
  const rows = [];
  for (const [key, values] of Object.entries(state.filters || {})) {
    for (const value of values || []) rows.push({ kind: 'filter', key, value, name: key, label: `${key}: ${value}` });
  }
  for (const value of state.exclude || []) {
    const { lens } = splitExclude(value);
    rows.push({ kind: 'exclude', key: lens, value, name: 'exclude', label: `exclude ${value}` });
  }
  for (const [key, text] of Object.entries(state.cohorts || {})) {
    if (!text) continue;
    const slot = key.slice(1).toUpperCase();
    rows.push({ kind: 'cohort', key, value: text, name: `cohort ${slot}`, label: cohortLabel(slot, text) });
  }
  if (state.cmp && state.cmp !== 'off') rows.push({ kind: 'cmp', key: 'cmp', value: state.cmp, name: 'compare', label: `compare ${state.cmp}` });
  if (state.pick) rows.push({ kind: 'pick', key: 'pick', value: state.pick, name: 'selection', label: 'selection' });
  return rows;
}

// Remove exactly one repeated include/exclude/ca..cd key. The window, timezone
// and all other advanced URL state survive.
export function removeAdvancedRow(state, row = {}) {
  if (row.kind === 'filter') return removeFilterChip(state, row.key, row.value);
  if (row.kind === 'exclude') return removeExcludeChip(state, row.value);
  if (row.kind === 'cohort') return removeCohortChip(state, row.key);
  const next = copyState(state);
  if (row.kind === 'cmp') next.cmp = 'off';
  if (row.kind === 'pick') next.pick = '';
  return next;
}

// C7 Reset filters: canonical defaults plus tenant, timezone and panel specs.
export function resetScopeState(state = {}) {
  return {
    ...copyState(state),
    win: '30d', from: '', to: '', filters: {}, exclude: [],
    cohorts: { ca: '', cb: '', cc: '', cd: '' }, pick: '', sel: '', hide: [], cmp: 'off'
  };
}
