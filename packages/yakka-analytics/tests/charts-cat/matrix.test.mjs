import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY, buildMatrixModel, calendarLayout, dayStart, moveBrushEdge, rampIndex, rampStopValues, rampStops, snapBrush, weekStart, weekdayIndex
} from '../../web/js/charts/yk-matrix.js';
import { formatValue } from '../../web/js/charts/formatters.js';
import {
  CAL_START, MEASURE, calendarRows, calendarSpec, heatmapRows, heatmapSpec
} from '../gallery/fixture-matrix.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

const RANGE = { min: 0, max: 22 };

test('heatmap cells map to their declared row, column and value', () => {
  const model = buildMatrixModel({ spec: heatmapSpec(), data: heatmapRows() });
  assert.equal(model.state, 'ready');
  assert.equal(model.type, 'heatmap');
  assert.equal(model.rows.length, 20);
  assert.deepEqual(
    [model.rows[0].rowIndex, model.rows[0].columnIndex, model.rows[0].rowKey, model.rows[0].columnKey, model.rows[0].value],
    [0, 0, 'Atlas', 'Mon', 12]
  );
  assert.deepEqual(
    [model.rows.at(-1).rowIndex, model.rows.at(-1).columnIndex, model.rows.at(-1).value],
    [3, 4, 2]
  );
  assert.deepEqual(model.rows.slice(0, 5).map(row => row.key), Array(5).fill('model:atlas'));
  assert.deepEqual(model.range, { min: 0, max: 22 });
  assert.deepEqual(model.tableRows[0], { key: 'model:atlas', x: 'Atlas', values: { column: 'Mon', value: 12 }, n: 12, coverage: undefined });
});

test('ramp stop selection reads the sequential and diverging token orders', () => {
  assert.deepEqual(rampStops('sequential'), ['--yk-seq-1', '--yk-seq-2', '--yk-seq-3', '--yk-seq-4', '--yk-seq-5']);
  assert.deepEqual(rampStops('diverging'), ['--yk-div-neg-2', '--yk-div-neg-1', '--yk-div-zero', '--yk-div-pos-1', '--yk-div-pos-2']);
  assert.deepEqual(rampStopValues(RANGE), [0, 5.5, 11, 16.5, 22]);
  assert.equal(rampIndex(0, RANGE), 0);
  assert.equal(rampIndex(11, RANGE), 2);
  assert.equal(rampIndex(22, RANGE), 4);
  assert.equal(rampIndex(null, RANGE), null);
  assert.deepEqual(rampStopValues({ min: -4, max: 4 }), [-4, -2, 0, 2, 4]);
  assert.equal(rampIndex(-4, { min: -4, max: 4 }), 0);
  assert.equal(rampIndex(0, { min: -4, max: 4 }), 2);
  assert.equal(rampIndex(4, { min: -4, max: 4 }), 4);
});

test('calendar days map to their week, weekday and week start', () => {
  const rows = calendarRows();
  const laid = calendarLayout(rows);
  assert.equal(laid.length, 21);
  assert.equal(laid[0].weekStart, CAL_START);
  assert.deepEqual([laid[0].weekIndex, laid[0].weekday], [0, 0]);
  assert.deepEqual([laid[1].weekIndex, laid[1].weekday], [0, 1]);
  assert.deepEqual([laid[7].weekIndex, laid[7].weekday], [1, 0]);
  assert.deepEqual([laid[20].weekIndex, laid[20].weekday], [2, 6]);
  assert.equal(weekStart(CAL_START + 7 * DAY), CAL_START + 7 * DAY);
  assert.equal(weekdayIndex(CAL_START), 0);
  assert.equal(dayStart(CAL_START + 5 * DAY + 12345), CAL_START + 5 * DAY);
  const model = buildMatrixModel({ spec: calendarSpec(), data: rows });
  assert.equal(model.type, 'calendar');
  assert.deepEqual(model.window, { from: CAL_START, to: CAL_START + 21 * DAY });
  assert.equal(model.rows[0].x, CAL_START);
  assert.equal(model.rows[0].columnKey, 'Mon');
  assert.equal(model.tableRows[0].x, '2021-01-04');
});

