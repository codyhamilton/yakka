import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIXED_KEYS,
  FIXED_NEUTRALS,
  HUES,
  THRESHOLDS,
  paletteReport
} from '../../web/js/charts/colour-registry.js';
import { formatCount, formatValue } from '../../web/js/charts/formatters.js';
import { SCATTER_BUDGET, SERIES, timeSeries } from '../gallery/fixture.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

// Phase 7 acceptance: one suite over every gallery page, proving the phase
// outcome end to end. The scatter reference below is an independent linear
// scan written here; it imports neither hit-test.js nor any chart module and
// consumes only the documented inspect() surface.

const environment = loadBrowserEnvironment();
let harness = null;
let browser = null;

test.before(async () => {
  if (!environment.ok) return;
  harness = await startGalleryHarness();
  browser = await launchBrowser(environment);
});

test.after(async () => {
  if (browser) await browser.close();
  if (harness) await harness.close();
});

function needsBrowser(t) {
  if (environment.ok) return true;
  t.skip(environment.reason || SKIP_REASON);
  return false;
}

async function openPage(options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 2600 },
    hasTouch: Boolean(options.hasTouch)
  });
  const page = await context.newPage();
  const diagnostics = await watchPage(page);
  return { context, page, diagnostics };
}

function referenceNearest(marks, px, py) {
  let best = null;
  for (const mark of marks) {
    const distance = Math.hypot(mark.px - px, mark.py - py);
    if (best === null
      || distance < best.distance - 1e-9
      || (Math.abs(distance - best.distance) <= 1e-9 && String(mark.key) < String(best.key))) {
      best = { key: mark.key, distance };
    }
  }
  return best ? best.key : null;
}

function referenceInRect(marks, bounds) {
  const keys = new Set();
  for (const mark of marks) {
    if (mark.px < bounds.left || mark.px > bounds.right || mark.py < bounds.top || mark.py > bounds.bottom) continue;
    keys.add(String(mark.key));
  }
  return [...keys].sort();
}

function inspectChart(page, id, extra = {}) {
  return page.evaluate(([chartId, keys]) => {
    const element = document.getElementById(chartId);
    const result = element.inspect();
    const output = {
      state: element.dataset.state,
      chart: result.chart,
      mode: result.mode,
      type: result.type,
      stacked: result.stacked,
      bucket: result.bucket,
      window: result.window,
      selection: result.selection,
      selectionKeys: result.selectionKeys,
      brush: result.brush,
      inspectedKey: result.inspectedKey,
      inspectedIndex: result.inspectedIndex,
      inspectedSeries: result.inspectedSeries,
      highlight: result.highlight,
      selectMode: result.selectMode,
      series: result.series,
      plot: result.plot,
      marks: result.marks,
      cursor: result.cursor,
      yScale: result.yScale,
      yScales: result.yScales,
      dualAxis: result.dualAxis,
      thresholds: result.thresholds,
      urlState: result.urlState
    };
    if (keys.includes('sampledMarkCount')) output.sampledMarkCount = result.sampledMarkCount;
    if (keys.includes('region')) output.region = result.region;
    return output;
  }, [id, Object.keys(extra).length ? Object.keys(extra) : []]);
}

function tableRows(page, chartId, limit = 2) {
  return page.evaluate(([id, count]) => {
    const root = document.getElementById(id).shadowRoot;
    return [...root.querySelectorAll('.yk-table tbody tr')].slice(0, count).map(row => ({
      key: row.dataset.entityKey,
      values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
    }));
  }, [chartId, limit]);
}

function legendSwatchToken(page, chartId, key) {
  return page.evaluate(([id, entity]) => {
    const root = document.getElementById(id).shadowRoot;
    const swatch = root.querySelector(`.yk-legend-item[data-key="${entity}"] .yk-legend-swatch`);
    return swatch ? swatch.style.getPropertyValue('--yk-swatch') : null;
  }, [chartId, key]);
}

