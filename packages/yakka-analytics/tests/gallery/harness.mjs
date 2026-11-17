// Test-only gallery harness. Serves web/ and tests/gallery/ from one origin
// with the same CSP and security headers the product declares in _headers.
// It writes nothing outside those trees (no /tmp) and counts analytics
// requests in flight so a spec can assert the four-in-flight bound.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const webRoot = resolve(import.meta.dirname, '../../web');
const galleryRoot = resolve(import.meta.dirname);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

async function defaultHeaders() {
  const text = await readFile(resolve(webRoot, '_headers'), 'utf8');
  const headers = {};
  let active = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '/*') { active = true; continue; }
    if (!active) continue;
    if (line.trim() === '') break;
    const at = line.indexOf(':');
    if (at === -1) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (name) headers[name] = value;
  }
  headers['Cache-Control'] = 'no-cache';
  return headers;
}

function within(root, path) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export async function startGalleryHarness({ port = 0 } = {}) {
  const baseHeaders = await defaultHeaders();
  const stats = { total: 0, analytics: 0, inFlight: 0, maxInFlight: 0 };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    stats.total += 1;
    if (url.pathname.startsWith('/v1/analytics/') || url.pathname === '/v1/analytics') {
      stats.analytics += 1;
      stats.inFlight += 1;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('{}');
      await new Promise(done => setImmediate(done));
      stats.inFlight -= 1;
      return;
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === '/__test/stats') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(stats));
      return;
    }
    let path;
    let relative;
    if (url.pathname === '/' || url.pathname === '/gallery/' || url.pathname === '/gallery') {
      relative = 'foundations.html';
      path = resolve(galleryRoot, relative);
    } else if (url.pathname.startsWith('/gallery/')) {
      relative = url.pathname.slice('/gallery/'.length);
      path = resolve(galleryRoot, relative);
      if (!within(galleryRoot, path)) { response.writeHead(403); response.end(); return; }
    } else {
      relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      path = resolve(webRoot, relative);
      if (!within(webRoot, path)) { response.writeHead(403); response.end(); return; }
    }
    let contents;
    try {
      contents = await readFile(path);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, { ...baseHeaders, 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    response.end(contents);
  });
  await new Promise(done => server.listen(port, '127.0.0.1', done));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stats,
    resetStats() {
      stats.total = 0;
      stats.analytics = 0;
      stats.inFlight = 0;
      stats.maxInFlight = 0;
    },
    close: () => new Promise(done => server.close(done))
  };
}

export async function waitForSettled(page, { idle = true } = {}) {
  await page.waitForFunction(value => document.documentElement.dataset.idle === String(value), idle);
}

export async function waitForChartState(page, selector, state) {
  await page.waitForFunction(([sel, expected]) => [...document.querySelectorAll(sel)].length > 0 && [...document.querySelectorAll(sel)].every(element => element.dataset.state === expected), [selector, state]);
}

export async function watchPage(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      window.__cspViolations.push({ directive: event.violatedDirective, blocked: event.blockedURI, sample: event.sample });
    });
  });
  return {
    consoleErrors,
    pageErrors,
    async cspViolations() {
      return page.evaluate(() => window.__cspViolations || []);
    },
    async assertClean() {
      const csp = await page.evaluate(() => window.__cspViolations || []);
      if (consoleErrors.length > 0 || pageErrors.length > 0 || csp.length > 0) {
        throw new Error(`page diagnostics: console=${JSON.stringify(consoleErrors)} errors=${JSON.stringify(pageErrors)} csp=${JSON.stringify(csp)}`);
      }
    }
  };
}
