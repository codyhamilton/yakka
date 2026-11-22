import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TREEMAP_LABEL_MIN, buildTreemapModel, layoutTreemap, squarify
} from '../../web/js/charts/yk-treemap.js';
import { FIXED_NEUTRALS, styleForKey } from '../../web/js/charts/colour-registry.js';
import { formatValue } from '../../web/js/charts/formatters.js';
import {
  FIXED_NEUTRAL_KEYS, PARENTS, REQUIRED_KEYS, TAIL_KEYS, parentTotal, tailTotal, treemapRows, treemapSpec
} from '../gallery/fixture-treemap.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

const WIDTH = 1040;
const HEIGHT = 480;
const AREA_TOLERANCE = 1e-3;

function area(rect) {
  return rect.width * rect.height;
}

function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 1e-6 && height > 1e-6 ? width * height : 0;
}

function leaves(layout) {
  return layout.flatMap(group => group.children.map(child => ({ ...child, parentKey: group.key })));
}

test('squarify tiles the rectangle with area proportional to the values and no overlaps', () => {
  const values = [6, 6, 4, 3, 2, 2, 1];
  const rects = squarify(values, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
  const total = values.reduce((sum, value) => sum + value, 0);
  for (const [index, rect] of rects.entries()) {
    assert.ok(Math.abs(area(rect) / (WIDTH * HEIGHT) - values[index] / total) < AREA_TOLERANCE, `cell ${index} area`);
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(overlapArea(rects[i], rects[j]), 0, `cells ${i}/${j} overlap`);
    }
  }
});

test('the treemap model keeps parent totals, the model children and one (other) tail', () => {
  const model = buildTreemapModel({ spec: treemapSpec(), data: treemapRows() });
  assert.equal(model.state, 'ready');
  const core = model.groups.find(group => group.key === 'repo:core');
  assert.equal(core.total, parentTotal('repo:core'));
  assert.deepEqual(core.children.map(child => child.key), ['model:atlas', 'model:beacon', 'model:cedar']);
  const other = model.groups.find(group => group.key === '(other)');
  assert.equal(other.total, tailTotal());
  assert.deepEqual(other.children.map(child => child.key), ['(other)']);
  for (const key of REQUIRED_KEYS) {
    assert.ok(model.groups.some(group => group.key === key) || model.rows.some(row => row.key === key), `${key} is present`);
  }
  for (const key of ['model:atlas', 'model:beacon']) {
    assert.ok(model.rows.some(row => row.key === key), `${key} is a child cell`);
  }
  for (const key of TAIL_KEYS) {
    assert.ok(!model.groups.some(group => group.key === key), `${key} is folded into the tail`);
  }
  assert.deepEqual(model.entityKeys, model.groups.map(group => group.key));
  const first = model.tableRows.find(row => row.key === 'model:atlas' && row.x === 'Core');
  assert.deepEqual(first.values, { child: 'Atlas', value: 120 });
});

test('parent and child rectangles are proportional, contained and non-overlapping', () => {
  const model = buildTreemapModel({ spec: treemapSpec(), data: treemapRows() });
  const layout = layoutTreemap(model.groups, WIDTH, HEIGHT);
  const plotArea = WIDTH * HEIGHT;
  const grandTotal = model.groups.reduce((sum, group) => sum + group.total, 0);
  const cells = leaves(layout);

  for (const group of layout) {
    assert.ok(Math.abs(area(group.rect) / plotArea - group.total / grandTotal) < AREA_TOLERANCE, `${group.key} group area`);
    for (const child of group.children) {
      const eps = 1e-6;
      assert.ok(child.rect.x >= group.rect.x - eps && child.rect.y >= group.rect.y - eps, `${child.key} inside ${group.key}`);
      assert.ok(child.rect.x + child.rect.width <= group.rect.x + group.rect.width + eps, `${child.key} right inside ${group.key}`);
      assert.ok(child.rect.y + child.rect.height <= group.rect.y + group.rect.height + eps, `${child.key} bottom inside ${group.key}`);
      assert.ok(Math.abs(area(child.rect) / area(group.rect) - child.value / group.total) < AREA_TOLERANCE, `${child.key} child area`);
    }
  }

  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      assert.equal(overlapArea(cells[i].rect, cells[j].rect), 0, `${cells[i].key}/${cells[j].key} overlap`);
    }
  }
  assert.ok(cells.every(cell => cell.rect.width >= 44 && cell.rect.height >= 44), 'every fixture cell is a 44 px target');
});

