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
import { formatMoney, formatNumber, formatPercent } from '../charts/formatters.js';
import { resolveWindow } from '../panels/ledger-table.js';
import { parseRoute } from '../core/router.js';
import { SCATTER_PLAN_PANEL, planDestination, planIdentity, planOverlap } from '../panels/scatter-plan.js';
import { canonicalRowKey } from '../panels/scatter-shared.js';
import { artifactKind, bandFor, createBaselineCache, fetchArtifactText } from './artifact-content.js';
import { PLAN_TIMELINE_PANEL } from '../panels/plan-timeline.js';

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

// --- Plan detail ---------------------------------------------------------
//
// `/plans/<repo>/<plan>` is one fixed plan identity. It never broadens to
// another plan and never sends `cohort=`. The design's phases and brief paths
// are parsed from stored content in the browser for display only; nothing here
// counts a phase or a brief as a measure or infers completion/review.

export function parsePlanDetailPath(pathname = '') {
  const match = /^\/plans\/([^/]+)\/([^/]+)$/.exec(String(pathname || ''));
  if (!match) return null;
  try {
    const repo_id = decodeURIComponent(match[1]);
    const plan = decodeURIComponent(match[2]);
    return repo_id && plan ? { repo_id, plan } : null;
  } catch { return null; }
}

function windowParams(state = {}, now = Date.now()) {
  const params = new URLSearchParams();
  const window = resolveWindow(state, now);
  if (window.all) params.set('all', '1');
  if (window.from) params.set('from', window.from);
  if (window.to) params.set('to', window.to);
  params.set('tz', state.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  return params;
}

function identityParams(identity = {}) {
  const params = new URLSearchParams();
  params.set('repo_id', String(identity.repo_id || ''));
  params.set('plan', String(identity.plan || ''));
  return params;
}

function withPaging(params, { limit = null, cursor = '' } = {}) {
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) params.set('limit', String(Math.floor(Number(limit))));
  if (cursor) params.set('cursor', cursor);
  return params;
}

// The plan row is named by repo and plan, not by position; `plan` is a shared
// filter the entities route applies even though the plan lens contract names
// repo_id/harness/session_model/id.
export function planRowParams(identity = {}, { state = {}, limit = 1 } = {}) {
  const params = windowParams(state);
  params.set('grain', 'plan');
  for (const [key, value] of identityParams(identity)) params.set(key, value);
  return withPaging(params, { limit });
}

export function planArtifactsParams(identity = {}, { state = {}, limit = null, cursor = '' } = {}) {
  const params = windowParams(state);
  params.set('grain', 'artifact');
  for (const [key, value] of identityParams(identity)) params.set(key, value);
  return withPaging(params, { limit, cursor });
}

export function planExecutionsParams(identity = {}, { state = {}, limit = null, cursor = '' } = {}) {
  const params = windowParams(state);
  params.set('grain', 'execution');
  for (const [key, value] of identityParams(identity)) params.set(key, value);
  return withPaging(params, { limit, cursor });
}

// `/entity?grain=plan` refuses `cohort=`; the builder never emits it.
export function planCollectionParams(identity = {}, collection = '', { state = {}, limit = null, cursor = '' } = {}) {
  const params = windowParams(state);
  params.set('grain', 'plan');
  params.set('collection', collection);
  for (const [key, value] of identityParams(identity)) params.set(key, value);
  return withPaging(params, { limit, cursor });
}

