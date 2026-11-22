// Plan 30 phase 3 proof harness. It wraps the real Plan 30 Go fixture
// (plan30/harness.mjs) and adds only additive browser helpers:
//
//  - a stateful, contract-faithful account stub for /v1/me, /v1/tokens,
//    /v1/tenants, token revoke, /logout, /oauth/callback and the device routes.
//    It matches the existing API field names and A1-A6 shapes exactly.
//  - a lifecycle helper that opens the real Go template at the fixture's
//    upstream origin and stubs /v1/me, the destructive reset/delete calls, and
//    the lifecycle page's own GET /v1/analytics/event-counts read. Nothing else
//    analytics is intercepted.
//  - 1440x900 light/dark screenshots under gitignored .scratch/ and mockup
//    PNG/source path helpers.
//
// No production fixture mode, no fixed sleeps. The event-counts reply is the
// lifecycle page's confirmation read, not an analytics surface.

import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startPlan30Harness } from '../plan30/harness.mjs';
import { pngSize, mockupsRoot } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
export const phase3ScreensRoot = resolve(repoRoot, '.scratch', 'plan30-chrome', 'phase3-screens');

export const PHASE3_SCREENS = [
  { id: 'profile', mockup: 'profile', src: 'profile.html', h1: 'Account, tenants & tokens' },
  { id: 'settings', mockup: 'settings', src: 'settings.html', h1: 'Connection settings' },
  { id: 'login', mockup: 'login', src: 'login.html', h1: 'Sign in' },
  { id: 'callback', mockup: 'callback', src: 'callback.html', h1: 'Completing sign in' },
  { id: 'device', mockup: 'device', src: 'device.html', h1: 'Device approval' },
  { id: 'notfound', mockup: 'notfound', src: 'notfound.html', h1: 'Page not found' },
  { id: 'lifecycle', mockup: 'lifecycle', src: 'lifecycle.html', h1: 'Tenant lifecycle' }
];

export const mockupPng = name => resolve(mockupsRoot, `${name}.png`);
export const mockupSrc = name => resolve(mockupsRoot, 'src', name);
export { pngSize, mockupsRoot };

