import { decodeUrlState } from '../contract/url-state.js';
import { createScheduler } from './core/request-scheduler.js';
import { createTransport } from '../contract/transport.js';
import { legacyErrorMessage } from './core/legacy-error.js';
import { rememberedTenant, sessionGateDecision, shouldRecoverTenant } from '../contract/session-gate.js';
import { renderIdentity } from './identity/flows.js';
import { createRouter, isAccountRoute, loadExplorer } from './core/router.js';
import { createFollow } from './core/follow.js';
import { encodePanelSpec } from './core/view-spec.js';
import { assembleBoard } from './boards/board.js';
import { createPanelFrame } from './panels/panel-frame.js';
import { currentBoardUrl, readBoards, saveBoard, deleteBoard, openBoard } from './core/saved-boards.js';

const root = document.querySelector('#app');
const scheduler = createScheduler({ onChange: ({ inFlight }) => {
  const status = document.querySelector('#request-status');
  status.dataset.inflight = String(inFlight);
  status.textContent = `${inFlight} requests in flight`;
} });
const transport = createTransport(scheduler);
let sessionPromise;
function loadSessionOnce() {
  if (!sessionPromise) sessionPromise = transport.request('me').then(result => {
    const valid = result.response.status !== 200 || (result.body && Array.isArray(result.body.tenants) && result.body.github_id !== undefined);
    return { me: result.body, status: valid ? result.response.status : 0 };
  }).catch(() => ({ me: null, status: 0 }));
  return sessionPromise;
}

function panelHref(grain, measures, split, chart) {
  return `p1=${encodeURIComponent(encodePanelSpec({ grain, measures, split, chart }))}`;
}

// The fixed question paths. Cost 3, quality 5, plans 3, activity 3, health 1.
// A path opens its configured board or explorer state, or is disabled with the
// reason when /schema lacks what it needs. Later-phase destinations are named
// and are never dead.
export const QUESTION_PATHS = [
  { group: 'Cost', label: 'Where did the money go this week against last?', href: '/b/cost?win=7d&cmp=period' },
  { group: 'Cost', label: 'Which model gives the most output per dollar?', href: `/b/scatter?win=30d&${panelHref('session', ['cost_usd', 'commits'], 'session_model', 'scatter')}`, requires: ['entities_session'] },
  { group: 'Cost', label: 'How much of my spend cannot be priced?', href: '/b/pulse?win=30d' },
  { group: 'Quality', label: 'How do design, brief and report scores differ by harness?', href: `/b/quality?win=30d&${panelHref('content', ['score'], 'harness', 'ranges')}`, requires: ['scores_by_lens'] },
  { group: 'Quality', label: 'Quality by model and by repo over time', href: `/b/quality?win=90d&${panelHref('content', ['score'], 'session_model', 'lines')}`, requires: ['scores_by_lens'] },
  { group: 'Quality', label: 'Do expensive sessions write better artifacts?', href: `/b/scatter?win=30d&${panelHref('artifact', ['cost_usd', 'score'], 'session_model', 'scatter')}`, requires: ['entities_session', 'entities_artifact'] },
  { group: 'Quality', label: 'Which artifacts scored lowest?', href: `/b/quality?win=30d&${panelHref('artifact', ['score'], 'kind', 'strip')}`, requires: ['entities_artifact', 'scores_by_lens'] },
  { group: 'Quality', label: 'Am I better than my usual?', href: `/b/quality?win=30d&${panelHref('content', ['score'], 'kind', 'ranges')}`, requires: ['scores_by_lens'] },
  { group: 'Plans', label: 'Which brief runs have no report or commit yet?', href: `/b/workflow?win=30d&${panelHref('execution', ['ts'], 'shape', 'bars')}`, requires: ['entities_execution'] },
  { group: 'Plans', label: 'What did this plan contain, and how did the design change?', href: '/plans', requires: ['entities_plan'] },
  { group: 'Plans', label: 'Which plans cost the most for what they produced?', href: `/b/scatter?win=30d&${panelHref('plan', ['associated_cost_usd', 'artifacts'], 'repo_id', 'scatter')}`, requires: ['entities_plan'] },
  { group: 'Activity', label: 'What just happened?', href: '/b/pulse?win=1d', requires: ['activity'] },
  { group: 'Activity', label: 'When do I work?', href: '/b/pulse?win=90d' },
  { group: 'Activity', label: 'How do harnesses use tools?', href: '/b/tools?win=30d' },
  { group: 'Health', label: 'What is unscored, unpriced, unattributed or rejected?', href: '/ops' }
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
  const strip = element('section', 'coverage-strip');
  strip.setAttribute('aria-label', 'Coverage');
  strip.append(element('strong', '', 'Coverage'));
  for (const [label, value] of [['first', coverage.first_ts || coverage.firstTs], ['last', coverage.last_ts || coverage.lastTs], ['received', coverage.last_received_at || coverage.lastReceivedAt]]) {
    if (value) strip.append(element('span', 'coverage-item', `${label} ${value}`));
  }
  if (coverage.scorer_configured === false) strip.append(element('span', 'coverage-item', 'no scorer configured'));
  container.append(strip);
}