test('the committed palette passes in both themes and every named neutral stays distinct from (other)', () => {
  const report = paletteReport();
  assert.deepEqual(report.failures, []);
  for (const theme of ['light', 'dark']) {
    const data = report.themes[theme];
    for (const hue of data.hues) assert.ok(hue.contrast >= THRESHOLDS.surfaceContrast, `${theme} ${hue.name}`);
    for (const pair of data.hueAdjacent) assert.ok(pair.value >= THRESHOLDS.adjacentDeltaE, `${theme} ${pair.from}/${pair.to}`);
    for (const neutral of data.neutrals) assert.ok(neutral.contrast >= THRESHOLDS.neutralContrast, `${theme} ${neutral.key}`);
    for (const pair of data.neutralAdjacent) assert.ok(pair.value >= THRESHOLDS.neutralAdjacentDeltaE, `${theme} ${pair.from}/${pair.to}`);
    for (const pair of data.cohortAdjacent) assert.ok(pair.value >= THRESHOLDS.cohortAdjacentDeltaE, `${theme} cohort ${pair.from}/${pair.to}`);
  }

  const other = FIXED_NEUTRALS['(other)'];
  for (const key of ['(mixed)', '(none)', '(multi)', 'unknown', 'unscored']) {
    const style = FIXED_NEUTRALS[key];
    assert.ok(FIXED_KEYS.includes(key));
    assert.notEqual(style.cssVar, other.cssVar, `${key} has its own token`);
    assert.ok(style.label !== other.label && style.shape && style.pattern, `${key} is labelled and patterned`);
  }
});

