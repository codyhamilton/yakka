// One resolved read context for a tenant-bound analytics view. It captures the
// selected tenant and resolves a relative browser window once into absolute API
// bounds, so every request and cursor continuation shares the same scope and no
// request carries a relative `win`. `paramsFor` is the only request builder the
// shell panels need; it never emits `win`.

import { rememberedTenant } from '../../contract/session-gate.js';
import { isCollectorMode, resolvedBase } from '../../contract/transport.js';

export const WINDOW_MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, y: 365 * 86400e3 };

// Filter names the workspace declares. A name outside this set is never sent.
const DECLARED_FILTERS = new Set([
  'repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id',
  'session_model', 'session_repo', 'origin', 'has_artifacts', 'id'
]);

function iso(value) {
  if (value === null || value === undefined || value === '') return '';
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function resolveWindow(state = {}, now = Date.now()) {
  const win = String(state.win || '30d');
  if (win === 'all') return { all: true, from: '', to: iso(state.to) || iso(now) };
  if (state.from || state.to) {
    const to = iso(state.to) || iso(now);
    return { all: false, from: iso(state.from), to };
  }
  const match = /^(\d+)([hdwmy])$/.exec(win);
  if (!match) return { all: false, from: iso(now - 30 * WINDOW_MS.d), to: iso(now) };
  return { all: false, from: iso(now - Number(match[1]) * WINDOW_MS[match[2]]), to: iso(now) };
}

// Flatten a URL state (nested `filters`) or a board scope (flat filters) into
// one filter map. Only declared names survive.
function declaredFilters(scope = {}) {
  const filters = {};
  const add = (key, value) => {
    if (!DECLARED_FILTERS.has(key)) return;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item !== 'string' || !item) continue;
      (filters[key] ??= []).push(item);
    }
  };
  for (const [key, values] of Object.entries(scope.filters || {})) add(key, values);
  for (const [key, value] of Object.entries(scope)) {
    if (['filters', 'exclude', 'cohorts', 'from', 'to', 'tz', 'win', 'cmp', 'pick', 'sel', 'hide'].includes(key)) continue;
    add(key, value);
  }
  return filters;
}

function applyExtra(params, extra) {
  if (!extra) return params;
  if (extra instanceof URLSearchParams) {
    for (const [key, value] of extra) params.append(key, value);
  } else {
    for (const [key, value] of Object.entries(extra)) {
      if (Array.isArray(value)) { for (const item of value) params.append(key, item); }
      else if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
  }
  return params;
}

export function resolveReadContext({ me = null, state = {}, now = Date.now() } = {}) {
  const tenant = rememberedTenant(me);
  const tz = state.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const window = resolveWindow(state, now);
  const scope = { ...state, from: window.from, to: window.to };
  delete scope.win;

  function paramsFor(extra) {
    const params = new URLSearchParams();
    if (window.all) {
      params.set('all', '1');
      if (window.to) params.set('to', window.to);
    } else {
      if (window.from) params.set('from', window.from);
      if (window.to) params.set('to', window.to);
    }
    params.set('tz', tz);
    for (const [key, values] of Object.entries(declaredFilters(scope))) {
      for (const value of values) params.append(key, value);
    }
    for (const raw of scope.exclude || []) {
      const text = String(raw || '');
      const lens = text.slice(0, text.indexOf(':'));
      if (DECLARED_FILTERS.has(lens)) params.append('exclude', text);
    }
    for (const value of Object.values(scope.cohorts || {})) {
      if (typeof value === 'string' && value) params.append('cohort', value);
    }
    return applyExtra(params, extra);
  }

  return {
    base: resolvedBase(),
    authMode: isCollectorMode() ? 'collector' : 'direct',
    tenant,
    tz,
    scope,
    window,
    paramsFor
  };
}

export default resolveReadContext;