function renderQuestionPaths(container, schema) {
  const intro = element('p', 'muted', 'Explore the analytics this server supports. Every path opens a configured board or explorer, or says why the server cannot answer it.');
  container.append(intro);
  const groups = new Map();
  for (const path of QUESTION_PATHS) {
    if (!groups.has(path.group)) groups.set(path.group, []);
    groups.get(path.group).push(path);
  }
  for (const [group, paths] of groups) {
    const section = element('section', 'question-group');
    section.append(element('h2', '', group));
    const list = element('ul', 'question-paths');
    for (const path of paths) {
      const item = element('li');
      const availability = pathAvailability(path, schema);
      if (availability.ok) {
        const link = element('a', '', path.label);
        link.href = path.href;
        item.append(link);
      } else {
        const label = element('span', 'disabled-path', path.label);
        label.setAttribute('aria-disabled', 'true');
        item.append(label, element('span', 'disabled-reason', availability.reason));
      }
      list.append(item);
    }
    section.append(list);
    container.append(section);
  }
}

function renderNamedDestination(container, record) {
  container.append(element('h1', '', record.title));
  const notice = element('p', 'notice', record.label || `Delivered in Phase ${record.phase}: ${record.title}`);
  container.append(notice);
}

function renderNotFound(container, record) {
  container.append(element('h1', '', 'Not found'));
  container.append(element('p', 'notice', `No workspace route matches ${record.path}.`));
  const nav = element('nav', 'not-found-routes');
  nav.setAttribute('aria-label', 'Workspace routes');
  for (const route of SHELL_ROUTES) {
    const link = element('a', '', route);
    link.href = route;
    nav.append(link);
  }
  container.append(nav);
}

function mountSavedBoards(container, state) {
  const section = element('section', 'saved-boards');
  section.append(element('h2', '', 'Saved boards'));
  const list = element('ul', 'saved-board-list');
  const render = () => {
    list.replaceChildren();
    const boards = readBoards();
    if (!boards.length) list.append(element('li', 'muted', 'No saved boards yet.'));
    for (const board of boards) {
      const item = element('li');
      item.append(element('span', '', board.name), document.createTextNode(' '));
      const open = element('button', '', 'Open');
      open.type = 'button';
      open.addEventListener('click', () => openBoard(board.name));
      const remove = element('button', '', 'Delete');
      remove.type = 'button';
      remove.addEventListener('click', () => { deleteBoard(board.name); render(); });
      item.append(open, remove);
      list.append(item);
    }
  };
  const form = element('form', 'save-board');
  const input = element('input');
  input.name = 'board-name';
  input.placeholder = 'Board name';
  input.setAttribute('aria-label', 'Board name');
  const save = element('button', '', 'Save current view');
  save.type = 'submit';
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    saveBoard(name, currentBoardUrl());
    input.value = '';
    render();
  });
  form.append(input, save);
  section.append(form, list);
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

