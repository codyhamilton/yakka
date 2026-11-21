import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowserEnvironment } from '../charts-time/browser.mjs';

const packageRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const webRoot = resolve(packageRoot, 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const tenants = [
  { id: 'tenant-a', name: 'Alpha', lifecycle_state: 'active', lifecycle_generation: 3 },
  { id: 'tenant-b', name: 'Beta', lifecycle_state: 'active', lifecycle_generation: 5 }
];
const defaultTokens = () => [
  { id: 'token-a1', name: 'alpha-active', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: false, created_at: '2026-11-12T12:00:00Z', expires_at: '2026-12-12T12:00:00Z' },
  { id: 'token-a2', name: 'alpha-expired', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read_write', revoked: false, created_at: '2026-10-01T12:00:00Z', expires_at: '2026-10-15T12:00:00Z' },
  { id: 'token-a3', name: 'alpha-revoked', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: true, created_at: '2026-09-01T12:00:00Z', expires_at: '2026-12-01T12:00:00Z' },
  { id: 'token-a4', name: 'alpha-second', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: false, created_at: '2026-11-10T12:00:00Z', expires_at: '2026-12-10T12:00:00Z' },
  { id: 'token-b1', name: 'beta-active', tenant: 'tenant-b', tenant_name: 'Beta', scope: 'read_write', revoked: false, created_at: '2026-11-15T12:00:00Z', expires_at: '2027-02-15T12:00:00Z' }
];

function makeIdentityHost() {
  const state = {
    signedIn: false,
    tenants: [tenants[0]],
    tokens: defaultTokens(),
    requests: [],
    callbacks: [],
    device: [],
    revoked: [],
    errors: [],
    failRevoke: false,
    meError: false,
    tokenListError: false
  };
  let inFlight = 0;
  let maxInFlight = 0;
  let pageOrigin = '';
  const server = createHttpsServer({ key: readFileSync(makeIdentityHost.key), cert: readFileSync(makeIdentityHost.cert) }, async (req, res) => {
    const url = new URL(req.url, 'https://yakka.build');
    const apiHost = (req.headers.host || '').startsWith('api.yakka.build');
    const cors = apiHost ? { 'Access-Control-Allow-Origin': pageOrigin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' } : {};
    if (apiHost && req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    if (apiHost && url.pathname.startsWith('/')) {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      const end = res.end.bind(res); res.end = (...args) => { inFlight -= 1; return end(...args); };
      const body = await new Promise(done => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => done(Buffer.concat(chunks).toString())); });
      const json = (status, value, headers = {}) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
      const empty = status => { res.writeHead(status, { ...cors, 'Cache-Control': 'no-store' }); res.end(); };
      const authed = state.signedIn && /(?:^|; )workflow_session=fixture-session(?:;|$)/.test(req.headers.cookie || '');
      state.requests.push({ method: req.method, path: url.pathname, search: url.search, cookie: req.headers.cookie || '', authorization: req.headers.authorization || '', body });
      if (url.pathname === '/v1/me') return state.meError ? json(500, { error: 'me failed' }) : json(authed ? 200 : 401, authed ? { github_id: 4242, github_login: 'fixture-user', admin: false, tenants: state.tenants } : { error: 'unauthorized' });
      if (url.pathname === '/oauth/callback') {
        state.callbacks.push({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), search: url.search });
        const mode = url.searchParams.get('code');
        if (mode === 'denied') return json(403, { ok: false, error: 'denied' });
        if (mode === 'error') return json(500, { ok: false, error: 'exchange failed' });
        state.signedIn = true;
        return json(200, { ok: true, return: '/profile' }, { 'Set-Cookie': 'workflow_session=fixture-session; Path=/; Secure; HttpOnly; SameSite=Lax' });
      }
      if (url.pathname === '/logout') { state.signedIn = false; return json(204, null, { 'Set-Cookie': 'workflow_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax' }); }
      if (url.pathname === '/v1/device/grant') return authed && url.searchParams.get('user_code') === 'ABCD-EFGH' ? json(200, { host: 'fixture-terminal' }) : json(404, { error: 'unknown_code' });
      if (url.pathname === '/v1/device/authorize') { if (!authed) return json(401, { error: 'unauthorized' }); state.device.push(JSON.parse(body)); return json(200, body.includes('"deny"') ? { denied: true } : { approved: true }); }
      if (url.pathname === '/v1/tenants' && req.method === 'POST') {
        if (!authed) return json(401, { error: 'unauthorized' });
        const name = String(JSON.parse(body || '{}').name || '');
        if (state.tenants.some(tenant => tenant.name.toLowerCase() === name.toLowerCase())) return json(409, { error: 'conflict' });
        const item = { id: `tenant-new-${state.tenants.length + 1}`, name, lifecycle_state: 'active', lifecycle_generation: 1 };
        state.tenants = [...state.tenants, item];
        return json(201, item);
      }
      if (url.pathname === '/v1/tokens' && req.method === 'GET') {
        if (!authed) return json(401, { error: 'unauthorized' });
        return state.tokenListError ? json(500, { error: 'tokens failed' }) : json(200, state.tokens);
      }
      if (url.pathname === '/v1/tokens' && req.method === 'POST') {
        if (!authed) return json(401, { error: 'unauthorized' });
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
          expires_at: '2027-02-20T12:00:00Z'
        };
        state.tokens = [...state.tokens, minted];
        return json(201, minted);
      }
      const revoke = /^\/v1\/tokens\/([^/]+)\/revoke$/.exec(url.pathname);
      if (revoke && req.method === 'POST') {
        if (!authed) return json(401, { error: 'unauthorized' });
        state.revoked.push(url.pathname);
        if (state.failRevoke) return json(500, { error: 'revoke failed' });
        const token = state.tokens.find(item => item.id === decodeURIComponent(revoke[1]));
        if (!token) return json(404, { error: 'not found' });
        token.revoked = true;
        return empty(204);
      }
      return json(404, { error: 'not found' });
    }
    if (url.pathname === '/__test/state') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...state, maxInFlight })); return; }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const path = resolve(webRoot, relative);
    if (path !== webRoot && !path.startsWith(`${webRoot}${sep}`)) { res.writeHead(403); res.end(); return; }
    const target = extname(url.pathname) ? path : resolve(webRoot, 'index.html');
    let data;
    try { data = readFileSync(target); } catch { res.writeHead(404); res.end('not found'); return; }
    const csp = readFileSync(resolve(webRoot, '_headers'), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x.startsWith('Content-Security-Policy:'))[0]?.slice('Content-Security-Policy:'.length).trim();
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...(csp ? { 'Content-Security-Policy': csp } : {}) }); res.end(data);
  });
  return { server, state, maxInFlight: () => maxInFlight, setPageOrigin(value) { pageOrigin = value; }, reset() { state.signedIn = false; state.tenants = [tenants[0]]; state.tokens = defaultTokens(); state.failRevoke = false; state.meError = false; state.tokenListError = false; state.requests.length = state.callbacks.length = state.device.length = state.revoked.length = state.errors.length = 0; maxInFlight = 0; } };
}

