// Plan 30 phase 2 acceptance harness wrapper. It starts the real Plan 30
// fixture (plan30_harness_test.go, build tag plan30harness) through the phase 1
// harness, then adds only additive browser helpers: route building, request
// capture, both-theme 1440x900 screenshots under gitignored .scratch/, and the
// mockup reference paths. No request interception, no synthetic API response,
// no fixed sleeps in assertions.

import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startPlan30Harness } from '../plan30/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
export const screensRoot = resolve(repoRoot, '.scratch', 'plan30-chrome', 'screens');
export const mockupsRoot = resolve(repoRoot, 'docs', 'plans', '30-analytics-operable-chrome', 'mockups');

export const SCREEN_FILES = {
  start: 'start', pulse: 'pulse', trends: 'trends', cost: 'cost', quality: 'quality',
  tools: 'tools', workflow: 'workflow', compare: 'compare', scatter: 'scatter',
  plans: 'plans', 'plan-detail': 'plan-detail', sessions: 'sessions',
  'session-detail': 'session-detail', ledger: 'ledger', artifact: 'artifact', ops: 'ops'
};

// Every browser-visible analytics request, method/path/query, captured from the
// real page. Control routes and static assets are deliberately excluded.
export function captureAnalytics(page, requests = []) {
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/v1/analytics/') && !url.pathname.startsWith('/v1/admin/')) return;
    requests.push({ method: request.method(), url, path: url.pathname, query: url.searchParams });
  });
  return requests;
}

export function analyticsRequests(requests, suffix = '') {
  return requests.filter(entry => entry.path.endsWith(`/v1/analytics/${suffix}`));
}

export function hasRequest(requests, suffix, expected = {}) {
  return requests.some(entry => {
    if (!entry.path.endsWith(`/v1/analytics/${suffix}`)) return false;
    return Object.entries(expected).every(([key, value]) => {
      if (Array.isArray(value)) return value.every(item => entry.query.getAll(key).includes(item));
      return entry.query.get(key) === String(value);
    });
  });
}

export function queryValue(url, key) {
  return url.searchParams.get(key);
}

// Reads the PNG IHDR dimensions without a decoder.
export async function pngSize(path) {
  const bytes = await readFile(path);
  if (bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export async function startPhase2Harness() {
  await mkdir(screensRoot, { recursive: true });
  const harness = await startPlan30Harness();

  const routeUrl = (route, { tenant, win = '30d' } = {}) => {
    const params = new URLSearchParams();
    if (tenant) params.set('tenant', tenant);
    if (win && !route.includes('from=')) params.set('win', win);
    const search = params.toString();
    if (!search) return route;
    return `${route}${route.includes('?') ? '&' : '?'}${search}`;
  };

  const go = async (page, route, options) => {
    await page.goto(`${harness.origin}${routeUrl(route, options)}`);
    // Detail screens nest read-only panels that do not carry data-idle; wait on
    // the document plus every top-level panel only.
    await page.waitForFunction(() => {
      const html = document.documentElement;
      if (html.dataset.idle !== 'true' || html.dataset.state !== 'ready') return false;
      const top = Array.from(document.querySelectorAll('[data-panel]')).filter(node => !node.parentElement?.closest('[data-panel]'));
      return top.length > 0 ? top.every(node => node.dataset.idle === 'true') : true;
    });
  };

  const setTheme = async (page, theme) => {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, theme);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  };

  const screenshot = async (page, id, theme) => {
    const file = resolve(screensRoot, `${id}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  };

  return { ...harness, screensRoot, mockupsRoot, routeUrl, go, setTheme, screenshot };
}