async function renderBoard(container, record, state, schema, tenant) {
  renderScopeBar(container, state);
  renderCoverageStrip(container, schema);
  const board = assembleBoard({ presetId: record.presetId, state });
  if (board.kind === 'named') { renderNamedDestination(container, { ...record, label: board.label, title: board.title, phase: board.phase }); return; }
  if (board.kind !== 'board') { renderNotFound(container, record); container.append(element('p', 'notice', board.reason)); return; }
  container.append(element('h1', '', board.title));
  const grid = element('div', 'panel-grid');
  for (const entry of board.panels) {
    if (!entry.panel) {
      const missing = element('section', 'workspace-panel');
      missing.dataset.state = 'unsupported';
      missing.dataset.idle = 'true';
      missing.append(element('h2', '', entry.panelId), element('p', 'disabled-reason', entry.reason));
      grid.append(missing);
      continue;
    }
    const frame = createPanelFrame({ panel: entry.panel, spec: entry.spec, scope: entry.scope, transport, scheduler, tenant });
    grid.append(frame.element);
    frame.load();
  }
  container.append(grid);
  mountFollow(container, schema, tenant);
  mountSavedBoards(container, state);
}

async function renderExplorer(container, record) {
  const module = await loadExplorer(record.explorer);
  module.render?.(container, document);
  if (!module.render) container.append(element('h1', '', record.title), element('p', 'notice', record.label || record.title));
}

async function render(record) {
  const path = record.path;
  const state = decodeUrlState(record.search);
  root.replaceChildren();
  root.dataset.route = path;
  setShellState('loading', 'false');
  const exempt = isAccountRoute(path);
  let me = null, meStatus = 0, hint = '';
  if (!exempt) {
    const result = await loadSessionOnce(); me = result.me; meStatus = result.status;
  }
  const decision = sessionGateDecision({ path, search: record.search, meStatus });
  if (!decision.stay) { location.replace(decision.redirect); return; }
  if (!exempt && meStatus !== 200) hint = decision.hint || '';
  if (hint) {
    root.dataset.route = path;
    root.append(element('h1', '', 'Connection'), element('p', '', hint));
    const link = element('a', '', 'Open Settings'); link.href = '/settings'; root.append(link);
    setShellState('ready', 'true');
    return;
  }

  if (exempt) {
    root.append(element('h1', '', record.title));
    await renderIdentity(root, path, transport, me);
    setShellState('ready', 'true');
    return;
  }

  const tenant = rememberedTenant(me);
  let schema = null;
  try {
    const result = await transport.schema(tenant);
    if (result.response.ok) schema = result.body;
    else if (shouldRecoverTenant({ status: result.response.status, error: result.body?.error, me, path }) && path !== '/profile') { location.assign('/profile'); return; }
    else {
      const node = document.querySelector('#schema-status');
      node.textContent = result.response.status === 401 ? 'Connection was rejected. Check the API base and bearer in Settings.' : legacyErrorMessage(result.body);
    }
    if (schema) document.querySelector('#schema-status').textContent = `${Object.keys(schema.features || {}).length} server capabilities detected`;
  } catch {
    document.querySelector('#schema-status').textContent = 'Connection failed. Check the API base and bearer in Settings.';
  }

  if (record.kind === 'start') {
    root.append(element('h1', '', 'Start'));
    renderQuestionPaths(root, schema);
    renderCoverageStrip(root, schema);
  } else if (record.kind === 'board') {
    await renderBoard(root, record, state, schema, tenant);
  } else if (record.kind === 'named') {
    renderScopeBar(root, state);
    renderCoverageStrip(root, schema);
    renderNamedDestination(root, record);
  } else if (record.kind === 'explorer') {
    await renderExplorer(root, record);
  } else {
    renderNotFound(root, record);
  }
  setShellState('ready', 'true');
}

const router = createRouter({ onRoute: render });

document.querySelector('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.dataset.themePreference = next;
  try { localStorage.setItem('yakka-analytics-theme', next); } catch {}
});

router.resolve();
