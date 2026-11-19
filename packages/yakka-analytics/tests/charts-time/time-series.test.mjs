import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseSpec, stackBands, transformSeriesData
} from '../../web/js/charts/series.js';
import {
  buildScales, dataToPx, pxToData, scaleGroupKey, xToPx, yToPx
} from '../../web/js/charts/scales.js';
import { thresholdModel, thresholdValueText } from '../../web/js/charts/thresholds.js';
import { formatCount, formatValue } from '../../web/js/charts/formatters.js';
import { SERIES, timeSeries } from '../gallery/fixture.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

const SPEC = {
  x: { label: 'Day', kind: 'time' },
  series: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]
};
const DATA = [
  { key: 'day:0', x: 0, values: { a: 1, b: 3 } },
  { key: 'day:1', x: 1, values: { a: 2, b: 2 } },
  { key: 'day:2', x: 2, values: { a: null, b: 4 } }
];

test('absolute mode keeps values and never invents a missing point', () => {
  const result = transformSeriesData({ spec: SPEC, data: DATA });
  assert.equal(result.mode, 'absolute');
  assert.equal(result.type, 'line');
  assert.deepEqual(result.rows.map(row => row.values.a), [1, 2, null]);
  assert.deepEqual(result.tableRows.map(row => row.values.b), [3, 2, 4]);
  assert.deepEqual(result.bands, []);
});

test('cumulative mode is a running sum per series and skips missing points', () => {
  const result = transformSeriesData({ spec: { ...SPEC, mode: 'cumulative' }, data: DATA });
  assert.equal(result.mode, 'cumulative');
  assert.deepEqual(result.rows.map(row => row.values.a), [1, 3, null]);
  assert.deepEqual(result.tableRows.map(row => row.values.b), [3, 5, 9]);
});

test('share mode is per-bucket 100 percent and formats as a percentage', () => {
  const result = transformSeriesData({ spec: { ...SPEC, mode: 'share' }, data: DATA });
  assert.equal(result.mode, 'share');
  const first = result.rows[0].values;
  assert.equal(first.a, 0.25);
  assert.equal(first.b, 0.75);
  assert.equal(first.a + first.b, 1);
  assert.deepEqual(result.rows.map(row => row.values.a), [0.25, 0.5, null]);
  assert.deepEqual(result.tableRows.map(row => row.values.b), [0.75, 0.5, 1]);
  assert.equal(result.spec.series[0].kind, 'percent');
  assert.equal(formatValue(result.tableRows[0].values.a, { kind: 'percent' }), '25%');
});

test('stacked columns cumulate plot values, keep slice values in the table and band series in order', () => {
  const result = transformSeriesData({ spec: { ...SPEC, type: 'columns' }, data: DATA });
  assert.equal(result.type, 'columns');
  assert.equal(result.stacked, true);
  assert.deepEqual(result.rows.map(row => row.values.a), [1, 2, null]);
  assert.deepEqual(result.rows.map(row => row.values.b), [4, 4, 4]);
  assert.deepEqual(result.tableRows.map(row => row.values.a), [1, 2, null]);
  assert.deepEqual(result.tableRows.map(row => row.values.b), [3, 2, 4]);
  assert.deepEqual(result.bands, [{ series: [2, 1] }]);
  assert.deepEqual(stackBands(4), [{ series: [2, 1] }, { series: [3, 2] }, { series: [4, 3] }]);
  assert.deepEqual(stackBands(1), []);
});

test('normaliseSpec defaults mode and type and keeps stable series order and keys', () => {
  const spec = normaliseSpec({ series: [{ key: 'z' }, { key: 'a', label: 'A' }], mode: 'nope', type: 'nope' });
  assert.equal(spec.mode, 'absolute');
  assert.equal(spec.type, 'line');
  assert.deepEqual(spec.series.map(item => item.key), ['z', 'a']);
  assert.equal(spec.series[0].label, 'z');
});

test('scales give one time or numeric x scale, one y scale and a zero-based y for columns', () => {
  const time = buildScales({ x: { kind: 'time' } });
  assert.equal(time.x.time, true);
  assert.deepEqual(Object.keys(time), ['x', 'y']);
  const numeric = buildScales({ x: { kind: 'number' } });
  assert.equal(numeric.x.time, false);

  const column = buildScales({ x: { kind: 'time' } }, { zeroBased: true });
  assert.deepEqual(column.y.range(null, 5, 10), [0, 10]);
  assert.deepEqual(column.y.range(null, -3, 4), [-3, 4]);
  assert.equal(buildScales({}, { zeroBased: false }).y.range, undefined);

  assert.equal(scaleGroupKey({ scaleGroup: 'paired-days' }), 'paired-days');
  assert.equal(scaleGroupKey({}), null);
});