export async function startPhase3Harness() {
  await mkdir(phase3ScreensRoot, { recursive: true });
  const harness = await startPlan30Harness();

  const routeUrl = (route, { tenant } = {}) => {
    if (!tenant) return route;
    return `${route}${route.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenant)}`;
  };

  const go = async (page, route, options) => {
    await page.goto(`${harness.origin}${routeUrl(route, options)}`);
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  };

  const setTheme = async (page, theme) => {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  };

  // C10 proof: toggle the real Theme button instead of writing data-theme.
  const toggleTheme = async (page, theme) => {
    for (let tries = 0; tries < 4; tries += 1) {
      const current = await page.evaluate(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
      if (current === theme) return;
      await page.locator('#theme-toggle').click();
    }
    await page.waitForFunction(value => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') === value, theme);
  };

  const screenshot = async (page, id, theme) => {
    const file = resolve(phase3ScreensRoot, `${id}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  };

  const lifecycleUrl = (tenant) => `${harness.upstreamOrigin}/profile/lifecycle${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`;

  return {
    ...harness,
    screensRoot: phase3ScreensRoot,
    mockupsRoot,
    routeUrl,
    go,
    setTheme,
    toggleTheme,
    screenshot,
    lifecycleUrl,
    pngSize,
    mockupPng,
    mockupSrc
  };
}

const jsonHeaders = request => {
  const origin = request.headers()['origin'];
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {})
  };
};

function capture(map, request, body) {
  const url = new URL(request.url());
  const entry = {
    method: request.method(),
    path: url.pathname,
    search: url.search,
    body,
    headers: request.headers(),
    resourceType: request.resourceType()
  };
  map.push(entry);
  return entry;
}

function installHold() {
  const holds = new Map();
  return {
    hold(path) {
      let releaseGate;
      const gate = new Promise(done => { releaseGate = done; });
      let startResolve;
      const started = new Promise(done => { startResolve = done; });
      holds.set(path, { gate, startResolve });
      return {
        started,
        release() {
          const entry = holds.get(path);
          holds.delete(path);
          releaseGate();
          return entry;
        }
      };
    },
    async pass(request) {
      const entry = holds.get(new URL(request.url()).pathname);
      if (!entry) return;
      entry.startResolve();
      await entry.gate;
    }
  };
}

const initialAccountTenants = () => [
  { id: 'tenant-a', name: 'Alpha', lifecycle_state: 'active', lifecycle_generation: 3 },
  { id: 'tenant-b', name: 'Beta', lifecycle_state: 'active', lifecycle_generation: 5 },
  { id: 'tenant-p', name: 'Resetting', lifecycle_state: 'resetting', lifecycle_generation: 1 }
];

const initialAccountTokens = () => [
  { id: 'token-a1', name: 'alpha-active', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: false, created_at: '2026-11-12T12:00:00Z', expires_at: '2099-12-12T12:00:00Z' },
  { id: 'token-a2', name: 'alpha-expired', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read_write', revoked: false, created_at: '2026-10-01T12:00:00Z', expires_at: '2000-10-15T12:00:00Z' },
  { id: 'token-a3', name: 'alpha-revoked', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: true, created_at: '2026-09-01T12:00:00Z', expires_at: '2099-12-01T12:00:00Z' },
  { id: 'token-a4', name: 'alpha-second', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: false, created_at: '2026-11-10T12:00:00Z', expires_at: '2099-12-10T12:00:00Z' },
  { id: 'token-b1', name: 'beta-active', tenant: 'tenant-b', tenant_name: 'Beta', scope: 'read_write', revoked: false, created_at: '2026-11-15T12:00:00Z', expires_at: '2099-02-15T12:00:00Z' }
];

const API_ROUTE = /\/v1\/(?:me|tokens|tenants|device)(?:\/|$)/;

export async function installAccountStub(page) {
  const state = {
    tenants: initialAccountTenants(),
    tokens: initialAccountTokens(),
    requests: [],
    callbacks: [],
    device: [],
    status: { me: 200, tokens: 200, createTenant: 201, token: 201, revoke: 204, logout: 204, grant: 200, authorize: 200, callback: 200 },
    emptyTenants: false
  };
  const hold = installHold();
  let maxInFlight = 0;
  let inFlight = 0;

  const reset = () => {
    state.tenants = initialAccountTenants();
    state.tokens = initialAccountTokens();
    state.requests.length = 0;
    state.callbacks.length = 0;
    state.device.length = 0;
    state.status = { me: 200, tokens: 200, createTenant: 201, token: 201, revoke: 204, logout: 204, grant: 200, authorize: 200, callback: 200 };
    state.emptyTenants = false;
    maxInFlight = 0;
  };
  const calls = (path, method) => state.requests.filter(entry => entry.path === path && (!method || entry.method === method));

  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() || '';
    const entry = capture(state.requests, request, body);
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { ...jsonHeaders(request), 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept' }, body: '' });
    }
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const json = (status, value) => route.fulfill({ status, headers: jsonHeaders(request), body: JSON.stringify(value) });
    const empty = status => route.fulfill({ status, headers: jsonHeaders(request), body: '' });
    try {
      await hold.pass(request);

      if (url.pathname === '/v1/me') {
        if (state.status.me !== 200) return await json(state.status.me, { error: state.status.me === 401 ? 'unauthorized' : 'me failed' });
        return await json(200, { github_id: 4242, github_login: 'fixture-user', admin: false, tenants: state.emptyTenants ? [] : state.tenants });
      }
      if (url.pathname === '/v1/tokens' && request.method() === 'GET') {
        if (state.status.tokens !== 200) return await json(state.status.tokens, { error: 'tokens failed' });
        return await json(200, state.tokens);
      }
      if (url.pathname === '/v1/tokens' && request.method() === 'POST') {
        if (state.status.token !== 201) return await json(state.status.token, { error: 'token failed' });
        const payload = JSON.parse(body || '{}');
        const tenant = state.tenants.find(item => item.id === payload.tenant);
        const minted = {
          id: `token-new-${state.tokens.length + 1}`,
          token: 'fixture-plaintext-token',
          tenant: payload.tenant,
          tenant_name: tenant?.name || '',
          name: payload.name || 'token',
          scope: payload.scope,
          revoked: false,
          created_at: '2026-11-20T12:00:00Z',
          expires_at: '2099-02-20T12:00:00Z'
        };
        state.tokens = [...state.tokens, minted];
        return await json(201, minted);
      }
      const revoke = /^\/v1\/tokens\/([^/]+)\/revoke$/.exec(url.pathname);
      if (revoke && request.method() === 'POST') {
        if (state.status.revoke !== 204) return await json(state.status.revoke, { error: 'revoke failed' });
        const token = state.tokens.find(item => item.id === decodeURIComponent(revoke[1]));
        if (!token) return await json(404, { error: 'not found' });
        token.revoked = true;
        return await empty(204);
      }
      if (url.pathname === '/v1/tenants' && request.method() === 'POST') {
        if (state.status.createTenant !== 201) return await json(state.status.createTenant, { error: state.status.createTenant === 409 ? 'conflict' : 'create failed' });
        const name = String(JSON.parse(body || '{}').name || '');
        if (state.tenants.some(tenant => tenant.name.toLowerCase() === name.toLowerCase())) return await json(409, { error: 'conflict' });
        const item = { id: `tenant-new-${state.tenants.length + 1}`, name, lifecycle_state: 'active', lifecycle_generation: 1 };
        state.tenants = [...state.tenants, item];
        return await json(201, item);
      }
      if (url.pathname === '/v1/device/grant') {
        if (state.status.grant !== 200) return await json(state.status.grant, { error: 'unknown_code' });
        return url.searchParams.get('user_code') === 'ABCD-EFGH'
          ? await json(200, { host: 'fixture-terminal' })
          : await json(404, { error: 'unknown_code' });
      }
      if (url.pathname === '/v1/device/authorize' && request.method() === 'POST') {
        if (state.status.authorize !== 200) return await json(state.status.authorize, { error: 'approval failed' });
        const payload = JSON.parse(body || '{}');
        state.device.push(payload);
        return await json(200, payload.action === 'deny' ? { denied: true } : { approved: true });
      }
      if (url.pathname === '/logout') {
        if (state.status.logout !== 204) return await json(state.status.logout, { error: 'logout failed' });
        return await empty(204);
      }
      if (url.pathname === '/oauth/callback') {
        const code = url.searchParams.get('code');
        state.callbacks.push({ code, state: url.searchParams.get('state'), search: url.search });
        if (code === 'denied') return await json(403, { ok: false, error: 'denied' });
        if (code === 'error') return await json(500, { ok: false, error: 'exchange failed' });
        if (state.status.callback !== 200) return await json(state.status.callback, { ok: false, error: 'exchange failed' });
        return await json(200, { ok: true, return: url.searchParams.get('return') || '/profile' });
      }
      return await route.continue();
    } finally {
      inFlight -= 1;
    }
  };

  await page.route(API_ROUTE, handler);
  await page.route(/\/logout$/, handler);
  await page.route(/\/oauth\/callback/, route => route.request().resourceType() === 'document' ? route.continue() : handler(route));

  return { state, reset, calls, hold, maxInFlight: () => maxInFlight };
}

const initialLifecycleTenants = () => [
  { id: 't-a', name: 'Alpha', lifecycle_state: 'active', lifecycle_generation: 3 },
  { id: 't-b', name: 'Beta', lifecycle_state: 'active', lifecycle_generation: 5 },
  { id: 't-p', name: 'Resetting', lifecycle_state: 'resetting', lifecycle_generation: 1 }
];

const defaultCounts = () => ({
  status: 200,
  body: {
    matched: { events: 0, rejections: 0, rows: 0 },
    tenant_total: { events: 0, rejections: 0, rows: 0 },
    unit: 'retained_record'
  },
  abort: false,
  gate: null
});

export async function installLifecycleStub(page) {
  const state = {
    tenants: initialLifecycleTenants(),
    requests: [],
    countRequests: [],
    counts: defaultCounts(),
    status: { me: 200, reset: 204, delete: 204 },
    abort: { reset: false, delete: false }
  };
  const hold = installHold();

  const reset = () => {
    state.tenants = initialLifecycleTenants();
    state.requests.length = 0;
    state.countRequests.length = 0;
    state.counts = defaultCounts();
    state.status = { me: 200, reset: 204, delete: 204 };
    state.abort = { reset: false, delete: false };
  };
  const calls = (path, method) => state.requests.filter(entry => entry.path === path && (!method || entry.method === method));

  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() || '';
    capture(state.requests, request, body);
    const json = (status, value) => route.fulfill({ status, headers: jsonHeaders(request), body: JSON.stringify(value) });
    const empty = status => route.fulfill({ status, headers: jsonHeaders(request), body: '' });
    await hold.pass(request);

    if (url.pathname === '/v1/me') {
      if (state.status.me !== 200) return await json(state.status.me, { error: 'unauthorized' });
      return await json(200, { github_id: 4242, github_login: 'fixture-owner', admin: false, tenants: state.tenants });
    }
    const resetMatch = /^\/v1\/tenants\/([^/]+)\/reset$/.exec(url.pathname);
    if (resetMatch && request.method() === 'POST') {
      if (state.abort.reset) return await route.abort('failed');
      if (state.status.reset !== 204) return await json(state.status.reset, { error: 'tenant_busy' });
      const id = decodeURIComponent(resetMatch[1]);
      const tenant = state.tenants.find(item => item.id === id);
      if (tenant) tenant.lifecycle_generation += 1;
      return await empty(204);
    }
    const deleteMatch = /^\/v1\/tenants\/([^/]+)$/.exec(url.pathname);
    if (deleteMatch && request.method() === 'DELETE') {
      if (state.abort.delete) return await route.abort('failed');
      if (state.status.delete !== 204) return await json(state.status.delete, { error: 'tenant_busy' });
      const id = decodeURIComponent(deleteMatch[1]);
      state.tenants = state.tenants.filter(item => item.id !== id);
      return await empty(204);
    }
    return await route.continue();
  };

  const countsHandler = async route => {
    const request = route.request();
    const entry = capture(state.countRequests, request, '');
    const { status, body, abort } = state.counts;
    if (typeof state.counts.gate === 'function') await state.counts.gate(entry);
    if (abort) return await route.abort('failed');
    return await route.fulfill({ status, headers: jsonHeaders(request), body: JSON.stringify(body) });
  };

  await page.route(API_ROUTE, handler);
  await page.route(/\/v1\/analytics\/event-counts/, countsHandler);
  return { state, reset, calls, hold };
}
