import { decodeUrlState } from '../contract/url-state.js';
import { resolveReadContext } from './core/read-context.js';
import { createScheduler } from './core/request-scheduler.js';
import { createTransport, isCollectorMode, resolvedBase } from '../contract/transport.js';
import { legacyErrorMessage } from './core/legacy-error.js';
import { authorizedTenant, selectableTenants, tenantCleanupState, sessionGateDecision, shouldRecoverTenant, tenantOptionLabel } from '../contract/session-gate.js';
import { renderIdentity } from './identity/flows.js';
import { createRouter, isAccountRoute, loadExplorer } from './core/router.js';
import { createFollow } from './core/follow.js';
import './charts/yk-chart.js';
import './charts/yk-bars.js';
import './charts/yk-ranges.js';
import './charts/yk-matrix.js';
import { encodePanelSpec, writePanelSpec } from './core/view-spec.js';
import { createScopeControls, panelOverridePlan, applyPromotions, resetPanelScope, TIME_OVERRIDE_FIELDS } from './core/scope-controls.js';
import { assembleBoard } from './boards/board.js';
import { createPanelFrame } from './panels/panel-frame.js';
import './panels/index.js';
import { currentBoardUrl, readBoards, saveBoard, deleteBoard, openBoard } from './core/saved-boards.js';
import {
  addFilterChip, createChips, legendFocusFilter, removeCohortChip, removeExcludeChip, removeFilterChip, resetScopeState, stateUrl, withPick
} from './core/chips.js';
import { buildCohort, createSelectionTray, nextCohortSlot, openListDestination, writeCohort } from './core/selection-tray.js';
import { createInspector } from './core/inspector.js';
import { createCapabilityInspector } from './core/capability-inspector.js';
import { unsupportedState } from './core/panel-state.js';
import { decodePick, encodePick, decodeCohort } from './core/selection-model.js';
import { coverageSnapshot } from './panels/coverage.js';

const root = document.querySelector('#app');
const scheduler = createScheduler({ onChange: ({ inFlight }) => {
  const status = document.querySelector('#request-status');
  status.dataset.inflight = String(inFlight);
  status.textContent = `${inFlight} requests in flight`;
} });
const transport = createTransport(scheduler);
let activeBoardTeardown = null;
let activeRouteTeardown = null;
let activeScopeDestroy = null;
let activeFollow = null;
let boardFrameTeardown = [];
let renderGeneration = 0;
let lastMe = null;
let lastMeStatus = 0;
let lastRecord = null;
let sessionFetchedAt = 0;
const generationMismatch = new Set();

function beginRender() {
  renderGeneration += 1;
  document.documentElement.dataset.renderGeneration = String(renderGeneration);
  return renderGeneration;
}

function renderIsCurrent(generation) {
  return generation === renderGeneration;
}

function teardownActiveRoute() {
  if (activeFollow) { activeFollow.destroy(); activeFollow = null; }
  if (activeScopeDestroy) { activeScopeDestroy(); activeScopeDestroy = null; }
  if (activeRouteTeardown) { activeRouteTeardown(); activeRouteTeardown = null; }
  if (activeBoardTeardown) { activeBoardTeardown(); activeBoardTeardown = null; }
  for (const destroy of boardFrameTeardown) destroy();
  boardFrameTeardown = [];
}

const tenantSelect = document.querySelector('#tenant-select');
const tenantNote = document.querySelector('#tenant-note');

function mountTenantHeader({ me = null, meStatus = 0, auth = null, state = {}, localMode = false, signedOut = false } = {}) {
  tenantSelect.replaceChildren();
  if (signedOut) {
    const option = element('option', '', 'Sign in to select a tenant');
    option.value = '';
    option.selected = true;
    tenantSelect.append(option);
    tenantSelect.disabled = true;
    tenantNote.hidden = true;
    return;
  }
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  let selected = auth?.tenant || state.tenant || '';
  if (meStatus !== 200 && tenants.length === 0) {
    const option = element('option', '', localMode ? 'Local collector' : 'Token-bound tenant');
    option.value = '';
    option.selected = true;
    tenantSelect.append(option);
    tenantSelect.disabled = true;
    tenantNote.hidden = false;
    tenantNote.textContent = localMode ? 'Local collector' : 'Token-bound tenant · Sign in to manage account';
    return;
  }
  if (!tenants.length) {
    const option = element('option', '', 'Create a tenant to view analytics');
    option.value = '';
    option.selected = true;
    tenantSelect.append(option);
    tenantSelect.disabled = true;
    tenantNote.hidden = true;
    return;
  }
  if (auth?.unavailable && selected) {
    const option = element('option', '', `${selected} · unavailable`);
    option.value = selected;
    option.selected = true;
    tenantSelect.append(option);
  }
  for (const tenant of tenants) {
    const cleanup = tenantCleanupState(tenant);
    const option = element('option', '', cleanup ? `${tenantOptionLabel(tenant)} · ${cleanup}` : tenantOptionLabel(tenant));
    option.value = tenant.id;
    option.selected = tenant.id === selected;
    option.disabled = Boolean(cleanup);
    tenantSelect.append(option);
  }
  if (!selected) {
    const first = selectableTenants(me)[0];
    if (first) { selected = first.id; tenantSelect.value = first.id; }
  }
  tenantSelect.disabled = false;
  tenantNote.hidden = true;
}

function navPath(value) {
  try { return new URL(value, globalThis.location.href).pathname.replace(/\/+$/, '') || '/'; } catch { return ''; }
}

const NAV_ALIASES = { '/artifact': '/ledger' };

