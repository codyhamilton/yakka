import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLanesModel, createTimeScale, formatLaneTime, toTime
} from '../../web/js/charts/yk-lanes.js';
import { planAssignments, styleForKey } from '../../web/js/charts/colour-registry.js';
import { formatValue, NULL_TEXT } from '../../web/js/charts/formatters.js';
import {
  KINDS, LANES, ganttRows, ganttSpec, laneWindow, timelineRows, timelineSpec
} from '../gallery/fixture-lanes.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

test('time-to-pixel mapping is linear and invertible over the plotted window', () => {
  const scale = createTimeScale({ min: 1000, max: 5000 }, 400);
  assert.equal(scale.xToPx(1000), 0);
  assert.equal(scale.xToPx(3000), 200);
  assert.equal(scale.xToPx(5000), 400);
  assert.equal(scale.xToData(0), 1000);
  assert.equal(scale.xToData(200), 3000);
  assert.equal(scale.xToData(400), 5000);
  assert.equal(scale.xToData(9999), 5000);
  assert.equal(scale.xToPx('not a time'), 0);
  assert.equal(toTime('2024-01-02T09:00:00Z'), Date.UTC(2024, 0, 2, 9));
  assert.equal(toTime(undefined), null);
});

test('the timeline model draws one marker per item in its declared lane', () => {
  const items = timelineRows();
  const model = buildLanesModel({ spec: timelineSpec(), data: items });
  assert.equal(model.state, 'ready');
  assert.equal(model.type, 'timeline');
  assert.deepEqual(model.lanes.map(lane => lane.key), LANES.map(lane => lane.key));
  assert.equal(model.rows.length, items.length);
  assert.deepEqual(model.window, laneWindow(items));
  assert.deepEqual(model.kinds, [...new Set(items.map(item => item.kind))]);
  for (const [index, row] of model.rows.entries()) {
    const item = items[index];
    assert.equal(row.key, item.key);
    assert.equal(row.span, false);
    assert.equal(row.at, item.at);
    assert.equal(row.lane, item.lane);
    assert.equal(row.laneIndex, LANES.findIndex(lane => lane.key === item.lane));
    assert.equal(row.priced, item.priced !== false);
    assert.equal(row.hollow, item.priced === false);
  }
  for (const key of ['model:atlas', 'harness:orca', 'repo:core', 'kind:test']) {
    assert.ok(model.entityKeys.includes(key), `fixture carries ${key}`);
  }
  assert.equal(model.tableSeries.map(column => column.key).join(','), 'lane,kind,value');
  assert.equal(model.tableRows.length, items.length);
  assert.equal(model.tableRows[2].values.lane, 'Core');
  assert.equal(model.tableRows[2].values.kind, 'Artifact');
  assert.match(model.tableRows[2].values.value, /2 artifacts$/);
});

test('the gantt model keeps every span start and end and packs overlaps apart', () => {
  const items = ganttRows();
  const model = buildLanesModel({ spec: ganttSpec(), data: items });
  assert.equal(model.state, 'ready');
  assert.equal(model.type, 'gantt');
  assert.equal(model.rows.length, items.length);
  assert.deepEqual(model.window, laneWindow(items));
  assert.equal(model.tableSeries.map(column => column.key).join(','), 'end,lane,kind,value');
  for (const [index, row] of model.rows.entries()) {
    const item = items[index];
    assert.equal(row.span, true);
    assert.equal(row.start, item.start);
    assert.equal(row.end, item.end);
    assert.ok(row.end > row.start);
    assert.equal(model.tableRows[index].x, formatLaneTime(item.start));
    assert.equal(model.tableRows[index].values.end, formatLaneTime(item.end));
  }
  const overlapping = [model.rows[0], model.rows[3]];
  assert.equal(overlapping[0].lane, overlapping[1].lane);
  assert.ok(overlapping[0].start < overlapping[1].end && overlapping[1].start < overlapping[0].end);
  assert.notEqual(overlapping[0].laneRow, overlapping[1].laneRow);
  assert.ok(overlapping.every(row => row.laneRows >= 2));
  assert.ok(model.tableRows.every(row => row.values.end && row.values.end !== NULL_TEXT));
});

