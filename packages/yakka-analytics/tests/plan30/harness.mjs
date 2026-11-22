// Test-only harness for Plan 30 phase 1. It spawns the real-Go cookie-session
// two-tenant fixture in packages/yakka/internal/serve (build tag plan30harness),
// serves web/ from a same-origin loopback static server with the declared
// _headers CSP and client-route fallback, and reverse-proxies /v1/ to Go.
//
// Delay, busy and append controls call the fixture's loopback control routes;
// there is no request interception and no synthetic API response. It never
// logs cookie values, tokens or row data, and writes only under the worktree's
// ignored .scratch/.

import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const yakkaRoot = resolve(repoRoot, 'packages', 'yakka');
const webRoot = resolve(repoRoot, 'packages', 'yakka-analytics', 'web');
const scratchRoot = resolve(repoRoot, '.scratch', 'plan30-harness');
const startupTimeout = Number(process.env.PLAN30_HARNESS_TIMEOUT_MS || 180000);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

async function declaredHeaders() {
  const text = await readFile(resolve(webRoot, '_headers'), 'utf8');
  const headers = {};
  let active = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '/*') { active = true; continue; }
    if (!active) continue;
    if (line.trim() === '') break;
    const at = line.indexOf(':');
    if (at === -1) continue;
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  headers['Cache-Control'] = 'no-cache';
  return headers;
}