function markActiveNav(path, hash = '') {
  const pathname = path.replace(/\/+$/, '') || '/';
  const wanted = NAV_ALIASES[pathname] || pathname;
  for (const link of document.querySelectorAll('.analytics-nav a')) {
    const target = navPath(link.getAttribute('href') || '');
    if (target === wanted || (target !== '/' && wanted.startsWith(`${target}/`))) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const link of document.querySelectorAll('.account-nav a')) {
    const raw = link.getAttribute('href') || '';
    const target = navPath(raw);
    const at = raw.indexOf('#');
    const wantedHash = at === -1 ? '' : raw.slice(at + 1);
    if (target === wanted && wantedHash && `#${wantedHash}` === hash) link.setAttribute('aria-current', 'location');
    else if (target === wanted && !wantedHash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function committedScopeUrl(state, path = globalThis.location?.pathname || '/') {
  return stateUrl(state, globalThis.location?.search || '', path);
}

function clearForTenantChange(state, tenant) {
  const next = {
    ...state,
    tenant,
    filters: {},
    exclude: [],
    cohorts: { ca: '', cb: '', cc: '', cd: '' },
    pick: '', sel: '', hide: [],
    panels: {},
    panelSpecs: {}
  };
  for (const [key, spec] of Object.entries(state.panelSpecs || {})) {
    const scope = { ...(spec.scope || {}) };
    for (const field of TIME_OVERRIDE_FIELDS) delete scope[field];
    const cleaned = { ...spec, scope };
    next.panelSpecs[key] = cleaned;
    next.panels[key] = encodePanelSpec(cleaned);
  }
  return next;
}

function parentListPath(record, state) {
  if (record.kind !== 'explorer') return record.path;
  if (record.explorer === 'sessions' && record.sessionId) return '/sessions';
  if (record.explorer === 'plans' && record.plan) return '/plans';
  if (record.explorer === 'artifact') {
    const params = new URLSearchParams(state.search || record.search || '');
    if (params.has('repo_id') || params.has('path')) return '/ledger';
  }
  return record.path;
}

async function changeTenant(nextTenant) {
  if (!nextTenant) return;
  const record = lastRecord || router.current();
  const state = decodeUrlState(record.search);
  if (state.tenant === nextTenant) return;
  try { localStorage.setItem('yakka-analytics-tenant', nextTenant); } catch {}
  generationMismatch.delete(nextTenant);
  scheduler.supersedeAll();
  teardownActiveRoute();
  transport.invalidateTenant();
  const target = parentListPath(record, { search: record.search });
  const next = clearForTenantChange(state, nextTenant);
  if (target !== record.path) { next.unknown = {}; next.pick = ''; next.sel = ''; }
  router.push(stateUrl(next, record.search, target));
}

tenantSelect.addEventListener('change', () => { changeTenant(tenantSelect.value); });
let sessionPromise;
let pendingAccountFocus = '';
function selectAccountTenant(id) {
  if (!id) return;
  pendingAccountFocus = id;
  return changeTenant(id);
}
async function refreshAccountSession() {
  sessionPromise = undefined;
  const result = await loadSessionOnce();
  lastMe = result.me;
  lastMeStatus = result.status;
  const state = decodeUrlState(globalThis.location?.search || '');
  const auth = authorizedTenant({ me: result.me, urlTenant: state.tenant });
  mountTenantHeader({ me: result.me, meStatus: result.status, auth, state });
  return result.status === 200 ? result.me : null;
}
function focusAccountRow(id) {
  const row = [...root.querySelectorAll('[data-account-tenant-row]')].find(el => el.dataset.accountTenantRow === id);
  if (row) row.focus();
}
function loadSessionOnce() {
  if (!sessionPromise) sessionPromise = transport.request('me').then(result => {
    const valid = result.response.status !== 200 || (result.body && Array.isArray(result.body.tenants) && result.body.github_id !== undefined);
    sessionFetchedAt = Date.now();
    return { me: result.body, status: valid ? result.response.status : 0 };
  }).catch(() => ({ me: null, status: 0 }));
  return sessionPromise;
}

function tenantOf(me, id) {
  return (Array.isArray(me?.tenants) ? me.tenants : []).find(tenant => tenant.id === id) || null;
}

// S1 lifecycle revalidation: after sleep/reset or on focus, re-read /me before
// trusting the selected tenant. A changed generation or a disappeared tenant
// clears that selection; the shell then requires an explicit choice instead of
// silently choosing another tenant.
async function revalidateSession() {
  const record = lastRecord;
  if (!record || Date.now() - sessionFetchedAt < 30000) return;
  const priorMe = lastMe;
  const priorTenant = decodeUrlState(record.search).tenant || '';
  sessionPromise = undefined;
  const result = await loadSessionOnce();
  const before = tenantOf(priorMe, priorTenant);
  const after = tenantOf(result.me, priorTenant);
  const beforeGeneration = String(before?.lifecycle_generation || '');
  const afterGeneration = String(after?.lifecycle_generation || '');
  const changed = Boolean(priorTenant && before && (!after || (beforeGeneration && afterGeneration && beforeGeneration !== afterGeneration)));
  if (changed) {
    generationMismatch.add(priorTenant);
    scheduler.supersedeAll();
    transport.invalidateTenant(priorTenant);
    try { localStorage.removeItem('yakka-analytics-tenant'); } catch {}
  }
  render(router.current());
}

function panelHref(grain, measures, split, chart) {
  return `p1=${encodeURIComponent(encodePanelSpec({ grain, measures, split, chart }))}`;
}

// The fixed question paths. Cost 3, quality 5, plans 3, activity 3, health 1.
// A path opens its configured board or explorer state, or is disabled with the
// reason when /schema lacks what it needs. Later-phase destinations are named
// and are never dead.
export const QUESTION_PATHS = [
  { group: 'Cost', label: 'Where did the money go this week against last?', href: '/b/cost?win=7d&cmp=period', explanation: 'Cost board for seven days against the previous equal period.' },
  { group: 'Cost', label: 'Which model gives the most output per dollar?', href: `/b/scatter?win=30d&${panelHref('session', ['cost_usd', 'commits'], 'session_model', 'scatter')}`, requires: ['entities_session'], explanation: 'Sessions plotted by priced spend and commits, coloured by session model.' },
  { group: 'Cost', label: 'How much of my spend cannot be priced?', href: '/b/pulse?win=30d', explanation: 'Pulse window totals, including the unpriced-call count and its lower bound.' },
  { group: 'Quality', label: 'How do design, brief and report scores differ by harness?', href: `/b/quality?win=30d&${panelHref('content', ['score'], 'harness', 'ranges')}`, requires: ['scores_by_lens'], explanation: 'Quality score ranges by harness for the selected document kind.' },
  { group: 'Quality', label: 'Quality by model and by repo over time', href: `/b/quality?win=90d&${panelHref('content', ['score'], 'session_model', 'lines')}`, requires: ['scores_by_lens'], explanation: 'Quality score trend by session model over ninety days.' },
  { group: 'Quality', label: 'Do expensive sessions write better artifacts?', href: `/b/scatter?win=30d&${panelHref('artifact', ['cost_usd', 'score'], 'session_model', 'scatter')}`, requires: ['entities_session', 'entities_artifact'], explanation: 'Artifact clarity plotted against its writing session’s priced spend.' },
  { group: 'Quality', label: 'Which artifacts scored lowest?', href: `/b/quality?win=30d&${panelHref('artifact', ['score'], 'kind', 'strip')}`, requires: ['entities_artifact', 'scores_by_lens'], explanation: 'File-weighted score strips grouped by document kind.' },
  { group: 'Quality', label: 'Am I better than my usual?', href: `/b/quality?win=30d&${panelHref('content', ['score'], 'kind', 'ranges')}`, requires: ['scores_by_lens'], explanation: 'Score ranges for the selected kind against the all-history baseline.' },
  { group: 'Plans', label: 'Which brief runs have no report or commit yet?', href: `/b/workflow?win=30d&${panelHref('execution', ['ts'], 'shape', 'bars')}`, requires: ['entities_execution'], explanation: 'Workflow execution completion by plan, naming each shape.' },
  { group: 'Plans', label: 'What did this plan contain, and how did the design change?', href: '/plans', requires: ['entities_plan'], explanation: 'Plans explorer with the plan’s artifacts, executions and events.' },
  { group: 'Plans', label: 'Which plans cost the most for what they produced?', href: `/b/scatter?win=30d&${panelHref('plan', ['associated_cost_usd', 'artifacts'], 'repo_id', 'scatter')}`, requires: ['entities_plan'], explanation: 'Plans plotted by associated spend and artifact count.' },
  { group: 'Activity', label: 'What just happened?', href: '/b/pulse?win=1d', requires: ['activity'], explanation: 'Pulse recent activity observations for the last twenty-four hours.' },
  { group: 'Activity', label: 'When do I work?', href: '/b/pulse?win=90d', explanation: 'Pulse activity and daily calendar over ninety days.' },
  { group: 'Activity', label: 'How do harnesses use tools?', href: '/b/tools?win=30d', explanation: 'Tools composition of hook events by tool category and harness.' },
  { group: 'Health', label: 'What is unscored, unpriced, unattributed or rejected?', href: '/ops', explanation: 'Operations storage, coverage, unscored, unpriced, unattributed and rejection facts.' }
];

export function featureAvailable(schema, name) {
  const features = schema?.features || {};
  if (name === 'activity') return Boolean(features.activity || features.analytics_activity);
  return Boolean(features[name]);
}

export function pathAvailability(path, schema) {
  if (!schema) return { ok: false, reason: 'The server capability schema is unavailable; this view cannot be configured.' };
  for (const feature of path.requires || []) {
    if (!featureAvailable(schema, feature)) {
      return { ok: false, reason: `The server does not advertise ${feature}. Supplied by this plan's server phases; this view stays disabled until it is.` };
    }
  }
  return { ok: true, reason: '' };
}

// Every client route the shell answers. The router dispatches them; the
// not-found view lists them so an unknown path is never a dead end.
export const SHELL_ROUTES = ['/plans', '/artifact', '/sessions', '/ledger', '/ops', '/login', '/oauth/callback', '/device', '/profile', '/settings'];

function setShellState(state, idle) {
  root.dataset.state = state;
  root.dataset.idle = idle;
  document.documentElement.dataset.state = state;
  document.documentElement.dataset.idle = idle;
  if (idle === 'true') {
    root.dataset.idle = 'true';
    document.documentElement.dataset.idle = 'true';
  }
}

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function renderScopeBar(container, state) {
  const bar = element('section', 'scope-bar');
  bar.setAttribute('aria-label', 'Scope');
  const windowText = state.from || state.to
    ? `${state.from || 'start'} → ${state.to || 'now'}`
    : `window ${state.win || '30d'}`;
  bar.append(element('strong', '', 'Scope'), element('span', 'scope-window', windowText));
  if (state.tz) bar.append(element('span', 'scope-item', `tz ${state.tz}`));
  for (const [key, values] of Object.entries(state.filters || {})) {
    for (const value of values) bar.append(element('span', 'scope-item', `${key}: ${value}`));
  }
  for (const value of state.exclude || []) bar.append(element('span', 'scope-item', `exclude ${value}`));
  for (const [slot, value] of Object.entries(state.cohorts || {})) {
    if (value) bar.append(element('span', 'scope-item', `cohort ${slot.slice(1).toUpperCase()}`));
  }
  if (state.cmp !== 'off') bar.append(element('span', 'scope-item', `compare ${state.cmp}`));
  if (state.cmp === 'period' && !state.from && !state.to && state.win === 'all') {
    bar.append(element('span', 'scope-warning', 'Choose a finite period to compare periods.'));
  }
  container.append(bar);
}

function renderCoverageStrip(container, schema) {
  const coverage = schema?.coverage;
  if (!coverage) return;
  const snapshot = coverageSnapshot(coverage, Date.now());
  const strip = element('section', 'coverage-strip');
  strip.setAttribute('aria-label', 'Coverage');
  strip.append(element('strong', '', 'Coverage'));
  if (snapshot.latest) {
    strip.append(element('span', 'coverage-item', `${snapshot.latest.type} last ${snapshot.latest.at}`));
    strip.append(element('span', 'coverage-item', `age ${snapshot.latest.age}`));
  } else {
    strip.append(element('span', 'coverage-item', 'no retained observation'));
  }
  if (snapshot.usage) strip.append(element('span', 'coverage-item', `usage last ${snapshot.usage.last} (${snapshot.usage.age} ago)`));
  if (snapshot.range) strip.append(element('span', 'coverage-item', `range ${snapshot.range.from} → ${snapshot.range.to}`));
  if (coverage.scorer_configured === false) strip.append(element('span', 'coverage-item', 'no scorer configured'));
  container.append(strip);
}

function scopedHref(href, tenant) {
  if (!tenant) return href;
  try {
    const url = new URL(href, globalThis.location?.href || 'http://localhost');
    if (!url.searchParams.has('tenant')) url.searchParams.set('tenant', tenant);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return href; }
}

export const QUESTION_GROUPS = ['Cost', 'Quality', 'Plans', 'Activity', 'Health'];

function questionCell(tag, className, value) {
  const cell = element(tag, className, value);
  if (tag === 'th') cell.scope = 'col';
  return cell;
}

// S-start: a full-width semantic table, Area then Question then Explanation,
// with the fixed group order and the existing QUESTION_PATHS order inside each
// group. A path the server cannot answer is disabled text plus the reason; it
// is never a dead link, and every enabled link keeps the selected tenant.
function renderQuestionPaths(container, schema, tenant = '') {
  const table = element('table', 'question-paths');
  table.append(element('caption', '', 'Question paths'));
  const head = element('thead');
  const headRow = element('tr');
  headRow.append(questionCell('th', '', 'Area'), questionCell('th', '', 'Question'), questionCell('th', '', 'Explanation'));
  head.append(headRow);
  const body = element('tbody');
  for (const group of QUESTION_GROUPS) {
    for (const path of QUESTION_PATHS.filter(item => item.group === group)) {
      const row = element('tr');
      const availability = pathAvailability(path, schema);
      const question = element('td');
      if (availability.ok) {
        const link = element('a', '', path.label);
        link.href = scopedHref(path.href, tenant);
        question.append(link);
      } else {
        const label = element('span', 'disabled-path', path.label);
        label.setAttribute('aria-disabled', 'true');
        question.append(label);
      }
      const explanation = availability.ok
        ? (path.explanation || '')
        : `${path.explanation || ''} ${availability.reason}`.trim();
      row.append(element('td', '', group), question, element('td', '', explanation));
      body.append(row);
    }
  }
  table.append(head, body);
  container.append(table);
}

function renderNamedDestination(container, record) {
  container.append(element('h1', '', record.title));
  const notice = element('p', 'notice', record.label || `Delivered in Phase ${record.phase}: ${record.title}`);
  container.append(notice);
}

function notFoundHref(path, search = '', tenant = '') {
  const params = new URLSearchParams(search);
  params.delete('tenant');
  if (tenant) params.set('tenant', tenant);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function renderNotFound(container, record, tenant = '') {
  container.append(element('h1', '', record.title || 'Not found'));
  container.append(element('p', 'account-context', 'Account controls use the selected tenant. Time, repository and kind filters apply on analytics pages.'));
  container.append(element('p', 'not-found-message', 'No page matches this address.'));
  const pathLine = element('p', 'not-found-path');
  pathLine.append(element('code', '', record.path));
  container.append(pathLine);
  const nav = element('nav', 'not-found-routes');
  nav.setAttribute('aria-label', 'Not found navigation');
  const start = element('a', '', 'Open Start');
  start.href = notFoundHref('/', record.search, tenant);
  const pulse = element('a', '', 'Open Pulse');
  pulse.href = notFoundHref('/b/pulse', record.search, tenant);
  nav.append(start, pulse);
  container.append(nav);
}

function mountSavedBoards(container, state) {
  const section = element('section', 'saved-boards');
  section.append(element('h2', '', 'Saved boards'));
  const form = element('form', 'save-board');
  const input = element('input');
  input.name = 'board-name';
  input.placeholder = 'Board name';
  input.setAttribute('aria-label', 'Board name');
  input.required = true;
  const save = element('button', '', 'Save current view');
  save.type = 'submit';
  const table = element('table', 'saved-board-list');
  table.append(element('caption', '', 'Saved boards'));
  const head = element('thead');
  const headRow = element('tr');
  headRow.append(
    questionCell('th', '', 'Name'),
    questionCell('th', '', 'Open'),
    questionCell('th', '', 'Delete'),
    questionCell('th', '', 'URL summary')
  );
  head.append(headRow);
  const body = element('tbody');
  table.append(head, body);

  const render = () => {
    body.replaceChildren();
    const boards = readBoards().slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (!boards.length) {
      const row = element('tr');
      const cell = element('td', 'muted', 'No saved boards yet.');
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
      return;
    }
    for (const board of boards) {
      const row = element('tr');
      const name = element('td', '', board.name);
      name.title = board.name;
      const openCell = element('td');
      const open = element('button', '', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => openBoard(board.name));
      openCell.append(open);
      const deleteCell = element('td');
      const remove = element('button', '', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => { deleteBoard(board.name); render(); });
      deleteCell.append(remove);
      const summary = element('td', '', board.url);
      summary.title = board.url;
      row.append(name, openCell, deleteCell, summary);
      body.append(row);
    }
  };

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    saveBoard(name, currentBoardUrl());
    input.value = '';
    render();
  });
  form.append(input, save);
  section.append(form, table);
  render();
  container.append(section);
}

function mountFollow(container, schema, tenant) {
  const bar = element('section', 'follow-bar');
  bar.setAttribute('aria-label', 'Follow');
  const toggle = element('button', '', 'Follow: off');
  toggle.type = 'button';
  toggle.setAttribute('aria-pressed', 'false');
  const status = element('span', 'follow-status', 'No observations yet');
  status.dataset.watermark = '';
  const follow = createFollow({ transport, tenant, onChange: snapshot => {
    toggle.textContent = `Follow: ${snapshot.enabled ? 'on' : 'off'}`;
    toggle.setAttribute('aria-pressed', String(snapshot.enabled));
    status.dataset.watermark = snapshot.acknowledged || '';
    const counts = snapshot.counts || {};
    const total = Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0);
    status.textContent = snapshot.enabled ? `${total} observations since the last acknowledged watermark` : 'Follow is off';
  } });
  toggle.addEventListener('click', () => follow.toggle());
  const ack = element('button', '', 'Acknowledge');
  ack.type = 'button';
  ack.addEventListener('click', () => follow.acknowledge());
  bar.append(toggle, ack, status);
  container.append(bar);
  return follow;
}

function currentState() {
  return decodeUrlState(globalThis.location?.search || '');
}

const COHORT_SLOTS = ['ca', 'cb', 'cc', 'cd'];

function validCohortCount(state) {
  return COHORT_SLOTS.filter(key => decodeCohort(state.cohorts?.[key])).length;
}

// The committed comparison is the URL `cmp` when it names a mode; an explicit
// `off` is encoded as an absent URL key, so the per-panel override is the
// durable signal that the board is not comparing.
function currentComparison(state, board) {
  if (state.cmp === 'cohorts') return 'cohorts';
  if (state.cmp === 'period') return 'period';
  const panelCmp = board.panels.find(entry => entry.spec?.scope?.cmp)?.spec.scope.cmp;
  return panelCmp === 'off' || panelCmp === 'cohorts' ? panelCmp : 'period';
}

// S-compare: one labeled Comparison select before the grid. A change writes the
// URL `cmp` and every panel's `pN.scope.cmp` in one push, because an explicit
// `off` is not a URL key and each preset panel carries a default cmp=period.
function mountComparison(container, state, board, router, path) {
  const enough = validCohortCount(state) >= 2;
  const group = element('div', 'compare-control');
  const label = element('label', '', 'Comparison');
  const select = element('select');
  select.id = 'comparison-select';
  label.htmlFor = 'comparison-select';
  for (const [value, text] of [['period', 'Previous equal period'], ['off', 'No comparison'], ['cohorts', 'Saved cohorts']]) {
    const option = element('option', '', text);
    option.value = value;
    if (value === 'cohorts' && !enough) option.disabled = true;
    select.append(option);
  }
  select.value = currentComparison(state, board);
  select.addEventListener('change', () => {
    const next = currentState();
    next.cmp = select.value;
    for (const entry of board.panels) {
      if (!entry.panel) continue;
      const spec = entry.spec || {};
      writePanelSpec(next, entry.key, { ...spec, scope: { ...(spec.scope || {}), cmp: select.value } });
    }
    router.pushScope(stateUrl(next, globalThis.location?.search || '', path));
  });
  group.append(label, select);
  container.append(group);
}

async function renderBoard(container, record, state, schema, context, scopeControls = null, conflicts = []) {
  const tenant = context?.tenant || '';
  const board = assembleBoard({ presetId: record.presetId, state });
  if (board.kind === 'named') { renderNamedDestination(container, { ...record, label: board.label, title: board.title, phase: board.phase }); return; }
  if (board.kind !== 'board') { renderNotFound(container, { ...record, title: 'Page not found' }, tenant); container.append(element('p', 'notice', board.reason)); return; }
  container.append(element('h1', '', board.title));
  if (scopeControls) container.append(scopeControls.element);
  renderScopeBar(container, state);
  if (record.path === '/b/compare') mountComparison(container, state, board, router, record.path);
  if (context?.window) {
    for (const entry of board.panels) {
      entry.scope = { ...entry.scope, from: context.window.from || '', to: context.window.to || '' };
    }
  }
  const grid = element('div', 'panel-grid');

  const runtime = { grain: '', unit: '', population: null, selection: null, unmapped: '', chips: [] };
  const inspector = createInspector({ doc: document, router, onAction: detail => handleInspectorAction(detail, runtime, record) });
  activeBoardTeardown = () => inspector.destroy();
  const tray = createSelectionTray({ doc: document, router, path: record.path });
  const clearSelection = () => {
    runtime.selection = null;
    router.replaceTransient(stateUrl(withPick(currentState(), ''), globalThis.location?.search || '', record.path));
    updateTray();
  };
  const defaultGrain = board.panels.find(entry => entry.panel)?.panel?.grain || '';

  // A panel can name an applied filter, cohort or selection as the cause of an
  // empty result, but it never imports the router. This handle rebuilds the
  // current state without that cause and pushes it; the router re-renders.
  function clearPanelCause(cause = {}) {
    const state = currentState();
    let next = state;
    if (cause.kind === 'filter') {
      next = cause.key === 'exclude'
        ? removeExcludeChip(state, cause.value)
        : removeFilterChip(state, cause.key, cause.value);
    } else if (cause.kind === 'cohort') {
      next = removeCohortChip(state, cause.key);
    } else if (cause.kind === 'selection') {
      next = state.pick ? withPick(state, '') : { ...state, sel: '' };
    } else if (cause.kind === 'window') {
      next = { ...state, win: 'all', from: '', to: '' };
    } else {
      return;
    }
    router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
  }

  function updateTray() {
    tray.update({
      state: currentState(),
      pick: decodePick(currentState().pick),
      grain: runtime.grain || defaultGrain,
      unit: runtime.unit || runtime.population?.unit || defaultGrain || 'row',
      population: runtime.population,
      selection: runtime.selection,
      schema,
      search: globalThis.location?.search || '',
      onClear: clearSelection,
      now: Date.now()
    });
  }

  function updateChips() {
    for (const update of runtime.chips) update();
  }

  for (const entry of board.panels) {
    const span = board.spans?.[entry.panelId] || '6';
    if (conflicts.includes(entry.key)) {
      const blocked = element('section', 'workspace-panel blocked-panel');
      blocked.dataset.state = 'unsupported';
      blocked.dataset.span = span;
      blocked.append(
        element('h2', '', entry.panelId),
        element('p', 'disabled-reason', 'Saved panel scope conflicts with the global filters. Reset panel scope.')
      );
      const reset = element('button', '', 'Reset panel scope');
      reset.type = 'button';
      reset.addEventListener('click', () => {
        const next = resetPanelScope(currentState(), conflicts);
        router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
      });
      blocked.append(reset);
      grid.append(blocked);
      continue;
    }
    if (!entry.panel) {
      const missing = element('section', 'workspace-panel');
      missing.dataset.state = 'unsupported';
      missing.dataset.idle = 'true';
      missing.dataset.span = span;
      missing.append(element('h2', '', entry.panelId), element('p', 'disabled-reason', entry.reason));
      grid.append(missing);
      continue;
    }
    const panelRuntime = { population: null };
    const wrappedPanel = entry.panel.load
      ? {
        ...entry.panel,
        load: async loadContext => {
          const result = await entry.panel.load({ ...loadContext, clear: clearPanelCause, readContext: context });
          panelRuntime.population = result?.population || null;
          if (!runtime.population) runtime.population = panelRuntime.population;
          if (!runtime.unit && panelRuntime.population?.unit) runtime.unit = panelRuntime.population.unit;
          updateTray();
          return result;
        }
      }
      : entry.panel;
    const frame = createPanelFrame({
      panel: wrappedPanel, spec: entry.spec, scope: entry.scope, transport, scheduler, tenant, schema,
      editFilters: () => scopeControls?.focusFilters?.(),
      onAllHistory: () => clearPanelCause({ kind: 'window' }),
      onResetFilters: () => {
        const next = resetScopeState(currentState());
        if (record.path === '/b/compare') next.cmp = 'period';
        router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
      }
    });
    boardFrameTeardown.push(() => frame.destroy());
    const capability = createCapabilityInspector({ doc: document, panel: entry.panel, spec: entry.spec || {}, schema });
    frame.element.append(capability.element);

    const chips = createChips({ doc: document, router, path: record.path });
    frame.chipSlot.append(chips.element);
    const updateChipsForPanel = () => chips.update({
      state: currentState(),
      search: globalThis.location?.search || '',
      schema,
      grain: entry.panel.grain,
      unmapped: runtime.unmapped,
      onClearSelection: clearSelection
    });
    runtime.chips.push(updateChipsForPanel);
    updateChipsForPanel();

    frame.element.addEventListener('select', event => {
      const detail = event.detail || {};
      const selection = detail.selection || null;
      runtime.grain = entry.panel.grain;
      runtime.population = panelRuntime.population || runtime.population;
      runtime.unit = runtime.population?.unit || entry.panel.grain;
      // A rectangle carries an explicit Boolean predicate and the server's
      // exact population. It is a transient selection, never URL `pick` state;
      // the tray's buttons act on it directly.
      if (selection && typeof selection === 'object' && selection.predicate) {
        runtime.selection = selection;
        updateTray();
        return;
      }
      // The chart's raw rectangle event has no exact count yet; the scatter
      // panel re-emits it after its bounded count query. Neither writes `pick`.
      if (detail.source === 'scatter-rectangle' || detail.region) return;
      runtime.selection = selection || { include: [], exclude: [] };
      const pick = encodePick({ include: selection?.include || [], exclude: selection?.exclude || [] });
      router.replaceTransient(stateUrl(withPick(currentState(), pick), globalThis.location?.search || '', record.path));
    });
    frame.element.addEventListener('spec', event => {
      const spec = event.detail?.spec;
      if (!spec) return;
      const next = writePanelSpec(currentState(), entry.key, spec);
      router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
    });
    frame.element.addEventListener('scope', event => {
      const detail = event.detail || {};
      const from = typeof detail.from === 'string' ? Date.parse(detail.from) : Number(detail.from);
      const to = typeof detail.to === 'string' ? Date.parse(detail.to) : Number(detail.to);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
      const state = currentState();
      state.from = new Date(from).toISOString();
      state.to = new Date(to).toISOString();
      state.win = '';
      state.sel = '';
      router.pushScope(stateUrl(state, globalThis.location?.search || '', record.path));
    });
    frame.element.addEventListener('inspect', event => {
      const detail = event.detail || {};
      const spec = event.target?.spec || {};
      const entity = spec.entities?.[detail.key] || null;
      const series = event.target?.spec?.series || event.target?.inspect?.().series || [];
      const facts = Object.entries(detail.values || {}).map(([key, value]) => {
        const match = series.find(item => item.key === key);
        return { label: match?.label || key, value, unit: match?.unit || '' };
      });
      inspector.open({
        grain: entry.panel.grain,
        key: detail.key,
        values: detail.values,
        facts,
        entity,
        destination: entity?.destination || '',
        unit: panelRuntime.population?.unit || entry.panel.grain,
        population: panelRuntime.population,
        selection: runtime.selection,
        opener: (event.composedPath?.() || []).find(node => node?.dataset?.mark !== undefined)
          || event.target?.shadowRoot?.activeElement
          || event.target,
        openerHost: event.target,
        url: globalThis.location?.href || ''
      });
    });
    frame.element.addEventListener('filter', event => {
      const detail = event.detail || {};
      const series = event.target?.spec?.series || event.target?.inspect?.().series || [];
      const mapped = legendFocusFilter(detail, { series });
      if (!mapped) { runtime.unmapped = detail.key || ''; updateChips(); return; }
      runtime.unmapped = '';
      const next = addFilterChip(currentState(), mapped.filter, mapped.value);
      router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
    });
    frame.element.addEventListener('cohort', event => {
      const detail = event.detail || {};
      const selection = detail.selection || runtime.selection;
      if (!selection) return;
      const slot = `c${detail.slot || 'a'}`;
      try {
        const cohort = buildCohort({ state: currentState(), pick: { include: selection.include || [], exclude: selection.exclude || [] }, grain: entry.panel.grain, schema });
        router.pushScope(stateUrl(writeCohort(currentState(), slot, cohort), globalThis.location?.search || '', record.path));
      } catch { /* a cohort needs a selection; leaving the board unchanged is the contract */ }
    });
    frame.element.addEventListener('open', () => router.push(openListDestination(entry.panel.grain)));

    const missingFeature = (entry.panel.requires || []).find(feature => !featureAvailable(schema, feature));
    frame.element.dataset.span = span;
    grid.append(frame.element);
    if (missingFeature) {
      const source = entry.panel.capabilitySources?.[missingFeature]
        || entry.panel.requiresSource?.[missingFeature]
        || entry.panel.capabilitySource
        || 'this plan\'s server phases';
      frame.setState('unsupported', unsupportedState({ feature: missingFeature, reason: 'the server does not advertise it', source }));
      continue;
    }
    frame.load();
  }
  const layout = element('div', 'workspace-layout');
  layout.append(grid, inspector.element);
  container.append(layout, tray.element);
  updateTray();
  activeFollow = mountFollow(container, schema, tenant);
  mountSavedBoards(container, state);
}

function handleInspectorAction(detail, runtime, record) {
  if (!detail || detail.action === 'close' || detail.action === 'open' || detail.action === 'copy') return;
  const state = currentState();
  if (detail.action === 'filter') {
    const mapped = legendFocusFilter({ key: detail.key }, { series: [] });
    if (!mapped) { runtime.unmapped = String(detail.key ?? ''); runtime.chips.forEach(update => update()); return; }
    router.pushScope(stateUrl(addFilterChip(state, mapped.filter, mapped.value), globalThis.location?.search || '', record.path));
  } else if (detail.action === 'exclude' || detail.action === 'cohort') {
    if (!detail.key) return;
    const op = detail.action === 'exclude' ? 'exclude' : 'include';
    const next = writeCohort(
      op === 'exclude' ? { ...state, cmp: 'cohorts' } : state,
      nextCohortSlot(state) || 'ca',
      buildCohort({ state, pick: { include: [String(detail.key)], exclude: [] }, grain: detail.grain, schema: null, op })
    );
    router.pushScope(stateUrl(next, globalThis.location?.search || '', record.path));
  }
}

// Each explorer gets one route-scoped AbortController. Leaving the route aborts
// it (and any request it started); a module may also return a destroy function.
async function renderExplorer(container, record, context) {
  const controller = new AbortController();
  activeRouteTeardown = () => controller.abort();
  const module = await loadExplorer(record.explorer);
  if (controller.signal.aborted) return;
  const cleanup = await module.render?.(container, document, {
    signal: controller.signal, tenant: context?.tenant || '', readContext: context || null
  });
  if (typeof cleanup === 'function') {
    activeRouteTeardown = () => { controller.abort(); cleanup(); };
  }
  if (!module.render) container.append(element('h1', '', record.title), element('p', 'notice', record.label || record.title));
}

async function render(record) {
  const generation = beginRender();
  const path = record.path;
  let state = decodeUrlState(record.search);
  lastRecord = record;
  teardownActiveRoute();
  root.replaceChildren();
  root.dataset.route = path;
  setShellState('loading', 'false');
  markActiveNav(path, globalThis.location?.hash || '');
  const exempt = isAccountRoute(path);
  const sessionExempt = ['/login', '/oauth/callback'].includes(path);
  let me = null, meStatus = 0, hint = '';
  if (!sessionExempt) {
    const result = await loadSessionOnce();
    if (!renderIsCurrent(generation)) return;
    me = result.me; meStatus = result.status;
  }
  if (!renderIsCurrent(generation)) return;
  const decision = sessionGateDecision({ path, search: record.search, meStatus });
  if (!decision.stay && record.kind !== 'not-found') { location.replace(decision.redirect); return; }
  const noServer = meStatus !== 200;
  const localMode = noServer && isCollectorMode() && !resolvedBase();
  let bearer = '';
  try { bearer = (localStorage.getItem('yakka-analytics-key') || '').trim(); } catch {}
  const tokenBound = noServer && !isCollectorMode() && Boolean(bearer);

  // A not-found path performs no analytics read, so it renders before the
  // schema/facet/scope pipeline and without the signed-out data-route redirect.
  if (record.kind === 'not-found') {
    const authed = meStatus === 200 && Boolean(me);
    const auth = authorizedTenant({ me, urlTenant: state.tenant });
    mountTenantHeader({ me, meStatus, auth, state, localMode, signedOut: !authed && !tokenBound });
    renderNotFound(root, record, auth.tenant);
    setShellState('ready', 'true');
    return;
  }

  if (!exempt && noServer && !localMode && !tokenBound) hint = decision.hint || '';
  if (hint) {
    root.dataset.route = path;
    mountTenantHeader({ me, meStatus, state, localMode });
    root.append(element('h1', '', 'Connection'), element('p', '', hint));
    const link = element('a', '', 'Open Settings'); link.href = '/settings'; root.append(link);
    setShellState('ready', 'true');
    return;
  }

  if (exempt) {
    const account = ['/profile', '/settings', '/device'].includes(path) ? {
      api: transport,
      me,
      meStatus,
      tenant: '',
      onRefreshMe: refreshAccountSession,
      onSelectTenant: selectAccountTenant,
      onStatus: (text, error = false) => {
        if (!text) { root.querySelector('[data-account-status]')?.remove(); return; }
        let out = root.querySelector('[data-account-status]');
        if (!out) { out = element('p', 'account-status', ''); out.dataset.accountStatus = ''; root.append(out); }
        out.textContent = text;
        out.classList.toggle('error', error);
      }
    } : null;
    if (account) {
      const auth = authorizedTenant({ me, urlTenant: state.tenant });
      account.tenant = auth.tenant;
      mountTenantHeader({ me, meStatus, auth, state, localMode });
      if (path === '/profile' && !state.tenant && auth.tenant) {
        const next = { ...state, tenant: auth.tenant };
        globalThis.history.replaceState(null, '', stateUrl(next, record.search, path));
        state = decodeUrlState(globalThis.location?.search || '');
        try { localStorage.setItem('yakka-analytics-tenant', auth.tenant); } catch {}
      }
      root.append(element('h1', '', record.title));
      await renderIdentity(root, path, transport, me, () => renderIsCurrent(generation), account);
      if (!renderIsCurrent(generation)) return;
      if (pendingAccountFocus) { const id = pendingAccountFocus; pendingAccountFocus = ''; focusAccountRow(id); }
      setShellState('ready', 'true');
      return;
    }
    mountTenantHeader({ me, meStatus, state, localMode, signedOut: true });
    root.append(element('h1', '', record.title));
    await renderIdentity(root, path, transport, me, () => renderIsCurrent(generation));
    if (!renderIsCurrent(generation)) return;
    setShellState('ready', 'true');
    return;
  }

  lastMe = me;
  lastMeStatus = meStatus;
  let auth = authorizedTenant({ me, urlTenant: state.tenant });
  if (state.tenant && generationMismatch.has(state.tenant)) auth = { tenant: '', unavailable: true, source: 'lifecycle' };
  mountTenantHeader({ me, meStatus, auth, state, localMode: localMode || tokenBound });
  if (auth.unavailable) {
    root.append(
      element('h1', '', record.title || 'Tenant unavailable'),
      element('p', 'tenant-unavailable', auth.reason === 'cleanup' ? 'This tenant is being reset or deleted. Choose it again when that finishes.' : 'This tenant is unavailable to your account.')
    );
    const choose = element('button', '', 'Choose a tenant');
    choose.type = 'button';
    choose.addEventListener('click', () => { if (tenantSelect.disabled) globalThis.location.assign('/profile'); else tenantSelect.focus(); });
    root.append(choose);
    setShellState('ready', 'true');
    return;
  }
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  if (meStatus === 200 && !tenants.length) {
    root.append(element('h1', '', record.title || 'Analytics'), element('p', '', 'Create a tenant to view analytics'));
    const profile = element('a', '', 'Open Profile'); profile.href = '/profile';
    root.append(profile);
    setShellState('ready', 'true');
    return;
  }

  // A missing initial tenant is canonicalized with replaceState; a later
  // committed edit pushes exactly once through the router.
  if (!state.tenant && auth.tenant) {
    const next = { ...state, tenant: auth.tenant };
    globalThis.history.replaceState(null, '', stateUrl(next, record.search, path));
    state = decodeUrlState(globalThis.location?.search || '');
  }
  if (auth.tenant) { try { localStorage.setItem('yakka-analytics-tenant', auth.tenant); } catch {} }

  // Unambiguous saved panel scope becomes visible global scope once. A global
  // field always wins; disagreeing overrides block their panels.
  const promotions = panelOverridePlan(state);
  if (Object.keys(promotions.promotions).length) {
    const promoted = applyPromotions(state, promotions.promotions);
    globalThis.history.replaceState(null, '', stateUrl(promoted, globalThis.location?.search || '', path));
    state = decodeUrlState(globalThis.location?.search || '');
  }
  const conflicts = panelOverridePlan(state).conflicts;

  const context = resolveReadContext({ me, state, now: Date.now(), tenant: auth.tenant, generation });
  const tenant = context.tenant;
  let schema = null;
  try {
    const result = await transport.schema(tenant);
    if (!renderIsCurrent(generation)) return;
    if (result.response.ok && !result.error) schema = result.body;
    else if (shouldRecoverTenant({ status: result.response.status, error: result.body?.error, me, path }) && path !== '/profile') { location.assign('/profile'); return; }
    else {
      const node = document.querySelector('#schema-status');
      const reason = result.error?.message || (result.response.status === 401
        ? 'Connection was rejected. Check the API base and bearer in Settings.'
        : legacyErrorMessage(result.body));
      const retry = element('button', '', 'fresh read');
      retry.type = 'button';
      retry.addEventListener('click', () => { transport.invalidateSchema(tenant); render(record); }, { once: true });
      node.replaceChildren(document.createTextNode(`Schema unavailable: ${reason} `), retry);
    }
    if (schema) {
      const warnings = Array.isArray(result.warnings) ? result.warnings : [];
      const unreadable = warnings.length ? `; unreadable schema sections: ${warnings.map(warning => warning.path || 'unknown').join(', ')}` : '';
      document.querySelector('#schema-status').textContent = `${Object.keys(schema.features || {}).length} server capabilities detected${unreadable}`;
    }
  } catch {
    if (!renderIsCurrent(generation)) return;
    const node = document.querySelector('#schema-status');
    const retry = element('button', '', 'fresh read');
    retry.type = 'button';
    retry.addEventListener('click', () => { transport.invalidateSchema(tenant); render(record); }, { once: true });
    node.replaceChildren(document.createTextNode('Connection failed. Check the API base and bearer in Settings. '), retry);
  }
  if (!renderIsCurrent(generation)) return;

  const features = schema?.features || {};
  const scopeControls = createScopeControls({
    doc: document,
    state,
    schema,
    transport,
    readContext: context,
    facetsFetch: Boolean(features.event_counts || features.record_filters || features.facets),
    resetCmp: record.path === '/b/compare' ? 'period' : 'off',
    onCommit: next => {
      if (!renderIsCurrent(generation)) return;
      router.pushScope(stateUrl(next, globalThis.location?.search || '', path));
    },
    onRefresh: () => router.resolve()
  });
  activeScopeDestroy = () => scopeControls.destroy();
  scopeControls.update(state, { schema, context });

  if (record.kind === 'start') {
    root.append(element('h1', '', 'Start'), scopeControls.element);
    renderQuestionPaths(root, schema, tenant);
    mountSavedBoards(root, state);
  } else if (record.kind === 'board') {
    await renderBoard(root, record, state, schema, context, scopeControls, conflicts);
  } else if (record.kind === 'named') {
    root.append(element('h1', '', record.title), scopeControls.element);
    renderScopeBar(root, state);
    renderCoverageStrip(root, schema);
    renderNamedDestination(root, record);
  } else if (record.kind === 'explorer') {
    await renderExplorer(root, record, context);
    if (!renderIsCurrent(generation)) return;
    const heading = root.querySelector('h1');
    if (heading?.after) heading.after(scopeControls.element);
    else root.prepend(scopeControls.element);
    scopeControls.update(state, { schema, context });
  } else {
    renderNotFound(root, record, context?.tenant || '');
  }
  if (!renderIsCurrent(generation)) return;
  setShellState('ready', 'true');
}

const router = createRouter({ onRoute: render });

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.dataset.themePreference = next;
  try { localStorage.setItem('yakka-analytics-theme', next); } catch {}
});

globalThis.addEventListener('hashchange', () => {
  const record = lastRecord || router.current();
  markActiveNav(record.path, globalThis.location?.hash || '');
});
globalThis.addEventListener('focus', () => { revalidateSession().catch(() => {}); });
globalThis.addEventListener('pageshow', event => { if (event.persisted) revalidateSession().catch(() => {}); });

router.resolve();
