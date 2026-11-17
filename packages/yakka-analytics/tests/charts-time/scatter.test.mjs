import test from 'node:test';
import assert from 'node:assert/strict';

import { SCATTER_BUDGET, scatterPoints } from '../gallery/fixture.js';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { SKIP_REASON, launchBrowser, loadBrowserEnvironment } from './browser.mjs';

// Independent references: plain linear scans written here, importing neither
// hit-test.js nor any production chart module. They consume only the marks and
// coordinates the documented `inspect()` surface exposes.

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

function referenceEcdf(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return x => {
    let count = 0;
    while (count < sorted.length && sorted[count] <= x) count += 1;
    return count / sorted.length;
  };
}

test('the independent nearest reference breaks exact ties by entity key', () => {
  const marks = [
    { key: 'b', px: 0, py: 0 },
    { key: 'a', px: 10, py: 0 }
  ];
  assert.equal(referenceNearest(marks, 5, 0), 'a');
  assert.equal(referenceNearest(marks, 0, 0), 'b');
  assert.deepEqual(referenceInRect(marks, { left: -1, right: 6, top: -1, bottom: 1 }), ['b']);
});

test('scatter and ECDF gallery prove the 5,000-point contract in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) {
    t.skip(environment.reason || SKIP_REASON);
    return;
  }
  const harness = await startGalleryHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 3200 } });
    const diagnostics = await watchPage(page);
    await page.goto(`${harness.origin}/gallery/scatter.html`);
    await waitForSettled(page);

    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        state: element.dataset.state,
        type: result.type,
        window: result.window,
        selection: result.selection,
        selectionKeys: result.selectionKeys,
        region: result.region,
        inspectedKey: result.inspectedKey,
        inspectedIndex: result.inspectedIndex,
        cursor: result.cursor,
        plot: result.plot,
        xScale: result.xScale,
        yScale: result.yScale,
        xToPx: null,
        marks: result.marks,
        groups: result.series.map(item => item.key),
        sampledMarkCount: result.sampledMarkCount,
        urlState: result.urlState
      };
    }, id);

    const scatter = await inspect('scatter');
    assert.equal(scatter.state, 'ready');
    assert.equal(scatter.type, 'scatter');
    assert.equal(scatter.marks.length, SCATTER_BUDGET);
    assert.equal(scatter.sampledMarkCount, scatterPoints().filter(point => point.sampled).length);
    assert.ok(scatter.plot.width > 0 && scatter.plot.height > 0);
    assert.deepEqual(scatter.groups, ['cohort:alpha', 'model:atlas']);
    assert.ok(scatter.marks.every(mark => mark.sampled === true || mark.sampled === false));
    assert.ok(scatter.marks.some(mark => mark.sampled === true));
    assert.ok(scatter.marks.some(mark => mark.sampled === false));
    assert.ok(new Set(scatter.marks.map(mark => mark.shape)).size > 1, 'shape comes from the spec');
    assert.ok(new Set(scatter.marks.map(mark => mark.colour)).size > 1, 'colour comes from the spec');
    assert.ok(Math.max(...scatter.marks.map(mark => mark.size)) > Math.min(...scatter.marks.map(mark => mark.size)), 'size comes from the spec');
    assert.ok(Math.abs(scatter.xScale.min) < Math.abs(scatter.xScale.max));

    const shell = await page.evaluate(() => {
      const root = document.getElementById('scatter').shadowRoot;
      return {
        canvases: root.querySelectorAll('.yk-scatter-canvas').length,
        uplot: Boolean(root.querySelector('.uplot')),
        markNodes: root.querySelectorAll('[data-mark]').length,
        animation: getComputedStyle(root.querySelector('.yk-scatter-stack')).animationName,
        transition: getComputedStyle(root.querySelector('.yk-scatter-stack')).transitionDuration
      };
    });
    assert.equal(shell.canvases, 2, 'the declared first-party canvas fallback renders the marks');
    assert.equal(shell.uplot, false, 'scatter does not use a uPlot plot area');
    assert.equal(shell.markNodes, 0, 'no per-point DOM');
    assert.equal(shell.animation, 'none');
    assert.equal(shell.transition, '0s');

    // Hover at a real mark's coordinates, compared with the linear scan.
    await page.locator('yk-chart#scatter .yk-scatter-overlay').scrollIntoViewIfNeeded();
    const live = await inspect('scatter');
    const target = live.marks.reduce((best, mark) => {
      const nearestOther = live.marks.reduce((distance, other) => (
        other === mark ? distance : Math.min(distance, Math.hypot(other.px - mark.px, other.py - mark.py))
      ), Infinity);
      return nearestOther > best.spacing ? { mark, spacing: nearestOther } : best;
    }, { mark: live.marks[0], spacing: -1 }).mark;
    assert.ok(target, 'a mark with a stable neighbourhood exists');
    const query = { px: target.px, py: target.py };
    const expectedNearest = referenceNearest(live.marks, query.px, query.py);
    const expectedMark = live.marks.find(mark => mark.key === expectedNearest);
    await page.mouse.move(live.plot.left + query.px, live.plot.top + query.py);
    const hovered = await inspect('scatter');
    assert.equal(hovered.inspectedKey, expectedNearest);
    assert.ok(hovered.cursor);
    assert.equal(hovered.cursor.idx, expectedMark.index);
    assert.equal(hovered.cursor.x, expectedMark.x);
    assert.equal(hovered.cursor.values.y, expectedMark.y);

    const tooltip = await page.locator('yk-chart#scatter .yk-tooltip').evaluate(element => ({
      key: element.dataset.entityKey,
      text: element.textContent
    }));
    assert.equal(tooltip.key, expectedNearest);
    assert.match(tooltip.text, /Artifacts/);

    // Rectangle membership matches the linear scan exactly.
    await page.evaluate(() => {
      window.__scatterSelectionEvents = [];
      const element = document.getElementById('scatter');
      element.addEventListener('select', event => window.__scatterSelectionEvents.push(event.detail));
    });
    const drag = async (bounds, modifiers = []) => {
      const chart = await inspect('scatter');
      const x0 = chart.plot.left + bounds.left;
      const y0 = chart.plot.top + bounds.top;
      const x1 = chart.plot.left + bounds.right;
      const y1 = chart.plot.top + bounds.bottom;
      for (const key of modifiers) await page.keyboard.down(key);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 8 });
      await page.mouse.up();
      for (const key of modifiers) await page.keyboard.up(key);
      return inspect('scatter');
    };

    const firstBounds = { left: 60, right: 300, top: 40, bottom: 180 };
    const firstKeys = referenceInRect(live.marks, firstBounds);
    assert.ok(firstKeys.length > 5, `expected several points in the region, got ${firstKeys.length}`);
    const first = await drag(firstBounds);
    assert.deepEqual(first.selectionKeys, firstKeys);
    assert.deepEqual(first.selection.include, firstKeys);
    assert.deepEqual(first.selection.exclude, []);
    assert.ok(first.selection.where, 'the predicate carries the data-space rectangle');
    assert.ok(first.selection.where.x.min < first.selection.where.x.max);
    assert.ok(first.selection.where.y.min < first.selection.where.y.max);

    const secondBounds = { left: 330, right: 520, top: 60, bottom: 200 };
    const secondKeys = referenceInRect(live.marks, secondBounds);
    const union = [...new Set([...firstKeys, ...secondKeys])].sort();
    const added = await drag(secondBounds, ['Shift']);
    assert.deepEqual(added.selectionKeys, union, 'Shift-drag adds the rectangle');
    assert.deepEqual(added.selection.exclude, []);

    const subtractBounds = { left: firstBounds.left, right: (firstBounds.left + firstBounds.right) / 2, top: firstBounds.top, bottom: firstBounds.bottom };
    const subtractKeys = referenceInRect(live.marks, subtractBounds);
    assert.ok(subtractKeys.length > 0 && subtractKeys.length < firstKeys.length);
    const subtracted = await drag(subtractBounds, ['Alt']);
    const expectedInclude = union.filter(key => !subtractKeys.includes(key));
    assert.deepEqual(subtracted.selection.exclude, subtractKeys.sort());
    assert.deepEqual(subtracted.selection.include, expectedInclude);

    const emitted = await page.evaluate(() => window.__scatterSelectionEvents);
    assert.ok(emitted.length >= 3);
    const last = emitted[emitted.length - 1];
    assert.equal(last.source, 'scatter-rectangle');
    assert.ok(last.selection && last.selection.where);
    assert.deepEqual(last.keys.slice().sort(), [...last.selection.include, ...last.selection.exclude].sort());

    // Tie and duplicate-key cases on a purpose-built chart.
    await page.evaluate(() => {
      const element = document.createElement('yk-chart');
      element.id = 'scatter-ties';
      element.spec = {
        chart: 'scatter',
        title: 'Tie and duplicate keys',
        x: { label: 'X', kind: 'number' },
        y: { label: 'Y', kind: 'number' }
      };
      element.data = [
        { key: 'b', x: 0, y: 5 },
        { key: 'a', x: 10, y: 5 }
      ];
      element.style.width = '480px';
      document.body.append(element);
      window.__tieElement = element;
      return element.whenSettled();
    });
    await page.locator('yk-chart#scatter-ties .yk-scatter-overlay').scrollIntoViewIfNeeded();
    const ties = await page.evaluate(() => {
      const element = document.getElementById('scatter-ties');
      const result = element.inspect();
      const byKey = key => result.marks.find(mark => mark.key === key);
      return {
        state: element.dataset.state,
        plot: result.plot,
        a: byKey('a'),
        b: byKey('b'),
        dup: result.marks.filter(mark => mark.key === 'dup')
      };
    });
    assert.equal(ties.state, 'ready');
    const mid = { px: (ties.a.px + ties.b.px) / 2, py: (ties.a.py + ties.b.py) / 2 };
    await page.mouse.move(ties.plot.left + mid.px, ties.plot.top + mid.py);
    const tied = await page.evaluate(() => document.getElementById('scatter-ties').inspect().inspectedKey);
    assert.equal(tied, referenceNearest([ties.a, ties.b], mid.px, mid.py));
    assert.equal(tied, 'a', 'exact tie breaks by entity key');

    await page.evaluate(() => {
      const element = document.createElement('yk-chart');
      element.id = 'scatter-dups';
      element.spec = {
        chart: 'scatter',
        title: 'Duplicate keys',
        x: { label: 'X', kind: 'number' },
        y: { label: 'Y', kind: 'number' }
      };
      element.data = [
        { key: 'dup', x: 4, y: 4 },
        { key: 'dup', x: 6, y: 6 },
        { key: 'other', x: 1, y: 9 }
      ];
      element.style.width = '480px';
      document.body.append(element);
      return element.whenSettled();
    });
    await page.locator('yk-chart#scatter-dups .yk-scatter-overlay').scrollIntoViewIfNeeded();
    const dups = await page.evaluate(() => {
      const result = document.getElementById('scatter-dups').inspect();
      const dup = result.marks.filter(mark => mark.key === 'dup');
      return {
        plot: result.plot,
        dup,
        bounds: {
          left: Math.min(...dup.map(mark => mark.px)) - 2,
          right: Math.max(...dup.map(mark => mark.px)) + 2,
          top: Math.min(...dup.map(mark => mark.py)) - 2,
          bottom: Math.max(...dup.map(mark => mark.py)) + 2
        }
      };
    });
    await page.mouse.move(dups.plot.left + dups.bounds.left, dups.plot.top + dups.bounds.top);
    await page.mouse.down();
    await page.mouse.move(dups.plot.left + dups.bounds.right, dups.plot.top + dups.bounds.bottom, { steps: 5 });
    await page.mouse.up();
    const dupSelection = await page.evaluate(() => document.getElementById('scatter-dups').inspect());
    assert.deepEqual(dupSelection.selectionKeys, ['dup'], 'duplicate entity keys collapse to one predicate member');

    // ECDF: values and table agree with the sorted input and are monotonic.
    const ecdf = await page.evaluate(() => {
      const element = document.getElementById('ecdf');
      const result = element.inspect();
      const root = element.shadowRoot;
      return {
        state: element.dataset.state,
        type: result.type,
        marks: result.marks,
        uplot: Boolean(root.querySelector('.uplot')),
        table: [...root.querySelectorAll('.yk-table tbody tr')].map(row => ({
          x: row.querySelector('.yk-table-x')?.textContent,
          values: [...row.querySelectorAll('.yk-table-value')].map(cell => cell.textContent)
        }))
      };
    });
    assert.equal(ecdf.state, 'ready');
    assert.equal(ecdf.type, 'ecdf');
    assert.equal(ecdf.uplot, true, 'ECDF is a uPlot step line');
    const ecdfData = await page.evaluate(() => window.__scatter.ecdfData);
    const alphaValues = ecdfData.filter(row => row.group === 'cohort:alpha').map(row => row.x);
    const betaValues = ecdfData.filter(row => row.group === 'cohort:beta').map(row => row.x);
    const alphaAt = referenceEcdf(alphaValues);
    const betaAt = referenceEcdf(betaValues);
    const xs = ecdf.marks.map(mark => mark.x);
    assert.deepEqual(xs, [...new Set([...alphaValues, ...betaValues])].sort((a, b) => a - b));
    let previousAlpha = -1;
    let previousBeta = -1;
    for (const mark of ecdf.marks) {
      assert.ok(Math.abs(mark.values['cohort:alpha'] - alphaAt(mark.x)) < 1e-9);
      assert.ok(Math.abs(mark.values['cohort:beta'] - betaAt(mark.x)) < 1e-9);
      assert.ok(mark.values['cohort:alpha'] >= previousAlpha);
      assert.ok(mark.values['cohort:beta'] >= previousBeta);
      previousAlpha = mark.values['cohort:alpha'];
      previousBeta = mark.values['cohort:beta'];
    }
    assert.equal(ecdf.marks.at(-1).values['cohort:alpha'], 1);
    assert.equal(ecdf.marks.at(-1).values['cohort:beta'], 1);
    assert.equal(ecdf.table.length, ecdf.marks.length);
    assert.equal(ecdf.table[0].x, String(xs[0]));
    assert.ok(ecdf.table.every(row => row.values.every(value => value.endsWith('%'))));
    const lastRow = ecdf.table.at(-1);
    assert.deepEqual(lastRow.values, ['100%', '100%']);
    const alphaColumn = ecdf.table.map(row => Number.parseFloat(row.values[0]));
    assert.ok(alphaColumn.every((value, index) => index === 0 || value >= alphaColumn[index - 1]), 'table values are monotonic');

    const sampleChart = await inspect('scatter-sampled');
    assert.equal(sampleChart.state, 'ready');
    assert.equal(sampleChart.marks.length, sampleChart.sampledMarkCount, 'the sampled chart contains only sampled marks');
    assert.match(await page.evaluate(() => document.getElementById('scatter-sampled').shadowRoot.textContent), /sample of/i);

    assert.ok(harness.stats.maxInFlight <= 4);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
