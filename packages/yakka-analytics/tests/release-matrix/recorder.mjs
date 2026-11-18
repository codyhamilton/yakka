// Browser request-shape recorder for the release matrix.
//
// Visits every shipped preset with a fixed absolute window and the relevant
// all-history states, and records only the analytics request shapes the shipped
// workspace sends: method, path and query pairs. No response body, tenant data
// or clock-derived volatile value enters the record. Query pairs are sorted so
// parameter order never causes drift.
//
// `node --test record.test.mjs` compares the canonical record with the committed
// file and fails on unexpected drift. Set YAKKA_RECORD_WRITE=1 once to author it.

import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../workspace/browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';

const repoRoot = resolve(import.meta.dirname, '../../../..');

export const RECORD_PATH = join(repoRoot, 'packages/yakka/internal/serve/testdata/browser-request-shapes.json');

const FROM = '2026-09-01T00:00:00Z';
const TO = '2026-09-05T00:00:00Z';
const finite = path => `/b/${path}?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&tz=UTC`;
const all = path => `/b/${path}?win=all&tz=UTC`;

// The stub's p12 scene publishes every preset's grains and features, so one
// schema covers the whole shipped catalogue. The API is deterministic; only
// the browser assets differ between the two matrix targets.
export const SCENE = { scenario: 'default', p10: true, p11: true, p12: true };

export const SCENARIOS = [
  { label: 'pulse:window', route: finite('pulse') },
  { label: 'pulse:all-history', route: all('pulse') },
  { label: 'trends:window', route: finite('trends') },
  { label: 'trends:all-history', route: all('trends') },
  { label: 'compare:window', route: finite('compare') },
  { label: 'scatter:window', route: finite('scatter') },
  { label: 'scatter:all-history', route: all('scatter') },
  { label: 'quality:window', route: finite('quality') },
  { label: 'cost:window', route: finite('cost') },
  { label: 'cost:all-history', route: all('cost') },
  { label: 'tools:window', route: finite('tools') },
  { label: 'workflow:window', route: finite('workflow') }
];

function pairOrder(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] === b[1]) return 0;
  return a[1] < b[1] ? -1 : 1;
}

export function canonicalShape({ method, path, query }) {
  return { method, path, query: query.slice().sort(pairOrder) };
}

function shapeKey(shape) {
  return JSON.stringify(shape);
}

async function setScene(origin) {
  const response = await fetch(`${origin}/__test/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(SCENE)
  });
  if (!response.ok) throw new Error(`control scene failed: ${response.status}`);
}

export async function collect(origin, { page }) {
  await setScene(origin);
  const collected = [];
  for (const scenario of SCENARIOS) {
    const shapes = [];
    const onResponse = response => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/v1/analytics/')) return;
      shapes.push(canonicalShape({
        method: response.request().method(),
        path: url.pathname,
        query: [...url.searchParams.entries()]
      }));
    };
    page.on('response', onResponse);
    try {
      await page.goto(`${origin}${scenario.route}`);
      await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
      await page.waitForFunction(() => {
        const panels = [...document.querySelectorAll('.workspace-panel')];
        return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true');
      });
    } finally {
      page.off('response', onResponse);
    }
    const unique = new Map();
    for (const shape of shapes) unique.set(shapeKey(shape), shape);
    collected.push({ label: scenario.label, route: scenario.route, requests: [...unique.values()].sort((a, b) => shapeKey(a) < shapeKey(b) ? -1 : 1) });
  }
  return collected;
}

export async function record() {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) throw new Error(SKIP_REASON);
  const tmp = resolve(repoRoot, process.env.TMPDIR || '.scratch/p13');
  if (tmp === '/tmp' || tmp.startsWith('/tmp/')) throw new Error(`recorder scratch must stay in the worktree, got ${tmp}`);
  mkdirSync(tmp, { recursive: true });
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
    const scenarios = await collect(harness.origin, { page });
    return {
      version: 1,
      note: 'Analytics request shapes the shipped workspace sends over the deterministic fixture. Method, path and query only; no bodies, tenant data or volatile timestamps.',
      scenarios
    };
  } finally {
    await browser.close();
    await harness.close();
  }
}

export function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readCommitted() {
  return JSON.parse(await readFile(RECORD_PATH, 'utf8'));
}

export async function writeCommitted(value) {
  await writeFile(RECORD_PATH, canonicalJson(value));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = await record();
  await writeCommitted(value);
  process.stdout.write(`wrote ${RECORD_PATH}\n`);
}