test('gallery index links every Phase 7 case page and names the theme and case', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage();
  try {
    await page.goto(`${harness.origin}/gallery/index.html?case=acceptance`);
    await waitForSettled(page);

    const links = await page.locator('#gallery-links a').evaluateAll(anchors => anchors.map(anchor => ({
      caseName: anchor.dataset.case,
      href: anchor.getAttribute('href')
    })));
    assert.deepEqual(links.map(link => link.caseName).slice(0, 4), ['foundations', 'time-series', 'gestures', 'scatter']);
    assert.ok(links.length >= 4, 'the Phase 7 case links are present');
    for (const link of links) assert.match(link.href, /^\/gallery\/[a-z-]+\.html$/);

    assert.equal(await page.locator('#gallery-theme').textContent(), 'theme: light');
    assert.equal(await page.locator('#gallery-case').textContent(), 'case: acceptance');
    assert.match(await page.locator('#gallery-fixture').textContent(), new RegExp(`${SCATTER_BUDGET} scatter points`));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.case), 'acceptance');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.idle), 'true');

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('foundations gallery proves badges, both themes, the palette and the accessible table', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ viewport: { width: 1280, height: 2600 } });
  try {
    await page.goto(`${harness.origin}/gallery/foundations.html`);
    await waitForSettled(page);

    const frame = page.locator('[data-chart="foundations"]');
    assert.equal(await frame.getAttribute('data-chart'), 'foundations');
    assert.equal(await frame.getAttribute('data-state'), 'ready');

    const badges = await page.locator('#badges-host').textContent();
    assert.match(badges, /resolution: time · day/);
    assert.match(badges, /sample of 5,000 of 12,000/);
    for (const flag of ['partial', 'sampled', 'coarsened', 'clipped', 'lower-bound']) {
      assert.ok(badges.includes(flag), `coverage badge ${flag}`);
    }
    assert.doesNotMatch(badges, /%/, 'badges name counts, not a blended percentage');

    assert.deepEqual(await page.evaluate(() => window.__foundations.palette.failures), []);

    const neutralTokens = await page.locator('#neutral-swatches .yk-swatch').evaluateAll(swatches => swatches.map(swatch => swatch.dataset.token));
    assert.equal(new Set(neutralTokens).size, neutralTokens.length, 'each named neutral keeps its own token');
    for (const style of Object.values(FIXED_NEUTRALS)) assert.ok(neutralTokens.includes(style.cssVar), style.key);

    const rowIndex = timeSeries({ points: 8 });
    const expectedValues = SERIES.map(series => formatCount(rowIndex[0].values[series.key]));
    assert.deepEqual(await page.locator('#table-host tbody tr').first().locator('.yk-table-value').allTextContents(), expectedValues);

    await page.locator('#table-host tbody tr').first().focus();
    await page.keyboard.press('Space');
    assert.match(await page.locator('#intent-log').textContent(), /"type":"select"/);
    assert.equal(await page.locator('#table-host .yk-table-select').first().isChecked(), true);

    const lightToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim());
    assert.equal(lightToken, HUES[0].light);
    const lightSlots = await page.locator('#registry-swatches .yk-registry-item').evaluateAll(items => items.map(item => item.dataset.slot));
    await page.locator('#theme-switch').click();
    const dark = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      token: getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim(),
      slots: [...document.querySelectorAll('#registry-swatches .yk-registry-item')].map(item => item.dataset.slot)
    }));
    assert.equal(dark.theme, 'dark');
    assert.equal(dark.token, HUES[0].dark);
    assert.deepEqual(dark.slots, lightSlots, 'a theme change never repaints a surviving entity');

    const motion = await page.locator('[data-chart="foundations"]').evaluate(element => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, transition: style.transitionDuration };
    });
    assert.equal(motion.animation, 'none');
    assert.equal(motion.transition, '0s');

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('time-series gallery proves every mode, its table and stable entity colours in both themes', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ viewport: { width: 1280, height: 2800 } });
  try {
    await page.goto(`${harness.origin}/gallery/time-series.html`);
    await waitForSettled(page);

    const rows = timeSeries({ points: 60 });
    for (const id of ['line', 'area', 'columns', 'cumulative', 'share', 'sync-a', 'sync-b', 'thresholds']) {
      assert.equal((await inspectChart(page, id)).state, 'ready', `${id} is ready`);
    }
    assert.equal((await inspectChart(page, 'empty')).state, 'empty');
    assert.equal((await inspectChart(page, 'unsupported')).state, 'unsupported');

    const line = await inspectChart(page, 'line');
    assert.equal(line.mode, 'absolute');
    assert.equal(line.type, 'line');
    assert.equal(line.bucket, 'day');
    assert.deepEqual(line.yScales, ['y']);
    assert.equal(line.dualAxis, false);
    assert.deepEqual(line.marks[0].values, rows[0].values);
    assert.deepEqual(await tableRows(page, 'line', 1).then(list => list[0].values), SERIES.map(series => formatCount(rows[0].values[series.key])));

    assert.equal((await inspectChart(page, 'area')).type, 'area');
    const columns = await inspectChart(page, 'columns');
    assert.equal(columns.type, 'columns');
    assert.equal(columns.stacked, true);
    assert.equal(columns.yScale.min, 0, 'stacked columns are zero-based');
    assert.deepEqual(await tableRows(page, 'columns', 1).then(list => list[0].values), SERIES.map(series => formatCount(rows[0].values[series.key])));

    assert.equal((await inspectChart(page, 'cumulative')).mode, 'cumulative');
    const cumulativeExpected = SERIES.map(series => formatCount(rows[0].values[series.key] + rows[1].values[series.key]));
    assert.deepEqual(await tableRows(page, 'cumulative', 2).then(list => list[1].values), cumulativeExpected);

    assert.equal((await inspectChart(page, 'share')).mode, 'share');
    const bucket = rows[0].values;
    const total = SERIES.reduce((sum, series) => sum + bucket[series.key], 0);
    const shareExpected = SERIES.map(series => formatValue(bucket[series.key] / total, { kind: 'percent' }));
    assert.deepEqual(await tableRows(page, 'share', 1).then(list => list[0].values), shareExpected);

    const tokens = await Promise.all(['line', 'area', 'columns', 'cumulative', 'share']
      .map(id => legendSwatchToken(page, id, 'model:atlas')));
    assert.ok(tokens.every(token => token && token === tokens[0]), 'entity colour is stable across modes');

    await page.locator('yk-chart#line .yk-legend-item[data-key="harness:orca"] .yk-legend-toggle').click();
    assert.equal(await legendSwatchToken(page, 'line', 'model:atlas'), tokens[0], 'a filter never repaints a surviving entity');

    const summary = page.locator('yk-chart#line .yk-chart-table > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('yk-chart#line').shadowRoot.querySelector('details.yk-chart-table').open), false);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('yk-chart#line').shadowRoot.querySelector('details.yk-chart-table').open), true);
    assert.deepEqual(await tableRows(page, 'line', 1).then(list => list[0].values), SERIES.map(series => formatCount(rows[0].values[series.key])));

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim() === '#60a5fa');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--yk-cat-1').trim()), HUES[0].dark);
    assert.equal(await legendSwatchToken(page, 'line', 'model:atlas'), tokens[0], 'the theme changes the value, not the entity slot');

    const motion = await page.locator('yk-chart#line .yk-chart').evaluate(element => {
      const style = getComputedStyle(element);
      return { animation: style.animationName, transition: style.transitionDuration };
    });
    assert.equal(motion.animation, 'none');
    assert.equal(motion.transition, '0s');

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('gestures gallery proves hover, inspect, selection, brush, zoom, pan, legend, keyboard and touch', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ viewport: { width: 1200, height: 2600 }, hasTouch: true });
  try {
    await page.goto(`${harness.origin}/gallery/gestures.html`);
    await waitForSettled(page);

    const rows = timeSeries({ points: 40 });
    const geometry = (id, index) => page.evaluate(([chartId, rowIndex]) => {
      const result = document.getElementById(chartId).inspect();
      const mark = result.marks[rowIndex];
      return { plot: result.plot, px: mark.px, key: mark.key, x: mark.x };
    }, [id, index]);
    const query = () => page.evaluate(() => location.search);
    const historyLength = () => page.evaluate(() => history.length);
    const at = (geom, offset = 0) => ({ x: geom.plot.left + geom.px + offset, y: geom.plot.top + geom.plot.height / 2 });
    const tooltipKey = id => page.locator(`yk-chart#${id} .yk-tooltip`).evaluate(element => element.dataset.entityKey || '');
    const lastEvent = () => page.locator('#gesture-state').evaluate(element => element.dataset.lastEvent);

    await page.locator('yk-chart#gestures-a .u-over').scrollIntoViewIfNeeded();

    const urlBefore = await query();
    const historyBefore = await historyLength();
    await page.mouse.move(at(await geometry('gestures-a', 5)).x, at(await geometry('gestures-a', 5)).y);
    const hoveredA = await inspectChart(page, 'gestures-a');
    assert.equal(hoveredA.inspectedKey, rows[5].key);
    assert.equal(hoveredA.highlight, rows[5].key);
    assert.equal((await inspectChart(page, 'gestures-b')).highlight, rows[5].key);
    assert.equal(await tooltipKey('gestures-a'), rows[5].key);
    assert.equal(await query(), urlBefore);
    assert.equal(await historyLength(), historyBefore);
    assert.equal(harness.stats.analytics, 0, 'hover makes no request');

    await page.evaluate(() => document.getElementById('gestures-a').shadowRoot.querySelector('.yk-chart').focus());
    await page.keyboard.press('ArrowRight');
    assert.equal((await inspectChart(page, 'gestures-a')).inspectedKey, rows[6].key);
    assert.equal((await inspectChart(page, 'gestures-b')).highlight, rows[6].key);
    assert.equal(await query(), urlBefore);

    await page.mouse.click(at(await geometry('gestures-a', 6)).x, at(await geometry('gestures-a', 6)).y);
    assert.equal(await lastEvent(), 'inspect', 'a plain click inspects');
    assert.equal((await inspectChart(page, 'gestures-a')).inspectedKey, rows[6].key);

    const historyBeforeSelection = await historyLength();
    const seriesBefore = (await inspectChart(page, 'gestures-a')).series;
    const at7 = await geometry('gestures-a', 7);
    await page.keyboard.down('Shift');
    await page.mouse.click(at(at7).x, at(at7).y);
    await page.keyboard.up('Shift');
    assert.deepEqual((await inspectChart(page, 'gestures-a')).selection, { kind: 'entity', include: [rows[7].key], exclude: [] });

    const at8 = await geometry('gestures-a', 8);
    await page.keyboard.down('Control');
    await page.mouse.click(at(at8).x, at(at8).y);
    await page.keyboard.up('Control');
    assert.deepEqual((await inspectChart(page, 'gestures-a')).selectionKeys, [rows[7].key, rows[8].key]);

    await page.keyboard.down('Alt');
    await page.mouse.click(at(at7).x, at(at7).y);
    await page.keyboard.up('Alt');
    const subtracted = await inspectChart(page, 'gestures-a');
    assert.deepEqual(subtracted.selection, { kind: 'entity', include: [rows[8].key], exclude: [rows[7].key] });
    assert.deepEqual((await inspectChart(page, 'gestures-a')).series, seriesBefore);

    await page.locator(`yk-chart#gestures-a input.yk-table-select[data-key="${rows[9].key}"]`).click();
    const afterCheckbox = await inspectChart(page, 'gestures-a');
    assert.deepEqual(afterCheckbox.selection.include, [rows[8].key, rows[9].key]);
    assert.match(await query(), /pick=/);
    assert.equal(await historyLength(), historyBeforeSelection);
    assert.equal(harness.stats.analytics, 0, 'selection makes no request');

    const brushStart = await geometry('gestures-a', 10);
    const brushEnd = await geometry('gestures-a', 20);
    await page.mouse.move(at(brushStart).x, at(brushStart).y);
    await page.mouse.down();
    await page.mouse.move(at(brushEnd).x, at(brushEnd).y, { steps: 6 });
    await page.mouse.up();
    const brushed = await inspectChart(page, 'gestures-a');
    assert.ok(brushed.brush, 'a time drag creates a transient brush');
    assert.ok(Math.abs(brushed.brush.from - rows[10].x) < 2 * 24 * 3600 * 1000);
    assert.match(await query(), /sel=/);
    const historyBeforeZoom = await historyLength();
    assert.equal(historyBeforeZoom, historyBeforeSelection, 'a brush does not push history');

    await page.locator('yk-chart#gestures-a [data-gesture="zoom-selection"]').click();
    const zoomed = await inspectChart(page, 'gestures-a');
    assert.equal(zoomed.brush, null, 'zoom clears the transient brush');
    assert.match(await query(), /from=/);
    assert.doesNotMatch(await query(), /sel=/);
    assert.equal(await historyLength(), historyBeforeZoom + 1, 'zoom pushes scope');

    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.search.includes('sel='));
    const restored = await inspectChart(page, 'gestures-a');
    assert.ok(restored.brush, 'Back restores the prior transient brush');
    assert.ok(Math.abs(restored.window.from - rows[0].x) < 2 * 24 * 3600 * 1000, 'Back restores the prior scope');

    await page.mouse.dblclick(at(brushStart).x, at(brushStart).y);
    const doubled = await inspectChart(page, 'gestures-a');
    assert.equal(doubled.brush, null);
    assert.match(await query(), /from=/);
    assert.doesNotMatch(await query(), /sel=/, 'double-click commits the brush to scope');

    const panStart = await geometry('gestures-a', 15);
    await page.keyboard.down('Shift');
    await page.mouse.move(at(panStart).x, at(panStart).y);
    await page.mouse.down();
    await page.mouse.move(at(panStart).x - 80, at(panStart).y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const panned = await inspectChart(page, 'gestures-a');
    assert.equal(panned.brush, null, 'pan creates no brush');
    assert.notDeepEqual(panned.window, doubled.window, 'pan moves the window');

    const wheelGeom = await geometry('gestures-a', 20);
    const spanBeforeWheel = panned.window.to - panned.window.from;
    await page.mouse.move(at(wheelGeom).x, at(wheelGeom).y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const wheeled = await inspectChart(page, 'gestures-a');
    assert.ok(wheeled.window.to - wheeled.window.from < spanBeforeWheel, 'Ctrl-wheel zooms around the cursor');

    const analyticsBeforeLegend = harness.stats.analytics;
    const historyBeforeLegend = await historyLength();
    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="harness:orca"] .yk-legend-toggle').click();
    assert.equal((await inspectChart(page, 'gestures-a')).series.find(item => item.key === 'harness:orca').visible, false);
    assert.match(await query(), /hide=harness%3Aorca/);
    assert.equal(await historyLength(), historyBeforeLegend, 'legend toggle replaces, it does not push');
    assert.equal(harness.stats.analytics, analyticsBeforeLegend, 'legend toggle makes no request');

    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="repo:core"] .yk-legend-focus').click();
    assert.match(await query(), /repo_id=core/);
    assert.equal(await historyLength(), historyBeforeLegend + 1, 'legend focus pushes one filter');

    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="model:atlas"] .yk-legend-toggle').click({ modifiers: ['Control'] });
    assert.deepEqual((await inspectChart(page, 'gestures-a')).series.filter(item => item.visible).map(item => item.key), ['model:atlas']);

    await page.evaluate(() => document.getElementById('gestures-a').shadowRoot.querySelector('.yk-chart').focus());
    await page.keyboard.press('ArrowRight');
    const keyboardA = await inspectChart(page, 'gestures-a');
    assert.notEqual(keyboardA.inspectedIndex, 0);
    await page.keyboard.press('ArrowDown');
    assert.equal((await inspectChart(page, 'gestures-a')).inspectedSeries, 1);

    await page.keyboard.press('Space');
    assert.ok((await inspectChart(page, 'gestures-a')).selectionKeys.includes(keyboardA.inspectedKey), 'Space toggles a selection');
    await page.keyboard.press('x');
    assert.ok((await inspectChart(page, 'gestures-a')).selection.exclude.includes(keyboardA.inspectedKey), 'x toggles an exclusion');
    await page.keyboard.press('o');
    assert.equal(await lastEvent(), 'open');
    const beforeFilter = await inspectChart(page, 'gestures-a');
    await page.keyboard.press('f');
    const filtered = await inspectChart(page, 'gestures-a');
    assert.ok(filtered.window.to - filtered.window.from < beforeFilter.window.to - beforeFilter.window.from, 'f filters to the inspected mark');
    await page.keyboard.press('c');
    await page.keyboard.press('a');
    assert.equal(await lastEvent(), 'cohort');
    await page.keyboard.press(']');
    assert.ok((await inspectChart(page, 'gestures-a')).brush, '] creates a brush edge');
    await page.keyboard.press('[');
    await page.keyboard.press('Escape');
    assert.equal((await inspectChart(page, 'gestures-a')).selection, null, 'Esc clears the selection first');
    await page.keyboard.press('Escape');
    assert.equal((await inspectChart(page, 'gestures-a')).brush, null, 'Esc then clears the brush');
    const beforePlus = await inspectChart(page, 'gestures-a');
    await page.keyboard.press('+');
    const plus = await inspectChart(page, 'gestures-a');
    assert.ok(plus.window.to - plus.window.from < beforePlus.window.to - beforePlus.window.from, '+ zooms in');
    await page.keyboard.press('-');
    assert.ok((await inspectChart(page, 'gestures-a')).window.to - (await inspectChart(page, 'gestures-a')).window.from > plus.window.to - plus.window.from, '- zooms out');

    const touchId = 'gestures-b';
    await page.locator(`yk-chart#${touchId} .u-over`).scrollIntoViewIfNeeded();
    const client = await page.context().newCDPSession(page);
    const tapPoint = at(await geometry(touchId, 12));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapPoint.x, y: tapPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tapped = await inspectChart(page, touchId);
    assert.equal(tapped.inspectedIndex, 12);
    assert.equal(tapped.inspectedKey, rows[12].key);

    await page.locator(`yk-chart#${touchId} [data-gesture="select-mode"]`).click();
    assert.equal((await inspectChart(page, touchId)).selectMode, true);
    const touchStart = at(await geometry(touchId, 4));
    const touchEnd = at(await geometry(touchId, 14));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x, y: touchStart.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchEnd.x, y: touchEnd.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok((await inspectChart(page, touchId)).brush, 'Select mode turns a touch drag into a brush');

    const spanBeforePinch = (await inspectChart(page, touchId)).window;
    const pinchStart = at(await geometry(touchId, 18));
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: pinchStart.x - 30, y: pinchStart.y }, { x: pinchStart.x + 30, y: pinchStart.y }]
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: pinchStart.x - 80, y: pinchStart.y }, { x: pinchStart.x + 80, y: pinchStart.y }]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const pinched = await inspectChart(page, touchId);
    assert.notEqual(pinched.window.to - pinched.window.from, spanBeforePinch.to - spanBeforePinch.from, 'pinch zooms a time axis');

    const targets = await page.evaluate(() => {
      const root = document.getElementById('gestures-a').shadowRoot;
      return [...root.querySelectorAll('.yk-gesture-button, .yk-legend button, input.yk-table-select')].map(node => {
        const rect = node.getBoundingClientRect();
        return { name: node.dataset.action || node.dataset.gesture || node.className, width: rect.width, height: rect.height };
      });
    });
    assert.ok(targets.length > 0);
    assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets.filter(target => target.width < 44 || target.height < 44)));

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('scatter gallery proves the 5,000-point reference, the declared canvas fallback and the ECDF table', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ viewport: { width: 1280, height: 3200 } });
  try {
    await page.goto(`${harness.origin}/gallery/scatter.html`);
    await waitForSettled(page);

    const scatter = await inspectChart(page, 'scatter', { sampledMarkCount: true, region: true });
    assert.equal(scatter.state, 'ready');
    assert.equal(scatter.type, 'scatter');
    assert.equal(scatter.marks.length, SCATTER_BUDGET, 'the point budget is exercised');
    assert.equal(scatter.sampledMarkCount, 1000);
    assert.ok(scatter.plot.width > 0 && scatter.plot.height > 0);

    const shell = await page.evaluate(() => {
      const root = document.getElementById('scatter').shadowRoot;
      return {
        canvases: root.querySelectorAll('.yk-scatter-canvas').length,
        uplot: Boolean(root.querySelector('.uplot')),
        markNodes: root.querySelectorAll('[data-mark]').length
      };
    });
    assert.equal(shell.canvases, 2, 'the declared first-party canvas fallback renders the marks');
    assert.equal(shell.uplot, false, 'scatter does not use a uPlot plot area');
    assert.equal(shell.markNodes, 0, 'no per-point DOM');

    await page.locator('yk-chart#scatter .yk-scatter-overlay').scrollIntoViewIfNeeded();
    const live = await inspectChart(page, 'scatter', { sampledMarkCount: true });
    const target = live.marks.reduce((best, mark) => {
      const nearestOther = live.marks.reduce((distance, other) => (
        other === mark ? distance : Math.min(distance, Math.hypot(other.px - mark.px, other.py - mark.py))
      ), Infinity);
      return nearestOther > best.spacing ? { mark, spacing: nearestOther } : best;
    }, { mark: live.marks[0], spacing: -1 }).mark;
    const expectedNearest = referenceNearest(live.marks, target.px, target.py);
    await page.mouse.move(live.plot.left + target.px, live.plot.top + target.py);
    const hovered = await inspectChart(page, 'scatter');
    assert.equal(hovered.inspectedKey, expectedNearest, '2-D nearest matches the independent scan');
    assert.equal(hovered.cursor.idx, live.marks.find(mark => mark.key === expectedNearest).index);

    const drag = async (bounds, modifiers = []) => {
      const chart = await inspectChart(page, 'scatter');
      for (const key of modifiers) await page.keyboard.down(key);
      await page.mouse.move(chart.plot.left + bounds.left, chart.plot.top + bounds.top);
      await page.mouse.down();
      await page.mouse.move(chart.plot.left + bounds.right, chart.plot.top + bounds.bottom, { steps: 8 });
      await page.mouse.up();
      for (const key of modifiers) await page.keyboard.up(key);
      return inspectChart(page, 'scatter', { region: true });
    };

    const firstBounds = { left: 60, right: 300, top: 40, bottom: 180 };
    const firstKeys = referenceInRect(live.marks, firstBounds);
    assert.ok(firstKeys.length > 5, `expected several points in the region, got ${firstKeys.length}`);
    const first = await drag(firstBounds);
    assert.deepEqual(first.selectionKeys, firstKeys, 'rectangle membership matches the independent reference');
    assert.ok(first.selection.where, 'the predicate carries the data-space rectangle');

    const secondBounds = { left: 330, right: 520, top: 60, bottom: 200 };
    const secondKeys = referenceInRect(live.marks, secondBounds);
    const added = await drag(secondBounds, ['Shift']);
    assert.deepEqual(added.selectionKeys, [...new Set([...firstKeys, ...secondKeys])].sort(), 'Shift-drag unions the rectangles');

    const markAt = mark => ({ x: live.plot.left + mark.px, y: live.plot.top + mark.py });
    const clickMark = async (mark, modifiers) => {
      const point = markAt(mark);
      for (const key of modifiers) await page.keyboard.down(key);
      await page.mouse.click(point.x, point.y);
      for (const key of modifiers) await page.keyboard.up(key);
      return inspectChart(page, 'scatter');
    };
    const clickTargets = live.marks.map(mark => ({
      mark,
      key: referenceNearest(live.marks, mark.px, mark.py),
      spacing: Math.min(...live.marks.filter(other => other !== mark).map(other => Math.hypot(other.px - mark.px, other.py - mark.py)))
    })).filter(item => !added.selectionKeys.includes(item.key))
      .sort((a, b) => b.spacing - a.spacing)
      .filter((item, index, all) => all.findIndex(other => other.key === item.key) === index)
      .slice(0, 3);
    const shiftSelected = await clickMark(clickTargets[0].mark, ['Shift']);
    assert.ok(shiftSelected.selection?.include.includes(clickTargets[0].key), 'Shift-click adds a mark to selection');
    const ctrlSelected = await clickMark(clickTargets[1].mark, ['Control']);
    assert.ok(ctrlSelected.selection.include.includes(clickTargets[1].key), 'Ctrl-click adds a mark to selection');
    const metaSelected = await clickMark(clickTargets[2].mark, ['Meta']);
    assert.ok(metaSelected.selection.include.includes(clickTargets[2].key), 'Cmd-click adds a mark to selection');
    const altExcluded = await clickMark(clickTargets[0].mark, ['Alt']);
    assert.ok(altExcluded.selection.exclude.includes(clickTargets[0].key), 'Alt-click toggles a mark as an exclusion');

    const keyboardTarget = live.marks.find(mark => !altExcluded.selectionKeys.includes(mark.key)
      && referenceNearest(live.marks, mark.px, mark.py) === mark.key);
    const keyboardPoint = markAt(keyboardTarget);
    await page.mouse.move(keyboardPoint.x, keyboardPoint.y);
    await page.locator('yk-chart#scatter .yk-scatter-overlay').focus();
    await page.keyboard.press('Space');
    let keyboardSelection = await inspectChart(page, 'scatter');
    assert.ok(keyboardSelection.selection.include.includes(keyboardTarget.key), 'Space toggles the focused mark into selection');
    await page.keyboard.press('x');
    keyboardSelection = await inspectChart(page, 'scatter');
    assert.ok(keyboardSelection.selection.exclude.includes(keyboardTarget.key), 'x toggles the focused mark as an exclusion');

    const ecdf = await page.evaluate(() => {
      const element = document.getElementById('ecdf');
      const result = element.inspect();
      const root = element.shadowRoot;
      return {
        state: element.dataset.state,
        type: result.type,
        uplot: Boolean(root.querySelector('.uplot')),
        marks: result.marks,
        table: [...root.querySelectorAll('.yk-table tbody tr')].map(row => ({
          x: row.querySelector('.yk-table-x')?.textContent,
          values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
        }))
      };
    });
    assert.equal(ecdf.state, 'ready');
    assert.equal(ecdf.type, 'ecdf');
    assert.equal(ecdf.uplot, true, 'the ECDF step line still uses uPlot');
    assert.equal(ecdf.table.length, ecdf.marks.length);
    for (let index = 0; index < ecdf.marks.length; index += 1) {
      const mark = ecdf.marks[index];
      const row = ecdf.table[index];
      assert.equal(row.x, String(mark.x));
      assert.deepEqual(row.values, [
        formatValue(mark.values['cohort:alpha'], { kind: 'percent' }),
        formatValue(mark.values['cohort:beta'], { kind: 'percent' })
      ], `ECDF row ${index} equals the plotted value`);
    }
    assert.deepEqual(ecdf.table.at(-1).values, ['100%', '100%']);

    const sampleChart = await inspectChart(page, 'scatter-sampled', { sampledMarkCount: true });
    assert.equal(sampleChart.state, 'ready');
    assert.equal(sampleChart.marks.length, sampleChart.sampledMarkCount, 'the sampled chart only holds sampled marks');
    const sampleText = await page.evaluate(() => document.getElementById('scatter-sampled').shadowRoot.textContent);
    assert.match(sampleText, /sample of 1,000 of 5,000/);

    const motion = await page.evaluate(() => getComputedStyle(document.getElementById('scatter').shadowRoot.querySelector('.yk-scatter-stack')).animationName);
    assert.equal(motion, 'none');

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('scatter touch Select mode turns a tap into selection while ordinary touch remains inspection', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ hasTouch: true, viewport: { width: 1280, height: 3200 } });
  try {
    await page.goto(`${harness.origin}/gallery/scatter.html`);
    await waitForSettled(page);
    const chart = await inspectChart(page, 'scatter');
    const mark = chart.marks[0];
    const x = chart.plot.left + mark.px;
    const y = chart.plot.top + mark.py;
    await page.touchscreen.tap(x, y);
    assert.equal((await inspectChart(page, 'scatter')).selectionKeys?.length || 0, 0, 'touch tap inspects without selecting by default');
    await page.locator('yk-chart#scatter [data-gesture="select-mode"]').click();
    assert.equal((await inspectChart(page, 'scatter')).selectMode, true, 'the Select control enters selection mode');
    await page.touchscreen.tap(x, y);
    const selected = await inspectChart(page, 'scatter');
    assert.ok(selected.selection.include.includes(mark.key), 'touch tap selects a mark in Select mode');
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});