test('Pages-mapped identity account flows and their API requests', async t => {
  const environment = loadBrowserEnvironment();
  assert.ok(environment.ok, environment.reason);
  const scratch = mkdtempSync(join(process.env.TMPDIR || process.cwd(), 'identity-pages-'));
  makeIdentityHost.key = join(scratch, 'key.pem'); makeIdentityHost.cert = join(scratch, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', makeIdentityHost.key, '-out', makeIdentityHost.cert, '-days', '1', '-subj', '/CN=yakka.build', '-addext', 'subjectAltName=DNS:yakka.build,DNS:api.yakka.build']);
  const rig = makeIdentityHost();
  let browser;
  try {
    await new Promise((resolveListen, reject) => { rig.server.once('error', reject); rig.server.listen(0, '127.0.0.1', resolveListen); });
    const port = rig.server.address().port;
    const pageOrigin = `https://yakka.build:${port}`;
    const apiOrigin = `https://api.yakka.build:${port}`;
    rig.setPageOrigin(pageOrigin);
    browser = await environment.playwright.chromium.launch({ executablePath: environment.executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--host-resolver-rules=MAP yakka.build 127.0.0.1, MAP api.yakka.build 127.0.0.1'] });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    await context.addInitScript(({ origin, base }) => {
      if (location.origin !== origin) return;
      try { localStorage.setItem('yakka-analytics-base', base); } catch {}
    }, { origin: pageOrigin, base: apiOrigin });
    const diagnostics = [];
    const expectedResource = /^Failed to load resource: the server responded with a status of (401|403|409|500) /;
    context.on('page', page => { page.on('pageerror', e => diagnostics.push(`pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !expectedResource.test(m.text())) diagnostics.push(`console: ${m.text()}`); }); });
    const page = await context.newPage();
    const visit = async path => { rig.reset(); await context.clearCookies(); await page.goto(`${pageOrigin}${path}`); };
    const signIn = async (owned = tenants) => {
      rig.reset();
      rig.state.signedIn = true;
      rig.state.tenants = owned.map(tenant => ({ ...tenant }));
      try { await page.evaluate(() => localStorage.removeItem('yakka-analytics-tenant')); } catch {}
      await context.clearCookies();
      await context.addCookies([{ name: 'workflow_session', value: 'fixture-session', domain: 'api.yakka.build', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    };
    const openProfile = async (owned = tenants) => {
      await signIn(owned);
      await page.goto(`${pageOrigin}/profile`);
      await page.locator('[data-account="tenants"]').waitFor();
      await page.locator('[data-account="tokens"]').waitFor();
    };
    const calls = (path, method) => rig.state.requests.filter(request => request.path === path && (!method || request.method === method));

    await t.test('signed-out deep link keeps device code through login', async () => {
      await visit('/device?user_code=abcd-efgh');
      await page.waitForURL(/\/login\?return=/);
      assert.equal(new URL(page.url()).searchParams.get('return'), '/device?user_code=abcd-efgh');
      assert.equal(await page.locator('[data-testid="identity-login"]').getAttribute('href'), 'https://api.yakka.build/oauth/login?return=%2Fdevice%3Fuser_code%3Dabcd-efgh');
    });
    await t.test('callback success forwards query and returns to profile', async () => {
      await visit('/oauth/callback?code=success&state=nonce');
      await page.waitForURL(`${pageOrigin}/profile`);
      assert.equal(rig.state.callbacks[0]?.search, '?code=success&state=nonce');
    });
    await t.test('callback denial stays on callback with a message', async () => {
      await visit('/oauth/callback?code=denied&state=nonce');
      await page.locator('[data-identity-status]').waitFor();
      assert.match(await page.locator('[data-identity-status]').textContent(), /denied/);
      assert.match(page.url(), /oauth\/callback/);
    });
    await t.test('callback API error stays on callback with a message', async () => {
      await visit('/oauth/callback?code=error&state=nonce');
      await page.locator('[data-identity-status]').waitFor();
      assert.match(await page.locator('[data-identity-status]').textContent(), /exchange failed/);
      assert.match(page.url(), /oauth\/callback/);
    });
    await t.test('device code is preserved and approval posts documented fields', async () => {
      rig.reset(); rig.state.signedIn = true; await context.addCookies([{ name: 'workflow_session', value: 'fixture-session', domain: 'api.yakka.build', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(`${pageOrigin}/device?user_code=abcd-efgh`);
      await page.getByText('Request from fixture-terminal').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('user_code'), 'ABCD-EFGH');
      await page.locator('[data-testid="device-grant"]').selectOption('read_write');
      await page.locator('[data-testid="device-submit"]').click();
      await page.getByText('Approved.').waitFor();
      assert.deepEqual(rig.state.device[0], { user_code: 'ABCD-EFGH', tenant: 'tenant-a', scope: 'read_write', lifetime: '3m' });
    });
    await t.test('device denial keeps the normalized code', async () => {
      rig.reset(); rig.state.signedIn = true; await context.clearCookies(); await context.addCookies([{ name: 'workflow_session', value: 'fixture-session', domain: 'api.yakka.build', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(`${pageOrigin}/device?user_code=abcd-efgh`); await page.getByText('Request from fixture-terminal').waitFor();
      await page.locator('[data-testid="device-deny"]').click(); await page.getByText('Denied.').waitFor();
      assert.deepEqual(rig.state.device[0], { user_code: 'ABCD-EFGH', action: 'deny' });
    });
    await t.test('A1 account nav, owned membership inventory and lifecycle boundary', async () => {
      await openProfile();
      assert.equal(await page.locator('#tenant-select').inputValue(), 'tenant-a');
      assert.match(page.url(), /[?&]tenant=tenant-a/);
      const nav = await page.locator('.account-nav a').evaluateAll(links => links.map(link => [link.textContent, link.getAttribute('href')]));
      assert.deepEqual(nav, [
        ['Tokens', '/profile#tokens'], ['Tenants', '/profile#tenants'], ['Membership', '/profile#membership'],
        ['Settings', '/settings'], ['Device approval', '/device']
      ]);
      assert.equal(await page.locator('main .scope-bar, main .coverage-strip, main .yk-chart').count(), 0);
      assert.equal(await page.getByRole('button', { name: /^(Invite|Add member|Change role)$/ }).count(), 0);
      const heads = await page.locator('[data-account="tenants"] thead th').allTextContents();
      assert.deepEqual(heads, ['Name', 'Immutable ID', 'Your access', 'Lifecycle state', 'Generation', 'Actions']);
      const rows = page.locator('[data-account-tenant-row]');
      assert.equal(await rows.count(), 2);
      const first = await rows.nth(0).locator('td').allTextContents();
      assert.deepEqual(first.slice(0, 5), ['Alpha', 'tenant-a', 'Owner', 'Active', '3']);
      const second = await rows.nth(1).locator('td').allTextContents();
      assert.deepEqual(second.slice(0, 5), ['Beta', 'tenant-b', 'Owner', 'Active', '5']);
      const link = page.locator('[data-testid="lifecycle-link-tenant-a"]');
      assert.equal(await link.getAttribute('href'), `${apiOrigin}/profile/lifecycle?tenant=tenant-a`);
      assert.equal(await link.getAttribute('target'), null);
      assert.match(await link.textContent(), /Reset or delete… \(API owner page\)/);
      for (const height of await rows.evaluateAll(items => items.map(item => item.getBoundingClientRect().height))) assert.ok(Math.abs(height - 30) <= 1, `row height ${height}`);
      const widths = await page.locator('[data-account="tenants"] thead th').evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().width)));
      for (const [index, expected] of [240, 260, 100, 160, 100].entries()) assert.ok(Math.abs(widths[index] - expected) <= 2, `column ${index + 1} width ${widths[index]}`);
      await page.locator('[data-testid="use-tenant-tenant-b"]').click();
      await page.waitForFunction(() => document.querySelector('#tenant-select')?.value === 'tenant-b');
      assert.match(page.url(), /tenant=tenant-b/);
      await page.getByText('beta-active').waitFor();
      assert.equal(await page.getByText('alpha-active').count(), 0);
      const refreshed = page.waitForResponse(response => response.url().endsWith('/v1/me'));
      await page.locator('[data-testid="account-refresh"]').click();
      assert.equal((await refreshed).status(), 200);
      await page.locator('[data-account="tokens"]').waitFor();
    });
    await t.test('A1 empty and error tenant states keep recovery controls', async () => {
      await openProfile([]);
      await page.getByText('You do not own any tenants yet.').waitFor();
      assert.equal(await page.locator('[data-testid="create-tenant"]').count(), 1);
      await page.getByText('Create a tenant to issue a token.').waitFor();
      assert.equal(await page.locator('[data-testid="create-token"]').isDisabled(), true);
      await signIn();
      rig.state.meError = true;
      await page.goto(`${pageOrigin}/profile`);
      await page.getByText('Could not load tenants.').waitFor();
      assert.equal(await page.locator('[data-testid="retry-account"]').count(), 1);
    });
    await t.test('A2 create tenant validates, refreshes, selects and focuses the new row', async () => {
      await openProfile([tenants[0]]);
      const before = calls('/v1/me').length;
      await page.locator('[data-testid="new-tenant-name"]').fill('   ');
      await page.locator('[data-testid="create-tenant"]').click();
      await page.getByText('Use 1–64 characters with no control characters.').waitFor();
      assert.equal(calls('/v1/tenants', 'POST').length, 0);
      await page.locator('[data-testid="new-tenant-name"]').fill('Bad\u0001Name');
      await page.locator('[data-testid="create-tenant"]').click();
      await page.getByText('Use 1–64 characters with no control characters.').waitFor();
      assert.equal(calls('/v1/tenants', 'POST').length, 0);
      await page.locator('[data-testid="new-tenant-name"]').fill('Delta');
      await page.locator('[data-testid="create-tenant"]').click();
      await page.locator('[data-account-tenant-row]').nth(1).waitFor();
      const created = rig.state.tenants.at(-1);
      assert.deepEqual(JSON.parse(calls('/v1/tenants', 'POST')[0].body), { name: 'Delta' });
      assert.ok(calls('/v1/me').length > before);
      await page.waitForFunction(id => document.querySelector('#tenant-select')?.value === id, created.id);
      assert.match(page.url(), new RegExp(`tenant=${created.id}`));
      const focused = await page.evaluate(() => document.activeElement?.closest('[data-account-tenant-row]')?.getAttribute('data-account-tenant-row') || '');
      assert.equal(focused, created.id);
      await page.locator('[data-testid="new-tenant-name"]').fill('Delta');
      await page.locator('[data-testid="create-tenant"]').click();
      await page.getByText('You already have a tenant with this name.').waitFor();
      assert.equal(await page.locator('[data-testid="new-tenant-name"]').inputValue(), 'Delta');
    });
    await t.test('A3 token payload, one-time plaintext, copy, dismiss and clearing', async () => {
      await openProfile();
      await page.locator('[data-testid="token-name"]').fill('');
      await page.locator('[data-testid="token-scope"]').selectOption('read_write');
      await page.locator('[data-testid="token-lifetime"]').selectOption('1y');
      await page.locator('[data-testid="create-token"]').click();
      await page.locator('[data-testid="issued-token-once"]').waitFor();
      const first = calls('/v1/tokens', 'POST')[0];
      assert.deepEqual(JSON.parse(first.body), { tenant: 'tenant-a', scope: 'read_write', lifetime: '1y' });
      assert.equal(await page.locator('[data-testid="issued-token-once"]').inputValue(), 'fixture-plaintext-token');
      await page.getByText('Copy this token now. It will not be shown again.').waitFor();
      assert.ok(calls('/v1/tokens', 'GET').every(request => !request.search.includes('tenant')));
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { globalThis.__copied = value; } } }); });
      await page.locator('[data-testid="copy-token"]').click();
      await page.waitForFunction(() => globalThis.__copied === 'fixture-plaintext-token');
      const stored = await page.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), url: location.href }));
      assert.ok(!stored.local.includes('fixture-plaintext-token'));
      assert.ok(!stored.session.includes('fixture-plaintext-token'));
      assert.ok(!stored.url.includes('fixture-plaintext-token'));
      await page.locator('[data-testid="dismiss-token"]').click();
      assert.equal(await page.locator('[data-testid="issued-token-once"]').count(), 0);
      await page.locator('[data-testid="token-name"]').fill('token');
      await page.locator('[data-testid="token-scope"]').selectOption('read');
      await page.locator('[data-testid="token-lifetime"]').selectOption('3m');
      await page.locator('[data-testid="create-token"]').click();
      await page.locator('[data-testid="issued-token-once"]').waitFor();
      assert.deepEqual(JSON.parse(calls('/v1/tokens', 'POST')[1].body), { tenant: 'tenant-a', scope: 'read', lifetime: '3m', name: 'token' });
      await page.locator('#tenant-select').selectOption('tenant-b');
      await page.getByText('beta-active').waitFor();
      assert.equal(await page.getByText('fixture-plaintext-token').count(), 0);
      await page.goto(`${pageOrigin}/settings`);
      await page.goto(`${pageOrigin}/profile`);
      await page.locator('[data-account="tokens"]').waitFor();
      assert.equal(await page.getByText('fixture-plaintext-token').count(), 0);
    });
    await t.test('A4 token inventory is exact-tenant filtered with real states', async () => {
      await openProfile();
      const heads = await page.locator('[data-account="tokens"] thead th').allTextContents();
      assert.deepEqual(heads, ['Name', 'Tenant', 'Scope', 'Created', 'Expires', 'State', 'Action']);
      assert.equal(heads.includes('Secret'), false);
      const rows = page.locator('[data-token-row]');
      assert.equal(await rows.count(), 4);
      assert.deepEqual(await rows.evaluateAll(items => items.map(item => item.getAttribute('data-token-row'))), ['token-a1', 'token-a4', 'token-a2', 'token-a3']);
      assert.deepEqual(await rows.locator('td:nth-child(6)').allTextContents(), ['Active', 'Active', 'Expired', 'Revoked']);
      assert.equal(await page.locator('[data-testid="revoke-token-a1"]').count(), 1);
      assert.equal(await page.locator('[data-testid="revoke-token-a2"]').count(), 0);
      assert.equal(await page.locator('[data-testid="revoke-token-a3"]').count(), 0);
      for (const [index, expected] of [220, 180, 140, 160, 160, 120].entries()) {
        const width = await page.locator('[data-account="tokens"] thead th').nth(index).evaluate(item => Math.round(item.getBoundingClientRect().width));
        assert.ok(Math.abs(width - expected) <= 2, `token column ${index + 1} width ${width}`);
      }
      assert.ok(calls('/v1/tokens', 'GET').every(request => !request.search.includes('tenant')));
      await page.locator('#tenant-select').selectOption('tenant-b');
      await page.getByText('beta-active').waitFor();
      assert.equal(await page.getByText('alpha-active').count(), 0);
      assert.equal(await page.getByText('alpha-expired').count(), 0);
      assert.equal(await rows.count(), 1);
    });
    await t.test('A4 token load failure offers Retry tokens', async () => {
      await signIn();
      rig.state.tokenListError = true;
      await page.goto(`${pageOrigin}/profile`);
      await page.getByText('Could not load tokens.').waitFor();
      assert.equal(await page.locator('[data-testid="retry-tokens"]').count(), 1);
    });
    await t.test('A5 revoke cancels, confirms once and keeps failures active with click-only retry', async () => {
      await openProfile([tenants[0]]);
      await page.locator('[data-testid="revoke-token-a1"]').click();
      await page.getByText('Revoke alpha-active? Clients using it will lose access.').waitFor();
      const before = rig.state.revoked.length;
      await page.locator('[data-testid="cancel-revoke"]').click();
      assert.equal(rig.state.revoked.length, before);
      assert.equal(await page.locator('[data-testid="revoke-token-a1"]').count(), 1);
      await page.locator('[data-testid="revoke-token-a1"]').click();
      await page.locator('[data-testid="confirm-revoke"]').click();
      await page.waitForFunction(() => document.querySelector('[data-token-row="token-a1"] td:nth-child(6)')?.textContent === 'Revoked');
      assert.deepEqual(JSON.parse(calls('/v1/tokens/token-a1/revoke', 'POST')[0].body), {});
      assert.equal(rig.state.revoked.at(-1), '/v1/tokens/token-a1/revoke');
      rig.state.failRevoke = true;
      await page.locator('[data-testid="revoke-token-a4"]').click();
      await page.locator('[data-testid="confirm-revoke"]').click();
      await page.locator('[data-testid="retry-revoke"]').waitFor();
      assert.equal(await page.locator('[data-token-row="token-a4"] td:nth-child(6)').textContent(), 'Active');
      assert.equal(calls('/v1/tokens/token-a4/revoke', 'POST').length, 1);
      assert.equal(await page.getByText('fixture-plaintext-token').count(), 0);
      rig.state.failRevoke = false;
      await page.locator('[data-testid="retry-revoke"]').click();
      await page.waitForFunction(() => document.querySelector('[data-token-row="token-a4"] td:nth-child(6)')?.textContent === 'Revoked');
      assert.equal(calls('/v1/tokens/token-a4/revoke', 'POST').length, 2);
    });
    await t.test('Settings saves base and bearer, then signs out', async () => {
      await visit('/settings');
      await page.getByTestId('settings-base').fill(`${apiOrigin}/`); await page.getByTestId('settings-key').fill('fixture-key'); await page.getByTestId('settings-save').click();
      await page.getByText('Settings saved.').waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('yakka-analytics-base')), apiOrigin);
      assert.equal(await page.evaluate(() => localStorage.getItem('yakka-analytics-key')), 'fixture-key');
      await page.getByRole('button', { name: 'Sign out' }).click(); await page.waitForURL(`${pageOrigin}/login`);
      assert.ok(rig.state.requests.some(r => r.path === '/logout' && r.method === 'POST'));
    });
    assert.equal(diagnostics.length, 0, diagnostics.join('\n'));
    assert.ok(rig.maxInFlight() <= 4, `max in flight ${rig.maxInFlight()}`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => rig.server.close(resolveClose));
    rmSync(scratch, { recursive: true, force: true });
  }
});
