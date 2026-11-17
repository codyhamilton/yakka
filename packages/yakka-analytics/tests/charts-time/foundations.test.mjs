import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  COHORTS,
  ColourRegistry,
  FIXED_KEYS,
  FIXED_NEUTRALS,
  HUES,
  STORAGE_KEY,
  STATUS,
  THRESHOLDS,
  cohortStyle,
  deltaE,
  fixedNeutralDistinctness,
  memoryStorage,
  paletteReport,
  planAssignments,
  styleForKey
} from '../../web/js/charts/colour-registry.js';
import {
  formatBasis, formatCount, formatMoney, formatNumber, formatSample, formatShare, formatValue
} from '../../web/js/charts/formatters.js';
import { badgeModel } from '../../web/js/charts/badges.js';
import { BADGE_META, ENTITY_KEYS, SERIES, timeSeries } from '../gallery/fixture.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

test('palette passes the committed first-party contrast and adjacency thresholds in both themes', async () => {
  const report = paletteReport();
  assert.deepEqual(report.failures, []);
  for (const theme of ['light', 'dark']) {
    const data = report.themes[theme];
    assert.equal(data.hues.length, 8);
    for (const hue of data.hues) assert.ok(hue.contrast >= THRESHOLDS.surfaceContrast, `${theme} ${hue.name} contrast`);
    for (const pair of data.hueAdjacent) assert.ok(pair.value >= THRESHOLDS.adjacentDeltaE, `${theme} ${pair.from}/${pair.to} deltaE`);
    assert.equal(data.neutrals.length, Object.keys(FIXED_NEUTRALS).length);
    for (const neutral of data.neutrals) assert.ok(neutral.contrast >= THRESHOLDS.neutralContrast, `${theme} ${neutral.key} neutral contrast`);
    for (const pair of data.neutralAdjacent) assert.ok(pair.value >= THRESHOLDS.neutralAdjacentDeltaE, `${theme} neutral ${pair.from}/${pair.to} deltaE`);
    for (const status of data.status) assert.ok(status.contrast >= THRESHOLDS.statusContrast, `${theme} ${status.key} status contrast`);
    for (const pair of data.statusAdjacent) assert.ok(pair.value >= THRESHOLDS.statusAdjacentDeltaE, `${theme} status ${pair.from}/${pair.to} deltaE`);
    for (const pair of data.cohortAdjacent) assert.ok(pair.value >= THRESHOLDS.cohortAdjacentDeltaE, `${theme} cohort ${pair.from}/${pair.to}`);
  }

  const css = await readFile(new URL('../../web/css/charts.css', import.meta.url), 'utf8');
  for (const hue of HUES) {
    assert.match(css, new RegExp(`${hue.cssVar}:\\s*${hue.light.replace('#', '#')}`));
    assert.match(css, new RegExp(`${hue.cssVar}:\\s*${hue.dark.replace('#', '#')}`));
  }
  for (const style of [...Object.values(FIXED_NEUTRALS), ...Object.values(COHORTS), ...Object.values(STATUS)]) {
    assert.match(css, new RegExp(`${style.cssVar}:\\s*${style.light}`));
    assert.match(css, new RegExp(`${style.cssVar}:\\s*${style.dark}`));
  }
});

test('registry gives eight hue slots, then labelled neutral styles, and keeps fixed values distinct', () => {
  const keys = Array.from({ length: 12 }, (_, index) => `model:model-${String(index).padStart(2, '0')}`);
  const sorted = [...keys].sort();
  const assignments = planAssignments({}, keys);
  const slots = sorted.map(key => assignments[key]);
  assert.deepEqual(slots, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'n0', 'n1', 'n2', 'n3']);
  assert.deepEqual(planAssignments({}, [...keys].reverse()), assignments);

  assert.equal(fixedNeutralDistinctness(), true);
  for (const key of FIXED_KEYS) {
    const style = styleForKey(key, assignments);
    assert.equal(style.category, 'fixed');
    assert.ok(FIXED_KEYS.includes(style.key));
  }
  assert.notEqual(styleForKey('(other)', assignments).cssVar, styleForKey('(mixed)', assignments).cssVar);
  assert.notEqual(styleForKey('(other)', assignments).pattern, styleForKey('unknown', assignments).pattern);

  const extra = styleForKey('model:model-08', assignments);
  assert.equal(extra.category, 'neutral');
  assert.ok(extra.label.startsWith('series'));
  assert.ok(extra.pattern);
  assert.ok(extra.shape);
});

test('registry persists the storage key and never repaints a surviving series after a filter', () => {
  const keys = Array.from({ length: 10 }, (_, index) => `kind:kind-${index}`);
  const storage = memoryStorage();
  const registry = new ColourRegistry({ storage });
  registry.register(keys);
  const snapshot = registry.toJSON();
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(stored, snapshot);
  assert.equal(Object.keys(snapshot).length, keys.length);

  const reloaded = new ColourRegistry({ storage });
  assert.deepEqual(reloaded.toJSON(), snapshot);
  for (const key of keys) assert.deepEqual(reloaded.style(key), registry.style(key));

  registry.register([keys[1], keys[7]]);
  assert.deepEqual(registry.toJSON(), snapshot);
  assert.deepEqual(registry.style(keys[7]), styleForKey(keys[7], snapshot));
});

test('cohorts A to D keep fixed colours and differ from each other', () => {
  const a = cohortStyle('A');
  const b = cohortStyle('B');
  assert.deepEqual(cohortStyle('a'), a);
  assert.notEqual(a.cssVar, b.cssVar);
  assert.ok(deltaE(a.light, b.light) >= THRESHOLDS.cohortAdjacentDeltaE);
  for (const letter of ['A', 'B', 'C', 'D']) assert.equal(cohortStyle(letter).category, 'cohort');
});