test('pixel and data conversions are inverse and plot-relative', () => {
  assert.equal(dataToPx(5, { min: 0, max: 10, size: 100 }), 50);
  assert.equal(dataToPx(5, { min: 0, max: 10, size: 100, invert: true }), 50);
  assert.equal(pxToData(50, { min: 0, max: 10, size: 100 }), 5);
  assert.equal(xToPx(5, { min: 0, max: 10, width: 100 }), 50);
  assert.equal(yToPx(10, { min: 0, max: 10, height: 100 }), 0);
  assert.equal(yToPx(0, { min: 0, max: 10, height: 100 }), 100);
});

test('threshold model normalises lines and bands and never becomes a mark', () => {
  const model = thresholdModel({
    thresholds: [
      { key: 't1', label: 'Target', tone: 'good', value: 80 },
      { label: 'Band', tone: 'nope', from: 60, to: 50, unit: 'events' }
    ]
  });
  assert.equal(model.length, 2);
  assert.deepEqual(
    { key: model[0].key, label: model[0].label, tone: model[0].tone, value: model[0].value },
    { key: 't1', label: 'Target', tone: 'good', value: 80 }
  );
  assert.equal(model[1].tone, 'info');
  assert.equal(model[1].from, 50);
  assert.equal(model[1].to, 60);
  assert.equal(thresholdValueText(model[1]), '50–60 events');
});

