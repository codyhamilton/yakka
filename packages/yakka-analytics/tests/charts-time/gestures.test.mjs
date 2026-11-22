import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addSelection, decodeSelection, emptySelection, encodeSelection, isExcluded, isSelected,
  normaliseSelection, removeSelection, selectedKeys, selectionIsEmpty, selectionPredicate,
  toggleSelection
} from '../../web/js/charts/selection.js';
import { decodeBrush, encodeBrush } from '../../web/js/charts/history.js';
import { panWindow, zoomWindow } from '../../web/js/charts/gestures.js';
import { timeSeries } from '../gallery/fixture.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

test('selection is a disjoint Boolean predicate with stable ordering', () => {
  let selection = emptySelection();
  selection = toggleSelection(selection, 'model:beacon');
  selection = toggleSelection(selection, 'model:atlas');
  selection = toggleSelection(selection, 'harness:orca');
  assert.deepEqual(selection.include, ['harness:orca', 'model:atlas', 'model:beacon']);
  assert.deepEqual(selection.exclude, []);
  assert.ok(isSelected(selection, 'model:atlas'));
  assert.deepEqual(selectionPredicate(selection), {
    kind: 'entity',
    include: ['harness:orca', 'model:atlas', 'model:beacon'],
    exclude: []
  });

  selection = toggleSelection(selection, 'model:atlas');
  assert.deepEqual(selection.include, ['harness:orca', 'model:beacon']);

  selection = toggleSelection(selection, 'model:beacon', { exclude: true });
  assert.deepEqual(selection.include, ['harness:orca']);
  assert.deepEqual(selection.exclude, ['model:beacon']);
  assert.ok(isExcluded(selection, 'model:beacon'));

  selection = toggleSelection(selection, 'model:beacon', { exclude: true });
  assert.deepEqual(selection.exclude, []);

  selection = addSelection(selection, 'repo:core');
  selection = removeSelection(selection, 'harness:orca');
  assert.deepEqual(selectedKeys(selection), ['repo:core']);
  assert.equal(selectionIsEmpty(emptySelection()), true);
  assert.equal(selectionPredicate(emptySelection()), null);
});

test('selection pick value round-trips and is order independent', () => {
  const one = normaliseSelection({ include: ['b', 'a'], exclude: ['c'] });
  const two = normaliseSelection({ include: ['a', 'b'], exclude: ['c'] });
  assert.equal(encodeSelection(one), 'a,b|c');
  assert.equal(encodeSelection(one), encodeSelection(two));
  assert.deepEqual(decodeSelection(encodeSelection(one)), { include: ['a', 'b'], exclude: ['c'] });
  assert.equal(decodeSelection('').include.length, 0);
  assert.equal(encodeSelection(emptySelection()), '');
});

test('brush and window maths settle without timers', () => {
  assert.equal(encodeBrush({ from: 10.4, to: 20.6 }), '10~21');
  assert.deepEqual(decodeBrush('21~10'), { from: 10, to: 21 });
  assert.equal(decodeBrush(''), null);
  assert.equal(decodeBrush('nope'), null);

  assert.deepEqual(zoomWindow({ min: 0, max: 100 }, 50, 0.5), { from: 25, to: 75 });
  assert.deepEqual(zoomWindow({ min: 0, max: 100 }, 0, 2), { from: 0, to: 200 });
  assert.deepEqual(panWindow({ min: 10, max: 20 }, 5), { min: 15, max: 25 });
});

