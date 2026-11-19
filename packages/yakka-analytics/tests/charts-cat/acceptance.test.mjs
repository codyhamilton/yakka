// Phase 8 acceptance across the gallery index and every categorical page. One
// Chromium page visits each gallery in a fixed order so the entity colour
// registry persists in localStorage and cross-engine styles are comparable.
// Values come from the same fixtures the pages render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGalleryHarness, waitForSettled, watchPage } from '../gallery/harness.mjs';
import { launchBrowser, loadBrowserEnvironment, SKIP_REASON } from './browser.mjs';
import { paletteReport, fixedNeutralDistinctness } from '../../web/js/charts/colour-registry.js';
import { formatValue } from '../../web/js/charts/formatters.js';
import {
  rankedOtherTotal, rankedRows, rankedTop, slopeRows, stackedRows
} from '../gallery/fixture-bars.js';
import { boxRows, dotsRows, histogramRows, stripRows } from '../gallery/fixture-ranges.js';
import { calendarRows, heatmapRows } from '../gallery/fixture-matrix.js';
import { ganttRows, timelineRows } from '../gallery/fixture-lanes.js';
import { FIXED_NEUTRAL_KEYS, PARENTS, TAIL_KEYS, treemapRows } from '../gallery/fixture-treemap.js';

const PHASE7 = ['foundations', 'time-series', 'gestures', 'scatter'];
const PHASE8 = ['bars', 'ranges', 'matrix', 'lanes', 'treemap'];
const SHARED = ['model:atlas', 'harness:orca', 'repo:core', 'kind:test'];

function pick(style) {
  return { cssVar: style.cssVar, shape: style.shape, pattern: style.pattern ?? null };
}

test('the committed palette has no failures and six distinct fixed neutrals in both themes', () => {
  const report = paletteReport();
  assert.deepEqual(report.failures, []);
  assert.ok(report.themes.light && report.themes.dark);
  assert.equal(fixedNeutralDistinctness(), true);
});