test('the (other) tail and every fixed neutral keep their own distinct style', () => {
  const styles = FIXED_NEUTRAL_KEYS.map(key => styleForKey(key));
  const combinations = new Set(styles.map(style => `${style.cssVar}|${style.shape}|${style.pattern}|${style.label}`));
  assert.equal(combinations.size, FIXED_NEUTRAL_KEYS.length);
  const other = styleForKey('(other)');
  assert.equal(other.cssVar, FIXED_NEUTRALS['(other)'].cssVar);
  assert.equal(other.pattern, FIXED_NEUTRALS['(other)'].pattern);
});

test('the treemap gallery proves labels, table, interaction, legend and both themes in Chromium', async t => {
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
    await page.goto(`${harness.origin}/gallery/treemap.html`);
    await waitForSettled(page);

    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        chart: result.chart,
        state: element.dataset.state,
        type: result.type,
        window: result.window,
        brush: result.brush,
        selection: result.selection,
        selectionKeys: result.selectionKeys,
        series: result.series,
        plot: result.plot,
        cursor: result.cursor,
        highlight: result.highlight,
        inspectedKey: result.inspectedKey,
        categories: result.categories,
        marks: result.marks,
        hasXToPx: typeof result.xToPx === 'function',
        hasYToPx: typeof result.yToPx === 'function'
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
    const settle = id => page.evaluate(chartId => document.getElementById(chartId).whenSettled(), id);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const markPoint = (id, predicate) => page.evaluate(([chartId, key, parent]) => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === key && (parent === null || mark.y === parent));
      const mark = result.marks[index];
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      const shape = group.querySelector('.yk-treemap-cell');
      const rect = shape.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height, key: mark.key, parent: mark.y };
    }, [id, predicate.key, predicate.parent ?? null]);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      text: document.getElementById('event-log').textContent
    }));

    assert.equal((await inspect('treemap-composition')).state, 'ready');
    assert.equal((await inspect('treemap-empty')).state, 'empty');
    assert.equal((await inspect('treemap-unsupported')).state, 'unsupported');

    const model = buildTreemapModel({ spec: treemapSpec(), data: treemapRows() });
    const treemap = await inspect('treemap-composition');
    assert.equal(treemap.chart, 'treemap');
    assert.equal(treemap.type, 'treemap');
    assert.equal(treemap.brush, null);
    assert.equal(treemap.window, null);
    assert.ok(treemap.plot.width > 0 && treemap.plot.height > 0);
    assert.equal(treemap.hasXToPx, true);
    assert.equal(treemap.hasYToPx, true);
    assert.deepEqual(treemap.categories, model.rows.map(row => row.key));
    assert.equal(treemap.marks.length, model.rows.length);
    assert.deepEqual(treemap.series.map(item => item.key), model.groups.map(group => group.key));
    assert.ok(treemap.marks.every(mark => mark.style.cssVar && mark.style.shape && mark.style.pattern !== undefined));

    const shell = await page.evaluate(() => {
      const element = document.getElementById('treemap-composition');
      const root = element.shadowRoot;
      return [...root.querySelectorAll('[data-mark]')].map(group => {
        const cell = group.querySelector('.yk-treemap-cell')?.getBBox();
        return {
          entityKey: group.dataset.entityKey,
          shape: group.dataset.shape,
          label: group.getAttribute('aria-label'),
          cell: cell ? { x: cell.x, y: cell.y, width: cell.width, height: cell.height } : null,
          texts: [...group.querySelectorAll('text')].map(text => text.textContent)
        };
      });
    });
    assert.ok(shell.every(mark => mark.entityKey && mark.shape && mark.label));
    for (const mark of shell) {
      const fits = mark.cell.width >= TREEMAP_LABEL_MIN.width && mark.cell.height >= TREEMAP_LABEL_MIN.height;
      if (fits) assert.ok(mark.texts.length > 0, `${mark.entityKey} is labelled`);
    }

    const other = treemap.marks.find(mark => mark.key === '(other)');
    assert.ok(other);
    assert.equal(other.style.cssVar, FIXED_NEUTRALS['(other)'].cssVar);
    assert.equal(other.values.sessions, tailTotal());

    const rowsUi = await tableRows('treemap-composition');
    assert.equal(rowsUi.length, model.rows.length);
    for (const row of model.tableRows) {
      const visible = rowsUi.find(item => item.key === row.key && item.x === row.x);
      assert.ok(visible, `${row.key} under ${row.x} is in the table`);
      assert.deepEqual(visible.values, [
        row.values.child,
        formatValue(row.values.value, { kind: 'count' })
      ]);
    }
    assert.ok(rowsUi.some(row => row.x === 'Core' && row.values[0] === 'Atlas'));

    const geometry = await page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return result.marks.map((mark, index) => {
        const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
        const cell = group.querySelector('.yk-treemap-cell').getBBox();
        return {
          key: mark.key,
          parent: mark.y,
          cell: { x: cell.x, y: cell.y, width: cell.width, height: cell.height },
          value: mark.values.sessions
        };
      });
    }, 'treemap-composition');
    const plotArea = treemap.plot.width * treemap.plot.height;
    const grandTotal = model.groups.reduce((sum, group) => sum + group.total, 0);
    for (const item of geometry) {
      assert.ok(Math.abs(area(item.cell) / plotArea - item.value / grandTotal) < AREA_TOLERANCE, `${item.key} area`);
    }

    await page.evaluate(() => document.getElementById('treemap-composition').scrollIntoView({ block: 'center' }));
    const first = treemap.marks.find(mark => mark.key === 'model:atlas' && mark.y === 'repo:core');
    const point = await markPoint('treemap-composition', { key: first.key, parent: first.y });
    assert.ok(point.width >= 44 && point.height >= 44);
    await page.mouse.move(point.x, point.y);
    const hovered = await inspect('treemap-composition');
    assert.equal(hovered.cursor.key, first.key);
    assert.equal(hovered.highlight, first.key);
    const tooltip = await page.locator('yk-treemap#treemap-composition .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(tooltip.key, first.key);
    assert.match(tooltip.text, /Atlas/);

    await page.mouse.click(point.x, point.y);
    let event = await lastEvent();
    assert.equal(event.name, 'inspect');
    await focusRoot('treemap-composition');
    await page.keyboard.press('Enter');
    event = await lastEvent();
    assert.equal(event.name, 'inspect');

    await page.keyboard.press(' ');
    let selection = await inspect('treemap-composition');
    assert.ok(selection.selection.include.includes(first.key));
    await page.keyboard.press(' ');
    assert.equal((await inspect('treemap-composition')).selection, null);

    const second = treemap.marks.find(mark => mark.key === 'model:beacon' && mark.y === 'repo:core');
    const secondPoint = await markPoint('treemap-composition', { key: second.key, parent: second.y });
    await page.keyboard.down('Shift');
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up('Shift');
    selection = await inspect('treemap-composition');
    assert.deepEqual(selection.selection.include, [second.key]);

    await page.mouse.click(point.x, point.y);
    await focusRoot('treemap-composition');
    await page.keyboard.press('x');
    selection = await inspect('treemap-composition');
    assert.deepEqual(selection.selection.exclude, [first.key]);

    const third = treemap.marks.find(mark => mark.key === 'model:cedar' && mark.y === 'repo:core');
    const thirdPoint = await markPoint('treemap-composition', { key: third.key, parent: third.y });
    await page.keyboard.down('Alt');
    await page.mouse.click(thirdPoint.x, thirdPoint.y);
    await page.keyboard.up('Alt');
    selection = await inspect('treemap-composition');
    assert.ok(selection.selection.exclude.includes(third.key));

    await page.evaluate(() => { document.getElementById('treemap-composition').shadowRoot.querySelector('details.yk-chart-table').open = true; });
    await page.locator('yk-treemap#treemap-composition .yk-table-select').nth(0).check();
    selection = await inspect('treemap-composition');
    assert.ok(selection.selection.include.length >= 1);

    // The accessible table is keyboard operable and shows the plotted values.
    await focusRoot('treemap-composition');
    await page.keyboard.press('Escape');
    assert.equal((await inspect('treemap-composition')).selection, null);
    await page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-table tbody tr').focus(), 'treemap-composition');
    await page.keyboard.press('ArrowDown');
    const focusedRow = await page.evaluate(() => document.getElementById('treemap-composition').shadowRoot.activeElement?.dataset.entityKey);
    assert.equal(focusedRow, model.rows[1].key);
    await page.keyboard.press(' ');
    const checked = await page.evaluate(() => document.getElementById('treemap-composition').shadowRoot.activeElement?.querySelector('input.yk-table-select')?.checked);
    assert.equal(checked, true);
    const beforeEnter = await lastEvent();
    await page.keyboard.press('Enter');
    const afterEnter = await lastEvent();
    assert.equal(afterEnter.name, 'inspect');
    assert.notEqual(afterEnter.text, beforeEnter.text);

    // A legend lists parent groups; a toggle hides one group and never repaints a survivor.
    const analyticsBefore = harness.stats.analytics;
    await page.evaluate(() => document.getElementById('treemap-composition').scrollIntoView({ block: 'center' }));
    const survivorBefore = (await inspect('treemap-composition')).marks.find(mark => mark.key === 'model:atlas' && mark.y === 'repo:core').style;
    await page.locator('yk-treemap#treemap-composition .yk-legend-item[data-key="repo:docs"] .yk-legend-toggle').click();
    await settle('treemap-composition');
    const toggled = await inspect('treemap-composition');
    assert.equal(toggled.series.find(item => item.key === 'repo:docs').visible, false);
    assert.ok(!toggled.marks.some(mark => mark.y === 'repo:docs'));
    const survivorAfter = toggled.marks.find(mark => mark.key === 'model:atlas' && mark.y === 'repo:core').style;
    assert.deepEqual(survivorAfter, survivorBefore);
    assert.equal(harness.stats.analytics, analyticsBefore, 'a legend toggle does not request');

    await page.locator('yk-treemap#treemap-composition .yk-legend-item[data-key="repo:core"] .yk-legend-focus').click();
    event = await lastEvent();
    assert.equal(event.name, 'legend');
    assert.match(event.text, /repo:core/);
    await focusRoot('treemap-composition');
    await page.keyboard.press('f');
    event = await lastEvent();
    assert.equal(event.name, 'filter');
    assert.match(event.text, /repo:core|model:/);

    // Six fixed neutral styles stay distinct in the rendered treemap.
    const neutralStyles = await page.evaluate(keys => {
      const result = document.getElementById('treemap-composition').inspect();
      return keys.map(key => {
        const mark = result.marks.find(item => item.key === key);
        return { key, style: mark?.style };
      });
    }, FIXED_NEUTRAL_KEYS);
    const combinations = new Set(neutralStyles.map(item => `${item.style.cssVar}|${item.style.shape}|${item.style.pattern}`));
    assert.equal(combinations.size, FIXED_NEUTRAL_KEYS.length);

    // A real touch tap inspects a mark without a prior hover.
    const touch = treemap.marks.find(mark => mark.key === 'model:cedar' && mark.y === 'repo:core');
    const touchPoint = await markPoint('treemap-composition', { key: touch.key, parent: touch.y });
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal((await inspect('treemap-composition')).inspectedKey, touch.key);

    // Both themes re-read the token and keep the same parent slot.
    const light = await page.evaluate(() => {
      const result = document.getElementById('treemap-composition').inspect();
      const mark = result.marks.find(item => item.key === 'model:atlas' && item.y === 'repo:core');
      const group = document.getElementById('treemap-composition').shadowRoot.querySelectorAll('[data-mark]');
      const index = result.marks.indexOf(mark);
      return { style: mark.style, fill: group[index].querySelector('.yk-treemap-cell')?.getAttribute('fill') };
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => {
      const element = document.getElementById('treemap-composition');
      return element?.dataset.theme === 'dark' && element.dataset.state === 'ready';
    });
    const dark = await page.evaluate(() => {
      const result = document.getElementById('treemap-composition').inspect();
      const mark = result.marks.find(item => item.key === 'model:atlas' && item.y === 'repo:core');
      const group = document.getElementById('treemap-composition').shadowRoot.querySelectorAll('[data-mark]');
      const index = result.marks.indexOf(mark);
      return { style: mark.style, fill: group[index].querySelector('.yk-treemap-cell')?.getAttribute('fill') };
    });
    assert.deepEqual(dark.style, light.style);
    assert.notEqual(dark.fill, light.fill);

    const motion = await page.evaluate(() => {
      const root = document.getElementById('treemap-composition').shadowRoot;
      const plot = getComputedStyle(root.querySelector('.yk-svg-plot'));
      const cell = getComputedStyle(root.querySelector('.yk-treemap-cell'));
      return { plotAnimation: plot.animationName, plotTransition: plot.transitionDuration, cellAnimation: cell.animationName };
    });
    assert.equal(motion.plotAnimation, 'none');
    assert.equal(motion.plotTransition, '0s');
    assert.equal(motion.cellAnimation, 'none');

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