test('gesture and settled-state gallery proves the interaction contract in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1200, height: 2600 }, hasTouch: true });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/gestures.html`);
    await waitForSettled(page);

    const rows = timeSeries({ points: 40 });
    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        state: element.dataset.state,
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
        urlState: result.urlState
      };
    }, id);
    const geometry = (id, index) => page.evaluate(([chartId, rowIndex]) => {
      const result = document.getElementById(chartId).inspect();
      const mark = result.marks[rowIndex];
      return { plot: result.plot, px: mark.px, key: mark.key, x: mark.x };
    }, [id, index]);
    const query = () => page.evaluate(() => location.search);
    const historyLength = () => page.evaluate(() => history.length);
    const point = (geom, offset = 0) => ({
      x: geom.plot.left + geom.px + offset,
      y: geom.plot.top + geom.plot.height / 2
    });
    const tooltipKey = id => page.locator(`yk-chart#${id} .yk-tooltip`).evaluate(element => element.dataset.entityKey || '');

    await page.locator('yk-chart#gestures-a .u-over').scrollIntoViewIfNeeded();

    // Hover and keyboard focus inspect without touching the URL or history.
    const urlBeforeHover = await query();
    const historyBeforeHover = await historyLength();
    const hoverGeom = await geometry('gestures-a', 5);
    await page.mouse.move(point(hoverGeom).x, point(hoverGeom).y);
    const hoveredA = await inspect('gestures-a');
    const hoveredB = await inspect('gestures-b');
    assert.equal(hoveredA.inspectedKey, rows[5].key);
    assert.equal(hoveredA.highlight, rows[5].key);
    assert.equal(hoveredB.highlight, rows[5].key, 'the linked chart highlights the same entity key');
    assert.equal(await tooltipKey('gestures-a'), rows[5].key);
    assert.equal(await query(), urlBeforeHover);
    assert.equal(await historyLength(), historyBeforeHover);
    assert.equal(harness.stats.analytics, 0, 'hover makes no request');

    await page.evaluate(() => document.getElementById('gestures-a').shadowRoot.querySelector('.yk-chart').focus());
    await page.keyboard.press('ArrowRight');
    const focusedA = await inspect('gestures-a');
    assert.equal(focusedA.inspectedKey, rows[6].key);
    assert.equal((await inspect('gestures-b')).highlight, rows[6].key);
    assert.equal(await tooltipKey('gestures-a'), rows[6].key);
    assert.equal(await query(), urlBeforeHover);
    assert.equal(await historyLength(), historyBeforeHover);

    // Selection: modifiers add and subtract, the checkbox adds, colours survive.
    const historyBeforeSelection = await historyLength();
    const seriesBefore = (await inspect('gestures-a')).series;
    const selectGeom7 = await geometry('gestures-a', 7);
    await page.keyboard.down('Shift');
    await page.mouse.click(point(selectGeom7).x, point(selectGeom7).y);
    await page.keyboard.up('Shift');
    const selected7 = await inspect('gestures-a');
    assert.deepEqual(selected7.selection, { kind: 'entity', include: [rows[7].key], exclude: [] });
    assert.equal(selected7.brush, null);

    const selectGeom8 = await geometry('gestures-a', 8);
    await page.keyboard.down('Control');
    await page.mouse.click(point(selectGeom8).x, point(selectGeom8).y);
    await page.keyboard.up('Control');
    assert.deepEqual((await inspect('gestures-a')).selectionKeys, [rows[7].key, rows[8].key]);

    await page.keyboard.down('Alt');
    await page.mouse.click(point(selectGeom7).x, point(selectGeom7).y);
    await page.keyboard.up('Alt');
    const subtracted = await inspect('gestures-a');
    assert.deepEqual(subtracted.selection, { kind: 'entity', include: [rows[8].key], exclude: [rows[7].key] });
    assert.deepEqual((await inspect('gestures-a')).series, seriesBefore);

    await page.locator('yk-chart#gestures-a .yk-chart-table > summary').click();
    await page.locator(`yk-chart#gestures-a input.yk-table-select[data-key="${rows[9].key}"]`).click();
    const afterCheckbox = await inspect('gestures-a');
    assert.deepEqual(afterCheckbox.selection.include, [rows[8].key, rows[9].key]);
    assert.deepEqual(afterCheckbox.selection.exclude, [rows[7].key]);
    assert.match(await query(), /pick=/);
    assert.equal(await historyLength(), historyBeforeSelection, 'selection replaces the transient pick entry');
    assert.equal(harness.stats.analytics, 0, 'selection makes no request');

    // Brush sets the transient sel by replaceState; zoom pushes from/to and
    // clears it; Back restores the brush.
    const brushStart = await geometry('gestures-a', 10);
    const brushEnd = await geometry('gestures-a', 20);
    await page.mouse.move(point(brushStart).x, point(brushStart).y);
    await page.mouse.down();
    await page.mouse.move(point(brushEnd).x, point(brushEnd).y, { steps: 6 });
    await page.mouse.up();
    const brushed = await inspect('gestures-a');
    assert.ok(brushed.brush, 'a time drag creates a transient brush');
    assert.ok(Math.abs(brushed.brush.from - rows[10].x) < 2 * 24 * 3600 * 1000);
    assert.ok(Math.abs(brushed.brush.to - rows[20].x) < 2 * 24 * 3600 * 1000);
    assert.match(await query(), /sel=/);
    const historyBeforeZoom = await historyLength();
    assert.equal(historyBeforeZoom, historyBeforeSelection, 'a brush does not push history');

    await page.locator('yk-chart#gestures-a [data-gesture="zoom-selection"]').click();
    const zoomed = await inspect('gestures-a');
    assert.equal(zoomed.brush, null, 'zoom clears the transient brush');
    assert.ok(Math.abs(zoomed.window.from - brushed.brush.from) < 2 * 24 * 3600 * 1000);
    assert.match(await query(), /from=/);
    assert.doesNotMatch(await query(), /sel=/);
    assert.equal(await historyLength(), historyBeforeZoom + 1, 'zoom pushes');

    await page.evaluate(() => history.back());
    await page.waitForFunction(() => location.search.includes('sel='));
    const restored = await inspect('gestures-a');
    assert.ok(restored.brush, 'Back restores the prior transient brush');
    assert.ok(Math.abs(restored.window.from - rows[0].x) < 2 * 24 * 3600 * 1000, 'Back restores the prior scope');

    await page.mouse.dblclick(point(brushStart).x, point(brushStart).y);
    const doubled = await inspect('gestures-a');
    assert.equal(doubled.brush, null);
    assert.ok(Math.abs(doubled.window.from - restored.brush.from) < 2 * 24 * 3600 * 1000);
    assert.match(await query(), /from=/);
    assert.doesNotMatch(await query(), /sel=/, 'double-click commits the brush to scope');

    // Shift-drag pans without a selection.
    const panStart = await geometry('gestures-a', 15);
    await page.keyboard.down('Shift');
    await page.mouse.move(point(panStart).x, point(panStart).y);
    await page.mouse.down();
    await page.mouse.move(point(panStart).x - 80, point(panStart).y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    const panned = await inspect('gestures-a');
    assert.equal(panned.brush, null, 'pan creates no brush');
    assert.notDeepEqual(panned.window, doubled.window, 'pan moves the window');
    assert.match(await query(), /from=/);
    assert.doesNotMatch(await query(), /sel=/);

    // Ctrl-wheel zooms around the cursor.
    const wheelGeom = await geometry('gestures-a', 20);
    const spanBeforeWheel = panned.window.to - panned.window.from;
    await page.mouse.move(point(wheelGeom).x, point(wheelGeom).y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    const wheeled = await inspect('gestures-a');
    assert.ok(wheeled.window.to - wheeled.window.from < spanBeforeWheel, 'ctrl-wheel zooms in');
    assert.doesNotMatch(await query(), /sel=/);

    // Legend: toggle hide without a request; focus pushes one filter; isolate hides the rest.
    const analyticsBeforeLegend = harness.stats.analytics;
    const historyBeforeLegend = await historyLength();
    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="harness:orca"] .yk-legend-toggle').click();
    const toggled = await inspect('gestures-a');
    assert.equal(toggled.series.find(item => item.key === 'harness:orca').visible, false);
    assert.match(await query(), /hide=harness%3Aorca/);
    assert.equal(await historyLength(), historyBeforeLegend, 'legend toggle replaces, it does not push');
    assert.equal(harness.stats.analytics, analyticsBeforeLegend, 'legend toggle makes no request');

    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="repo:core"] .yk-legend-focus').click();
    assert.match(await query(), /repo_id=core/);
    assert.equal(await historyLength(), historyBeforeLegend + 1, 'legend focus pushes the filter');
    assert.equal(harness.stats.analytics, analyticsBeforeLegend, 'legend focus makes no request itself');

    await page.keyboard.down('Control');
    await page.locator('yk-chart#gestures-a .yk-legend-item[data-key="model:atlas"] .yk-legend-toggle').click({ modifiers: ['Control'] });
    await page.keyboard.up('Control');
    const isolated = await inspect('gestures-a');
    assert.deepEqual(isolated.series.filter(item => item.visible).map(item => item.key), ['model:atlas']);

    // Keyboard grammar settles each named state.
    await page.evaluate(() => document.getElementById('gestures-a').shadowRoot.querySelector('.yk-chart').focus());
    await page.keyboard.press('ArrowRight');
    const keyboardA = await inspect('gestures-a');
    assert.notEqual(keyboardA.inspectedIndex, 0);
    await page.keyboard.press('ArrowDown');
    assert.equal((await inspect('gestures-a')).inspectedSeries, 1);

    await page.keyboard.press('Space');
    const spaceSelection = await inspect('gestures-a');
    assert.ok(spaceSelection.selection, 'Space toggles a selection');
    assert.ok(spaceSelection.selectionKeys.includes(keyboardA.inspectedKey));

    await page.keyboard.press('x');
    const excluded = await inspect('gestures-a');
    assert.ok(excluded.selection.exclude.includes(keyboardA.inspectedKey), 'x toggles an exclusion');

    const log = await page.locator('#gesture-state').evaluate(element => ({ event: element.dataset.lastEvent }));
    await page.keyboard.press('o');
    assert.equal(await page.locator('#gesture-state').evaluate(element => element.dataset.lastEvent), 'open');
    const beforeFilter = await inspect('gestures-a');
    await page.keyboard.press('f');
    const filtered = await inspect('gestures-a');
    assert.ok(filtered.window.to - filtered.window.from < beforeFilter.window.to - beforeFilter.window.from, 'f filters to the inspected mark');
    assert.match(await query(), /from=/);
    await page.keyboard.press('c');
    await page.keyboard.press('a');
    assert.equal(await page.locator('#gesture-state').evaluate(element => element.dataset.lastEvent), 'cohort');
    assert.ok(log.event);

    await page.keyboard.press(']');
    const bracketed = await inspect('gestures-a');
    assert.ok(bracketed.brush, '] moves/creates a brush edge');
    await page.keyboard.press('[');
    assert.notDeepEqual((await inspect('gestures-a')).brush, bracketed.brush);

    await page.keyboard.press('Escape');
    assert.equal((await inspect('gestures-a')).selection, null, 'Esc clears the selection first');
    await page.keyboard.press('Escape');
    assert.equal((await inspect('gestures-a')).brush, null, 'Esc then clears the brush');

    const beforePlus = await inspect('gestures-a');
    await page.keyboard.press('+');
    const plus = await inspect('gestures-a');
    assert.ok(plus.window.to - plus.window.from < beforePlus.window.to - beforePlus.window.from, '+ zooms in');
    await page.keyboard.press('-');
    const minus = await inspect('gestures-a');
    assert.ok(minus.window.to - minus.window.from > plus.window.to - plus.window.from, '- zooms out');

    // Touch: tap inspects, Select mode turns a drag into a brush, pinch zooms.
    // Chart B still shows the full window, so every fixture mark is reachable.
    const touchId = 'gestures-b';
    await page.locator(`yk-chart#${touchId} .u-over`).scrollIntoViewIfNeeded();
    await page.evaluate(id => {
      const over = document.getElementById(id).shadowRoot.querySelector('.u-over');
      window.__pe = [];
      for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        over.addEventListener(type, event => window.__pe.push({ type, id: event.pointerId }));
      }
    }, touchId);
    const client = await page.context().newCDPSession(page);
    const tapPoint = point(await geometry(touchId, 12));
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: tapPoint.x, y: tapPoint.y }]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tapped = await inspect(touchId);
    assert.equal(tapped.inspectedIndex, 12);
    assert.equal(tapped.inspectedKey, rows[12].key);

    await page.locator(`yk-chart#${touchId} [data-gesture="select-mode"]`).click();
    assert.equal((await inspect(touchId)).selectMode, true);
    const touchStart = point(await geometry(touchId, 4));
    const touchEnd = point(await geometry(touchId, 14));
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x, y: touchStart.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchEnd.x, y: touchEnd.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const touchBrush = await inspect(touchId);
    assert.ok(touchBrush.brush, 'Select mode turns a touch drag into a brush');

    const spanBeforePinch = (await inspect(touchId)).window;
    const pinchStart = point(await geometry(touchId, 18));
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: pinchStart.x - 30, y: pinchStart.y }, { x: pinchStart.x + 30, y: pinchStart.y }]
    });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: pinchStart.x - 80, y: pinchStart.y }, { x: pinchStart.x + 80, y: pinchStart.y }]
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const pinched = await inspect(touchId);
    const events = await page.evaluate(() => window.__pe);
    const lastGesture = await page.locator('#gesture-state').evaluate(element => element.dataset.lastEvent);
    assert.notEqual(pinched.window.to - pinched.window.from, spanBeforePinch.to - spanBeforePinch.from, 'pinch changes the time window');
    await diagnostics.assertClean();
    assert.doesNotMatch(await query(), /sel=/, JSON.stringify({ window: pinched.window, spanBeforePinch, brush: pinched.brush, events, lastGesture }));

    const targets = await page.evaluate(() => {
      const root = document.getElementById('gestures-a').shadowRoot;
      const nodes = [...root.querySelectorAll('.yk-gesture-button, .yk-legend button, input.yk-table-select')];
      return nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { name: node.dataset.action || node.dataset.gesture || node.className, width: rect.width, height: rect.height };
      });
    });
    assert.ok(targets.length > 0);
    assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets.filter(target => target.width < 44 || target.height < 44)));

    await diagnostics.assertClean();
    assert.ok(harness.stats.maxInFlight <= 4);
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