test('registry module has no network path', async () => {
  const source = await readFile(new URL('../../web/js/charts/colour-registry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest|WebSocket/);
});

test('formatters never turn a missing value into zero and apply the money rules', () => {
  assert.equal(formatNumber(null), '—');
  assert.equal(formatValue(undefined), '—');
  assert.equal(formatCount(null, { unit: 'session' }), '—');
  assert.equal(formatCount(1, { unit: 'session' }), '1 session');
  assert.equal(formatCount(3, { unit: 'session' }), '3 sessions');
  assert.equal(formatShare(1, 4), '25%');
  assert.equal(formatShare(1, 0), '—');
  assert.equal(formatShare(null, 10), '—');
  assert.equal(formatMoney(12.5), '$12.50');
  assert.equal(formatMoney(0, { unpriced: 3 }), '$0.00+ (3 unpriced)');
  assert.equal(formatMoney(0, { priced: 0, unpriced: 3 }), 'unpriced');
  assert.equal(formatMoney(null), 'unpriced');
  assert.equal(formatMoney(5, { lowerBound: true }), '$5.00+');
  assert.equal(formatSample(5000, 12000), 'sample of 5,000 of 12,000');
  const basis = formatBasis({ clock: 'artifact/event facts.ts', score: 'latest known' });
  assert.match(basis, /artifact\/event facts\.ts/);
  assert.match(basis, /latest known/);
});

test('badge model names resolution, sample and every coverage flag', () => {
  const badges = badgeModel(BADGE_META);
  const labels = badges.map(badge => badge.label);
  assert.ok(labels.includes('resolution: time · day'));
  assert.ok(labels.includes('sample of 5,000 of 12,000'));
  for (const flag of ['partial', 'sampled', 'coarsened', 'clipped', 'lower-bound']) assert.ok(labels.includes(flag), flag);
  assert.ok(badges.some(badge => badge.kind === 'basis'));
});

test('foundations gallery proves tooltip, legend, badges, table and both themes in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage();
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/foundations.html`);
    await waitForSettled(page);

    assert.equal(await page.locator('[data-chart="foundations"]').getAttribute('data-chart'), 'foundations');
    assert.equal(await page.locator('[data-chart="foundations"]').getAttribute('data-state'), 'ready');

    const slots = await page.locator('#registry-swatches .yk-registry-item').evaluateAll(items => items.map(item => item.dataset.slot));
    assert.deepEqual(slots.slice(0, 8), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8']);
    assert.ok(slots[8].startsWith('n'));

    const key = 'model:atlas';
    const target = page.locator(`.yk-hit-target[data-key="${key}"]`);
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.locator('.yk-tooltip').getAttribute('data-entity-key'), key);
    assert.ok((await page.locator('.yk-tooltip').textContent()).includes('n='));

    const requestsBefore = harness.stats.total;
    await page.locator('.yk-legend-item[data-key="model:atlas"] button[data-action="toggle"]').click();
    assert.match(await page.locator('#intent-log').textContent(), /"type":"toggle"/);
    assert.equal(await page.locator('.yk-legend-item[data-key="model:atlas"]').getAttribute('data-hidden'), 'true');
    assert.equal(harness.stats.total, requestsBefore, 'legend toggle must not fetch');
    const targetSizes = await page.locator('.yk-legend button').evaluateAll(buttons => buttons.map(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    for (const size of targetSizes) assert.ok(size.width >= 44 && size.height >= 44, 'legend target is at least 44 px');

    const badges = await page.locator('#badges-host').textContent();
    assert.match(badges, /resolution: time · day/);
    assert.match(badges, /sample of 5,000 of 12,000/);
    for (const flag of ['partial', 'sampled', 'coarsened', 'clipped', 'lower-bound']) assert.ok(badges.includes(flag), flag);

    const expected = timeSeries({ points: 8 })[0];
    const expectedValues = SERIES.map(series => formatCount(expected.values[series.key], {}));
    const actualValues = await page.locator('#table-host tbody tr').first().locator('.yk-table-value').allTextContents();
    assert.deepEqual(actualValues, expectedValues);
    assert.match(await page.locator('#table-host caption').textContent(), /artifact\/event facts\.ts/);

    await page.locator('#table-host tbody tr').first().focus();
    await page.keyboard.press('Space');
    assert.match(await page.locator('#intent-log').textContent(), /"type":"select"/);
    assert.equal(await page.locator('#table-host .yk-table-select').first().isChecked(), true);

    const light = await page.evaluate(() => ({
      token: getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim(),
      shadowSheets: document.getElementById('shadow-host').shadowRoot.adoptedStyleSheets.length,
      shadowBg: getComputedStyle(document.getElementById('shadow-host').shadowRoot.querySelector('.yk-swatch')).backgroundColor
    }));
    assert.equal(light.token, HUES[0].light);
    assert.ok(light.shadowSheets >= 1);
    await page.locator('#theme-switch').click();
    const dark = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      token: getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim(),
      shadowBg: getComputedStyle(document.getElementById('shadow-host').shadowRoot.querySelector('.yk-swatch')).backgroundColor,
      slots: [...document.querySelectorAll('#registry-swatches .yk-registry-item')].map(item => item.dataset.slot)
    }));
    assert.equal(dark.theme, 'dark');
    assert.equal(dark.token, HUES[0].dark);
    assert.notEqual(light.shadowBg, dark.shadowBg);
    assert.deepEqual(dark.slots, slots, 'theme change must not repaint registry slots');

    const motion = await page.locator('[data-chart="foundations"]').evaluate(element => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, transition: style.transitionDuration };
    });
    assert.equal(motion.animation, 'none');
    assert.equal(motion.transition, '0s');

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