test('every Phase 8 page proves the phase outcome in Chromium', async t => {
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

    const goto = async path => {
      await page.goto(`${harness.origin}${path}`);
      await waitForSettled(page);
    };
    const inspect = id => page.evaluate(chartId => {
      const element = document.getElementById(chartId);
      const result = element.inspect();
      return {
        state: element.dataset.state,
        chart: element.dataset.chart,
        theme: element.dataset.theme,
        type: result.type,
        plot: result.plot,
        brush: result.brush,
        window: result.window,
        selection: result.selection,
        selectionKeys: result.selectionKeys,
        series: result.series,
        marks: result.marks,
        cursor: result.cursor,
        highlight: result.highlight,
        inspectedKey: result.inspectedKey,
        categories: result.categories,
        hasXToPx: typeof result.xToPx === 'function',
        hasYToPx: typeof result.yToPx === 'function'
      };
    }, id);
    const tableRows = id => page.evaluate(chartId => {
      const root = document.getElementById(chartId).shadowRoot;
      return [...root.querySelectorAll('.yk-table tbody tr')].map(row => ({
        key: row.dataset.entityKey,
        cells: [...row.querySelectorAll('td, th')].map(cell => cell.textContent.trim()).filter(Boolean)
      }));
    }, id);
    const settle = id => page.evaluate(chartId => document.getElementById(chartId).whenSettled(), id);
    const focusRoot = id => page.evaluate(chartId => document.getElementById(chartId).shadowRoot.querySelector('.yk-chart').focus(), id);
    const lastEvent = () => page.evaluate(() => ({
      name: document.getElementById('event-log').dataset.lastEvent,
      text: document.getElementById('event-log').textContent
    }));
    const markPoint = (id, index) => page.evaluate(([chartId, markIndex]) => {
      const element = document.getElementById(chartId);
      const group = element.shadowRoot.querySelector(`[data-mark="${markIndex}"]`);
      const rect = group.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
    }, [id, index]);
    const clickMark = async (id, index, { shift = false, alt = false } = {}) => {
      const point = await markPoint(id, index);
      await page.evaluate(chartId => document.getElementById(chartId).scrollIntoView({ block: 'center' }), id);
      if (shift) await page.keyboard.down('Shift');
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.click(point.x, point.y);
      if (alt) await page.keyboard.up('Alt');
      if (shift) await page.keyboard.up('Shift');
    };
    const selection = async id => (await inspect(id)).selection || { include: [], exclude: [] };

    const ready = async (id, chart) => {
      const result = await inspect(id);
      assert.equal(result.state, 'ready', `${id} is ready`);
      assert.equal(result.chart, chart, `${id} reports data-chart`);
      assert.ok(result.plot.width > 0 && result.plot.height > 0, `${id} has a plot`);
      assert.equal(result.hasXToPx, true, `${id} has xToPx`);
      assert.equal(result.hasYToPx, true, `${id} has yToPx`);
      assert.ok(result.marks.length > 0, `${id} has marks`);
      return result;
    };
    const state = async (id, expected) => {
      const result = await inspect(id);
      assert.equal(result.state, expected, `${id} is ${expected}`);
      assert.equal(result.marks.length, 0);
      return result;
    };
    const assertTable = async (id, expectedRows, expectedValue) => {
      const rows = await tableRows(id);
      assert.equal(rows.length, expectedRows, `${id} table rows`);
      if (expectedValue) assert.ok(rows[0].cells.includes(expectedValue), `${id} shows ${expectedValue}`);
      return rows;
    };
    const proveInteractions = async (id, { index = 0 } = {}) => {
      const info = await inspect(id);
      const first = info.marks[index];
      await clickMark(id, index);
      assert.equal((await lastEvent()).name, 'inspect', `${id} real mark inspects`);
      assert.equal((await inspect(id)).inspectedKey, first.key);
      await focusRoot(id);
      await page.keyboard.press(' ');
      assert.ok((await selection(id)).include.includes(first.key), `${id} Space selects`);

      const otherIndex = info.marks.findIndex((mark, at) => at !== index && mark.key !== first.key);
      assert.ok(otherIndex >= 0, `${id} has a second entity`);
      const otherKey = info.marks[otherIndex].key;
      await clickMark(id, otherIndex, { shift: true });
      assert.ok((await selection(id)).include.includes(otherKey), `${id} Shift-click selects`);
      await focusRoot(id);
      await page.keyboard.press('Escape');
      await page.evaluate(([chartId, key]) => {
        const row = [...document.getElementById(chartId).shadowRoot.querySelectorAll('.yk-table tbody tr')]
          .find(item => item.dataset.entityKey === key);
        row.querySelector('.yk-table-select').click();
      }, [id, first.key]);
      assert.ok((await selection(id)).include.includes(first.key), `${id} checkbox selects`);

      const thirdIndex = info.marks.findIndex((mark, at) => at > otherIndex && mark.key !== first.key && mark.key !== otherKey);
      assert.ok(thirdIndex >= 0, `${id} has a third entity`);
      const thirdKey = info.marks[thirdIndex].key;
      await clickMark(id, thirdIndex, { alt: true });
      assert.ok((await selection(id)).exclude.includes(thirdKey), `${id} Alt-click excludes`);
      await clickMark(id, index);
      await focusRoot(id);
      await page.keyboard.press('x');
      assert.ok((await selection(id)).exclude.includes(first.key), `${id} x excludes`);
    };
    const proveLegend = async (id, { hide, focus, survivor }) => {
      const before = (await inspect(id)).marks.find(mark => mark.key === survivor.key &&
        (survivor.parent === undefined || mark.y === survivor.parent)).style;
      await page.evaluate(chartId => document.getElementById(chartId).scrollIntoView({ block: 'center' }), id);
      await page.locator(`#${id} .yk-legend-item[data-key="${hide}"] .yk-legend-toggle`).click();
      await settle(id);
      const hidden = await inspect(id);
      assert.equal(hidden.series.find(item => item.key === hide).visible, false, `${id} hides ${hide}`);
      const after = hidden.marks.find(mark => mark.key === survivor.key &&
        (survivor.parent === undefined || mark.y === survivor.parent)).style;
      assert.deepEqual(after, before, `${id} does not repaint survivors`);
      await page.locator(`#${id} .yk-legend-item[data-key="${focus}"] .yk-legend-focus`).click();
      assert.equal((await lastEvent()).name, 'legend', `${id} legend focus`);
      await focusRoot(id);
      await page.keyboard.press('f');
      assert.equal((await lastEvent()).name, 'filter', `${id} keyboard filter`);
    };
    const assertMotion = async id => {
      const motion = await page.evaluate(chartId => {
        const root = document.getElementById(chartId).shadowRoot;
        const plot = getComputedStyle(root.querySelector('.yk-svg-plot'));
        const mark = getComputedStyle(root.querySelector('[data-mark]'));
        return { plotAnimation: plot.animationName, plotTransition: plot.transitionDuration, markAnimation: mark.animationName };
      }, id);
      assert.equal(motion.plotAnimation, 'none', `${id} plot animation`);
      assert.equal(motion.plotTransition, '0s', `${id} plot transition`);
      assert.equal(motion.markAnimation, 'none', `${id} mark animation`);
    };
    const assertTargets = async id => {
      const smallest = await page.evaluate(chartId => {
        const rects = [...document.getElementById(chartId).shadowRoot.querySelectorAll('[data-mark]')]
          .map(mark => mark.getBoundingClientRect());
        return Math.min(...rects.map(rect => Math.min(rect.width, rect.height)));
      }, id);
      assert.ok(Math.round(smallest) >= 44, `${id} targets are at least 44 px`);
    };
    const capture = id => page.evaluate(chartId => {
      const result = document.getElementById(chartId).inspect();
      return Object.fromEntries(result.marks.map(mark => [mark.key, mark.style]));
    }, id);
    const legendStyles = id => page.evaluate(chartId => {
      const items = [...document.getElementById(chartId).shadowRoot.querySelectorAll('.yk-legend-item')];
      return Object.fromEntries(items.map(item => {
        const swatch = item.querySelector('.yk-legend-swatch');
        const cssVar = swatch.style.getPropertyValue('--yk-swatch').match(/var\((--[^)]+)\)/)?.[1] ?? null;
        return [item.dataset.key, { cssVar, shape: swatch.dataset.shape, pattern: swatch.dataset.pattern || null }];
      }));
    }, id);

    await t.test('the index links every Phase 7 and Phase 8 case and reports its state', async () => {
      await goto('/gallery/index.html');
      const links = await page.evaluate(() => [...document.querySelectorAll('#gallery-links a')].map(link => ({
        case: link.dataset.case,
        href: link.getAttribute('href')
      })));
      assert.deepEqual(links.map(link => link.case), [...PHASE7, ...PHASE8]);
      for (const name of PHASE8) assert.ok(links.find(link => link.case === name).href.endsWith(`/${name}.html`));
      const outputs = await page.evaluate(() => ({
        theme: document.getElementById('gallery-theme').textContent,
        caseName: document.getElementById('gallery-case').textContent,
        fixture: document.getElementById('gallery-fixture').textContent
      }));
      assert.match(outputs.theme, /^theme: (light|dark)$/);
      assert.equal(outputs.caseName, 'case: gallery-index');
      assert.match(outputs.fixture, /5 Phase 8 cases/);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.idle), 'true');
      await goto('/gallery/index.html?case=bars');
      assert.equal(await page.evaluate(() => document.getElementById('gallery-case').textContent), 'case: bars');
    });

    let barStyles;
    await t.test('bars: modes, tables, states, selection and legend', async () => {
      await goto('/gallery/bars.html');
      for (const [id, type] of [['bars-ranked', 'ranked'], ['bars-stacked', 'stacked'], ['bars-percent', 'percent'], ['bars-lollipop', 'lollipop'], ['bars-slope', 'slope']]) {
        const result = await ready(id, 'bars');
        assert.equal(result.type, type);
      }
      await state('bars-ranked-empty', 'empty');
      await state('bars-ranked-unsupported', 'unsupported');

      const ranked = rankedRows();
      const rankedInfo = await ready('bars-ranked', 'bars');
      assert.equal(rankedInfo.marks.length, rankedTop() + 1);
      const rankedTable = await assertTable('bars-ranked', rankedTop() + 1, formatValue(ranked[0].values.sessions, { kind: 'count' }));
      assert.equal(rankedTable.at(-1).key, '(other)');
      assert.ok(rankedTable.at(-1).cells.includes(formatValue(rankedOtherTotal(), { kind: 'count' })));
      assert.equal(rankedInfo.marks.at(-1).values.sessions, rankedOtherTotal());

      const stacked = stackedRows();
      await assertTable('bars-stacked', stacked.length, formatValue(stacked[0].values.sessions, { kind: 'count' }));
      await assertTable('bars-slope', slopeRows().length, formatValue(slopeRows()[0].values.before, { kind: 'count' }));

      await proveInteractions('bars-ranked');
      await proveLegend('bars-stacked', { hide: 'calls', focus: 'sessions', survivor: { key: 'model:atlas' } });
      await assertMotion('bars-stacked');
      await assertTargets('bars-ranked');
      barStyles = await capture('bars-ranked');
    });

    let rangeStyles;
    await t.test('ranges: modes, tables, states, selection and legend', async () => {
      await goto('/gallery/ranges.html');
      for (const [id, type] of [['ranges-box', 'box'], ['ranges-histogram', 'histogram'], ['ranges-strip', 'strip'], ['ranges-dots', 'dots']]) {
        const result = await ready(id, 'ranges');
        assert.equal(result.type, type);
      }
      await state('ranges-empty', 'empty');
      await state('ranges-unsupported', 'unsupported');

      const box = boxRows();
      await assertTable('ranges-box', box.length, formatValue(box[0].values.median, { kind: 'money' }));
      const histogram = histogramRows();
      await assertTable('ranges-histogram', histogram.length, formatValue(histogram[0].values.calls, { kind: 'count' }));
      const strip = stripRows();
      await assertTable('ranges-strip', strip.length, formatValue(strip[0].values.latency, { kind: 'number' }));
      const dots = dotsRows();
      await assertTable('ranges-dots', dots.length, formatValue(dots[0].values.tokens, { kind: 'count' }));

      await proveInteractions('ranges-box');
      await proveLegend('ranges-box', { hide: 'p95', focus: 'median', survivor: { key: 'model:atlas' } });
      await assertMotion('ranges-box');
      await assertTargets('ranges-strip');
      rangeStyles = await capture('ranges-box');
    });

    let matrixStyles;
    await t.test('matrix: modes, tables, states, selection and styles', async () => {
      await goto('/gallery/matrix.html');
      for (const [id, type] of [['matrix-heatmap', 'heatmap'], ['matrix-calendar', 'calendar']]) {
        const result = await ready(id, 'matrix');
        assert.equal(result.type, type);
      }
      await state('matrix-empty', 'empty');
      await state('matrix-unsupported', 'unsupported');
      matrixStyles = await capture('matrix-heatmap');

      const heat = heatmapRows();
      await assertTable('matrix-heatmap', heat.length, formatValue(heat[0].values.sessions, { kind: 'count' }));
      const calendar = calendarRows();
      await assertTable('matrix-calendar', calendar.length, formatValue(calendar[0].values.sessions, { kind: 'count' }));

      await proveInteractions('matrix-heatmap');
      await assertMotion('matrix-heatmap');
      await assertTargets('matrix-calendar');
    });

    let laneLegendStyles;
    await t.test('lanes: modes, tables, selection, legend and styles', async () => {
      await goto('/gallery/lanes.html');
      const timeline = await ready('lanes-timeline', 'lanes');
      assert.equal(timeline.type, 'timeline');
      const gantt = await ready('lanes-gantt', 'lanes');
      assert.equal(gantt.type, 'gantt');

      const events = timelineRows();
      await assertTable('lanes-timeline', events.length, formatValue(events[0].values.cost, { kind: 'money' }));
      const spans = ganttRows();
      await assertTable('lanes-gantt', spans.length, formatValue(spans[0].values.events, { kind: 'count', unit: 'events' }));

      await proveInteractions('lanes-timeline');
      await proveLegend('lanes-timeline', { hide: 'kind:artifact', focus: 'kind:test', survivor: { key: 'model:atlas' } });
      await assertMotion('lanes-timeline');
      await assertTargets('lanes-timeline');
      laneLegendStyles = await legendStyles('lanes-timeline');
    });

    await t.test('treemap: composition, states, table keyboard, touch, theme and neutrals', async () => {
      await goto('/gallery/treemap.html');
      const tree = await ready('treemap-composition', 'treemap');
      assert.equal(tree.type, 'treemap');
      assert.equal(tree.brush, null);
      assert.equal(tree.window, null);
      await state('treemap-empty', 'empty');
      await state('treemap-unsupported', 'unsupported');

      const rows = treemapRows();
      const cells = rows.filter(row => !TAIL_KEYS.includes(row.parent)).length + 1;
      const table = await assertTable('treemap-composition', cells, formatValue(rows[0].value, { kind: 'count' }));
      const parentLabel = PARENTS.find(parent => parent.key === rows[0].parent).label;
      assert.ok(table[0].cells.includes(parentLabel));

      await proveInteractions('treemap-composition');
      await proveLegend('treemap-composition', { hide: 'repo:docs', focus: 'repo:core', survivor: { key: 'model:atlas', parent: 'repo:core' } });
      await assertMotion('treemap-composition');
      await assertTargets('treemap-composition');

      // The accessible table is keyboard operable after clearing the selection.
      await focusRoot('treemap-composition');
      await page.keyboard.press('Escape');
      assert.equal((await inspect('treemap-composition')).selection, null);
      await page.evaluate(() => document.getElementById('treemap-composition').shadowRoot.querySelector('.yk-table tbody tr').focus());
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.getElementById('treemap-composition').shadowRoot.activeElement?.dataset.entityKey), rows[1].key);
      await page.keyboard.press(' ');
      assert.equal(await page.evaluate(() => document.getElementById('treemap-composition').shadowRoot.activeElement?.querySelector('input.yk-table-select')?.checked), true);
      const beforeEnter = await lastEvent();
      await page.keyboard.press('Enter');
      const afterEnter = await lastEvent();
      assert.equal(afterEnter.name, 'inspect');
      assert.notEqual(afterEnter.text, beforeEnter.text);

      // A real touch tap inspects a mark without a prior hover.
      const touchIndex = (await inspect('treemap-composition')).marks.findIndex(mark => mark.key === 'model:cedar');
      const touchPoint = await markPoint('treemap-composition', touchIndex);
      const client = await page.context().newCDPSession(page);
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchPoint.x, y: touchPoint.y }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal((await inspect('treemap-composition')).inspectedKey, 'model:cedar');

      // Both themes keep the same entity slot; only the token value changes.
      const light = await page.evaluate(() => {
        const element = document.getElementById('treemap-composition');
        const result = element.inspect();
        const index = result.marks.findIndex(mark => mark.key === 'model:atlas' && mark.y === 'repo:core');
        const cell = element.shadowRoot.querySelector(`[data-mark="${index}"] .yk-treemap-cell`);
        return { style: result.marks[index].style, fill: cell.getAttribute('fill') };
      });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await page.waitForFunction(() => document.getElementById('treemap-composition')?.dataset.theme === 'dark');
      const dark = await page.evaluate(() => {
        const element = document.getElementById('treemap-composition');
        const result = element.inspect();
        const index = result.marks.findIndex(mark => mark.key === 'model:atlas' && mark.y === 'repo:core');
        const cell = element.shadowRoot.querySelector(`[data-mark="${index}"] .yk-treemap-cell`);
        return { style: result.marks[index].style, fill: cell.getAttribute('fill') };
      });
      assert.deepEqual(dark.style, light.style);
      assert.notEqual(dark.fill, light.fill);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await page.waitForFunction(() => document.getElementById('treemap-composition')?.dataset.theme === 'light');

      const neutrals = await page.evaluate(keys => {
        const result = document.getElementById('treemap-composition').inspect();
        return keys.map(key => result.marks.find(mark => mark.key === key)?.style);
      }, FIXED_NEUTRAL_KEYS);
      const combinations = new Set(neutrals.map(style => `${style.cssVar}|${style.shape}|${style.pattern}|${style.label}`));
      assert.equal(combinations.size, FIXED_NEUTRAL_KEYS.length);

      // The same entity keeps its slot across engines, including the treemap's
      // parent groups and the lanes' series legend.
      const treemapParents = await legendStyles('treemap-composition');
      for (const key of SHARED) {
        assert.deepEqual(pick(rangeStyles[key]), pick(barStyles[key]), `${key} survives ranges`);
        assert.deepEqual(pick(matrixStyles[key]), pick(barStyles[key]), `${key} survives matrix`);
      }
      assert.deepEqual(laneLegendStyles['kind:test'], pick(barStyles['kind:test']));
      assert.deepEqual(treemapParents['repo:core'], pick(barStyles['repo:core']));
    });

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