export function planSessionResolveParams(ids = [], { state = {}, limit = null } = {}) {
  const params = windowParams(state);
  params.set('grain', 'session');
  const seen = new Set();
  for (const raw of ids) {
    const id = String(raw || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    params.append('id', id);
  }
  return withPaging(params, { limit });
}

export function planDesignArtifactParams(identity = {}) {
  const params = new URLSearchParams();
  params.set('grain', 'artifact');
  params.set('repo_id', String(identity.repo_id || ''));
  params.set('path', `docs/plans/${identity.plan}/DESIGN.md`);
  return params;
}

// A fixed plan page applies only the shared window. Every cohort or lens
// filter in the URL is named rather than narrowing some sections silently.
export function planDetailNotApplied(state = {}) {
  const labels = [];
  for (const [slot, text] of Object.entries(state.cohorts || {})) if (text) labels.push(`cohort ${String(slot).toUpperCase()}`);
  for (const [key, values] of Object.entries(state.filters || {})) for (const value of values || []) labels.push(`${key}: ${value}`);
  for (const [key, values] of Object.entries(state.unknown || {})) {
    if (key === 'sort') continue;
    for (const value of values || []) labels.push(`${key}: ${value}`);
  }
  for (const raw of state.exclude || []) labels.push(`exclude ${raw}`);
  return labels;
}

export function detailPopulationText(population = null, rows = []) {
  const unit = population?.unit || 'rows';
  const scope = Number(population?.scope_n ?? rows.length);
  const returned = Number(population?.returned_n ?? rows.length);
  return `${formatNumber(rows.length)} loaded; ${formatNumber(returned)} on this page; ${formatNumber(scope)} ${unit} total`;
}

// Line-based, fence-aware. Headings are only ATX `### Phase <n>` at the start
// of a line; the text after the heading must be joined by an em/en/hyphen dash
// or a colon. The first `- Outcome:` line before the next heading is the
// outcome, kept as one text line. Nothing is rendered as markdown.
export function parseDesignPhases(text = '') {
  const lines = String(text ?? '').split('\n');
  const phases = [];
  let fence = null;
  let current = null;
  let acceptingOutcome = false;
  const push = () => { if (current) { phases.push(current); current = null; } };
  for (const raw of lines) {
    const stripped = raw.replace(/^ {0,3}/, '');
    const open = /^(`{3,}|~{3,})/.exec(stripped);
    if (open) {
      const char = open[1][0];
      const length = open[1].length;
      if (!fence) fence = { char, length };
      else if (fence.char === char && length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const phase = /^###\s+Phase\s+(\d+)\s*(?:—|–|-|:)\s*(.+?)\s*$/.exec(raw);
    if (phase) {
      push();
      current = { number: Number(phase[1]), heading: phase[2], outcome: null };
      acceptingOutcome = true;
      continue;
    }
    if (/^#{1,6}[ \t]+/.test(raw)) { acceptingOutcome = false; continue; }
    if (!current || !acceptingOutcome) continue;
    const outcome = /^\s*-\s+Outcome:\s*(.+)$/.exec(raw);
    if (outcome) { current.outcome = outcome[1]; acceptingOutcome = false; }
  }
  push();
  return phases;
}

export function parseBriefPaths(rows = []) {
  const briefs = [];
  for (const row of rows) {
    const path = String(row?.id?.path || row?.path || '');
    const match = /(?:^|\/)briefs\/(\d+)-(\d+)-(.+)\.md$/.exec(path);
    if (!match) continue;
    briefs.push({ phase: Number(match[1]), unit: Number(match[2]), unitText: match[2], slug: match[3], path });
  }
  return briefs.sort((a, b) => a.phase - b.phase || a.unit - b.unit || a.path.localeCompare(b.path));
}

// Pair by the leading phase number. A brief whose phase heading is absent is
// unpaired, never assigned. A phase with no brief path is observed absence.
export function pairBriefs(phases = [], briefs = []) {
  const byPhase = new Map();
  for (const brief of briefs) {
    if (!byPhase.has(brief.phase)) byPhase.set(brief.phase, []);
    byPhase.get(brief.phase).push(brief);
  }
  const known = new Set(phases.map(phase => Number(phase.number)));
  const paired = phases.map(phase => ({ ...phase, briefs: byPhase.get(Number(phase.number)) || [] }));
  const unpaired = briefs.filter(brief => !known.has(brief.phase));
  return { phases: paired, unpaired };
}

export function briefObservationText(briefs = []) {
  return briefs.length
    ? `${formatNumber(briefs.length)} brief path${briefs.length === 1 ? '' : 's'} observed in the loaded artifact rows`
    : 'no brief path observed in the loaded artifact rows';
}

export function detailExecutionCost(row = {}) {
  const m = row.m || {};
  const flags = row.flags || {};
  return detailMoney(m.session_cost_usd, flags.session_cost_lower_bound === true, flags.session_cost_null_reason);
}

export function detailSessionCost(row = {}) {
  const m = row.m || {};
  const flags = row.flags || {};
  const lower = flags.cost_lower_bound === true || flags.session_cost_lower_bound === true;
  return detailMoney(m.cost_usd, lower, flags.cost_null_reason || flags.session_cost_null_reason);
}

export function detailWritingSessionCost(row = {}) {
  const m = row.m || {};
  const flags = row.flags || {};
  const reason = flags.null_reasons?.writing_session_cost_usd || (flags.writing_session_unpriced_calls > 0 ? '' : '');
  const lower = flags.writing_session_cost_lower_bound === true;
  if (m.writing_session_cost_usd === null || m.writing_session_cost_usd === undefined) {
    return reason === 'all_unpriced' || lower ? 'unpriced (all calls)' : 'unpriced';
  }
  return detailMoney(m.writing_session_cost_usd, lower, reason);
}

export function detailMoney(amount, lower = false, nullReason = '') {
  if (nullReason === 'all_unpriced' || amount === null || amount === undefined) return 'unpriced (all calls)';
  const number = Number(amount);
  if (!Number.isFinite(number)) return 'unpriced';
  return lower ? `$${number.toFixed(2)} (lower bound)` : `$${number.toFixed(2)}`;
}

// The artifact entity row does not expose a version content_hash; the reader is
// linked at its latest version, labelled as such. No hash is invented.
export function artifactLatestDestination(identity = {}, path = '') {
  const params = new URLSearchParams();
  if (identity.repo_id) params.set('repo_id', identity.repo_id);
  if (path) params.set('path', path);
  const query = params.toString();
  return `/artifact${query ? `?${query}` : ''}`;
}

export function artifactScoreEntries(row = {}) {
  const m = row.m || {};
  const l = row.l || {};
  return Object.keys(m)
    .filter(name => name.startsWith('score:') && !name.startsWith('score_scorer:'))
    .map(name => name.slice('score:'.length))
    .sort()
    .map(check => ({
      check,
      score: m[`score:${check}`] === undefined ? null : m[`score:${check}`],
      scorer: m[`score_scorer:${check}`] || '',
      band: l[`band:${check}`] || null
    }));
}

export function designScoreTextWithScorer(row = {}) {
  return designScoreText(row);
}

export function executionScores(row = {}) {
  const m = row.m || {};
  const pick = prefix => Object.keys(m)
    .filter(name => name.startsWith(prefix))
    .sort()
    .map(name => ({ check: name.slice(prefix.length), score: m[name] }));
  return { brief: pick('brief_score:'), report: pick('report_score:') };
}

function detailSection(doc, key, headingText) {
  const section = doc.createElement('section');
  section.className = `plans-detail-section plans-detail-${key}`;
  section.dataset.section = key;
  section.dataset.state = 'loading';
  section.append(el(doc, 'h2', '', headingText));
  const status = el(doc, 'p', 'plans-detail-status', 'Loading…');
  status.setAttribute('aria-live', 'polite');
  const body = el(doc, 'div', 'plans-detail-body');
  section.append(status, body);
  return {
    section, status, body,
    state(next, text) {
      section.dataset.state = next;
      status.textContent = text || '';
      if (next !== 'loading' && next !== 'ready') body.replaceChildren();
    }
  };
}

function detailTable(doc, { caption, columns, rows }) {
  const table = doc.createElement('table');
  table.className = 'plans-detail-table';
  const cap = el(doc, 'caption', '', caption);
  table.append(cap);
  const thead = doc.createElement('thead');
  const head = doc.createElement('tr');
  for (const label of columns) { const th = el(doc, 'th', '', label); th.scope = 'col'; head.append(th); }
  thead.append(head);
  const tbody = doc.createElement('tbody');
  for (const cells of rows) {
    const tr = doc.createElement('tr');
    for (const cell of cells) {
      const td = doc.createElement('td');
      if (cell && typeof cell === 'object' && cell.node) td.append(cell.node);
      else td.textContent = cell === null || cell === undefined || cell === '' ? '—' : String(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return table;
}

function definitionList(doc, pairs) {
  const dl = doc.createElement('dl');
  dl.className = 'plans-detail-facts';
  for (const [label, value] of pairs) {
    dl.append(el(doc, 'dt', '', label), el(doc, 'dd', '', value === null || value === undefined || value === '' ? '—' : String(value)));
  }
  return dl;
}

async function fetchJson(route, params, { tenant, signal, stateKey }) {
  return transport.get(route, params, { tenant, signal, stateKey });
}

function detailTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Date(number * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

async function renderDetail(root, doc, { signal, identity } = {}) {
  ensurePlansStyles(doc);
  root.replaceChildren();
  const state = readScope(decodeUrlState(globalThis.location?.search || ''));
  root.append(el(doc, 'h1', '', 'Plan'));
  root.append(el(doc, 'p', 'plans-detail-identity', `${identity.repo_id} / ${identity.plan}`));
  const notApplied = planDetailNotApplied(state);
  if (notApplied.length) {
    const note = el(doc, 'p', 'plans-detail-not-applied', `Not applied here: ${notApplied.join(', ')}. This fixed plan page sends only the shared window; it never sends cohort= to /entity.`);
    note.setAttribute('role', 'note');
    root.append(note);
  }

  const header = detailSection(doc, 'summary', 'Plan measures');
  const artifacts = detailSection(doc, 'artifacts', 'Artifacts by kind');
  const executions = detailSection(doc, 'executions', 'Executions');
  const sessions = detailSection(doc, 'sessions', 'Sessions');
  const events = detailSection(doc, 'events', 'Events');
  const timeline = detailSection(doc, 'timeline', 'Version and execution timeline');
  const design = detailSection(doc, 'design', 'Stored design context');
  for (const section of [header, artifacts, executions, sessions, events, timeline, design]) root.append(section.section);

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let disposed = false;
  let tenant = '';
  let schema = null;
  let timelineFrame = null;
  const baselineCache = createBaselineCache({ transport, tenant: '', signal: controller.signal });
  const artifactsState = { rows: [], next: '', population: null, bands: new Map() };
  const executionsState = { rows: [], next: '', population: null };
  const sessionsState = { rows: [], next: '', population: null, resolved: new Map() };
  const eventsState = { rows: [], next: '', population: null };
  let designState = { row: null, text: null, failure: '' };
  let planRow = null;

  const get = (route, params, stateKey) => fetchJson(route, params, { tenant, signal: controller.signal, stateKey });

  function errorText(response, body, fallback) {
    return body?.error || `${fallback} (${response?.status || 'no response'})`;
  }

  async function bandsFor(rows) {
    const bands = new Map();
    for (const row of rows) {
      const path = String(row?.id?.path || '');
      const kind = row?.l?.kind || artifactKind(path);
      for (const entry of artifactScoreEntries(row)) {
        const key = `${path}\u001f${entry.check}`;
        if (entry.band) { bands.set(key, entry.band); continue; }
        if (entry.score === null || entry.score === undefined) { bands.set(key, 'unscored'); continue; }
        if (!entry.scorer) { bands.set(key, 'baseline_unavailable'); continue; }
        const baseline = await baselineCache.get(kind, entry.check, entry.scorer).catch(() => null);
        bands.set(key, bandFor(entry.score, baseline));
      }
    }
    return bands;
  }

  function paintHeader() {
    header.body.replaceChildren();
    header.state('ready', '');
    const m = planRow.m || {};
    const shared = Number(m.shared_sessions) || 0;
    const cost = formatPlanCost(planRow);
    header.body.append(definitionList(doc, [
      ['Repo', identity.repo_id],
      ['Plan', identity.plan],
      ['Associated cost', `${cost}${shared ? ` · ${formatNumber(shared)} session${shared === 1 ? '' : 's'} shared with another plan` : ''}`],
      ['Associated cost note', 'sums associated sessions; non-additive and overlapping across plans'],
      ['Sessions', m.sessions],
      ['Shared sessions', m.shared_sessions],
      ['Versions', m.versions],
      ['Artifacts', m.artifacts],
      ['Executions complete / unreported / started', executionShapeText(planRow)],
      ['Complete share', completeShareText(planRow)],
      ['Span days', m.span_days === null || m.span_days === undefined ? '—' : Number(m.span_days).toFixed(2)],
      ['First observed', detailTimestamp(m.first_ts)],
      ['Last observed', detailTimestamp(m.last_ts)],
      ['Latest design score(s)', designScoreText(planRow)],
      ['Execution shape', 'process completion, not success']
    ]));
  }

  function paintArtifacts() {
    artifacts.body.replaceChildren();
    if (!artifactsState.rows.length) { artifacts.state('empty', 'No artifacts for this plan in the applied window.'); return; }
    const rows = artifactsState.rows.map(row => {
      const path = String(row.id?.path || '');
      const scores = artifactScoreEntries(row).map(entry => {
        const band = artifactsState.bands.get(`${path}\u001f${entry.check}`) || entry.band || 'baseline_unavailable';
        const value = entry.score === null || entry.score === undefined ? 'unscored' : Number(entry.score).toFixed(2);
        const scorer = entry.scorer || 'scorer not served';
        return `${entry.check} ${value} · ${scorer} · ${band}`;
      }).join('; ') || 'unscored';
      const bytes = row.m?.content_bytes === null || row.m?.content_bytes === undefined
        ? 'content_unavailable'
        : `${formatNumber(Number(row.m.content_bytes))} bytes`;
      const open = doc.createElement('a');
      open.href = artifactLatestDestination(identity, path);
      open.className = 'plans-artifact-open';
      open.textContent = 'Open (latest version)';
      return [
        row.l?.kind || artifactKind(path),
        path,
        `${formatNumber(Number(row.m?.versions) || 0)} versions`,
        scores,
        bytes,
        row.l?.screen_verdict || '—',
        detailWritingSessionCost(row),
        { node: open }
      ];
    });
    artifacts.state('ready', '');
    artifacts.body.append(detailTable(doc, {
      caption: 'Artifacts by kind. Scores, scorers and bands are latest-version only; the reader opens the latest version, no hash is invented.',
      columns: ['Kind', 'Path', 'Latest version', 'Score · scorer · band', 'Content', 'Screen verdict', 'Writing session cost', 'Open'],
      rows
    }));
    artifacts.body.append(el(doc, 'p', 'plans-detail-population', detailPopulationText(artifactsState.population, artifactsState.rows)));
    appendLoadMore(artifacts, 'artifacts', artifactsState, loadArtifacts);
  }

  function paintExecutions() {
    executions.body.replaceChildren();
    if (!executionsState.rows.length) { executions.state('empty', 'No executions for this plan in the applied window.'); return; }
    const rows = executionsState.rows.map(row => {
      const scores = executionScores(row);
      const text = [...scores.brief.map(item => `brief ${item.check} ${item.score === null ? '—' : Number(item.score).toFixed(2)}`),
        ...scores.report.map(item => `report ${item.check} ${item.score === null ? '—' : Number(item.score).toFixed(2)}`)].join('; ') || 'no scores';
      const conv = String(row.id?.conversation_id || '');
      const link = doc.createElement('a');
      link.href = `/sessions/${encodeURIComponent(conv)}`;
      link.className = 'plans-execution-session';
      link.textContent = conv || '—';
      return [
        row.l?.shape || 'unknown',
        row.id?.brief_path || '—',
        detailTimestamp(row.m?.ts),
        detailExecutionCost(row),
        `${text} (scorers not served on execution rows)`,
        { node: link }
      ];
    });
    executions.state('ready', '');
    executions.body.append(detailTable(doc, {
      caption: 'Execution completion, not success.',
      columns: ['Shape', 'Brief path', 'Time', 'Session cost', 'Brief / report scores', 'Session'],
      rows
    }));
    executions.body.append(el(doc, 'p', 'plans-detail-population', detailPopulationText(executionsState.population, executionsState.rows)));
    appendLoadMore(executions, 'executions', executionsState, loadExecutions);
  }

  function paintSessions() {
    sessions.body.replaceChildren();
    if (!sessionsState.rows.length) { sessions.state('empty', 'No sessions touched this plan in the applied window.'); return; }
    const rows = sessionsState.rows.map(row => {
      const conv = String(row.conversation_id || row.conversationId || '');
      const resolved = sessionsState.resolved.get(conv) || null;
      const link = doc.createElement('a');
      link.href = `/sessions/${encodeURIComponent(conv)}`;
      link.className = 'plans-session-link';
      link.textContent = conv || '—';
      return [
        { node: link },
        detailTimestamp(row.ts),
        resolved ? detailSessionCost(resolved) : 'session detail unavailable',
        resolved ? (resolved.m?.unpriced_calls ?? '—') : '—'
      ];
    });
    sessions.state('ready', '');
    const shared = Number(planRow?.m?.shared_sessions) || 0;
    const note = el(doc, 'p', 'plans-detail-overlap', `${shared ? `${formatNumber(shared)} session${shared === 1 ? '' : 's'} touch more than one plan. ` : ''}Associated cost sums sessions and is non-additive across plans; overlap is expected, not spend.`);
    sessions.body.append(note);
    sessions.body.append(detailTable(doc, {
      caption: 'Sessions with a lifetime artifact under this plan; last observed ts from the sessions collection.',
      columns: ['Conversation', 'Last observed', 'Cost', 'Unpriced calls'],
      rows
    }));
    sessions.body.append(el(doc, 'p', 'plans-detail-population', detailPopulationText(sessionsState.population, sessionsState.rows)));
    appendLoadMore(sessions, 'sessions', sessionsState, loadSessions);
  }

  function paintEvents() {
    events.body.replaceChildren();
    const scope = el(doc, 'p', 'plans-detail-events-scope', 'All observed events in sessions that wrote an artifact under this plan, not only plan files.');
    scope.setAttribute('role', 'note');
    events.body.append(scope);
    if (!eventsState.rows.length) { events.state('empty', 'No events in sessions that wrote an artifact under this plan.'); return; }
    events.state('ready', '');
    const rows = eventsState.rows.map(row => [
      detailTimestamp(row.ts),
      row.event_type || '—',
      row.event || '—',
      row.path || '—',
      row.conversation_id || '—'
    ]);
    events.body.append(detailTable(doc, {
      caption: 'Time-ordered events; paged independently of every other section.',
      columns: ['Time', 'Event type', 'Event', 'Path', 'Conversation'],
      rows
    }));
    events.body.append(el(doc, 'p', 'plans-detail-population', detailPopulationText(eventsState.population, eventsState.rows)));
    appendLoadMore(events, 'events', eventsState, loadEvents);
  }

  function appendLoadMore(section, key, store, loader) {
    if (!store.next) return;
    const button = el(doc, 'button', `plans-detail-more plans-detail-more-${key}`, `Load more ${key}`);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await loader(store.next); } finally { button.disabled = false; }
    });
    section.body.append(button);
  }

  function paintDesign() {
    design.body.replaceChildren();
    design.state('ready', '');
    if (designState.row) {
      const link = doc.createElement('a');
      link.className = 'plans-design-open';
      link.href = artifactLatestDestination(identity, designState.row.id?.path || `docs/plans/${identity.plan}/DESIGN.md`);
      link.textContent = 'Open design content (latest version)';
      design.body.append(link);
    }
    if (!designState.row) {
      design.body.append(el(doc, 'p', 'plans-design-missing', 'no stored design content'));
    } else if (designState.failure) {
      design.body.append(el(doc, 'p', 'plans-design-failure', designState.failure));
    } else if (designState.text !== null) {
      const phases = parseDesignPhases(designState.text);
      const briefs = parseBriefPaths(artifactsState.rows);
      const { phases: paired, unpaired } = pairBriefs(phases, briefs);
      if (!phases.length) design.body.append(el(doc, 'p', 'plans-design-no-phases', 'no `### Phase <n>` headings observed in the stored design content'));
      const list = doc.createElement('ol');
      list.className = 'plans-phases';
      for (const phase of paired.slice(0, 100)) {
        const item = doc.createElement('li');
        item.className = 'plans-phase';
        item.dataset.phase = String(phase.number);
        item.append(el(doc, 'strong', 'plans-phase-heading', `Phase ${phase.number} — ${phase.heading}`));
        item.append(el(doc, 'p', 'plans-phase-outcome', phase.outcome === null ? 'Outcome: not observed in the design body' : `Outcome: ${phase.outcome}`));
        item.append(el(doc, 'p', 'plans-phase-briefs', phase.briefs.length
          ? `Brief paths: ${phase.briefs.map(brief => `phase ${brief.phase}, unit ${brief.unitText}, ${brief.slug} (${brief.path})`).join('; ')}`
          : 'no brief path observed in the loaded artifact rows'));
        list.append(item);
      }
      if (paired.length) design.body.append(list);
      if (phases.length > 100) design.body.append(el(doc, 'p', 'plans-design-more', 'more phases not shown'));
      if (unpaired.length) {
        design.body.append(el(doc, 'h3', '', 'Unpaired briefs'));
        const ul = doc.createElement('ul');
        ul.className = 'plans-unpaired-briefs';
        for (const brief of unpaired) ul.append(el(doc, 'li', '', `${brief.path} (phase ${brief.phase}, unit ${brief.unitText}, slug ${brief.slug})`));
        design.body.append(ul);
      }
      design.body.append(el(doc, 'p', 'plans-design-basis', 'Parsed in the browser for display only; phases and brief paths are never counted as measures.'));
    }
  }

  function paintTimeline() {
    timeline.body.replaceChildren();
    timeline.state('ready', '');
    timelineFrame = createPanelFrame({
      panel: PLAN_TIMELINE_PANEL,
      spec: { plan: { repo_id: identity.repo_id, plan: identity.plan } },
      scope: { ...(state.win ? { win: state.win } : {}), ...(state.from ? { from: state.from } : {}), ...(state.to ? { to: state.to } : {}), ...(state.tz ? { tz: state.tz } : {}) },
      transport, scheduler, tenant, schema, doc
    });
    timeline.body.append(timelineFrame.element);
    timelineFrame.load().catch(() => {});
  }

  async function loadArtifacts(cursor = '') {
    const { response, body } = await get('entities', planArtifactsParams(identity, { state, limit: pageLimit, cursor }), 'plan-detail-artifacts');
    if (!response.ok) { artifacts.state('error', errorText(response, body, 'The artifacts request failed.')); return; }
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    artifactsState.rows = cursor ? mergeByIdentity(artifactsState.rows, incoming) : incoming;
    artifactsState.next = body.next || '';
    artifactsState.population = body.population || artifactsState.population;
    artifactsState.bands = await bandsFor(artifactsState.rows);
    paintArtifacts();
    if (designState.row || designState.text !== null || designState.failure) paintDesign();
  }

  async function loadExecutions(cursor = '') {
    const { response, body } = await get('entities', planExecutionsParams(identity, { state, limit: pageLimit, cursor }), 'plan-detail-executions');
    if (!response.ok) { executions.state('error', errorText(response, body, 'The executions request failed.')); return; }
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    executionsState.rows = cursor ? mergeByIdentity(executionsState.rows, incoming, true) : incoming;
    executionsState.next = body.next || '';
    executionsState.population = body.population || executionsState.population;
    paintExecutions();
  }

  async function loadSessions(cursor = '') {
    const { response, body } = await get('entity', planCollectionParams(identity, 'sessions', { state, limit: pageLimit, cursor }), 'plan-detail-sessions');
    if (!response.ok) { sessions.state('error', errorText(response, body, 'The sessions collection failed.')); return; }
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    sessionsState.rows = cursor ? mergeConversationRows(sessionsState.rows, incoming) : incoming;
    sessionsState.next = body.next || '';
    sessionsState.population = body.population || sessionsState.population;
    const ids = [...new Set(sessionsState.rows.map(row => String(row.conversation_id || '')).filter(Boolean))];
    if (ids.length) {
      const resolved = await get('entities', planSessionResolveParams(ids, { state, limit: pageLimit }), 'plan-detail-session-rows');
      if (resolved.response.ok) {
        for (const row of resolved.body.rows || []) {
          const id = String(row.id?.conversation_id || row.id || '');
          if (id) sessionsState.resolved.set(id, row);
        }
      }
    }
    paintSessions();
  }

  async function loadEvents(cursor = '') {
    const { response, body } = await get('entity', planCollectionParams(identity, 'events', { state, limit: pageLimit, cursor }), 'plan-detail-events');
    if (!response.ok) { events.state('error', errorText(response, body, 'The events collection failed.')); return; }
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    eventsState.rows = cursor ? mergeEventRows(eventsState.rows, incoming) : incoming;
    eventsState.next = body.next || '';
    eventsState.population = body.population || eventsState.population;
    paintEvents();
  }

  function mergeByIdentity(existing, incoming, execution = false) {
    const seen = new Set(existing.map(row => execution
      ? `${row.id?.repo_id}|${row.id?.conversation_id}|${row.id?.brief_path}`
      : `${row.id?.repo_id}|${row.id?.path}`));
    const rows = existing.slice();
    for (const row of incoming) {
      const key = execution
        ? `${row.id?.repo_id}|${row.id?.conversation_id}|${row.id?.brief_path}`
        : `${row.id?.repo_id}|${row.id?.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }

  function mergeConversationRows(existing, incoming) {
    const seen = new Set(existing.map(row => String(row.conversation_id || '')));
    const rows = existing.slice();
    for (const row of incoming) {
      const key = String(row.conversation_id || '');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }

  function mergeEventRows(existing, incoming) {
    const seen = new Set(existing.map(row => `${row.ts}|${row.event_type}|${row.rowid ?? ''}|${row.path}|${row.conversation_id}`));
    const rows = existing.slice();
    for (const row of incoming) {
      const key = `${row.ts}|${row.event_type}|${row.rowid ?? ''}|${row.path}|${row.conversation_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows;
  }

  let pageLimit = null;

  async function start() {
    try {
      const me = await transport.request('me', { signal: controller.signal, stateKey: 'plans-detail-me' });
      tenant = rememberedTenant(me?.body || {});
    } catch (error) {
      if (error?.name === 'AbortError') return;
      tenant = '';
    }
    if (disposed) return;
    try {
      const result = await transport.schema(tenant);
      if (result.response.ok) schema = result.body;
    } catch { schema = null; }
    if (disposed) return;
    const max = Number(schema?.budgets?.page_max);
    pageLimit = Number.isFinite(max) && max > 0 ? Math.floor(max) : null;
    if (schema?.features && schema.features.entities_plan === false) {
      for (const section of [header, artifacts, executions, sessions, events, timeline]) {
        section.state('unsupported', 'entities_plan is not advertised by this server; supplied by Plan 20 Phase 6.');
      }
      design.state('unsupported', 'entities_plan is not advertised by this server; supplied by Plan 20 Phase 6.');
      return;
    }

    let rowResult;
    try {
      rowResult = await get('entities', planRowParams(identity, { state, limit: 1 }), 'plan-detail-row');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      header.state('error', error?.message || 'The plan request failed.');
      return;
    }
    if (!rowResult.response.ok) {
      header.state(rowResult.response.status === 404 ? 'unsupported' : 'error', errorText(rowResult.response, rowResult.body, 'The plan request failed.'));
      showAbsent(`No served plan (${identity.repo_id}, ${identity.plan}).`);
      return;
    }
    const rows = Array.isArray(rowResult.body.rows) ? rowResult.body.rows : [];
    planRow = rows.find(row => {
      const name = planIdentity(row);
      return name.repo_id === identity.repo_id && name.plan === identity.plan;
    }) || null;
    if (!planRow) {
      header.state('empty', `No served plan (${identity.repo_id}, ${identity.plan}).`);
      showAbsent(`No served plan (${identity.repo_id}, ${identity.plan}).`);
      return;
    }
    paintHeader();

    // Artifacts settle first: the design row is found among the artifact rows
    // the page already loaded, and the phases/briefs pairing reads them.
    await Promise.allSettled([loadArtifacts()]);
    if (disposed) return;
    await Promise.allSettled([loadDesign(), loadExecutions(), loadSessions(), loadEvents()]);
    if (disposed) return;
    paintTimeline();
  }

  function showAbsent(message) {
    for (const section of [artifacts, executions, sessions, events, timeline, design]) {
      section.state('empty', message);
    }
    const link = doc.createElement('a');
    link.href = '/plans';
    link.className = 'plans-detail-back';
    link.textContent = 'Back to plans';
    header.body.append(el(doc, 'p', 'plans-detail-absent', message), link);
  }

  async function loadDesign() {
    design.state('loading', 'Loading stored design content…');
    const designPath = `docs/plans/${identity.plan}/DESIGN.md`;
    // The design row is found among the artifact rows the page already loads;
    // its exact blob comes from the artifact entity route, then /content.
    const artifactRows = artifactsState.rows;
    const row = artifactRows.find(item => String(item.id?.path || '') === designPath) || null;
    designState = { row, text: null, failure: '' };
    if (!row) { paintDesign(); return; }
    try {
      const entity = await get('entity', planDesignArtifactParams(identity), 'plan-detail-design-entity');
      if (!entity.response.ok) { designState.failure = errorText(entity.response, entity.body, 'The design artifact request failed.'); paintDesign(); return; }
      const hash = entity.body?.latest?.content_hash || '';
      if (!hash) { designState.failure = 'no stored design content'; paintDesign(); return; }
      const content = await fetchArtifactText({ scheduler, repo: identity.repo_id, path: designPath, hash, tenant, signal: controller.signal, stateKey: 'plan-detail-design-content' });
      if (content.ok) designState.text = content.text;
      else designState.failure = detailContentFailure(content);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      designState.failure = error?.message || 'The design content request failed.';
    }
    paintDesign();
  }

  start().catch(error => {
    if (disposed || error?.name === 'AbortError') return;
    header.state('error', error?.message || 'The plan detail failed.');
  });

  return () => {
    disposed = true;
    controller.abort();
    timelineFrame?.destroy();
  };
}

function detailContentFailure(result = {}) {
  if (result.code === 'content_unavailable') return `content unavailable: ${result.reason || 'no reason given'}`;
  if (result.code === 'content_too_large') return `content too large: ${result.size_bytes ?? 'unknown'} bytes exceeds the ${result.limit_bytes ?? 'unknown'}-byte limit`;
  if (result.code === 'content_integrity') return 'content integrity check failed';
  if (result.status === 404) return 'not found';
  return result.message || 'The content request failed.';
}

export function render(root, doc = globalThis.document, { signal } = {}) {
  const route = parseRoute(globalThis.location?.pathname || '/', globalThis.location?.search || '');
  if (route?.kind === 'explorer' && route.explorer === 'plans' && route.plan) {
    return renderDetail(root, doc, { signal, identity: route.plan });
  }
  return renderList(root, doc, { signal });
}

export function renderList(root, doc = globalThis.document, { signal } = {}) {
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