test('marker colour and shape come from the registry by kind, not by entity', () => {
  const items = timelineRows();
  const model = buildLanesModel({ spec: timelineSpec(), data: items });
  const kinds = model.kinds;
  const assignments = planAssignments({}, kinds);
  const styles = kinds.map(kind => styleForKey(kind, assignments));
  assert.equal(new Set(styles.map(style => style.cssVar)).size, kinds.length);
  const calls = items.filter(item => item.kind === 'kind:call');
  const callStyle = styleForKey('kind:call', assignments);
  for (const item of calls) {
    assert.equal(styleForKey(item.kind, assignments).cssVar, callStyle.cssVar);
    assert.notEqual(styleForKey(item.key, assignments).cssVar, callStyle.cssVar);
  }
});

test('an unpriced marker is hollow and named, never formatted as zero', () => {
  const model = buildLanesModel({ spec: timelineSpec(), data: timelineRows() });
  const unpriced = model.rows.find(row => !row.priced);
  const unpricedTable = model.tableRows.find(row => row.key === unpriced.key);
  assert.equal(unpriced.hollow, true);
  assert.deepEqual(unpriced.values, { 'kind:call': null });
  assert.equal(unpricedTable.values.value, 'unpriced');
  assert.doesNotMatch(unpricedTable.values.value, /\$0/);
  const priced = model.rows.find(row => row.priced && row.kind === 'kind:call');
  const pricedTable = model.tableRows.find(row => row.key === priced.key);
  assert.equal(priced.hollow, false);
  assert.equal(pricedTable.values.value, formatValue(12.5, { kind: 'money', unit: 'USD' }));
  assert.notEqual(pricedTable.values.value, 'unpriced');
});

