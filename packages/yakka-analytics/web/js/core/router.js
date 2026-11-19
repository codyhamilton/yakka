// Path+query to a route record, the client route table, and the push/replace
// decision. The same index.html answers every client route; unknown paths stay
// an in-shell not-found view. Later-phase destinations are named, never dead.

import { isPresetId, lookupPreset, presetDestination } from '../boards/presets.js';

export const ACCOUNT_PATHS = ['/login', '/oauth/callback', '/device', '/profile', '/settings'];
export const START_PATH = '/';
export const EXPLORER_PATHS = new Map([['/ledger', 'ledger'], ['/ops', 'ops'], ['/sessions', 'sessions'], ['/artifact', 'artifact'], ['/plans', 'plans']]);

export function normalizePath(pathname = '/') {
  const path = String(pathname || '/').replace(/\/+$/, '');
  return path || '/';
}

// Each path segment is percent-decoded exactly once, so a repo id containing a
// slash round-trips (`/plans/acme%2Fwidgets/20-analytics-reset`). A malformed
// escape or an empty segment is not-found, never guessed.
function decodeSegment(raw = '') {
  try {
    const value = decodeURIComponent(raw);
    return value && value !== '.' && value !== '..' ? value : '';
  } catch {
    return '';
  }
}

export function parseRoute(pathname = '/', search = '') {
  const path = normalizePath(pathname);
  if (path === START_PATH) return { kind: 'start', path, search, title: 'Start' };
  const board = /^\/b\/([^/]+)$/.exec(path);
  if (board) {
    const presetId = board[1];
    if (!isPresetId(presetId) && !lookupPreset(presetId)) return { kind: 'not-found', path, search, title: 'Not found' };
    const destination = presetDestination(presetId);
    if (destination?.kind === 'named') {
      return { kind: 'named', path, search, title: destination.title, phase: destination.phase, label: destination.label, presetId };
    }
    return { kind: 'board', path, search, title: destination?.title || presetId, presetId };
  }
  const sessionDetail = /^\/sessions\/([^/]+)$/.exec(path);
  if (sessionDetail) {
    return { kind: 'explorer', path, search, explorer: 'sessions', sessionId: decodeURIComponent(sessionDetail[1]), title: 'Session' };
  }
  const planDetail = /^\/plans\/([^/]+)\/([^/]+)$/.exec(path);
  if (planDetail) {
    const repo_id = decodeSegment(planDetail[1]);
    const plan = decodeSegment(planDetail[2]);
    if (!repo_id || !plan) return { kind: 'not-found', path, search, title: 'Not found' };
    return { kind: 'explorer', path, search, explorer: 'plans', plan: { repo_id, plan }, title: 'Plan' };
  }
  if (EXPLORER_PATHS.has(path)) {
    const explorer = EXPLORER_PATHS.get(path);
    const title = explorer === 'ledger' ? 'Ledger' : explorer === 'sessions' ? 'Sessions' : explorer === 'artifact' ? 'Artifact' : explorer === 'plans' ? 'Plans' : 'Operations';
    return { kind: 'explorer', path, search, explorer, title };
  }
  if (ACCOUNT_PATHS.includes(path)) return { kind: 'account', path, search, title: accountTitle(path) };
  return { kind: 'not-found', path, search, title: 'Not found' };
}

function accountTitle(path) {
  return {
    '/login': 'Sign in', '/oauth/callback': 'Sign in callback', '/device': 'Device approval',
    '/profile': 'Profile', '/settings': 'Settings'
  }[path] || 'Account';
}

export function isAccountRoute(pathname) {
  return ACCOUNT_PATHS.includes(normalizePath(pathname));
}

export async function loadExplorer(kind) {
  if (kind === 'ledger') return import('../explorers/ledger.js');
  if (kind === 'ops') return import('../ops.js');
  if (kind === 'sessions') return import('../explorers/sessions.js');
  if (kind === 'artifact') return import('../explorers/artifact.js');
  if (kind === 'plans') return import('../explorers/plans.js');
  throw new Error(`unknown explorer ${kind}`);
}

// One router. Scope/filter/cohort/compare changes call push(); hover and an
// in-progress drag call replaceTransient() so history is not polluted. A
// committed brush replaces its transient parameter and zoom pushes.
export function createRouter({ onRoute, windowRef = globalThis.window } = {}) {
  function current() {
    return parseRoute(windowRef.location.pathname, windowRef.location.search);
  }

  function dispatch() {
    const record = current();
    onRoute?.(record);
    return record;
  }

  function navigate(url, { mode = 'push', state = null } = {}) {
    const target = new URL(url, windowRef.location.href);
    const next = `${target.pathname}${target.search}${target.hash}`;
    const now = `${windowRef.location.pathname}${windowRef.location.search}${windowRef.location.hash}`;
    if (next === now) { dispatch(); return current(); }
    if (mode === 'replace') windowRef.history.replaceState(state, '', next);
    else windowRef.history.pushState(state, '', next);
    return dispatch();
  }

  const onPop = () => dispatch();
  windowRef.addEventListener('popstate', onPop);

  return {
    resolve: dispatch,
    current,
    navigate,
    push: (url, options = {}) => navigate(url, { ...options, mode: 'push' }),
    replace: (url, options = {}) => navigate(url, { ...options, mode: 'replace' }),
    pushScope: (url, options = {}) => navigate(url, { ...options, mode: 'push' }),
    replaceTransient: (url, options = {}) => navigate(url, { ...options, mode: 'replace' }),
    destroy() { windowRef.removeEventListener('popstate', onPop); }
  };
}
