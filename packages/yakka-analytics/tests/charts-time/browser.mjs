// Chromium-only browser loader for the chart kit specs. playwright-core is a
// test-only dependency and is never added to the package. If either it or the
// pinned Chromium cache is missing, callers skip with SKIP_REASON.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const NODE_PATH_HINT = '/home/codyh/workspace/yakka/packages/yakka-analytics/node_modules';
export const SKIP_REASON = `browser acceptance needs playwright-core under NODE_PATH=${NODE_PATH_HINT} and the Chromium 1243 cache`;

function moduleDirectories() {
  const dirs = (process.env.NODE_PATH || '').split(':').filter(Boolean);
  if (!dirs.includes(NODE_PATH_HINT)) dirs.push(NODE_PATH_HINT);
  return dirs;
}

export function loadPlaywright() {
  for (const dir of moduleDirectories()) {
    try {
      const require = createRequire(join(dir, '__chart_kit_resolver.cjs'));
      const playwright = require('playwright-core');
      if (playwright?.chromium) return playwright;
    } catch {}
  }
  try {
    return createRequire(import.meta.url)('playwright-core');
  } catch {
    return null;
  }
}

export function chromiumExecutablePath() {
  return join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome');
}

export function loadBrowserEnvironment() {
  const playwright = loadPlaywright();
  const executablePath = chromiumExecutablePath();
  if (!playwright) return { ok: false, reason: SKIP_REASON, playwright: null, executablePath };
  if (!existsSync(executablePath)) return { ok: false, reason: SKIP_REASON, playwright, executablePath };
  return { ok: true, reason: '', playwright, executablePath };
}

export async function launchBrowser(environment = loadBrowserEnvironment()) {
  if (!environment.ok) throw new Error(environment.reason);
  return environment.playwright.chromium.launch({
    executablePath: environment.executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
}