test('the lanes gallery proves both modes, the time brush and the interaction grammar in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2200 }, hasTouch: true });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/lanes.html`);
    await waitForSettled(page);

    const inspect = id => page.evaluate(chartId => {
      const result = document.getElementById(chartId).inspect();
      return {
        chart: result.chart,
        hostChart: document.getElementById(chartId).dataset.chart,
        state: document.getElementById(chartId).dataset.state,
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
      return {
        headers: [...root.querySelectorAll('.yk-table thead th')].map(cell => cell.textContent),
        rows: [...root.querySelectorAll('.yk-table tbody tr')].map(row => ({
          key: row.dataset.entityKey,
          x: row.querySelector('.yk-table-x')?.textContent,
          values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
        }))
      };
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
    const axisPoint = (id, fraction) => page.evaluate(([chartId, ratio]) => {
      const plot = document.getElementById(chartId).inspect().plot;
      return { x: plot.left + plot.width * ratio, y: plot.top + plot.height + 16 };
    }, [id, fraction]);
    const settle = id => page.evaluate(chartId => document.getElementById(chartId).whenSettled(), id);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      text: document.getElementById('event-log').textContent
    }));
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let step = 1; step <= 6; step += 1) {
        await page.mouse.move(from.x + ((to.x - from.x) * step) / 6, from.y);
      }
      await page.mouse.up();
    };

    const timelineItems = timelineRows();
    const ganttItems = ganttRows();
    assert.equal((await inspect('lanes-timeline')).state, 'ready');
    assert.equal((await inspect('lanes-gantt')).state, 'ready');

    const timeline = await inspect('lanes-timeline');
    assert.equal(timeline.hostChart, 'lanes');
    assert.equal(timeline.type, 'timeline');
    assert.deepEqual(timeline.window, laneWindow(timelineItems));
    assert.equal(timeline.marks.length, timelineItems.length);
    assert.equal(timeline.brush, null);
    const timelineMapping = await page.evaluate(() => {
      const result = document.getElementById('lanes-timeline').inspect();
      return result.marks.map(mark => {
        const item = window.__lanes.fixture.timeline[mark.index];
        return { key: mark.key, px: mark.px, expected: result.xToPx(item.at), laneIndex: mark.y, expectedLane: window.__lanes.fixture.lanes.findIndex(lane => lane.key === item.lane) };
      });
    });
    for (const mark of timelineMapping) {
      assert.ok(Math.abs(mark.px - mark.expected) < 0.01, `${mark.key} lands at its fixture time`);
      assert.equal(mark.laneIndex, mark.expectedLane);
    }
    const timelineTable = await tableRows('lanes-timeline');
    assert.deepEqual(timelineTable.rows.map(row => row.key), timelineItems.map(item => item.key));
    for (const [index, row] of timelineTable.rows.entries()) {
      assert.equal(row.x, formatLaneTime(timelineItems[index].at));
      assert.equal(row.values[0], LANES.find(lane => lane.key === timelineItems[index].lane).label);
      assert.equal(row.values[1], KINDS.find(kind => kind.key === timelineItems[index].kind).label);
    }
    const markerSizes = await page.evaluate(() => [...document.getElementById('lanes-timeline').shadowRoot.querySelectorAll('.yk-lane-marker')]
      .map(shape => { const rect = shape.getBoundingClientRect(); return [Math.round(rect.width), Math.round(rect.height)]; }));
    for (const [width, height] of markerSizes) {
      assert.ok(width <= 18 && height <= 18 && width > 0 && height > 0, 'markers are a fixed size, not sized by a value');
    }

    const gantt = await inspect('lanes-gantt');
    assert.equal(gantt.type, 'gantt');
    assert.deepEqual(gantt.window, laneWindow(ganttItems));
    assert.equal(gantt.marks.length, ganttItems.length);
    const ganttMapping = await page.evaluate(() => {
      const result = document.getElementById('lanes-gantt').inspect();
      return result.marks.map(mark => {
        const item = window.__lanes.fixture.gantt[mark.index];
        const span = document.getElementById('lanes-gantt').shadowRoot.querySelector(`[data-mark="${mark.index}"] .yk-lane-span`);
        const rect = span.getBoundingClientRect();
        return {
          key: mark.key,
          px: mark.px,
          expectedStart: result.xToPx(item.start),
          width: rect.width,
          expectedWidth: result.xToPx(item.end) - result.xToPx(item.start),
          py: mark.py,
          laneIndex: mark.y,
          start: mark.values.start,
          end: mark.values.end,
          itemStart: item.start,
          itemEnd: item.end,
          itemLane: item.lane
        };
      });
    });
    for (const mark of ganttMapping) {
      assert.ok(Math.abs(mark.px - mark.expectedStart) < 0.01, `${mark.key} starts at its fixture start`);
      assert.ok(Math.abs(mark.width - mark.expectedWidth) < 0.5, `${mark.key} spans its fixture interval`);
      assert.equal(mark.start, mark.itemStart);
      assert.equal(mark.end, mark.itemEnd);
      assert.equal(mark.laneIndex, LANES.findIndex(lane => lane.key === mark.itemLane));
    }
    for (let left = 0; left < ganttMapping.length; left += 1) {
      for (let right = left + 1; right < ganttMapping.length; right += 1) {
        const a = ganttMapping[left];
        const b = ganttMapping[right];
        if (a.laneIndex === b.laneIndex && a.start < b.end && b.start < a.end) {
          assert.notEqual(a.py, b.py, 'overlapping spans stay distinguishable');
        }
      }
    }
    const ganttTable = await tableRows('lanes-gantt');
    assert.equal(ganttTable.rows.length, ganttItems.length);
    for (const [index, row] of ganttTable.rows.entries()) {
      assert.equal(row.x, formatLaneTime(ganttItems[index].start));
      assert.equal(row.values[0], formatLaneTime(ganttItems[index].end));
    }
    assert.ok(ganttTable.headers.includes('End'));

    // A real drag on the time axis emits a finite aligned brush; [ ] move an
    // edge and Esc clears the brush (the selection is empty at this point).
    await page.evaluate(() => document.getElementById('lanes-timeline').scrollIntoView({ block: 'center' }));
    const expectedBrush = await page.evaluate(() => {
      const result = document.getElementById('lanes-timeline').inspect();
      return { from: result.xToData(result.plot.width * 0.2), to: result.xToData(result.plot.width * 0.7) };
    });
    await drag(await axisPoint('lanes-timeline', 0.2), await axisPoint('lanes-timeline', 0.7));
    let brushed = await inspect('lanes-timeline');
    assert.ok(brushed.brush, 'a drag on the axis sets brush');
    assert.equal(brushed.brush.aligned, true);
    assert.ok(Number.isFinite(brushed.brush.from) && Number.isFinite(brushed.brush.to));
    assert.ok(brushed.brush.from < brushed.brush.to);
    assert.ok(Math.abs(brushed.brush.from - Math.round(expectedBrush.from)) < 2);
    assert.ok(Math.abs(brushed.brush.to - Math.round(expectedBrush.to)) < 2);
    assert.equal((await lastEvent()).name, 'brush');

    await focusRoot('lanes-timeline');
    const beforeBracket = (await inspect('lanes-timeline')).brush;
    await page.keyboard.press(']');
    const widened = (await inspect('lanes-timeline')).brush;
    assert.ok(widened.to > beforeBracket.to);
    await page.keyboard.press('[');
    const narrowed = (await inspect('lanes-timeline')).brush;
    assert.ok(narrowed.from < widened.from);
    await page.keyboard.press('Escape');
    assert.equal((await inspect('lanes-timeline')).brush, null);

    // Touch Select mode turns a drag into the same brush.
    await page.locator('yk-lanes#lanes-timeline .yk-lane-select-mode').click();
    const touchStart = await page.evaluate(() => {
      const plot = document.getElementById('lanes-timeline').inspect().plot;
      return { x: plot.left + plot.width * 0.25, y: plot.top + plot.height * 0.5 };
    });
    const touchEnd = { x: touchStart.x + 120, y: touchStart.y };
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchStart.x, y: touchStart.y }] });
    for (let step = 1; step <= 5; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: touchStart.x + ((touchEnd.x - touchStart.x) * step) / 5, y: touchStart.y }]
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle('lanes-timeline');
    const touchBrush = (await inspect('lanes-timeline')).brush;
    assert.ok(touchBrush && touchBrush.aligned === true && touchBrush.from < touchBrush.to, 'touch Select mode drags the brush');
    await page.locator('yk-lanes#lanes-timeline .yk-lane-select-mode').click();
    await focusRoot('lanes-timeline');
    await page.keyboard.press('Escape');

    // Hover/focus highlight the entity key; click and Enter inspect.
    const firstKey = timelineItems[0].key;
    const firstPoint = await markPoint('lanes-timeline', firstKey);
    await page.mouse.move(firstPoint.x, firstPoint.y);
    let hovered = await inspect('lanes-timeline');
    assert.equal(hovered.cursor.key, firstKey);
    assert.equal(hovered.highlight, firstKey);
    const tooltip = await page.locator('yk-lanes#lanes-timeline .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(tooltip.key, firstKey);
    assert.match(tooltip.text, /Model call/);

    await page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('[data-mark="0"]').focus(), 'lanes-timeline');
    hovered = await inspect('lanes-timeline');
    assert.equal(hovered.highlight, firstKey);
    assert.equal(hovered.inspectedKey, firstKey);

    await page.mouse.click(firstPoint.x, firstPoint.y);
    let event = await lastEvent();
    assert.equal(event.name, 'inspect');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).key, firstKey);
    await focusRoot('lanes-timeline');
    await page.keyboard.press('Enter');
    assert.equal((await lastEvent()).name, 'inspect');

    await page.keyboard.press(' ');
    let selection = await inspect('lanes-timeline');
    assert.deepEqual(selection.selection.include, [firstKey]);
    await page.keyboard.press(' ');
    selection = await inspect('lanes-timeline');
    assert.equal(selection.selection, null);

    const secondKey = timelineItems[1].key;
    const secondPoint = await markPoint('lanes-timeline', secondKey);
    await page.keyboard.down('Alt');
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up('Alt');
    selection = await inspect('lanes-timeline');
    assert.ok(selection.selection.exclude.includes(secondKey));

    await page.mouse.click(firstPoint.x, firstPoint.y);
    await focusRoot('lanes-timeline');
    await page.keyboard.press('x');
    selection = await inspect('lanes-timeline');
    assert.ok(selection.selection.exclude.includes(firstKey));

    await page.keyboard.press('o');
    assert.equal((await lastEvent()).name, 'open');
    await page.keyboard.press('f');
    assert.equal((await lastEvent()).name, 'filter');
    await page.keyboard.press('c');
    await page.keyboard.press('a');
    event = await lastEvent();
    assert.equal(event.name, 'cohort');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).slot, 'a');
    await page.keyboard.press(' ');
    await page.keyboard.press('Escape');
    assert.equal((await inspect('lanes-timeline')).selection, null);

    // A real touch tap inspects a mark at a target of at least 44 px.
    const tapPoint = await markPoint('lanes-timeline', timelineItems[4].key);
    assert.ok(tapPoint.width >= 44 && tapPoint.height >= 44);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapPoint.x, y: tapPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle('lanes-timeline');
    assert.equal((await inspect('lanes-timeline')).inspectedKey, timelineItems[4].key);

    // The table is keyboard operable and its values carry units.
    await page.evaluate(() => {
      document.getElementById('lanes-timeline').scrollIntoView({ block: 'center' });
      document.getElementById('lanes-timeline').shadowRoot.querySelectorAll('.yk-table tbody tr')[0].focus();
    });
    await page.keyboard.press('ArrowDown');
    const tableFocus = await page.evaluate(() => document.getElementById('lanes-timeline').shadowRoot.activeElement?.dataset.entityKey);
    assert.equal(tableFocus, timelineItems[1].key);
    await page.keyboard.press(' ');
    selection = await inspect('lanes-timeline');
    assert.ok(selection.selection.include.includes(timelineItems[1].key));
    await page.keyboard.press('Enter');
    assert.equal((await lastEvent()).name, 'inspect');
    await page.keyboard.press(' ');
    const unitCell = (await tableRows('lanes-timeline')).rows[1].values[2];
    assert.match(unitCell, /4 events$/);

    // Priced marks are filled; unpriced marks are hollow, named and never $0.
    const unpriced = await page.evaluate(() => {
      const element = document.getElementById('lanes-timeline');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.values.priced === false);
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      const shape = group.querySelector('.yk-lane-marker');
      return { index, fill: shape.getAttribute('fill'), stroke: shape.getAttribute('stroke'), label: group.getAttribute('aria-label') };
    });
    assert.equal(unpriced.fill, 'none');
    assert.ok(unpriced.stroke);
    assert.match(unpriced.label, /unpriced/);
    const unpricedTable = (await tableRows('lanes-timeline')).rows.find(row => row.key === 'kind:test');
    assert.equal(unpricedTable.values[2], 'unpriced');
    assert.doesNotMatch(unpricedTable.values[2], /\$0/);

    // The legend groups by kind, toggles one kind with no request, and leaves
    // a survivor's slot and shape untouched.
    await page.evaluate(() => document.getElementById('lanes-timeline').scrollIntoView({ block: 'center' }));
    const analyticsBefore = harness.stats.analytics;
    const survivor = () => page.evaluate(() => {
      const result = document.getElementById('lanes-timeline').inspect();
      const mark = result.marks.find(item => item.key === 'model:atlas' && item.values.priced !== false);
      return { style: mark.style };
    });
    const beforeToggle = await survivor();
    await page.locator('yk-lanes#lanes-timeline .yk-legend-item[data-key="kind:test"] .yk-legend-toggle').click();
    await settle('lanes-timeline');
    const toggled = await inspect('lanes-timeline');
    assert.equal(toggled.series.find(item => item.key === 'kind:test').visible, false);
    assert.deepEqual((await survivor()).style, beforeToggle.style);
    assert.equal(harness.stats.analytics, analyticsBefore, 'a legend toggle does not request');
    await page.locator('yk-lanes#lanes-timeline .yk-legend-item[data-key="kind:test"] .yk-legend-toggle').click();
    await settle('lanes-timeline');

    // Both themes keep the same slot and shape; only the token value changes.
    const light = await page.evaluate(() => {
      const element = document.getElementById('lanes-timeline');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.values.priced !== false);
      const shape = element.shadowRoot.querySelector(`[data-mark="${index}"] .yk-lane-marker`);
      return { style: result.marks[index].style, fill: shape.getAttribute('fill') };
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => {
      const element = document.getElementById('lanes-timeline');
      return element?.dataset.theme === 'dark' && element.dataset.state === 'ready';
    });
    const dark = await page.evaluate(() => {
      const element = document.getElementById('lanes-timeline');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.values.priced !== false);
      const shape = element.shadowRoot.querySelector(`[data-mark="${index}"] .yk-lane-marker`);
      return { style: result.marks[index].style, fill: shape.getAttribute('fill') };
    });
    assert.deepEqual(dark.style, light.style);
    assert.notEqual(dark.fill, light.fill);

    const motion = await page.evaluate(() => {
      const root = document.getElementById('lanes-timeline').shadowRoot;
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
