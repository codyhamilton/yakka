// Shared C1–C11 scope controls. One committed scope describes the URL and the
// results; the filter inputs keep a local draft until Apply. Tenant selection is
// mounted by the shell into the identity row and commits immediately.

import { advancedScopeRows, removeAdvancedRow, resetScopeState } from './chips.js';
import { createEventCountStrip } from './event-counts.js';

export const WINDOW_OPTIONS = [
  { value: '1d', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All history' },
  { value: 'custom', label: 'Custom…' }
];

export const KIND_OPTIONS = [
  { value: 'design', label: 'Design' },
  { value: 'brief', label: 'Brief' },
  { value: 'report', label: 'Report' }
];

export const CUSTOM_TIME_ERROR = 'Use an unambiguous time in the selected timezone.';
export const CUSTOM_RANGE_ERROR = 'Enter a start before the end.';

const VALID_WINDOW = /^(?:all|\d+[hdwmy])$/;
const FILTER_FIELDS = ['repo_id', 'kind'];

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function zoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') parts[part.type] = part.value;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(hour), minute: Number(parts.minute), second: Number(parts.second)
  };
}

function wallText(parts, withSeconds = false) {
  const pad = value => String(value).padStart(2, '0');
  const base = `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  return withSeconds ? `${base}:${pad(parts.second)}` : base;
}

export function isoToWallTime(iso, timeZone) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return wallText(zoneParts(date, timeZone || 'UTC'));
}

// Convert a datetime-local wall time in the displayed IANA zone to an absolute
// UTC instant. A nonexistent or ambiguous wall time is rejected rather than
// guessed, so a DST fold never silently maps to another hour.
export function wallTimeToIso(value, timeZone = 'UTC') {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value || ''));
  if (!match) return { error: CUSTOM_RANGE_ERROR };
  const [, y, mo, d, h, mi, s] = match;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0));
  let offset = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const probe = zoneParts(new Date(naive - offset), timeZone);
    const asUtc = Date.UTC(probe.year, probe.month - 1, probe.day, probe.hour, probe.minute, probe.second);
    offset = asUtc - (naive - offset);
  }
  const utc = naive - offset;
  const expected = `${y}-${mo}-${d}T${h}:${mi}`;
  const normalized = value.length > 16 && s ? `${expected}:${s}` : expected;
  const roundTrip = wallText(zoneParts(new Date(utc), timeZone), Boolean(s));
  if (roundTrip !== normalized) return { error: CUSTOM_TIME_ERROR };
  const earlier = wallText(zoneParts(new Date(utc - 3600e3), timeZone), Boolean(s));
  const later = wallText(zoneParts(new Date(utc + 3600e3), timeZone), Boolean(s));
  if (earlier === normalized || later === normalized) return { error: CUSTOM_TIME_ERROR };
  return { iso: new Date(utc).toISOString() };
}

function selectedWin(state) {
  if (state.from || state.to) return 'custom';
  const win = String(state.win || '30d');
  return VALID_WINDOW.test(win) ? win : '30d';
}

export function draftFromState(state = {}) {
  const repo = [...(state.filters?.repo_id || [])];
  const kind = [...(state.filters?.kind || [])];
  return {
    win: selectedWin(state),
    from: state.from ? isoToWallTime(state.from, state.tz || 'UTC') : '',
    to: state.to ? isoToWallTime(state.to, state.tz || 'UTC') : '',
    tz: state.tz || '',
    repo,
    kind
  };
}

function sameDraft(a, b) {
  return a.win === b.win && a.from === b.from && a.to === b.to && a.tz === b.tz
    && a.repo.join('\u001f') === b.repo.join('\u001f')
    && a.kind.join('\u001f') === b.kind.join('\u001f');
}

export function customTimeError(draft = {}) {
  if (draft.win !== 'custom') return '';
  if (!draft.from || !draft.to) return CUSTOM_RANGE_ERROR;
  const from = wallTimeToIso(draft.from, draft.tz || 'UTC');
  const to = wallTimeToIso(draft.to, draft.tz || 'UTC');
  if (from.error || to.error) return CUSTOM_TIME_ERROR;
  if (Date.parse(from.iso) >= Date.parse(to.iso)) return CUSTOM_RANGE_ERROR;
  return '';
}

// Apply only the C2–C5 draft fields. Advanced predicates, panel specs, tenant,
// timezone-independent state and the compare mode survive.
export function commitDraft(state = {}, draft = {}) {
  const next = {
    ...state,
    filters: Object.fromEntries(Object.entries(state.filters || {}).map(([key, values]) => [key, [...(values || [])]])),
    cohorts: { ...(state.cohorts || {}) },
    exclude: [...(state.exclude || [])]
  };
  next.tz = draft.tz || state.tz || '';
  for (const field of FILTER_FIELDS) delete next.filters[field];
  if (draft.repo?.length) next.filters.repo_id = [...draft.repo];
  if (draft.kind?.length) next.filters.kind = [...draft.kind];
  if (draft.win === 'custom') {
    const from = wallTimeToIso(draft.from, next.tz || 'UTC');
    const to = wallTimeToIso(draft.to, next.tz || 'UTC');
    if (from.error || to.error) return { error: from.error || to.error };
    next.from = from.iso;
    next.to = to.iso;
    next.win = '';
  } else {
    next.from = '';
    next.to = '';
    next.win = VALID_WINDOW.test(draft.win) ? draft.win : '30d';
  }
  next.pick = '';
  next.sel = '';
  next.cursors = {};
  return { state: next };
}

export const TIME_OVERRIDE_FIELDS = ['win', 'from', 'to', 'tz', 'repo_id', 'kind', 'tenant'];

function globalOverrideValue(state, field) {
  if (field === 'win') return state.win || '';
  if (field === 'from') return state.from || '';
  if (field === 'to') return state.to || '';
  if (field === 'tz') return state.tz || '';
  if (field === 'tenant') return state.tenant || '';
  const values = state.filters?.[field] || [];
  return values.length === 1 ? values[0] : '';
}

// Panel-local time/repo/tenant/kind overrides may not shadow the visible bar.
// Unambiguous saved overrides are promoted once into the global state; a global
// value always wins. Disagreeing overrides block their panels.
export function panelOverridePlan(state = {}) {
  const promotions = {};
  const conflicts = new Set();
  const panels = Object.entries(state.panelSpecs || {}).filter(([, spec]) => spec?.scope);
  const byField = new Map();
  for (const [key, spec] of panels) {
    for (const field of TIME_OVERRIDE_FIELDS) {
      if (!(field in spec.scope)) continue;
      const value = Array.isArray(spec.scope[field]) ? spec.scope[field].join('\u001f') : String(spec.scope[field]);
      if (!value) continue;
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field).push({ key, value: spec.scope[field] });
    }
  }
  for (const [field, entries] of byField) {
    if (globalOverrideValue(state, field)) continue;
    const distinct = new Set(entries.map(entry => Array.isArray(entry.value) ? entry.value.join('\u001f') : String(entry.value)));
    if (distinct.size === 1) promotions[field] = entries[0].value;
    else entries.forEach(entry => conflicts.add(entry.key));
  }
  return { promotions, conflicts: [...conflicts] };
}

export function applyPromotions(state = {}, promotions = {}) {
  const next = {
    ...state,
    filters: Object.fromEntries(Object.entries(state.filters || {}).map(([key, values]) => [key, [...(values || [])]])),
    cohorts: { ...(state.cohorts || {}) },
    exclude: [...(state.exclude || [])]
  };
  const remove = new Set(Object.keys(promotions).filter(field => field !== 'tenant'));
  const strip = scope => {
    const out = { ...(scope || {}) };
    for (const field of remove) delete out[field];
    return out;
  };
  for (const [field, value] of Object.entries(promotions)) {
    if (field === 'tenant') next.tenant = String(value);
    else if (field === 'win' || field === 'from' || field === 'to' || field === 'tz') next[field] = String(value);
    else next.filters[field] = Array.isArray(value) ? [...value] : [String(value)];
  }
  next.panelSpecs = Object.fromEntries(Object.entries(state.panelSpecs || {}).map(([key, spec]) => [key, { ...spec, scope: strip(spec.scope) }]));
  next.panels = {};
  return next;
}

export function resetPanelScope(state = {}, keys = []) {
  const next = {
    ...state,
    panels: { ...(state.panels || {}) },
    panelSpecs: { ...(state.panelSpecs || {}) }
  };
  for (const key of keys) {
    const spec = state.panelSpecs?.[key];
    if (!spec) continue;
    const scope = { ...(spec.scope || {}) };
    for (const field of TIME_OVERRIDE_FIELDS) delete scope[field];
    next.panelSpecs[key] = { ...spec, scope };
    next.panels[key] = '';
  }
  return next;
}

// Facets describe tenant metadata under the frozen window only: the route
// refuses cohort and never narrows options by filters, excludes, pick or sel.
export function facetsParameters(context = {}) {
  const params = new URLSearchParams();
  const window = context.window || {};
  if (window.all) {
    params.set('all', '1');
    if (window.to) params.set('to', window.to);
  } else {
    if (window.from) params.set('from', window.from);
    if (window.to) params.set('to', window.to);
  }
  params.set('tz', context.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  return params;
}

export function createScopeControls({
  doc = globalThis.document,
  state = {},
  schema = null,
  transport = null,
  readContext = null,
  onCommit = () => {},
  onRefresh = () => {},
  onRetryCounts = null,
  allowRefresh = true,
  facetsFetch = true,
  resetCmp = 'off'
} = {}) {
  let committed = state;
  let draft = draftFromState(state);
  let facets = { state: 'idle', repos: [], kinds: [], error: '' };
  let countPath = '';

  const element = el(doc, 'section', 'scope-controls');
  element.setAttribute('aria-label', 'Filters and counts');

  const form = el(doc, 'form', 'scope-filters');
  form.setAttribute('aria-label', 'Analytics filters');

  const windowLabel = el(doc, 'label', 'scope-field');
  windowLabel.append(doc.createTextNode('Window '));
  const windowSelect = el(doc, 'select');
  windowSelect.name = 'win';
  windowSelect.id = 'scope-window';
  windowSelect.className = 'scope-window-select';
  windowLabel.append(windowSelect);

  const repoLabel = el(doc, 'label', 'scope-field');
  repoLabel.append(doc.createTextNode('Repository '));
  const repoSelect = el(doc, 'select');
  repoSelect.name = 'repo_id';
  repoSelect.id = 'scope-repo';
  repoSelect.className = 'scope-repo-select';
  repoLabel.append(repoSelect);

  const kindLabel = el(doc, 'label', 'scope-field');
  kindLabel.append(doc.createTextNode('Kind '));
  const kindSelect = el(doc, 'select');
  kindSelect.name = 'kind';
  kindSelect.id = 'scope-kind';
  kindSelect.className = 'scope-kind-select';
  kindLabel.append(kindSelect);

  const custom = el(doc, 'span', 'scope-custom');
  custom.hidden = true;
  const fromLabel = el(doc, 'label', 'scope-field');
  fromLabel.append(doc.createTextNode('From '));
  const fromInput = el(doc, 'input');
  fromInput.type = 'datetime-local';
  fromInput.name = 'from';
  fromInput.className = 'scope-from';
  fromLabel.append(fromInput);
  const toLabel = el(doc, 'label', 'scope-field');
  toLabel.append(doc.createTextNode('To '));
  const toInput = el(doc, 'input');
  toInput.type = 'datetime-local';
  toInput.name = 'to';
  toInput.className = 'scope-to';
  toLabel.append(toInput);
  custom.append(fromLabel, toLabel);

  const apply = el(doc, 'button', 'scope-apply', 'Apply filters');
  apply.type = 'submit';
  apply.disabled = true;
  const dirtyNote = el(doc, 'span', 'scope-dirty', 'Unapplied changes');
  dirtyNote.hidden = true;
  const reset = el(doc, 'button', 'scope-reset', 'Reset filters');
  reset.type = 'button';
  const allHistory = el(doc, 'button', 'scope-all', 'All history');
  allHistory.type = 'button';

  const tzLabel = el(doc, 'label', 'scope-field scope-tz');
  tzLabel.append(doc.createTextNode('Timezone '));
  const tzSelect = el(doc, 'select');
  tzSelect.name = 'tz';
  tzSelect.id = 'scope-tz';
  tzSelect.className = 'scope-tz-select';
  tzLabel.append(tzSelect);

  const inlineError = el(doc, 'span', 'scope-error');
  inlineError.setAttribute('role', 'alert');
  form.append(windowLabel, repoLabel, kindLabel, custom, apply, dirtyNote, reset, allHistory, tzLabel, inlineError);

  const status = el(doc, 'div', 'scope-status');
  status.setAttribute('role', 'status');
  const counts = transport && readContext ? createEventCountStrip({
    doc, transport, readContext, allowRefresh, onRetry: onRetryCounts
  }) : null;
  if (counts) status.append(counts.element);
  if (allowRefresh) {
    const refresh = el(doc, 'button', 'scope-refresh', 'Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', () => onRefresh());
    status.append(refresh);
  }
  const advanced = el(doc, 'details', 'scope-advanced');
  advanced.append(el(doc, 'summary', '', 'Advanced scope'));
  const advancedBody = el(doc, 'div', 'scope-advanced-body');
  advanced.append(advancedBody);
  status.append(advanced);
  element.append(form, status);

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zones = new Set([browserZone, 'UTC', 'Australia/Brisbane']);
  if (state.tz) zones.add(state.tz);
  try { for (const zone of Intl.supportedValuesOf?.('timeZone') || []) zones.add(zone); } catch {}
  const zoneList = [...zones].filter(Boolean).sort();

  function facetRepos() {
    const values = committed.filters?.repo_id || [];
    const available = new Set(facets.repos || []);
    return { values, missing: values.filter(value => !available.has(value)) };
  }

  function facetKinds() {
    const values = committed.filters?.kind || [];
    const available = new Set((facets.kinds || []).map(item => String(item).split('\u0000')[0]));
    return { values, missing: values.filter(value => !available.has(value)) };
  }

  function renderWindow() {
    windowSelect.replaceChildren();
    const current = draft.win;
    const known = new Set(WINDOW_OPTIONS.map(option => option.value));
    for (const option of WINDOW_OPTIONS) {
      if (option.value === 'custom') continue;
      const node = el(doc, 'option', '', option.label);
      node.value = option.value;
      node.selected = current === option.value;
      windowSelect.append(node);
    }
    if (current !== 'custom' && !known.has(current) && VALID_WINDOW.test(current)) {
      const node = el(doc, 'option', '', `URL window: ${current}`);
      node.value = current;
      node.selected = true;
      windowSelect.append(node);
    }
    const customOption = el(doc, 'option', '', 'Custom…');
    customOption.value = 'custom';
    customOption.selected = current === 'custom';
    windowSelect.append(customOption);
    custom.hidden = current !== 'custom';
    fromInput.value = draft.from;
    toInput.value = draft.to;
  }

  function renderRepo() {
    repoSelect.replaceChildren();
    const { values, missing } = facetRepos();
    const multiple = values.length > 1 || repoSelect.multiple;
    if (multiple) repoSelect.multiple = true; else repoSelect.removeAttribute('multiple');
    if (!values.length) {
      const node = el(doc, 'option', '', 'All repositories');
      node.value = '';
      node.selected = true;
      repoSelect.append(node);
      if (multiple) repoSelect.multiple = false;
    } else if (!multiple) {
      const all = el(doc, 'option', '', 'All repositories');
      all.value = '';
      repoSelect.append(all);
    }
    const options = [...(facets.state === 'ready' ? facets.repos : []), ...missing];
    for (const value of options) {
      const node = el(doc, 'option', '', facets.state === 'ready' && !missing.includes(value) ? value : `${value} (not in this window)`);
      node.value = value;
      node.selected = values.includes(value);
      repoSelect.append(node);
    }
  }

  function renderKind() {
    kindSelect.replaceChildren();
    const { values, missing } = facetKinds();
    const multiple = values.length > 1;
    if (multiple) kindSelect.multiple = true; else kindSelect.removeAttribute('multiple');
    for (const option of KIND_OPTIONS) {
      const node = el(doc, 'option', '', option.label);
      node.value = option.value;
      node.selected = values.includes(option.value);
      kindSelect.append(node);
    }
    for (const value of missing) {
      if (KIND_OPTIONS.some(option => option.value === value)) continue;
      const node = el(doc, 'option', '', `Unsupported kind: ${value}`);
      node.value = value;
      node.disabled = true;
      node.selected = true;
      kindSelect.append(node);
    }
    // The absent value is always a real option so users can clear a committed
    // kind without resetting the rest of the scope.
    const all = el(doc, 'option', '', 'All kinds');
    all.value = '';
    all.selected = !values.length;
    kindSelect.prepend(all);
  }

  function renderTz() {
    tzSelect.replaceChildren();
    for (const zone of zoneList) {
      const node = el(doc, 'option', '', zone);
      node.value = zone;
      node.selected = (draft.tz || browserZone) === zone;
      tzSelect.append(node);
    }
  }

  function renderAdvanced() {
    advancedBody.replaceChildren();
    const rows = advancedScopeRows(committed);
    if (!rows.length) {
      advancedBody.append(el(doc, 'p', 'muted', 'No advanced filters applied.'));
      return;
    }
    for (const row of rows) {
      const line = el(doc, 'div', 'scope-advanced-row');
      line.append(el(doc, 'span', '', row.label));
      const remove = el(doc, 'button', '', `Remove ${row.name}: ${row.value}`);
      remove.type = 'button';
      remove.addEventListener('click', () => onCommit(removeAdvancedRow(committed, row)));
      line.append(remove);
      advancedBody.append(line);
    }
  }

  function isDirty() {
    return !sameDraft(draft, draftFromState(committed));
  }

  function syncValidity() {
    const problem = customTimeError(draft);
    inlineError.textContent = problem;
    const unsupportedKind = (draft.kind || []).some(value => !KIND_OPTIONS.some(option => option.value === value));
    const dirty = isDirty();
    apply.disabled = !dirty || Boolean(problem) || unsupportedKind;
    dirtyNote.hidden = !dirty;
  }

  function render() {
    renderWindow();
    renderRepo();
    renderKind();
    renderTz();
    renderAdvanced();
    syncValidity();
  }

  function readDraft() {
    draft.win = windowSelect.value;
    draft.from = fromInput.value || '';
    draft.to = toInput.value || '';
    draft.tz = tzSelect.value || '';
    draft.repo = [...repoSelect.selectedOptions].map(option => option.value).filter(Boolean);
    const selectedKinds = [...kindSelect.selectedOptions].filter(option => !option.disabled).map(option => option.value);
    draft.kind = selectedKinds.includes('') ? [] : selectedKinds.filter(Boolean);
    if (draft.kind.length) {
      const all = [...kindSelect.options].find(option => option.value === '');
      if (all) all.selected = false;
    }
    renderWindow();
    syncValidity();
  }

  for (const control of [windowSelect, repoSelect, kindSelect, tzSelect, fromInput, toInput]) {
    control.addEventListener('change', readDraft);
    control.addEventListener('input', readDraft);
  }

  function loadFacets(nextContext = readContext) {
    if (!facetsFetch || !transport || !nextContext) return Promise.resolve();
    const key = `${nextContext.tenant}|${JSON.stringify(nextContext.window)}`;
    countPath = key;
    facets = { state: 'loading', repos: [], kinds: [], error: '' };
    render();
    return transport.get('facets', facetsParameters(nextContext), { tenant: nextContext.tenant })
      .then(({ response, body }) => {
        if (countPath !== key) return;
        if (!response.ok) {
          facets = { state: 'error', repos: [], kinds: [], error: response.status === 403 ? 'Filter options unavailable' : 'Filter options unavailable' };
        } else {
          facets = {
            state: 'ready',
            repos: (body?.repos || []).map(value => typeof value === 'string' ? value : String(value?.name ?? value?.value ?? '')).filter(Boolean),
            kinds: (body?.kinds || []).map(value => typeof value === 'string' ? value : String(value?.name ?? '')).filter(Boolean),
            error: ''
          };
        }
        render();
      })
      .catch(() => {
        if (countPath !== key) return;
        facets = { state: 'error', repos: [], kinds: [], error: 'Filter options unavailable' };
        render();
      });
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    if (apply.disabled) return;
    const result = commitDraft(committed, draft);
    if (result.error) { inlineError.textContent = result.error; return; }
    onCommit(result.state);
  });

  reset.addEventListener('click', () => {
    const next = resetScopeState(committed);
    if (resetCmp) next.cmp = resetCmp;
    onCommit(next);
  });

  allHistory.addEventListener('click', () => {
    onCommit({ ...committed, win: 'all', from: '', to: '' });
  });

  render();

  return {
    element,
    form,
    counts,
    get draft() { return { ...draft }; },
    get facets() { return { ...facets }; },
    focusFilters() { windowSelect.focus?.(); },
    update(nextState = {}, { schema: nextSchema = schema, context = readContext } = {}) {
      committed = nextState;
      draft = draftFromState(nextState);
      render();
      if (counts) counts.update({ readContext: context, schema: nextSchema });
      if (facetsFetch) loadFacets(context);
    },
    destroy() { counts?.destroy?.(); }
  };
}

export default createScopeControls;