test('a brushed pixel range snaps to whole days and an edge moves by one day', () => {
  const from = CAL_START + 2 * DAY + 5 * 60 * 60 * 1000;
  const to = CAL_START + 5 * DAY + 60 * 1000;
  assert.deepEqual(snapBrush(to, from), { from: CAL_START + 2 * DAY, to: CAL_START + 6 * DAY });
  assert.equal(snapBrush(null, from), null);
  const brush = { from: CAL_START, to: CAL_START + 2 * DAY };
  assert.deepEqual(moveBrushEdge(brush, 'from', -1, { min: CAL_START - DAY }), { from: CAL_START - DAY, to: CAL_START + 2 * DAY });
  assert.deepEqual(moveBrushEdge(brush, 'to', 1, { max: CAL_START + 3 * DAY }), { from: CAL_START, to: CAL_START + 3 * DAY });
  assert.deepEqual(moveBrushEdge(brush, 'from', 5), { from: CAL_START + DAY, to: CAL_START + 2 * DAY });
});

test('the matrix gallery proves heatmap, calendar, ramp legend, interaction and both themes in Chromium', async t => {
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
    await page.goto(`${harness.origin}/gallery/matrix.html`);
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
    const pointAt = (id, index) => page.evaluate(([chartId, markIndex]) => {
      const element = document.getElementById(chartId);
      const mark = element.inspect().marks[markIndex];
      const group = element.shadowRoot.querySelector(`[data-mark="${markIndex}"]`);
      const hit = group.querySelector('[data-hit]');
      const rect = hit.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, key: mark.key, px: mark.px, py: mark.py };
    }, [id, index]);
    const settle = id => page.evaluate(chartId => document.getElementById(chartId).whenSettled(), id);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      chart: document.getElementById('event-log').dataset.lastChart,
      text: document.getElementById('event-log').textContent
    }));
    const brushCount = id => page.evaluate(chartId => window.__matrix.brushCounts[chartId] || 0, id);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 });
      await page.mouse.up();
    };

    assert.equal((await inspect('matrix-heatmap')).state, 'ready');
    assert.equal((await inspect('matrix-calendar')).state, 'ready');
    assert.equal((await inspect('matrix-empty')).state, 'empty');
    assert.equal((await inspect('matrix-unsupported')).state, 'unsupported');

    // Heatmap: row/column cells, values, table and a labelled ramp legend.
    const heat = await inspect('matrix-heatmap');
    const heatModel = buildMatrixModel({ spec: heatmapSpec(), data: heatmapRows() });
    assert.equal(heat.hostChart, 'matrix');
    assert.equal(heat.type, 'heatmap');
    assert.equal(heat.brush, null);
    assert.equal(heat.window, null);
    assert.deepEqual(heat.categories, heatmapRows().map(row => row.key));
    assert.equal(heat.marks.length, 20);
    assert.deepEqual(heat.marks[0].values, { sessions: 12 });
    assert.ok(heat.marks.every(mark => mark.style.cssVar && mark.style.shape));
    const heatTable = await tableRows('matrix-heatmap');
    assert.deepEqual(heatTable.map(row => row.key), heatmapRows().map(row => row.key));
    assert.equal(heatTable[0].x, 'Atlas');
    assert.deepEqual(heatTable[0].values, ['Mon', formatValue(12, { kind: MEASURE.kind })]);
    assert.deepEqual(heatTable.at(-1).values, ['Fri', formatValue(2, { kind: MEASURE.kind })]);
    const ramp = await page.evaluate(() => {
      const root = document.getElementById('matrix-heatmap').shadowRoot;
      return {
        stops: [...root.querySelectorAll('.yk-matrix-ramp-stop')].map(item => item.dataset.stop),
        values: [...root.querySelectorAll('.yk-matrix-ramp-value')].map(item => item.textContent),
        label: root.querySelector('.yk-matrix-ramp').getAttribute('aria-label'),
        cells: [...root.querySelectorAll('.yk-mark')].map(cell => cell.textContent)
      };
    });
    assert.deepEqual(ramp.stops, ['0', '1', '2', '3', '4']);
    assert.equal(ramp.values.length, 5);
    assert.equal(ramp.values[0], formatValue(0, { kind: MEASURE.kind, compact: true }));
    assert.equal(ramp.values.at(-1), formatValue(22, { kind: MEASURE.kind, compact: true }));
    assert.match(ramp.label, /Sessions/);
    assert.ok(ramp.cells.includes('12'));

    // A heatmap has no continuous axis, so a drag emits no brush event.
    const heatBefore = await brushCount('matrix-heatmap');
    await drag(await pointAt('matrix-heatmap', 0), await pointAt('matrix-heatmap', 6));
    assert.equal(await brushCount('matrix-heatmap'), heatBefore);
    assert.equal((await inspect('matrix-heatmap')).brush, null);

    // Hover and focus highlight the same entity key and the tooltip carries it.
    await page.evaluate(() => document.getElementById('matrix-heatmap').scrollIntoView({ block: 'center' }));
    const firstPoint = await pointAt('matrix-heatmap', 0);
    await page.mouse.move(firstPoint.x, firstPoint.y);
    const hovered = await inspect('matrix-heatmap');
    assert.equal(hovered.cursor.key, firstPoint.key);
    assert.equal(hovered.highlight, firstPoint.key);
    const tooltip = await page.locator('yk-matrix#matrix-heatmap .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(tooltip.key, firstPoint.key);
    assert.match(tooltip.text, /Sessions/);
    await page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('[data-mark="0"]').focus(), 'matrix-heatmap');
    const focused = await inspect('matrix-heatmap');
    assert.equal(focused.highlight, firstPoint.key);
    assert.equal(focused.inspectedKey, firstPoint.key);

    // Click and Enter inspect; Space, modifier click and the checkbox select.
    await page.mouse.click(firstPoint.x, firstPoint.y);
    let event = await lastEvent();
    assert.equal(event.name, 'inspect');
    await focusRoot('matrix-heatmap');
    await page.keyboard.press('Enter');
    event = await lastEvent();
    assert.equal(event.name, 'inspect');
    await page.keyboard.press(' ');
    let selection = await inspect('matrix-heatmap');
    assert.deepEqual(selection.selection.include, [firstPoint.key]);
    await page.keyboard.press(' ');
    selection = await inspect('matrix-heatmap');
    assert.equal(selection.selection, null);

    const secondPoint = await pointAt('matrix-heatmap', 1);
    await page.keyboard.down('Shift');
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up('Shift');
    selection = await inspect('matrix-heatmap');
    assert.ok(selection.selection.include.includes(firstPoint.key));

    await page.mouse.click(firstPoint.x, firstPoint.y);
    await focusRoot('matrix-heatmap');
    await page.keyboard.press('x');
    selection = await inspect('matrix-heatmap');
    assert.deepEqual(selection.selection.exclude, [firstPoint.key]);

    const altPoint = await pointAt('matrix-heatmap', 5);
    await page.keyboard.down('Alt');
    await page.mouse.click(altPoint.x, altPoint.y);
    await page.keyboard.up('Alt');
    selection = await inspect('matrix-heatmap');
    assert.ok(selection.selection.exclude.includes(altPoint.key));

    await page.evaluate(() => { document.getElementById('matrix-heatmap').shadowRoot.querySelector('details.yk-chart-table').open = true; });
    await page.locator('yk-matrix#matrix-heatmap .yk-table-select').nth(0).check();
    selection = await inspect('matrix-heatmap');
    assert.ok(selection.selection.include.includes(firstPoint.key));

    // Table keyboard: arrows move the row focus, Space selects and Enter inspects.
    await page.evaluate(() => document.getElementById('matrix-heatmap').shadowRoot.querySelector('.yk-table tbody tr').focus());
    await page.keyboard.press('ArrowDown');
    const tableFocus = await page.evaluate(() => {
      const root = document.getElementById('matrix-heatmap').shadowRoot;
      return root.activeElement?.dataset.entityKey;
    });
    assert.equal(tableFocus, heatmapRows()[1].key);
    await page.evaluate(() => document.getElementById('matrix-heatmap').shadowRoot.querySelectorAll('.yk-table tbody tr')[5].focus());
    await page.keyboard.press(' ');
    selection = await inspect('matrix-heatmap');
    assert.ok(selection.selection.include.includes(heatmapRows()[5].key));
    await page.keyboard.press('Enter');
    event = await lastEvent();
    assert.equal(event.name, 'inspect');

    // o, f, c then a-d emit the contract intents.
    await page.mouse.click(firstPoint.x, firstPoint.y);
    await focusRoot('matrix-heatmap');
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
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(': ') + 2)).slot, 'a');

    // A real touch tap inspects a heatmap cell at a target of at least 44 px.
    await page.evaluate(() => document.getElementById('matrix-heatmap').scrollIntoView({ block: 'center' }));
    const touchPoint = await pointAt('matrix-heatmap', 3);
    assert.ok(touchPoint.width >= 44 && touchPoint.height >= 44);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tapped = await inspect('matrix-heatmap');
    assert.equal(tapped.inspectedKey, touchPoint.key);

    // Calendar: day cells map to fixture dates; a real drag brushes the axis.
    const calendar = await inspect('matrix-calendar');
    assert.equal(calendar.type, 'calendar');
    assert.deepEqual(calendar.categories, calendarRows().map(row => row.key));
    assert.equal(calendar.marks.length, 21);
    assert.deepEqual(calendar.marks.map(mark => mark.x), calendarRows().map(row => row.x));
    assert.equal(calendar.marks[0].py, calendar.marks[7].py);
    assert.ok(calendar.marks[1].py > calendar.marks[0].py);
    assert.equal(calendar.brush, null);
    const calendarTable = await tableRows('matrix-calendar');
    assert.equal(calendarTable[0].x, '2021-01-04');
    assert.equal(calendarTable[0].values[0], 'Mon');

    await page.evaluate(() => document.getElementById('matrix-calendar').scrollIntoView({ block: 'center' }));
    const fromPoint = await pointAt('matrix-calendar', 1);
    const toPoint = await pointAt('matrix-calendar', 8);
    await drag(fromPoint, toPoint);
    event = await lastEvent();
    assert.equal(event.name, 'brush');
    assert.equal(event.chart, 'matrix-calendar');
    const brushed = await inspect('matrix-calendar');
    assert.ok(Number.isFinite(brushed.brush.from) && Number.isFinite(brushed.brush.to));
    assert.ok(brushed.brush.from < brushed.brush.to);
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(': ') + 2)).aligned, true);

    // Esc clears the brush; [ and ] move an edge by a day.
    await focusRoot('matrix-calendar');
    await page.keyboard.press('Escape');
    assert.equal((await inspect('matrix-calendar')).brush, null);
    await drag(fromPoint, toPoint);
    const beforeEdges = await inspect('matrix-calendar');
    await focusRoot('matrix-calendar');
    await page.keyboard.press('[');
    const leftMoved = await inspect('matrix-calendar');
    assert.ok(leftMoved.brush.from < beforeEdges.brush.from);
    assert.equal(leftMoved.brush.to, beforeEdges.brush.to);
    await page.keyboard.press(']');
    const rightMoved = await inspect('matrix-calendar');
    assert.ok(rightMoved.brush.to > leftMoved.brush.to);

    // Select mode turns a real touch drag into the same brush.
    await page.locator('yk-matrix#matrix-calendar .yk-matrix-select-mode').click();
    const touchFrom = await pointAt('matrix-calendar', 8);
    const touchTo = await pointAt('matrix-calendar', 1);
    const calendarBefore = await brushCount('matrix-calendar');
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchFrom.x, y: touchFrom.y, id: 0 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchTo.x, y: touchTo.y, id: 0 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(await brushCount('matrix-calendar') > calendarBefore);

    // Both themes keep the entity slot and re-read the ramp tokens.
    const light = await page.evaluate(() => {
      const element = document.getElementById('matrix-heatmap');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-matrix-cell')?.getAttribute('fill') };
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => {
      const element = document.getElementById('matrix-heatmap');
      return element?.dataset.theme === 'dark' && element.dataset.state === 'ready';
    });
    const dark = await page.evaluate(() => {
      const element = document.getElementById('matrix-heatmap');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-matrix-cell')?.getAttribute('fill') };
    });
    assert.deepEqual(dark.style, light.style);
    assert.notEqual(dark.fill, light.fill);
    const motion = await page.evaluate(() => {
      const root = document.getElementById('matrix-heatmap').shadowRoot;
      const plot = getComputedStyle(root.querySelector('.yk-svg-plot'));
      const cell = getComputedStyle(root.querySelector('.yk-matrix-cell'));
      return { plotAnimation: plot.animationName, plotTransition: plot.transitionDuration, cellAnimation: cell.animationName };
    });
    assert.equal(motion.plotAnimation, 'none');
    assert.equal(motion.plotTransition, '0s');
    assert.equal(motion.cellAnimation, 'none');

    await settle('matrix-calendar');
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
