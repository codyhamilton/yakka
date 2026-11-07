import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const webRoot = resolve(import.meta.dirname, '../../web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/** Test-only static server. `fixtureSummary` is the Summary returned by analyticsfixture.Create. */
export async function startStaticHarness({ fixtureSummary, port = 0 } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/__test/fixture-summary') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(fixtureSummary ?? null));
      return;
    }
    if (url.pathname === '/__test/fixture-summary-probe') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" });
      response.end('<!doctype html><html><body><output id="summary">pending</output><script src="/__test/fixture-summary-probe.js"></script></body></html>');
      return;
    }
    if (url.pathname === '/__test/fixture-summary-probe.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end("fetch('/__test/fixture-summary').then(r => r.json()).then(x => document.querySelector('#summary').textContent = JSON.stringify(x)).catch(e => document.querySelector('#summary').textContent = e.message);");
      return;
    }
    if (url.pathname === '/__test/legacy-limit-probe') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" });
      response.end('<!doctype html><html><body><output id="legacy">pending</output><script type="module" src="/__test/legacy-limit-probe.js"></script></body></html>');
      return;
    }
    if (url.pathname === '/__test/legacy-limit-probe.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end("import { legacyErrorMessage, retryHint } from '/js/core/legacy-error.js'; fetch('/v1/analytics/query').then(async r => { const body = await r.json(); document.querySelector('#legacy').textContent = legacyErrorMessage(body) + '|retry=' + retryHint(body); }).catch(e => document.querySelector('#legacy').textContent = e.message);");
      return;
    }
    if (url.pathname === '/v1/analytics/schema') {
      response.writeHead(404, { 'Content-Type': 'application/json' }); response.end('{"error":"not found"}'); return;
    }
    if (url.pathname === '/v1/analytics/query') {
      response.writeHead(400, { 'Content-Type': 'application/json' }); response.end('{"error":"range too wide"}'); return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    let path = resolve(webRoot, relative);
    if (!path.startsWith(`${webRoot}${sep}`) && path !== webRoot) { response.writeHead(403); response.end(); return; }
    let contents;
    try { contents = await readFile(path); }
    catch {
      path = resolve(webRoot, 'index.html');
      try { contents = await readFile(path); }
      catch { response.writeHead(404); response.end(); return; }
    }
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(contents);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function readFixtureSummary(page) {
  return page.evaluate(async () => {
    const response = await fetch('/__test/fixture-summary');
    if (!response.ok) throw new Error(`fixture summary returned ${response.status}`);
    return response.json();
  });
}
