import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUMMARY_FIELDS, aggregateDots, buildRangesModel, fiveNumberSummary, percentile, rangePeriodStyle, sampleLabel
} from '../../web/js/charts/yk-ranges.js';
import { formatValue } from '../../web/js/charts/formatters.js';
import {
  BASELINE, BINS, boxRows, boxSpec, dotsRows, dotsSpec, histogramRows, histogramSpec, stripRows, stripSpec, stripSample
} from '../gallery/fixture-ranges.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

test('the five-number summary interpolates and carries p95', () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.75), 4);
  assert.ok(Math.abs(percentile([1, 2, 3, 4, 5], 0.95) - 4.8) < 1e-9);
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(fiveNumberSummary([1, 2, 3, 4, 5]), { min: 1, q1: 2, median: 3, q3: 4, max: 5, p95: 4.8 });
});

test('the box model keeps every summary, n, unpriced and the baseline out of the marks', () => {
  const model = buildRangesModel({ spec: boxSpec(), data: boxRows() });
  assert.equal(model.state, 'ready');
  assert.deepEqual(model.baseline, BASELINE);
  assert.equal(model.rows.length, boxRows().length);
  for (const [index, row] of boxRows().entries()) {
    for (const field of SUMMARY_FIELDS) assert.equal(model.rows[index].summary[field.key], row.values[field.key]);
    assert.equal(model.rows[index].values.n, row.n);
    assert.equal(model.rows[index].values.unpriced, row.unpriced);
  }
  assert.ok(!model.rows.some(row => row.key === 'baseline'));
  assert.ok(model.tableSeries.some(item => item.key === 'n'));
  assert.ok(model.tableSeries.some(item => item.key === 'unpriced'));
});

test('the histogram model follows the fixed bins and zero-fills missing counts', () => {
  const model = buildRangesModel({ spec: histogramSpec(), data: histogramRows().slice(0, 2) });
  assert.equal(model.state, 'ready');
  assert.equal(model.rows.length, BINS.length);
  for (const [index, bin] of BINS.entries()) {
    assert.equal(model.rows[index].values.binFrom, bin.from);
    assert.equal(model.rows[index].values.binTo, bin.to);
  }
  assert.equal(model.rows[0].values.calls, 18);
  assert.equal(model.rows[1].values.calls, 42);
  assert.equal(model.rows[2].values.calls, 0);
  assert.equal(model.rows[3].values.calls, 0);
});

test('strip marks carry the sampled flag and label the sample size', () => {
  assert.equal(sampleLabel(stripSample()), 'sample of 6 of 24');
  assert.equal(sampleLabel(null), '');
  const model = buildRangesModel({ spec: stripSpec(), data: stripRows() });
  assert.equal(model.state, 'ready');
  assert.equal(model.rows.length, stripRows().length);
  const sampled = model.rows.filter(row => row.values.sampled);
  assert.equal(sampled.length, 6);
  assert.ok(model.rows.every(row => typeof row.values.sampled === 'boolean'));
  const table = model.tableRows.find(row => row.key === 'model:atlas');
  assert.equal(table.values.sampled, 'sampled');
});

test('dots aggregate duplicate keys into one dot per category', () => {
  const aggregated = aggregateDots([
    { key: 'a', values: { m: 1 }, n: 2 },
    { key: 'a', values: { m: 3 }, n: 4 },
    { key: 'b', values: { m: 5 } }
  ], 'm');
  assert.deepEqual(aggregated.map(row => row.key), ['a', 'b']);
  assert.equal(aggregated[0].values.m, 4);
  assert.equal(aggregated[0].n, 6);
  assert.equal(aggregated[1].values.m, 5);
  const model = buildRangesModel({ spec: dotsSpec(), data: dotsRows() });
  assert.equal(model.state, 'ready');
  assert.equal(model.rows.length, dotsRows().length);
});

test('the previous range row is dashed and outlined while current stays solid', () => {
  assert.deepEqual(rangePeriodStyle('current'), { previous: false, dash: null, fillOpacity: 0.35 });
  assert.deepEqual(rangePeriodStyle('previous'), { previous: true, dash: '6 4', fillOpacity: 0 });
  assert.equal(rangePeriodStyle('').previous, false, 'a single-mode row is current');
  assert.equal(rangePeriodStyle('Cohort A').previous, false, 'cohort A is the current side of a cohort compare');
  assert.equal(rangePeriodStyle('Cohort B').previous, true);
});