function within(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function snapshotScratch() {
  try { return new Set(await readdir(scratchRoot)); } catch { return new Set(); }
}

function startGo() {
  const child = spawn('go', [
    'test', '-tags', 'plan30harness', '-run', '^TestPlan30Harness$', '-count=1', '-v', './internal/serve'
  ], {
    cwd: yakkaRoot,
    env: { ...process.env, GOTOOLCHAIN: 'auto', PUBLIC_CANVAS_TEST_MODE: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });
  child.killGroup = signal => {
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      try { child.kill(signal); } catch {}
    }
  };
  return child;
}

async function waitForReady(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = '';
    let origin = '';
    let ready = false;
    const timer = setTimeout(() => {
      cleanup();
      rejectReady(new Error(`plan30 harness did not start within ${startupTimeout}ms; child output:\n${output.slice(-8000)}`));
    }, startupTimeout);
    timer.unref?.();
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    const maybeReady = () => {
      if (origin && ready) {
        cleanup();
        resolveReady(origin);
      }
    };
    const onStdout = chunk => {
      output += chunk.toString();
      for (const raw of chunk.toString().split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('PLAN30_HARNESS_ORIGIN=')) origin = line.slice('PLAN30_HARNESS_ORIGIN='.length).trim();
        if (line === 'PLAN30_HARNESS_READY') ready = true;
      }
      maybeReady();
    };
    const onStderr = chunk => { output += chunk.toString(); };
    const onExit = code => {
      cleanup();
      rejectReady(new Error(`plan30 harness exited (${code}) before ready; child output:\n${output.slice(-8000)}`));
    };
    const onError = error => {
      cleanup();
      rejectReady(error);
    };
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function proxy(request, response, url, upstreamOrigin) {
  const target = new URL(`${url.pathname}${url.search}`, upstreamOrigin);
  const headers = { ...request.headers, host: new URL(upstreamOrigin).host };
  delete headers.connection;
  const upstream = httpRequest(target, { method: request.method, headers }, up => {
    response.writeHead(up.statusCode || 502, up.headers);
    up.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end('{"error":"harness proxy failed"}');
  });
  request.pipe(upstream);
}

async function startStatic(upstreamOrigin) {
  const baseHeaders = await declaredHeaders();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/v1/')) { proxy(request, response, url, upstreamOrigin); return; }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const path = resolve(webRoot, relative);
    if (!within(webRoot, path)) { response.writeHead(403); response.end(); return; }
    const target = extname(url.pathname) ? path : resolve(webRoot, 'index.html');
    let body;
    try { body = await readFile(target); } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { ...baseHeaders, 'Content-Type': types[extname(target)] || 'application/octet-stream' });
    response.end(body);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function parseCookie(raw) {
  if (!raw) throw new Error('plan30 harness returned no session cookie');
  const pair = raw.split(';')[0];
  const at = pair.indexOf('=');
  if (at === -1) throw new Error('plan30 harness returned a malformed cookie');
  const name = pair.slice(0, at).trim();
  let value = pair.slice(at + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
  if (!name || !value) throw new Error('plan30 harness returned an empty cookie');
  return { name, value };
}

export async function startPlan30Harness() {
  const before = await snapshotScratch();
  const child = startGo();
  let origin;
  try {
    origin = await waitForReady(child);
  } catch (error) {
    child.killGroup('SIGKILL');
    throw error;
  }

  let fixture;
  try {
    const response = await fetch(`${origin}/__plan30/fixture`);
    if (!response.ok) throw new Error(`fixture route: ${response.status}`);
    fixture = await response.json();
  } catch (error) {
    child.killGroup('SIGKILL');
    throw error;
  }

  const tenants = Array.isArray(fixture.tenants) ? fixture.tenants : [];
  const known = new Set(tenants.map(t => t.id));
  const byName = new Map(tenants.map(t => [t.name, t.id]));
  const resolveTenant = value => byName.get(value) || (known.has(value) ? value : '');
  const staticServer = await startStatic(origin);

  const after = await snapshotScratch();
  const dataRoots = [...after].filter(name => !before.has(name)).map(name => resolve(scratchRoot, name));

  const diagnostics = [];
  const expectedResource = /^Failed to load resource: the server responded with a status of (401|403|503)\b/;
  const watch = page => {
    page.on('pageerror', error => diagnostics.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (expectedResource.test(text) || /status of 400 \(Bad Request\)/.test(text)) return;
      diagnostics.push(`console: ${text}`);
    });
    page.on('response', response => {
      if (response.status() === 400) diagnostics.push(`400: ${response.url()}`);
    });
    return page;
  };
  const attach = context => { context.on('page', watch); };

  const cookie = async tenant => {
    const id = resolveTenant(tenant);
    if (!id) throw new Error(`unknown plan30 tenant ${tenant}`);
    const response = await fetch(`${origin}/__plan30/session?tenant=${encodeURIComponent(id)}`);
    if (response.status !== 204) throw new Error(`session route: ${response.status}`);
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
    return parseCookie(list[0]);
  };

  const adminCookie = async () => {
    const response = await fetch(`${origin}/__plan30/admin-session`);
    if (response.status !== 204) throw new Error(`admin session route: ${response.status}`);
    const list = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
    return parseCookie(list[0]);
  };

  const installCookie = async (context, session) => {
    // A host-only cookie installed by the fixture does not always replace a
    // Playwright-added cookie of the same name, so drop the jar before adding
    // the role's session.
    await context.clearCookies();
    await context.addCookies([{
      name: session.name, value: session.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax'
    }]);
  };

  const installSession = async (context, tenant) => {
    await installCookie(context, await cookie(tenant));
  };

  const installAdminSession = async context => {
    await installCookie(context, await adminCookie());
  };

  const controlUrl = (route, tenant, extra = {}) => {
    const id = resolveTenant(tenant);
    if (!id) throw new Error(`unknown plan30 tenant ${tenant}`);
    const query = new URLSearchParams({ tenant: id, ...extra });
    return `${origin}/__plan30/${route}?${query}`;
  };
  const control = {
    async delay(tenant, ms) {
      const response = await fetch(controlUrl('delay', tenant, { ms: String(ms) }));
      if (response.status !== 204) throw new Error(`delay route: ${response.status}`);
    },
    async hold(tenant, on) {
      const response = await fetch(controlUrl('hold', tenant, { on: on ? '1' : '0' }));
      if (response.status !== 204) throw new Error(`hold route: ${response.status}`);
    },
    async append(tenant) {
      const response = await fetch(controlUrl('append', tenant));
      if (!response.ok) throw new Error(`append route: ${response.status}`);
      return response.json();
    }
  };

  const waitIdle = async page => {
    await page.waitForFunction(() => {
      const html = document.documentElement;
      const panels = Array.from(document.querySelectorAll('[data-panel]'))
        .filter(panel => !panel.parentElement?.closest('[data-panel]'));
      return html.dataset.idle === 'true' && html.dataset.state === 'ready'
        && panels.every(panel => panel.getAttribute('data-idle') === 'true');
    });
  };

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { child.stdin.end(); } catch {}
    await new Promise(done => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; done(); } };
      child.once('exit', finish);
      child.killGroup('SIGTERM');
      const timer = setTimeout(() => { child.killGroup('SIGKILL'); finish(); }, 5000);
      timer.unref?.();
    });
    await new Promise(done => staticServer.server.close(done));
    for (const dir of dataRoots) {
      if (existsSync(dir)) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };

  return {
    origin: staticServer.origin,
    upstreamOrigin: origin,
    tenants,
    fixture,
    expected: fixture.expected || {},
    markers: fixture.markers || {},
    foreign: fixture.foreign || '',
    dataRoots,
    diagnostics,
    attach,
    watch,
    waitIdle,
    tenantId: resolveTenant,
    cookie,
    adminCookie,
    installSession,
    installAdminSession,
    control,
    close
  };
}
