// `/plans` explorer: a server-sorted, cursor-paged ranked table of plans plus
// the delivered `scatter-plan` panel over the same scope. One plan identity is
// `(repo_id, plan)`; inspect opens the plan inspector, a scatter rectangle
// becomes a typed plan cohort in the shared tray. It adds no route, grain, join,
// chart type or gesture, and reuses the shared frame, chips, tray and inspector.

import { decodeUrlState } from '../../contract/url-state.js';
import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { rememberedTenant } from '../../contract/session-gate.js';
import { createPanelFrame } from '../panels/panel-frame.js';
import { hasPanel, registerPanel } from '../panels/registry.js';
import { addFilterChip, createChips, stateUrl } from '../core/chips.js';
import { createSelectionTray } from '../core/selection-tray.js';
import { createInspector } from '../core/inspector.js';
import { decodeCohort, encodeCohort } from '../core/selection-model.js';
import { cancelledState, emptyCauses, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatNumber, formatPercent } from '../charts/formatters.js';
import { resolveWindow } from '../panels/ledger-table.js';
import { SCATTER_PLAN_PANEL, planDestination, planIdentity, planOverlap } from '../panels/scatter-plan.js';
import { canonicalRowKey } from '../panels/scatter-shared.js';

export const title = 'Plans';
export const phase = 12;

export const PLAN_MEASURES = [
  'artifacts', 'versions', 'sessions', 'shared_sessions', 'associated_cost_usd', 'unpriced_calls',
  'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
  'span_days', 'first_ts', 'last_ts'
];

export const PLAN_FILTERS = ['repo_id', 'harness', 'session_model', 'id'];
export const DEFAULT_SORT = 'last_ts:desc';

export const PLANS_LIST_PANEL = {
  id: 'plans-list',
  title: 'Plans',
  grain: 'plan',
  measures: PLAN_MEASURES,
  lenses: PLAN_FILTERS,
  charts: [],
  table: true,
  requires: ['entities_plan'],
  caveats: 'Server-sorted, cursor-paged plan list. Measures are in-window; associated cost is a sum of associated sessions and is non-additive across plans. Null measures are counted, never zero-filled.',
  measureBasis: 'in-window artifact facts; associated sessions aggregate inside the applied window; totals come from the server population, never a returned page'
};

const scheduler = createScheduler();
const transport = createTransport(scheduler);

let stylesLoaded = false;
export function ensurePlansStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/plans.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/plans.css';
  doc.head?.append(link);
}

// `sort` is not a shared-filter key, so decodeUrlState keeps it under `unknown`.
export function parseSort(raw, allowed = PLAN_MEASURES) {
  const text = String(raw || '');
  const at = text.lastIndexOf(':');
  const measure = at === -1 ? text : text.slice(0, at);
  const dir = at === -1 ? '' : text.slice(at + 1);
  const fallback = allowed.includes('last_ts') ? 'last_ts' : (allowed[0] || 'last_ts');
  if (!text) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  if (!allowed.includes(measure)) return { measure: fallback, dir: 'desc', raw: `${fallback}:desc` };
  const direction = dir === 'asc' ? 'asc' : 'desc';
  return { measure, dir: direction, raw: `${measure}:${direction}` };
}

export function allowedMeasures(schema) {
  const published = schema?.grains?.plan?.measures;
  if (!Array.isArray(published) || !published.length) return PLAN_MEASURES.slice();
  const filtered = published.filter(name => typeof name === 'string' && name && name !== 'id');
  return filtered.length ? filtered : PLAN_MEASURES.slice();
}

export function allowedFilters(schema) {
  const published = schema?.grains?.plan?.filters;
  if (!Array.isArray(published) || !published.length) return PLAN_FILTERS.slice();
  const filtered = published.filter(name => typeof name === 'string' && name);
  return filtered.length ? filtered : PLAN_FILTERS.slice();
}

