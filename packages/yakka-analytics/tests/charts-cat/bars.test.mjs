import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOther, buildBarsModel, horizontalStackRects, lollipopModel, percentRows, slopePairs, sortRanked, stackSegments
} from '../../web/js/charts/yk-bars.js';
import { FIXED_NEUTRALS } from '../../web/js/charts/colour-registry.js';
import { formatValue } from '../../web/js/charts/formatters.js';
import {
  FIXED_NEUTRAL_KEYS, MEASURES, SLOPE_SERIES, rankedRows, rankedTop, slopeRows, stackedRows
} from '../gallery/fixture-bars.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

const ROWS = [
  { key: 'a', values: { measure: 3, other: 1 } },
  { key: 'b', values: { measure: 9, other: 2 } },
  { key: 'c', values: { measure: null, other: 4 } },
  { key: 'd', values: { measure: 6, other: 0 } }
];

test('ranked sort is descending by the measure with stable key ties', () => {
  assert.deepEqual(sortRanked(ROWS, 'measure').map(row => row.key), ['b', 'd', 'a', 'c']);
  const tied = [{ key: 'z', values: { m: 1 } }, { key: 'a', values: { m: 1 } }];
  assert.deepEqual(sortRanked(tied, 'm').map(row => row.key), ['a', 'z']);
});

test('the tail beyond top becomes one labelled (other) bucket summed per series', () => {
  const ranked = sortRanked(ROWS, 'measure');
  const result = applyOther(ranked, 2, ['measure', 'other']);
  assert.deepEqual(result.rows.map(row => row.key), ['b', 'd', '(other)']);
  assert.deepEqual(result.rows[2].values, { measure: 3, other: 5 });
  assert.equal(result.other.label, '(other)');
});

test('stacking keeps cumulative offsets in series order and never invents a zero', () => {
  const series = [{ key: 'x' }, { key: 'y' }];
  const [row] = stackSegments([{ key: 'a', values: { x: 2, y: null } }], series);
  assert.equal(row.total, 2);
  assert.deepEqual(row.segments, [{ key: 'x', from: 0, to: 2, value: 2 }]);
  const [both] = stackSegments([{ key: 'b', values: { x: 2, y: 3 } }], series);
  assert.deepEqual(both.segments.map(segment => [segment.from, segment.to]), [[0, 2], [2, 5]]);
});

test('100 percent normalises each category to one and leaves a missing value missing', () => {
  const series = [{ key: 'x' }, { key: 'y' }];
  const [row] = percentRows([{ key: 'a', values: { x: 1, y: 3 } }], series);
  assert.equal(row.values.x, 0.25);
  assert.equal(row.values.y, 0.75);
  assert.equal(row.values.x + row.values.y, 1);
  const [missing] = percentRows([{ key: 'b', values: { x: null, y: 4 } }], series);
  assert.equal(missing.values.x, null);
  assert.equal(missing.values.y, 1);
});

test('lollipop stems start at zero and end at the measure', () => {
  const [row] = lollipopModel([{ key: 'a', values: { m: 7 } }], 'm');
  assert.equal(row.base, 0);
  assert.equal(row.tip, 7);
  const [empty] = lollipopModel([{ key: 'b', values: { m: null } }], 'm');
  assert.equal(empty.tip, null);
});

test('slope pairs one start and one end per entity, ordered by change', () => {
  const pairs = slopePairs([
    { key: 'a', values: { before: 5, after: 8 } },
    { key: 'b', values: { before: 9, after: 4 } },
    { key: 'c', values: { before: 2, after: 6 } }
  ], [{ key: 'before' }, { key: 'after' }]);
  assert.deepEqual(pairs.map(pair => pair.key), ['c', 'a', 'b']);
  assert.deepEqual([pairs[0].start, pairs[0].end, pairs[0].change], [2, 6, 4]);
});

