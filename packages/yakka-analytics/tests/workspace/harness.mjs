// Test-only static server for web/ with the declared _headers CSP, a client
// route fallback to index.html, /__test/stats, a control surface, and the
// deterministic same-origin stub API. It writes nothing outside the tree and
// uses no /tmp.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { createStubApi } from './stub-api.mjs';

const webRoot = resolve(import.meta.dirname, '../../web');
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

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function startWorkspaceHarness({ port = 0 } = {}) {
  const baseHeaders = await declaredHeaders();
  const api = createStubApi();
  const stats = { total: 0, analytics: 0, inFlight: 0, maxInFlight: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    stats.total += 1;

    if (url.pathname === '/__test/stats') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ...stats, probes: api.probes, scenario: api.state.scenario }));
      return;
    }
    if (url.pathname === '/__test/control') {
      if (request.method === 'POST') {
        try { api.set(JSON.parse(await readBody(request) || '{}')); } catch {}
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ...api.state, probes: api.probes }));
      return;
    }
    if (url.pathname.startsWith('/v1/')) {
      stats.analytics += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      let done = false;
      const end = response.end.bind(response);
      response.end = (...args) => { if (!done) { done = true; stats.inFlight -= 1; } return end(...args); };
      if (api.handle(request, response, url)) return;
      response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end('{"error":"not found"}');
      return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }

    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    let path = resolve(webRoot, relative);
    if (!within(webRoot, path)) { response.writeHead(403); response.end(); return; }
    let target = path;
    if (!extname(url.pathname)) target = resolve(webRoot, 'index.html');
    let body;
    try { body = await readFile(target); } catch {
      if (extname(url.pathname)) { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('not found'); return; }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('not found'); return;
    }
    response.writeHead(200, { ...baseHeaders, 'Content-Type': types[extname(target)] || 'application/octet-stream' });
    response.end(body);
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    api,
    stats,
    resetStats() { stats.total = 0; stats.analytics = 0; stats.inFlight = 0; stats.maxInFlight = 0; },
    close: () => new Promise(done => server.close(done))
  };
}