// Plan-specific filter names are not all in the shared FILTERS set (notably
// `session_model`), so the URL codec keeps them under `unknown`. Fold only
// declared names into `filters` so the builder, chips and tray see one scope.
export function readScope(state = {}, filters = PLAN_FILTERS) {
  const merged = { ...state, filters: { ...(state.filters || {}) }, unknown: { ...(state.unknown || {}) } };
  for (const key of filters) {
    const values = merged.unknown[key];
    if (!Array.isArray(values) || !values.length) continue;
    merged.filters[key] = [...(merged.filters[key] || []), ...values];
    delete merged.unknown[key];
  }
  return merged;
}

function lensOf(raw) {
  const text = String(raw || '');
  const at = text.indexOf(':');
  return at === -1 ? '' : text.slice(0, at);
}

export function unappliedFilter(state = {}, filters = PLAN_FILTERS) {
  const declared = new Set(filters);
  for (const key of Object.keys(state.filters || {})) if (!declared.has(key)) return key;
  for (const raw of state.exclude || []) {
    const lens = lensOf(raw);
    if (lens && !declared.has(lens)) return lens;
  }
  for (const key of Object.keys(state.unknown || {})) if (key !== 'sort') return key;
  return '';
}

// The first valid cohort slot in A-D order, canonicalised. A malformed slot is
// never put on the wire and is named by the caller.
export function cohortParam(scope = {}) {
  for (const key of ['ca', 'cb', 'cc', 'cd']) {
    const text = scope.cohorts?.[key];
    if (!text) continue;
    const cohort = decodeCohort(text);
    if (cohort) return encodeCohort(cohort);
  }
  return '';
}