test('the bars model applies top and (other) and marks percent shares', () => {
  const ranked = buildBarsModel({ spec: { type: 'ranked', series: [MEASURES[0]], top: 5 }, data: rankedRows() });
  assert.equal(ranked.rows.at(-1).key, '(other)');
  assert.equal(ranked.rows.at(-1).values.sessions, 174);
  const percent = buildBarsModel({ spec: { type: 'percent', series: MEASURES }, data: stackedRows() });
  for (const row of percent.rows) {
    const sum = MEASURES.reduce((total, item) => total + row.values[item.key], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
  assert.ok(percent.series.every(item => item.kind === 'percent'));
});

test('horizontal stacked bars run segments left to right with categories on Y', () => {
  const model = buildBarsModel({ spec: { type: 'stacked', orientation: 'horizontal', series: MEASURES }, data: stackedRows() });
  assert.equal(model.orientation, 'horizontal');
  assert.equal(model.spec.orientation, 'horizontal');
  assert.deepEqual(model.series.map(series => series.key), MEASURES.map(series => series.key));
  assert.deepEqual(model.tableRows.map(row => row.key), model.rows.map(row => row.key));

  const rows = stackedRows().slice(0, 2);
  const rects = horizontalStackRects(rows, MEASURES, { width: 400, height: 200 });
  assert.equal(rects.length, 2);
  const first = rects[0];
  assert.ok(first.y < rects[1].y, 'categories run top to bottom');
  for (let index = 0; index < first.segments.length; index += 1) {
    const segment = first.segments[index];
    assert.ok(segment.width > 0, 'each present segment has width');
    if (index > 0) {
      const previous = first.segments[index - 1];
      assert.ok(Math.abs(previous.x + previous.width - segment.x) < 1e-9, 'segments touch without gaps');
    }
  }
  const last = first.segments.at(-1);
  assert.ok(last.x + last.width <= 400 + 1e-9, 'segments stay inside the plot');
  assert.ok(Math.abs(last.x + last.width - first.totalPx) < 1e-9, 'the last segment ends at the row total');
  assert.equal(first.segments.length, MEASURES.length, 'a null-free row has one segment per series');
});

test('the bars gallery proves every mode, table, interaction and both themes in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2600 }, hasTouch: true });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/bars.html`);
    await waitForSettled(page);

    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        chart: result.chart,
        hostChart: element.dataset.chart,
        state: element.dataset.state,
        type: result.type,
        window: result.window,
        brush: result.brush,
        selection: result.selection,
        selectionKeys: result.selectionKeys,
        series: result.series,
        plot: result.plot,
        xScale: result.xScale,
        yScale: result.yScale,
        cursor: result.cursor,
        highlight: result.highlight,
        inspectedKey: result.inspectedKey,
        inspectedIndex: result.inspectedIndex,
        categories: result.categories,
        marks: result.marks
      };
    }, id);
    const tableRows = id => page.evaluate(chartId => {
      const root = document.getElementById(chartId).shadowRoot;
      return [...root.querySelectorAll('.yk-table tbody tr')].map(row => ({
        key: row.dataset.entityKey,
        x: row.querySelector('.yk-table-x')?.textContent,
        values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
      }));
    }, id);
    const markPoint = (id, key) => page.evaluate(([chartId, entityKey]) => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      const index = entityKey ? result.marks.findIndex(mark => mark.key === entityKey) : 0;
      const mark = result.marks[index];
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      const hit = group.querySelector('[data-hit]');
      const rect = hit.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        key: mark.key,
        px: mark.px,
        py: mark.py,
        width: rect.width,
        height: rect.height
      };
    }, [id, key]);
    const settle = id => page.evaluate(chartId => document.getElementById(chartId).whenSettled(), id);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      text: document.getElementById('event-log').textContent
    }));

    assert.equal((await inspect('bars-ranked')).state, 'ready');
    assert.equal((await inspect('bars-ranked-empty')).state, 'empty');
    assert.equal((await inspect('bars-ranked-unsupported')).state, 'unsupported');

    const rankedModel = buildBarsModel({ spec: { type: 'ranked', series: [MEASURES[0]], top: rankedTop() }, data: rankedRows() });
    const ranked = await inspect('bars-ranked');
    assert.equal(ranked.hostChart, 'bars');
    assert.equal(ranked.type, 'ranked');
    assert.equal(ranked.brush, null);
    assert.equal(ranked.window, null);
    assert.deepEqual(ranked.categories, rankedModel.rows.map(row => row.key));
    assert.equal(ranked.categories.at(-1), '(other)');
    assert.ok(ranked.marks.every(mark => mark.style.cssVar && mark.style.shape));
    const rankedRowsUi = await tableRows('bars-ranked');
    assert.deepEqual(rankedRowsUi.map(row => row.key), rankedModel.rows.map(row => row.key));
    assert.equal(rankedRowsUi.at(-1).values[0], formatValue(174, { kind: 'count' }));
    assert.ok(rankedRowsUi.map(row => row.key).includes('(other)'));

    const stackedModel = buildBarsModel({ spec: { type: 'stacked', series: MEASURES }, data: stackedRows() });
    const stacked = await inspect('bars-stacked');
    assert.equal(stacked.type, 'stacked');
    assert.equal(stacked.yScale.min, 0, 'stacked bars are zero-based');
    assert.equal(stacked.marks.length, stackedRows().length);
    const stackedUi = await tableRows('bars-stacked');
    assert.deepEqual(stackedUi.map(row => row.key), stackedRows().map(row => row.key));
    for (const [rowIndex, row] of stackedRows().entries()) {
      assert.deepEqual(stackedUi[rowIndex].values, MEASURES.map(item => formatValue(row.values[item.key], { kind: item.kind })));
    }

    const percentModel = buildBarsModel({ spec: { type: 'percent', series: MEASURES }, data: stackedRows() });
    const percent = await inspect('bars-percent');
    assert.equal(percent.type, 'percent');
    assert.equal(percent.yScale.min, 0);
    assert.ok(percent.marks.every((mark, index) => {
      const sum = MEASURES.reduce((total, item) => total + percentModel.rows[index].values[item.key], 0);
      return Math.abs(sum - 1) < 1e-9;
    }));
    const percentUi = await tableRows('bars-percent');
    assert.equal(percentUi[0].values[0], formatValue(percentModel.rows[0].values.sessions, { kind: 'percent' }));
    assert.match(percentUi[0].values[0], /%$/);

    const lollipop = await inspect('bars-lollipop');
    assert.equal(lollipop.type, 'lollipop');
    const lollipopGeometry = await page.evaluate(() => {
      const element = document.getElementById('bars-lollipop');
      const result = element.inspect();
      const mark = result.marks[0];
      return { px: mark.px, tip: result.xToPx(mark.y), zero: result.xToPx(0) };
    });
    assert.ok(lollipopGeometry.px > lollipopGeometry.zero);
    assert.ok(Math.abs(lollipopGeometry.px - lollipopGeometry.tip) < 0.01);

    const slope = await inspect('bars-slope');
    assert.equal(slope.type, 'slope');
    const slopePairsUi = await page.evaluate(() => {
      const result = document.getElementById('bars-slope').inspect();
      const grouped = new Map();
      for (const mark of result.marks) {
        if (!grouped.has(mark.key)) grouped.set(mark.key, []);
        grouped.get(mark.key).push(mark);
      }
      return [...grouped.entries()].map(([key, marks]) => ({
        key,
        xs: marks.map(mark => mark.x),
        values: marks.map(mark => mark.y)
      }));
    });
    assert.equal(slopePairsUi.length, slopeRows().length);
    for (const pair of slopePairsUi) {
      assert.deepEqual(pair.xs, [0, 1]);
      const row = slopeRows().find(item => item.key === pair.key);
      assert.deepEqual(pair.values, [row.values.before, row.values.after]);
    }
    const slopeUi = await tableRows('bars-slope');
    assert.deepEqual(slopeUi[0].values, SLOPE_SERIES.map(item => formatValue(slopeRows()[0].values[item.key], { kind: item.kind })));

    // Fixed neutrals stay six distinct styles and never merge into (other).
    const neutralStyles = await page.evaluate(keys => {
      const result = document.getElementById('bars-stacked').inspect();
      return keys.map(key => {
        const mark = result.marks.find(item => item.key === key);
        const index = result.marks.indexOf(mark);
        const group = document.getElementById('bars-stacked').shadowRoot.querySelector(`[data-mark="${index}"]`);
        return { key, style: mark.style, label: group?.getAttribute('aria-label') };
      });
    }, FIXED_NEUTRAL_KEYS);
    const combinations = new Set(neutralStyles.map(item => `${item.style.cssVar}|${item.style.shape}|${item.style.pattern}|${item.label}`));
    assert.equal(combinations.size, FIXED_NEUTRAL_KEYS.length);
    for (const item of neutralStyles) {
      assert.equal(item.style.cssVar, FIXED_NEUTRALS[item.key].cssVar);
      if (item.key !== '(other)') assert.notEqual(item.style.cssVar, '--yk-neutral-other');
    }

    // Hover and focus highlight the same key and carry it in the tooltip.
    await page.evaluate(() => document.getElementById('bars-ranked').scrollIntoView({ block: 'center' }));
    const firstKey = rankedModel.rows[0].key;
    const point = await markPoint('bars-ranked', firstKey);
    await page.mouse.move(point.x, point.y);
    const hovered = await inspect('bars-ranked');
    assert.equal(hovered.cursor.key, firstKey);
    assert.equal(hovered.highlight, firstKey);
    const tooltip = await page.locator('yk-bars#bars-ranked .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(tooltip.key, firstKey);
    assert.match(tooltip.text, /Sessions/);

    await page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('[data-mark="0"]').focus(), 'bars-ranked');
    const focused = await inspect('bars-ranked');
    assert.equal(focused.highlight, firstKey);
    assert.equal(focused.inspectedKey, firstKey);

    // Click and Enter inspect; Space and modifier clicks toggle include/exclude.
    await page.mouse.click(point.x, point.y);
    let event = await lastEvent();
    assert.equal(event.name, 'inspect');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).key, firstKey);

    await focusRoot('bars-ranked');
    await page.keyboard.press('Enter');
    event = await lastEvent();
    assert.equal(event.name, 'inspect');

    await page.keyboard.press(' ');
    let selection = await inspect('bars-ranked');
    assert.deepEqual(selection.selection.include, [firstKey]);
    await page.keyboard.press(' ');
    selection = await inspect('bars-ranked');
    assert.deepEqual(selection.selection, null);

    const secondKey = rankedModel.rows[1].key;
    const secondPoint = await markPoint('bars-ranked', secondKey);
    await page.keyboard.down('Shift');
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up('Shift');
    selection = await inspect('bars-ranked');
    assert.deepEqual(selection.selection.include, [secondKey]);

    await page.mouse.click(point.x, point.y);
    await focusRoot('bars-ranked');
    await page.keyboard.press('x');
    selection = await inspect('bars-ranked');
    assert.deepEqual(selection.selection.exclude, [firstKey]);

    const thirdKey = rankedModel.rows[2].key;
    const thirdPoint = await markPoint('bars-ranked', thirdKey);
    await page.keyboard.down('Alt');
    await page.mouse.click(thirdPoint.x, thirdPoint.y);
    await page.keyboard.up('Alt');
    selection = await inspect('bars-ranked');
    assert.ok(selection.selection.exclude.includes(thirdKey));

    // The row checkbox toggles the same include predicate.
    await page.locator('yk-bars#bars-ranked .yk-table-select').nth(0).check();
    selection = await inspect('bars-ranked');
    assert.ok(selection.selection.include.includes(firstKey));

    // Legend toggle hides a series with no request and never repaints survivors.
    await page.evaluate(() => document.getElementById('bars-stacked').scrollIntoView({ block: 'center' }));
    const analyticsBefore = harness.stats.analytics;
    const survivor = index => page.evaluate(index => {
      const result = document.getElementById('bars-stacked').inspect();
      const mark = result.marks[index];
      return { key: mark.key, style: mark.style };
    }, index);
    const beforeToggle = await survivor(0);
    await page.locator('yk-bars#bars-stacked .yk-legend-item[data-key="calls"] .yk-legend-toggle').click();
    await settle('bars-stacked');
    const afterToggle = await inspect('bars-stacked');
    assert.equal(afterToggle.series.find(item => item.key === 'calls').visible, false);
    assert.deepEqual((await survivor(0)).style, beforeToggle.style);
    assert.equal(harness.stats.analytics, analyticsBefore, 'a legend toggle does not request');

    // o, f, c then a-d and Esc emit the contract intents.
    await page.evaluate(() => document.getElementById('bars-ranked').scrollIntoView({ block: 'center' }));
    await page.mouse.click(point.x, point.y);
    await focusRoot('bars-ranked');
    await page.keyboard.press('o');
    event = await lastEvent();
    assert.equal(event.name, 'open');
    await page.keyboard.press('f');
    event = await lastEvent();
    assert.equal(event.name, 'filter');
    await page.keyboard.press('c');
    await page.keyboard.press('a');
    event = await lastEvent();
    assert.equal(event.name, 'cohort');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).slot, 'a');
    await page.keyboard.press(' ');
    await page.keyboard.press('Escape');
    selection = await inspect('bars-ranked');
    assert.equal(selection.selection, null);

    // A real touch tap inspects a mark at a target of at least 44 px.
    const touchPoint = await markPoint('bars-ranked', rankedModel.rows[3].key);
    assert.ok(touchPoint.width >= 44 && touchPoint.height >= 44);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tapped = await inspect('bars-ranked');
    assert.equal(tapped.inspectedKey, rankedModel.rows[3].key);

    // Both themes keep the entity slot and pattern; only the token value changes.
    const light = await page.evaluate(() => {
      const element = document.getElementById('bars-stacked');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-mark-shape')?.getAttribute('fill') };
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => {
      const element = document.getElementById('bars-stacked');
      return element?.dataset.theme === 'dark' && element.dataset.state === 'ready';
    });
    const dark = await page.evaluate(() => {
      const element = document.getElementById('bars-stacked');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-mark-shape')?.getAttribute('fill') };
    });
    assert.deepEqual(dark.style, light.style);
    assert.notEqual(dark.fill, light.fill);

    const motion = await page.evaluate(() => {
      const root = document.getElementById('bars-stacked').shadowRoot;
      const plot = getComputedStyle(root.querySelector('.yk-svg-plot'));
      const mark = getComputedStyle(root.querySelector('.yk-mark-shape'));
      return { plotAnimation: plot.animationName, plotTransition: plot.transitionDuration, markAnimation: mark.animationName };
    });
    assert.equal(motion.plotAnimation, 'none');
    assert.equal(motion.plotTransition, '0s');
    assert.equal(motion.markAnimation, 'none');

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