test('time-series gallery proves modes, inspect, scale groups, thresholds and states in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/time-series.html`);
    await waitForSettled(page);

    const rows = timeSeries({ points: 60 });
    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        chart: result.chart,
        state: element.dataset.state,
        hostChart: element.dataset.chart,
        mode: result.mode,
        type: result.type,
        stacked: result.stacked,
        bucket: result.bucket,
        window: result.window,
        selection: result.selection,
        series: result.series,
        plot: result.plot,
        xScale: result.xScale,
        yScale: result.yScale,
        yScales: result.yScales,
        dualAxis: result.dualAxis,
        cursor: result.cursor,
        marks: result.marks,
        thresholds: result.thresholds
      };
    }, id);
    const geometry = (id, index = 10) => page.evaluate(([chartId, rowIndex]) => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      const row = window.__timeSeries.rows[rowIndex];
      return {
        plot: result.plot,
        px: result.xToPx(row.x),
        dataX: result.xToData(result.xToPx(row.x)),
        yTop: result.yToPx(result.yScale.max),
        yBottom: result.yToPx(result.yScale.min)
      };
    }, [id, index]);

    for (const id of ['line', 'area', 'columns', 'cumulative', 'share', 'sync-a', 'sync-b', 'thresholds']) {
      assert.equal((await inspect(id)).state, 'ready', `${id} is ready`);
    }
    assert.equal((await inspect('empty')).state, 'empty');
    assert.equal((await inspect('unsupported')).state, 'unsupported');

    const line = await inspect('line');
    assert.equal(line.hostChart, 'line');
    assert.equal(line.mode, 'absolute');
    assert.equal(line.type, 'line');
    assert.equal(line.bucket, 'day');
    assert.equal(line.series.length, 4);
    assert.ok(line.series.every(item => item.visible));
    assert.equal(line.selection, null);
    assert.ok(line.window.from < line.window.to);
    assert.ok(line.plot.width > 0 && line.plot.height > 0);
    assert.equal(line.marks.length, rows.length);
    assert.deepEqual(line.yScales, ['y']);
    assert.equal(line.dualAxis, false);

    const lineGeometry = await geometry('line');
    assert.ok(Math.abs(lineGeometry.dataX - rows[10].x) < 1);
    assert.ok(lineGeometry.yTop >= 0 && lineGeometry.yTop <= lineGeometry.plot.height);
    assert.ok(lineGeometry.yBottom >= 0 && lineGeometry.yBottom <= lineGeometry.plot.height);

    await page.mouse.move(
      lineGeometry.plot.left + lineGeometry.px,
      lineGeometry.plot.top + lineGeometry.plot.height / 2
    );
    const hovered = await inspect('line');
    assert.ok(hovered.cursor, 'cursor present after a real mouse move');
    assert.equal(hovered.cursor.idx, 10);
    assert.equal(hovered.cursor.x, rows[10].x);
    assert.ok(hovered.cursor.left >= 0);
    assert.equal(hovered.cursor.values['model:atlas'], rows[10].values['model:atlas']);

    const toolbar = await page.locator('yk-chart#line .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(toolbar.key, rows[10].key);
    assert.match(toolbar.text, /model:atlas|Atlas/);

    const columnRows = await page.evaluate(() => {
      const root = document.getElementById('columns').shadowRoot;
      return [...root.querySelectorAll('.yk-table tbody tr')].slice(0, 3).map(row => ({
        key: row.dataset.entityKey,
        values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
      }));
    });
    assert.deepEqual(columnRows[0].values, SERIES.map(series => formatCount(rows[0].values[series.key])));
    const columns = await inspect('columns');
    assert.equal(columns.type, 'columns');
    assert.equal(columns.stacked, true);
    assert.equal(columns.yScale.min, 0, 'stacked columns are zero-based');

    const cumulativeRows = await page.evaluate(() => {
      const root = document.getElementById('cumulative').shadowRoot;
      return [...root.querySelectorAll('.yk-table tbody tr')].slice(0, 2).map(row => ({
        values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
      }));
    });
    const cumulativeExpected = SERIES.map(series => formatCount(rows[0].values[series.key] + rows[1].values[series.key]));
    assert.deepEqual(cumulativeRows[1].values, cumulativeExpected);
    assert.equal((await inspect('cumulative')).mode, 'cumulative');

    const shareRows = await page.evaluate(() => {
      const root = document.getElementById('share').shadowRoot;
      return [...root.querySelectorAll('.yk-table tbody tr')].slice(0, 2).map(row => ({
        values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
      }));
    });
    const bucket = rows[0].values;
    const total = SERIES.reduce((sum, series) => sum + bucket[series.key], 0);
    const shareExpected = SERIES.map(series => formatValue(bucket[series.key] / total, { kind: 'percent' }));
    assert.deepEqual(shareRows[0].values, shareExpected);
    assert.equal((await inspect('share')).mode, 'share');
    assert.equal((await inspect('area')).type, 'area');

    await page.evaluate(() => document.getElementById('sync-a').shadowRoot.querySelector('.u-over').scrollIntoView({ block: 'center' }));
    const syncGeometry = await geometry('sync-a', 20);
    await page.mouse.move(
      syncGeometry.plot.left + syncGeometry.px,
      syncGeometry.plot.top + syncGeometry.plot.height / 2
    );
    const syncA = await inspect('sync-a');
    const syncB = await inspect('sync-b');
    assert.equal(syncA.cursor.idx, 20);
    assert.equal(syncB.cursor.idx, 20);
    assert.equal(syncB.cursor.x, syncA.cursor.x);
    assert.deepEqual(syncB.yScales, ['y']);
    assert.equal(syncB.dualAxis, false);
    assert.equal(syncB.series.length, 1);
    const lineAfter = await inspect('line');
    assert.notEqual(lineAfter.cursor.x, syncA.cursor.x, 'a chart outside the group does not follow');

    const threshold = await inspect('thresholds');
    assert.equal(threshold.thresholds.length, 2);
    assert.equal(threshold.thresholds[0].label, 'Target events');
    assert.ok(threshold.marks.every(mark => !mark.key.startsWith('threshold:')));
    const thresholdTable = await page.evaluate(() => {
      const root = document.getElementById('thresholds').shadowRoot;
      return {
        drawn: root.querySelector('.uplot')?.dataset.thresholds,
        text: root.querySelector('table')?.textContent || ''
      };
    });
    assert.equal(thresholdTable.drawn, '2');
    assert.match(thresholdTable.text, /Target events/);
    assert.match(thresholdTable.text, /Watch band/);

    const empty = await page.evaluate(() => document.getElementById('empty').shadowRoot.textContent);
    assert.match(empty, /Empty:/);
    assert.match(empty, /filters: model:beacon/);
    const unsupported = await page.evaluate(() => document.getElementById('unsupported').shadowRoot.textContent);
    assert.match(unsupported, /Unsupported:/);
    assert.match(unsupported, /grain quarter is not joinable/);

    const motion = await page.locator('yk-chart#line .yk-chart').evaluate(element => {
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