// Only contract filter names, the frozen window, sort, paging and the first
// valid cohort are sent.
export function planListParams({ state = {}, filters = PLAN_FILTERS, measures = PLAN_MEASURES, sort = DEFAULT_SORT, limit = null, cursor = '', now = Date.now() } = {}) {
  const scope = readScope(state, filters);
  const params = new URLSearchParams();
  const window = resolveWindow(scope, now);
  if (window.all) params.set('all', '1');
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  const tz = scope.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  params.set('tz', tz);
  params.set('grain', 'plan');
  for (const key of filters) {
    for (const value of scope.filters?.[key] || []) params.append(key, value);
  }
  for (const raw of scope.exclude || []) {
    const lens = lensOf(raw);
    if (filters.includes(lens)) params.append('exclude', raw);
  }
  const cohort = cohortParam(scope);
  if (cohort) params.set('cohort', cohort);
  params.set('sort', parseSort(sort, measures).raw);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function planPageParams(base, { cursor = '', limit = null } = {}) {
  const params = new URLSearchParams(base);
  if (cursor) params.set('cursor', cursor);
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  return params;
}

export function planRowKey(row = {}) {
  return canonicalRowKey(row.id, 'plan');
}

// A plan row is well formed only when its composite id names both repo and plan.
// A malformed id is an error row, never a silent skip.
export function isMalformedPlanRow(row = {}) {
  const id = row && typeof row.id === 'object' && row.id ? row.id : null;
  return !id || typeof id.repo_id !== 'string' || !id.repo_id || typeof id.plan !== 'string' || !id.plan;
}

export function identityFromKey(key = '') {
  try {
    const parsed = JSON.parse(String(key || ''));
    if (parsed && typeof parsed === 'object') return { repo_id: parsed.repo_id ?? '', plan: parsed.plan ?? '' };
  } catch { /* an opaque key is not a plan identity */ }
  return { repo_id: '', plan: '' };
}

export function mapPlanListResponse({ status = 0, body = null } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (!status) return errorState({ message: 'The server did not answer.', code: '' });
  if (status === 404) {
    return unsupportedState({
      feature: '/entities?grain=plan', reason: 'this server does not serve it', source: 'the analytics server',
      nearest: 'the workflow board over the same window'
    });
  }
  if (status >= 400) return errorState({ message: payload.error || `The server returned ${status}.`, code: payload.code || String(status) });
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const next = typeof payload.next === 'string' && payload.next ? payload.next : null;
  const population = payload.population && typeof payload.population === 'object' ? payload.population : null;
  if (!rows.length) return emptyState([]);
  return { state: 'ready', rows, next, population, basis: 'in-window artifact facts; associated sessions aggregate inside the applied window; totals come from the server population, never a page' };
}

export function mergePlanRows(existing = [], incoming = []) {
  const rows = [...existing];
  const seen = new Set(rows.map(row => planRowKey(row)));
  let added = 0;
  for (const row of incoming) {
    const key = planRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
    added += 1;
  }
  return { rows, added };
}

export function formatPlanCost(row = {}) {
  const m = row.m || {};
  const flags = row.flags || {};
  if (flags.associated_cost_null_reason === 'all_unpriced') return 'unpriced (all calls)';
  if (m.associated_cost_usd === null || m.associated_cost_usd === undefined) return 'unpriced';
  const number = Number(m.associated_cost_usd);
  if (!Number.isFinite(number)) return 'unpriced';
  const unpriced = Number(m.unpriced_calls) || 0;
  const lower = flags.associated_cost_lower_bound || unpriced > 0;
  return lower ? `$${number.toFixed(2)} (lower bound; ${formatNumber(unpriced)} unpriced)` : `$${number.toFixed(2)}`;
}

export function completeShareText(row = {}) {
  const m = row.m || {};
  if (m.complete_share === null || m.complete_share === undefined) {
    const reason = row.flags?.complete_share_null_reason;
    return reason === 'no_executions' || !reason ? 'no executions' : String(reason).replace(/_/g, ' ');
  }
  const value = Number(m.complete_share);
  return Number.isFinite(value) ? formatPercent(value) : '—';
}

export function executionShapeText(row = {}) {
  const m = row.m || {};
  const part = key => (m[key] === null || m[key] === undefined ? '—' : formatNumber(Number(m[key]) || 0));
  return `${part('executions_complete')} / ${part('executions_unreported')} / ${part('executions_started')}`;
}

// The plan list carries `design_score:<check>` measures but not the artifact
// grain's per-check scorer; each score is shown with its check name.
export function designScoreText(row = {}) {
  const m = row.m || {};
  const parts = Object.keys(m)
    .filter(name => name.startsWith('design_score:'))
    .sort()
    .map(name => {
      const value = m[name];
      if (value === null || value === undefined) return `${name.slice('design_score:'.length)} —`;
      return `${name.slice('design_score:'.length)} ${Number(value).toFixed(2)}`;
    });
  if (!parts.length) return '—';
  return `${parts.join(', ')} (scorer not served on plan rows)`;
}

export function populationText(population, rows = []) {
  const page = Number(population?.returned_n ?? rows.length);
  const loaded = rows.length;
  const scope = Number(population?.scope_n ?? page);
  const unit = population?.unit || 'plan';
  const plural = scope === 1 ? '' : 's';
  if (loaded > page) {
    return `${formatNumber(loaded)} loaded; ${formatNumber(page)} on this page; ${formatNumber(scope)} ${unit}${plural} total`;
  }
  return `${formatNumber(page)} of ${formatNumber(scope)} ${unit}${plural} shown`;
}

// Counts and flags describe the rows on screen only; never a total.
export function planCoverageNotes({ population = null, rows = [] } = {}) {
  const notes = [];
  for (const [reason, count] of Object.entries(population?.missing_by_reason || {})) {
    notes.push(`${formatNumber(Number(count) || 0)} ${String(reason).replace(/_/g, ' ')}`);
  }
  const allUnpriced = rows.filter(row => row.flags?.associated_cost_null_reason === 'all_unpriced' || row.m?.associated_cost_usd === null).length;
  const lowerBound = rows.filter(row => row.flags?.associated_cost_lower_bound).length;
  const shared = rows.filter(row => Number(row.m?.shared_sessions || 0) > 0).length;
  if (allUnpriced) notes.push(`${formatNumber(allUnpriced)} shown all-unpriced`);
  if (lowerBound) notes.push(`${formatNumber(lowerBound)} shown lower-bound`);
  if (shared) notes.push(`${formatNumber(shared)} shown sharing a session with another plan`);
  return notes;
}

// The plan scatter spec is the delivered panel's canonical configuration. The
// same `scatter-plan` panel is mounted, never a second implementation.
export function planScatterSpec() {
  return {
    grain: 'plan',
    measures: ['associated_cost_usd', 'artifacts'],
    split: 'repo_id',
    chart: 'scatter',
    scope: { x: 'associated_cost_usd', y: 'artifacts', colour: 'repo_id' }
  };
}

export function scatterSampleNote(body = {}) {
  if (body.sampled !== true) return '';
  const returned = Number(body.returned_n ?? (body.rows || []).length);
  const population = Number(body.population_n ?? body.population?.scope_n ?? returned);
  return `sample of ${formatNumber(returned)} of ${formatNumber(population)}; marginals are the whole population`;
}

// Window, lenses, excludes and the first bound cohort, flattened for the
// delivery panel's shared request seam.
export function flatScope(state = {}) {
  const scope = {};
  for (const key of ['win', 'from', 'to', 'tz']) if (state[key]) scope[key] = state[key];
  for (const [key, values] of Object.entries(state.filters || {})) if (values?.length) scope[key] = values;
  if (state.exclude?.length) scope.exclude = state.exclude;
  const cohorts = Object.fromEntries(Object.entries(state.cohorts || {}).filter(([, value]) => value));
  if (Object.keys(cohorts).length) scope.cohorts = cohorts;
  return scope;
}

function routeAdapter() {
  const navigate = url => {
    globalThis.history.pushState(null, '', url);
    globalThis.dispatchEvent(new PopStateEvent('popstate'));
  };
  return { push: navigate, pushScope: navigate, replaceTransient: url => globalThis.history.replaceState(null, '', url) };
}

function pushSort(measure, dir) {
  const params = new URLSearchParams(globalThis.location?.search || '');
  params.set('sort', `${measure}:${dir}`);
  globalThis.history.pushState(null, '', `${globalThis.location.pathname}?${params.toString()}`);
  globalThis.dispatchEvent(new PopStateEvent('popstate'));
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function cellText(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function register() {
  if (!hasPanel(PLANS_LIST_PANEL.id)) registerPanel(PLANS_LIST_PANEL);
}

const COLUMNS = [
  { key: 'associated_cost_usd', label: 'Associated cost' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'shared_sessions', label: 'Shared sessions' },
  { key: 'artifacts', label: 'Artifacts' },
  { key: 'versions', label: 'Versions' },
  { key: 'executions', label: 'Exec / unreported / started' },
  { key: 'complete_share', label: 'Complete share' },
  { key: 'design_score', label: 'Latest design score(s)' },
  { key: 'last_ts', label: 'Last observed' }
];

function columnText(row, key) {
  const m = row.m || {};
  if (key === 'associated_cost_usd') return formatPlanCost(row);
  if (key === 'executions') return executionShapeText(row);
  if (key === 'complete_share') return completeShareText(row);
  if (key === 'design_score') return designScoreText(row);
  return cellText(m[key]);
}

function renderPlanTable(container, { rows = [], doc = globalThis.document, onInspect, onOpen } = {}) {
  container.replaceChildren();
  const table = doc.createElement('table');
  table.className = 'plans-table';
  table.append(el(doc, 'caption', '', `Plans, ${formatNumber(rows.length)} rows shown. Identity is repo/plan; open one for its detail.`));
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const label of ['Plan', ...COLUMNS.map(column => column.label), 'Open']) {
    const th = el(doc, 'th', '', label); th.scope = 'col'; head.append(th);
  }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  tbody.className = 'plans-body';
  for (const row of rows) {
    const key = planRowKey(row);
    const malformed = isMalformedPlanRow(row);
    const identity = planIdentity(row);
    const tr = doc.createElement('tr');
    tr.className = 'plan-row';
    tr.dataset.entityKey = key;
    tr.dataset.planIdentity = `${identity.repo_id}/${identity.plan}`;
    tr.tabIndex = 0;
    if (malformed) tr.dataset.malformed = 'true';
    tr.append(el(doc, 'td', 'plans-id', malformed ? 'invalid plan identity' : `${identity.repo_id}/${identity.plan}`));
    for (const column of COLUMNS) {
      const td = el(doc, 'td', 'numeric', malformed ? '—' : columnText(row, column.key));
      td.dataset.key = column.key;
      tr.append(td);
    }
    const openCell = el(doc, 'td', 'plans-open-cell');
    if (!malformed) {
      const open = el(doc, 'button', 'plan-open', 'Open');
      open.type = 'button';
      open.addEventListener('click', event => { event.stopPropagation(); onOpen?.(row); });
      openCell.append(open);
    } else {
      openCell.append(doc.createTextNode('—'));
    }
    tr.append(openCell);
    tr.addEventListener('click', event => {
      if (malformed || event.target.closest('input,button,a')) return;
      onInspect?.(row, tr);
    });
    tr.addEventListener('keydown', event => {
      if (malformed) return;
      if (event.key === 'Enter') { event.preventDefault(); onInspect?.(row, tr); }
      else if (event.key === 'o' || event.key === 'O') { event.preventDefault(); onOpen?.(row); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const all = [...tbody.querySelectorAll('.plan-row:not([data-malformed])')];
        const at = all.indexOf(tr);
        all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }
    });
    tbody.append(tr);
  }
  table.append(thead, tbody);
  container.append(table);
  return container;
}

function listCauses(scope, push) {
  const filters = [];
  for (const [key, values] of Object.entries(scope.filters || {})) {
    for (const value of values || []) {
      filters.push({
        key, label: `${key}: ${value}`,
        clear: () => {
          const next = { ...scope, filters: { ...(scope.filters || {}) } };
          next.filters[key] = (next.filters[key] || []).filter(item => item !== value);
          if (!next.filters[key].length) delete next.filters[key];
          push(stateUrl(next, '', '/plans'));
        }
      });
    }
  }
  return emptyCauses({ filters });
}

export function render(root, doc = globalThis.document, { signal } = {}) {
  ensurePlansStyles(doc);
  register();
  root.replaceChildren();
  root.append(el(doc, 'h1', '', title));
  root.append(el(doc, 'p', 'plans-intro', 'Plans sorted by any published plan measure, paged by the server cursor, beside the delivered plan scatter over the same scope. Totals come from the server population, never a partial page; associated cost is a sum of associated sessions and is non-additive across plans.'));

  const router = routeAdapter();
  const state = readScope(decodeUrlState(globalThis.location?.search || ''));
  const frame = createPanelFrame({ panel: PLANS_LIST_PANEL, scope: state, transport, scheduler, doc });
  frame.element.dataset.chart = 'table';
  frame.setBasis(PLANS_LIST_PANEL.measureBasis);
  root.append(frame.element);
  const body = frame.element.querySelector('.workspace-panel-body');

  const chips = createChips({ doc, router, path: '/plans' });
  frame.chipSlot.append(chips.element);
  const sortBar = el(doc, 'div', 'plans-sort');
  frame.chooserSlot.append(sortBar);
  const bannerSlot = el(doc, 'div', 'plans-banner-slot');
  frame.chipSlot.append(bannerSlot);
  const notes = el(doc, 'div', 'plans-footer');
  const inspector = createInspector({ doc, router });
  const tray = createSelectionTray({ doc, router, path: '/plans' });
  root.append(tray.element, inspector.element);

  const scatterSection = el(doc, 'section', 'plans-scatter');
  scatterSection.append(el(doc, 'h2', '', 'Associated cost against artifacts'));
  root.append(scatterSection);

  let schema = null;
  let tenant = '';
  let measures = PLAN_MEASURES.slice();
  let filters = PLAN_FILTERS.slice();
  let sort = parseSort(new URLSearchParams(globalThis.location?.search || '').get('sort'), measures);
  let rows = [];
  let population = null;
  let cursor = '';
  let pageLimit = null;
  let base = null;
  let disposed = false;
  let runId = 0;
  let controller = new AbortController();
  let scatterFrame = null;
  let selection = null;
  // The shared scatter request seam sends the FILTER_KEYS it knows; a plan
  // `session_model` lens is not among them, so it is named as not applied to
  // the scatter rather than dropped silently.
  let scatterNote = '';
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  function currentScope() {
    return readScope(decodeUrlState(globalThis.location?.search || ''), filters);
  }

  function selectedPopulation() {
    return { scope_n: population?.scope_n ?? rows.length, eligible_n: population?.eligible_n ?? rows.length, returned_n: rows.length };
  }

  function updateTray() {
    const scope = currentScope();
    tray.update({
      state: scope, pick: null, grain: 'plan', unit: 'plan',
      population: selection?.counts?.scope ? { scope_n: selection.counts.scope, returned_n: rows.length } : selectedPopulation(),
      selection, schema: schema || { grains: { plan: { filters } } },
      search: globalThis.location?.search || '', now: Date.now(),
      onClear: () => { selection = null; updateTray(); }
    });
  }

  function openRow(row) {
    const identity = planIdentity(row);
    if (!identity.repo_id || !identity.plan) return;
    router.push(planDestination(identity));
  }

  function inspectRow(row, opener) {
    const identity = planIdentity(row);
    if (!identity.repo_id || !identity.plan) return;
    const m = row.m || {};
    inspector.open({
      grain: 'plan', key: planRowKey(row),
      title: `Plan ${identity.repo_id}/${identity.plan}`,
      facts: [
        { label: 'Repo', value: identity.repo_id },
        { label: 'Plan', value: identity.plan },
        { label: 'Harness', value: row.l?.harness },
        { label: 'Session model', value: row.l?.session_model },
        { label: 'Associated cost', value: formatPlanCost(row) },
        { label: 'Sessions', value: m.sessions },
        { label: 'Shared sessions', value: m.shared_sessions },
        { label: 'Artifacts', value: m.artifacts },
        { label: 'Versions', value: m.versions },
        { label: 'Executions complete / unreported / started', value: executionShapeText(row) },
        { label: 'Complete share', value: completeShareText(row) },
        { label: 'Latest design score(s)', value: designScoreText(row) },
        { label: 'Last observed (epoch s)', value: m.last_ts }
      ],
      destination: planDestination(identity),
      unit: 'plan', population: selectedPopulation(), opener: opener || null, url: globalThis.location?.href || ''
    });
  }

  function show() {
    renderPlanTable(body, { rows, doc, onInspect: inspectRow, onOpen: openRow });
    notes.replaceChildren();
    notes.append(el(doc, 'p', 'plans-population', populationText(population, rows)));
    const coverage = planCoverageNotes({ population, rows });
    if (coverage.length) notes.append(el(doc, 'p', 'plans-coverage', coverage.join(' · ')));
    notes.append(el(doc, 'p', 'plans-note', cursor ? 'More plans remain; use Load more.' : 'End of the server result.'));
    body.append(notes);
    if (cursor) {
      const more = el(doc, 'button', 'plans-load-more', 'Load more');
      more.type = 'button';
      more.addEventListener('click', () => { more.disabled = true; loadMore(); });
      body.append(more);
    }
    paintBanner();
  }

  function paintBanner() {
    bannerSlot.replaceChildren();
    if (sort.measure !== 'associated_cost_usd') return;
    const banner = el(doc, 'p', 'plans-overlap-banner', planOverlap(rows).text);
    banner.setAttribute('role', 'note');
    bannerSlot.append(banner);
  }

  function renderSort() {
    sortBar.replaceChildren();
    sortBar.append(el(doc, 'span', 'plans-sort-label', 'Sort by'));
    const measure = doc.createElement('select');
    measure.className = 'plans-sort-measure';
    measure.setAttribute('aria-label', 'Sort measure');
    for (const name of measures) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = name === 'associated_cost_usd' ? 'by associated cost' : name;
      option.selected = name === sort.measure;
      measure.append(option);
    }
    measure.addEventListener('change', () => pushSort(measure.value, sort.dir));
    const direction = doc.createElement('select');
    direction.className = 'plans-sort-direction';
    direction.setAttribute('aria-label', 'Sort direction');
    for (const value of ['desc', 'asc']) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === sort.dir;
      direction.append(option);
    }
    direction.addEventListener('change', () => pushSort(sort.measure, direction.value));
    sortBar.append(measure, direction);
    sortBar.append(el(doc, 'span', 'plans-sort-current', `server sort: ${sort.raw}`));
  }

  function mountScatter() {
    const scope = currentScope();
    if (scope.filters?.session_model?.length) scatterNote = 'session_model is not applied here: the shared plan scatter request seam carries repo_id, harness, excludes and cohort only.';
    if (schema?.features && schema.features.entities_plan === false) {
      scatterSection.append(el(doc, 'p', 'plans-scatter-unsupported', 'scatter-plan is not supported (not advertised by this server). Supplied by Plan 20 Phase 6 entities_plan.'));
      return;
    }
    if (scatterNote) scatterSection.append(el(doc, 'p', 'plans-scatter-not-applied', scatterNote));
    scatterFrame = createPanelFrame({
      panel: SCATTER_PLAN_PANEL, spec: planScatterSpec(), scope: flatScope(scope),
      transport, scheduler, tenant, schema, doc
    });
    scatterSection.append(scatterFrame.element);
    scatterFrame.element.addEventListener('inspect', event => {
      const detail = event.detail || {};
      const entity = event.target?.spec?.entities?.[detail.key] || null;
      const identity = entity?.identity || identityFromKey(detail.key);
      if (!identity.repo_id || !identity.plan) return;
      const values = detail.values || {};
      const value = name => (values[name] === null || values[name] === undefined ? '—' : values[name]);
      inspector.open({
        grain: 'plan', key: detail.key,
        title: `Plan ${identity.repo_id}/${identity.plan}`,
        facts: [
          { label: 'Repo', value: identity.repo_id },
          { label: 'Plan', value: identity.plan },
          { label: 'Associated cost', value: formatPlanCost({ m: values, flags: { associated_cost_lower_bound: Number(values.unpriced_calls) > 0 } }) },
          { label: 'Artifacts', value: value('artifacts') },
          { label: 'Versions', value: value('versions') },
          { label: 'Sessions', value: value('sessions') },
          { label: 'Shared sessions', value: value('shared_sessions') },
          { label: 'Unpriced calls', value: value('unpriced_calls') }
        ],
        destination: entity?.destination || planDestination(identity),
        unit: 'plan', population: selectedPopulation(),
        selection, opener: event.target, url: globalThis.location?.href || ''
      });
    });
    scatterFrame.element.addEventListener('select', event => {
      const detail = event.detail || {};
      const next = detail.selection || null;
      // The raw rectangle has no exact count yet; use the re-emitted predicate
      // with its server counts, and never expand sampled marks into identities.
      if (detail.source === 'scatter-rectangle' || !next || !next.predicate) return;
      selection = next;
      updateTray();
    });
    scatterFrame.load().catch(() => {});
  }

  async function firstPage() {
    const id = ++runId;
    controller.abort();
    controller = new AbortController();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', () => controller.abort(), { once: true });
    frame.setState('loading', { inFlight: 1 });
    base = planListParams({ state: currentScope(), filters, measures, sort: sort.raw, limit: pageLimit });
    try {
      const { response, body: payload } = await transport.get('entities', base, { tenant, signal: controller.signal, stateKey: 'plans' });
      if (disposed || id !== runId) return;
      const result = mapPlanListResponse({ status: response.status, body: payload });
      if (result.state === 'ready') {
        rows = result.rows;
        population = result.population;
        cursor = result.next || '';
        frame.setState('ready', {});
        frame.setPopulation(population);
        show();
      } else if (result.state === 'empty') {
        rows = []; population = null; cursor = '';
        body.replaceChildren(); notes.replaceChildren();
        frame.setState('empty', { causes: listCauses(currentScope(), url => router.pushScope(url)) });
      } else {
        result.retry = firstPage;
        body.replaceChildren();
        frame.setState(result.state, result);
      }
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = error?.name === 'AbortError'
        ? cancelledState({ retry: firstPage })
        : errorState({ message: error?.message || 'The plans request failed.', retry: firstPage });
      frame.setState(result.state, result);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    const id = ++runId;
    frame.setState('loading', { inFlight: 1 });
    try {
      const { response, body: payload } = await transport.get('entities', planPageParams(base, { cursor, limit: pageLimit }), { signal: controller.signal, stateKey: 'plans' });
      if (disposed || id !== runId) return;
      const result = mapPlanListResponse({ status: response.status, body: payload });
      if (result.state !== 'ready') { result.retry = loadMore; frame.setState(result.state, result); return; }
      rows = mergePlanRows(rows, result.rows).rows;
      population = result.population || population;
      cursor = result.next || '';
      frame.setState('ready', {});
      frame.setPopulation(population);
      show();
    } catch (error) {
      if (disposed || id !== runId) return;
      const result = error?.name === 'AbortError'
        ? cancelledState({ retry: loadMore })
        : errorState({ message: error?.message || 'The next page failed.', retry: loadMore });
      frame.setState(result.state, result);
    }
  }

  function paintScope() {
    const scope = currentScope();
    chips.update({ state: scope, search: '', schema: schema || { grains: { plan: { filters } } }, grain: 'plan', unmapped: unappliedFilter(scope, filters) });
    renderSort();
    paintBanner();
  }

  async function start() {
    try {
      const me = await transport.request('me', { signal: controller.signal, stateKey: 'plans-me' });
      tenant = rememberedTenant(me?.body || {});
    } catch (error) {
      if (error?.name === 'AbortError') { if (!disposed) frame.setState('cancelled', { retry: start }); return; }
      tenant = '';
    }
    if (disposed) return;
    let body = null;
    try {
      const result = await transport.schema(tenant);
      if (result.response.ok) body = result.body;
    } catch { body = null; }
    if (disposed) return;
    schema = body;
    measures = allowedMeasures(schema);
    filters = allowedFilters(schema);
    sort = parseSort(new URLSearchParams(globalThis.location?.search || '').get('sort'), measures);
    const max = Number(schema?.budgets?.page_max);
    pageLimit = Number.isFinite(max) && max > 0 ? Math.floor(max) : null;
    if (schema?.features && schema.features.entities_plan === false) {
      frame.setState('unsupported', { missing: 'entities_plan', reason: 'not advertised by this server', source: 'Plan 20 Phase 6 (entities_plan)', nearest: 'the workflow board' });
      scatterSection.append(el(doc, 'p', 'plans-scatter-unsupported', 'scatter-plan is not supported (not advertised by this server). Supplied by Plan 20 Phase 6 entities_plan.'));
      return;
    }
    paintScope();
    mountScatter();
    firstPage();
  }

  start();

  return () => { disposed = true; controller.abort(); inspector.destroy(); scatterFrame?.destroy(); };
}

export default { title, phase, render };
