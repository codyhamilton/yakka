// Capture the Plan 31 mockups at 1440x900 with the repo's existing Playwright/Chromium loader
// (same path as Plan 30). Usage: node capture.mjs   (run generate.py first)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadBrowserEnvironment, launchBrowser } from '../../../../../packages/yakka-analytics/tests/charts-time/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..');
const keys = ['tenant-selector', 'profile-tenants', 'lifecycle-confirm'];

const env = loadBrowserEnvironment();
if (!env.ok) throw new Error(env.reason);
const browser = await launchBrowser(env);
const results = [];
try {
  for (const key of keys) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(here, `${key}.html`)).href);
    const facts = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > 1440,
      rowHeights: [...document.querySelectorAll('th,td')].map(c => Math.round(c.getBoundingClientRect().height)),
      whiteSurface: [...document.querySelectorAll('.panel,.plot,.mock-dialog,.mock-listbox,table')]
        .some(el => getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)')
    }));
    const bad = facts.rowHeights.filter(h => h < 28 || h > 32);
    if (facts.overflow) throw new Error(`${key}: horizontal overflow`);
    if (bad.length) throw new Error(`${key}: row heights outside 28-32px: ${[...new Set(bad)]}`);
    if (facts.whiteSurface) throw new Error(`${key}: white surface`);
    if (errors.length) throw new Error(`${key}: page errors ${errors}`);
    await page.screenshot({ path: path.join(out, `${key}.png`), fullPage: false });
    results.push({ key, overflow: false, rows: '28-32px', whiteSurface: false, pageErrors: 0 });
    await page.close();
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, 'capture-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log('captured', keys.join(', '));