test('below 900 px the chart frames stack in one column and interactive targets stay at least 44 px', async t => {
  if (!needsBrowser(t)) return;
  const { context, page, diagnostics } = await openPage({ viewport: { width: 800, height: 1600 } });
  try {
    await page.goto(`${harness.origin}/gallery/gestures.html`);
    await waitForSettled(page);

    const columns = await page.evaluate(() => getComputedStyle(document.getElementById('linked-host')).gridTemplateColumns);
    assert.doesNotMatch(columns, /\s/, `one column expected, got ${columns}`);
    const boxes = await page.locator('#linked-host yk-chart').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
    }));
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].left, boxes[1].left, 'stacked frames share a left edge');
    assert.ok(boxes[1].top >= boxes[0].bottom - 1, 'the second frame sits below the first');

    const targets = await page.evaluate(() => {
      const root = document.getElementById('gestures-a').shadowRoot;
      return [...root.querySelectorAll('.yk-gesture-button, .yk-legend button, input.yk-table-select')].map(node => {
        const rect = node.getBoundingClientRect();
        return { name: node.dataset.action || node.dataset.gesture || node.className, width: rect.width, height: rect.height };
      });
    });
    assert.ok(targets.length > 0);
    assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets.filter(target => target.width < 44 || target.height < 44)));

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    await context.close();
  }
});
