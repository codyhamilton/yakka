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
const tenants = [{ id: 'tenant-a', name: 'Alpha' }, { id: 'tenant-b', name: 'Beta' }];

function makeIdentityHost() {
  const state = { signedIn: false, tenants: [tenants[0]], requests: [], callbacks: [], device: [], revoked: [], errors: [] };
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
      const authed = state.signedIn && /(?:^|; )workflow_session=fixture-session(?:;|$)/.test(req.headers.cookie || '');
      state.requests.push({ method: req.method, path: url.pathname, search: url.search, cookie: req.headers.cookie || '', authorization: req.headers.authorization || '', body });
      if (url.pathname === '/v1/me') return json(authed ? 200 : 401, authed ? { github_id: 4242, github_login: 'fixture-user', admin: false, tenants: state.tenants } : { error: 'unauthorized' });
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
      if (url.pathname === '/v1/tenants' && req.method === 'POST') { const item = { id: 'tenant-b', name: JSON.parse(body).name }; state.tenants = [...state.tenants, item]; return json(201, item); }
      if (url.pathname === '/v1/tokens' && req.method === 'GET') return json(200, [{ id: 'token-old', name: 'old-token', tenant: 'tenant-a', tenant_name: 'Alpha', scope: 'read', revoked: false }]);
      if (url.pathname === '/v1/tokens' && req.method === 'POST') return json(201, { id: 'token-new', token: 'fixture-plaintext-token', ...JSON.parse(body) });
      if (url.pathname === '/v1/tokens/token-old/revoke') { state.revoked.push(url.pathname); return json(204, null); }
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
  return { server, state, maxInFlight: () => maxInFlight, setPageOrigin(value) { pageOrigin = value; }, reset() { state.signedIn = false; state.tenants = [tenants[0]]; state.requests.length = state.callbacks.length = state.device.length = state.revoked.length = state.errors.length = 0; maxInFlight = 0; } };
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
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addInitScript(({ origin, base }) => {
      if (location.origin !== origin) return;
      try { localStorage.setItem('yakka-analytics-base', base); } catch {}
    }, { origin: pageOrigin, base: apiOrigin });
    const diagnostics = [];
    const expectedResource = /^Failed to load resource: the server responded with a status of (401|403|500) /;
    context.on('page', page => { page.on('pageerror', e => diagnostics.push(`pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error' && !expectedResource.test(m.text())) diagnostics.push(`console: ${m.text()}`); }); });
    const page = await context.newPage();
    const visit = async path => { rig.reset(); await context.clearCookies(); await page.goto(`${pageOrigin}${path}`); };
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
    await t.test('profile creates tenant, mints token once, and revokes listed token', async () => {
      rig.reset(); rig.state.signedIn = true; await context.clearCookies(); await context.addCookies([{ name: 'workflow_session', value: 'fixture-session', domain: 'api.yakka.build', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
      await page.goto(`${pageOrigin}/profile`);
      await page.getByLabel('New tenant').fill('Beta'); await page.getByRole('button', { name: 'Create tenant' }).click(); await page.waitForURL(`${pageOrigin}/profile`);
      await page.getByText('old-token').waitFor();
      const forms = page.locator('form'); const tokenForm = forms.nth(1);
      await tokenForm.locator('select').nth(0).selectOption('tenant-b'); await tokenForm.locator('input[name="name"]').fill('cli'); await tokenForm.getByRole('button', { name: 'Create token' }).click();
      await page.getByTestId('issued-token-once').getByText('fixture-plaintext-token').waitFor();
      await page.getByRole('button', { name: 'Revoke' }).click(); await page.getByText(/revoked/).waitFor();
      assert.ok(rig.state.requests.some(r => r.path === '/v1/tenants' && JSON.parse(r.body).name === 'Beta'));
      assert.ok(rig.state.requests.some(r => r.path === '/v1/tokens' && r.method === 'POST' && JSON.parse(r.body).tenant === 'tenant-b'));
      assert.equal(rig.state.revoked.length, 1);
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