test('the ranges gallery proves every mode, table, interaction and both themes in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 3000 }, hasTouch: true });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/ranges.html`);
    await waitForSettled(page);

    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        chart: result.chart,
        hostChart: element.dataset.chart,
        state: element.dataset.state,
        type: result.type,
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
        width: rect.width,
        height: rect.height
      };
    }, [id, key]);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      text: document.getElementById('event-log').textContent
    }));

    assert.equal((await inspect('ranges-box')).state, 'ready');
    assert.equal((await inspect('ranges-histogram')).state, 'ready');
    assert.equal((await inspect('ranges-strip')).state, 'ready');
    assert.equal((await inspect('ranges-dots')).state, 'ready');
    assert.equal((await inspect('ranges-empty')).state, 'empty');
    assert.equal((await inspect('ranges-unsupported')).state, 'unsupported');

    const box = await inspect('ranges-box');
    assert.equal(box.hostChart, 'ranges');
    assert.equal(box.type, 'box');
    assert.equal(box.brush, null);
    assert.deepEqual(box.categories, boxRows().map(row => row.key));
    assert.equal(box.marks.length, boxRows().length);
    for (const [index, row] of boxRows().entries()) {
      assert.equal(box.marks[index].key, row.key);
      for (const field of SUMMARY_FIELDS) assert.equal(box.marks[index].values[field.key], row.values[field.key]);
      assert.equal(box.marks[index].values.n, row.n);
    }
    const boxTable = await tableRows('ranges-box');
    for (const [index, row] of boxRows().entries()) {
      const expected = [
        ...SUMMARY_FIELDS.map(field => formatValue(row.values[field.key], { kind: 'money', unit: 'USD' })),
        formatValue(row.n, { kind: 'count' }),
        formatValue(row.unpriced, { kind: 'count' })
      ];
      assert.deepEqual(boxTable[index].values, expected);
    }
    const baseline = await page.evaluate(() => {
      const root = document.getElementById('ranges-box').shadowRoot;
      const band = root.querySelector('[data-baseline]');
      return {
        found: Boolean(band),
        label: root.querySelector('.yk-range-baseline-label')?.textContent,
        markKeys: [...root.querySelectorAll('[data-mark]')].map(mark => mark.dataset.entityKey)
      };
    });
    assert.equal(baseline.found, true);
    assert.match(baseline.label, new RegExp(BASELINE.label));
    assert.ok(!baseline.markKeys.includes('baseline'));
    assert.ok(box.marks.every(mark => mark.key !== 'baseline'));

    const histogram = await inspect('ranges-histogram');
    assert.equal(histogram.type, 'histogram');
    assert.equal(histogram.brush, null);
    assert.equal(histogram.yScale.min, 0, 'histogram counts are zero-based');
    assert.equal(histogram.marks.length, BINS.length);
    for (const [index, bin] of BINS.entries()) {
      assert.equal(histogram.marks[index].values.binFrom, bin.from);
      assert.equal(histogram.marks[index].values.binTo, bin.to);
      assert.equal(histogram.marks[index].values.calls, histogramRows()[index].values.calls);
    }
    const histogramTable = await tableRows('ranges-histogram');
    assert.match(histogramTable[0].x, /0–10/);
    assert.equal(histogramTable[0].values[0], formatValue(18, { kind: 'count' }));

    const strip = await inspect('ranges-strip');
    assert.equal(strip.type, 'strip');
    assert.equal(strip.brush, null);
    assert.equal(strip.marks.length, stripRows().length);
    assert.equal(strip.marks.filter(mark => mark.values.sampled).length, 6);
    const stripLabels = await page.evaluate(() => {
      const root = document.getElementById('ranges-strip').shadowRoot;
      return [...root.querySelectorAll('[data-mark]')].map(mark => ({ sampled: mark.querySelectorAll('circle[stroke-dasharray]').length > 0, label: mark.getAttribute('aria-label') }));
    });
    for (const item of stripLabels) {
      if (item.sampled) assert.match(item.label, /sample of 6 of 24/);
      else assert.doesNotMatch(item.label, /sample of/);
    }

    const dots = await inspect('ranges-dots');
    assert.equal(dots.type, 'dots');
    assert.equal(dots.brush, null);
    assert.equal(dots.marks.length, dotsRows().length);
    for (const [index, row] of dotsRows().entries()) {
      assert.equal(dots.marks[index].key, row.key);
      assert.equal(dots.marks[index].values.tokens, row.values.tokens);
    }
    const dotsTable = await tableRows('ranges-dots');
    assert.deepEqual(dotsTable.map(row => row.values[0]), dotsRows().map(row => formatValue(row.values.tokens, { kind: 'count' })));

    await page.evaluate(() => document.getElementById('ranges-box').scrollIntoView({ block: 'center' }));
    const firstKey = boxRows()[0].key;
    const point = await markPoint('ranges-box', firstKey);
    await page.mouse.move(point.x, point.y);
    const hovered = await inspect('ranges-box');
    assert.equal(hovered.cursor.key, firstKey);
    assert.equal(hovered.highlight, firstKey);
    const tooltip = await page.locator('yk-ranges#ranges-box .yk-tooltip').evaluate(element => ({ key: element.dataset.entityKey, text: element.textContent }));
    assert.equal(tooltip.key, firstKey);
    assert.match(tooltip.text, /Median/);
    assert.match(tooltip.text, /p95/);
    assert.match(tooltip.text, /Unpriced/);

    await page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('[data-mark="0"]').focus(), 'ranges-box');
    const focused = await inspect('ranges-box');
    assert.equal(focused.highlight, firstKey);
    assert.equal(focused.inspectedKey, firstKey);

    await page.mouse.click(point.x, point.y);
    let event = await lastEvent();
    assert.equal(event.name, 'inspect');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).key, firstKey);

    await focusRoot('ranges-box');
    await page.keyboard.press('Enter');
    event = await lastEvent();
    assert.equal(event.name, 'inspect');

    await page.keyboard.press(' ');
    let selection = await inspect('ranges-box');
    assert.deepEqual(selection.selection.include, [firstKey]);
    await page.keyboard.press(' ');
    selection = await inspect('ranges-box');
    assert.equal(selection.selection, null);

    const secondKey = boxRows()[1].key;
    const secondPoint = await markPoint('ranges-box', secondKey);
    await page.keyboard.down('Shift');
    await page.mouse.click(secondPoint.x, secondPoint.y);
    await page.keyboard.up('Shift');
    selection = await inspect('ranges-box');
    assert.deepEqual(selection.selection.include, [secondKey]);

    await page.mouse.click(point.x, point.y);
    await focusRoot('ranges-box');
    await page.keyboard.press('x');
    selection = await inspect('ranges-box');
    assert.ok(selection.selection.exclude.includes(firstKey));

    const thirdKey = boxRows()[2].key;
    const thirdPoint = await markPoint('ranges-box', thirdKey);
    await page.keyboard.down('Alt');
    await page.mouse.click(thirdPoint.x, thirdPoint.y);
    await page.keyboard.up('Alt');
    selection = await inspect('ranges-box');
    assert.ok(selection.selection.exclude.includes(thirdKey));

    await page.locator('yk-ranges#ranges-box .yk-table-select').nth(0).check();
    selection = await inspect('ranges-box');
    assert.ok(selection.selection.include.includes(firstKey));

    await page.evaluate(() => document.getElementById('ranges-box').scrollIntoView({ block: 'center' }));
    await page.mouse.click(point.x, point.y);
    await focusRoot('ranges-box');
    await page.keyboard.press('o');
    event = await lastEvent();
    assert.equal(event.name, 'open');
    await page.keyboard.press('f');
    event = await lastEvent();
    assert.equal(event.name, 'filter');
    await page.keyboard.press('c');
    await page.keyboard.press('b');
    event = await lastEvent();
    assert.equal(event.name, 'cohort');
    assert.equal(JSON.parse(event.text.slice(event.text.indexOf(' ') + 1)).slot, 'b');
    await page.keyboard.press(' ');
    await page.keyboard.press('Escape');
    selection = await inspect('ranges-box');
    assert.equal(selection.selection, null);

    const touchPoint = await markPoint('ranges-box', boxRows()[3].key);
    assert.ok(touchPoint.width >= 44 && touchPoint.height >= 44);
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tapped = await inspect('ranges-box');
    assert.equal(tapped.inspectedKey, boxRows()[3].key);

    const light = await page.evaluate(() => {
      const element = document.getElementById('ranges-box');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-mark-shape')?.getAttribute('fill') };
    });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.waitForFunction(() => {
      const element = document.getElementById('ranges-box');
      return element?.dataset.theme === 'dark' && element.dataset.state === 'ready';
    });
    const dark = await page.evaluate(() => {
      const element = document.getElementById('ranges-box');
      const result = element.inspect();
      const index = result.marks.findIndex(mark => mark.key === 'model:atlas');
      const group = element.shadowRoot.querySelector(`[data-mark="${index}"]`);
      return { style: result.marks[index].style, fill: group.querySelector('.yk-mark-shape')?.getAttribute('fill') };
    });
    assert.deepEqual(dark.style, light.style);
    assert.notEqual(dark.fill, light.fill);

    const motion = await page.evaluate(() => {
      const root = document.getElementById('ranges-box').shadowRoot;
      const plot = getComputedStyle(root.querySelector('.yk-svg-plot'));
      const mark = getComputedStyle(root.querySelector('.yk-mark-shape'));
      return { plotAnimation: plot.animationName, plotTransition: plot.transitionDuration, markAnimation: mark.animationName };
    });
    assert.equal(motion.plotAnimation, 'none');
    assert.equal(motion.plotTransition, '0s');
    assert.equal(motion.markAnimation, 'none');

    const brushStates = await page.evaluate(() => ['ranges-box', 'ranges-histogram', 'ranges-strip', 'ranges-dots']
      .map(id => document.getElementById(id).inspect().brush));
    assert.deepEqual(brushStates, [null, null, null, null]);
    assert.notEqual((await lastEvent()).name, 'brush');

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
