// Plan 29 phase 3 acceptance: the dense full-width, theme-family, interaction
// and state outcome proved against the real Go API and real Chromium. The one
// two-tenant fixture (plan29-a populated, plan29-b empty) is used through the
// cookie session and PUBLIC_CANVAS_TEST_MODE. No stubs, no interception, no
// fixed sleeps: every wait is an idle/ready attribute or a rendered pixel.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../charts-time/browser.mjs';
import { startPlan29Harness } from './harness.mjs';

const environment = loadBrowserEnvironment();
const measurementsPath = resolve(import.meta.dirname, 'phase3-measurements.json');
const SKIP = environment.ok ? false : (environment.reason || SKIP_REASON);
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';

const ROUTES = [
  '/', '/b/pulse', '/b/trends', '/b/cost', '/b/quality', '/b/tools', '/b/workflow',
  '/b/compare', '/b/scatter', '/plans', '/sessions', '/ledger', '/ops', '/artifact'
];

const TOKEN_KEYS = [
  '--yk-bg', '--yk-surface', '--yk-surface-alt', '--yk-text', '--yk-muted', '--yk-border',
  '--yk-grid', '--yk-focus', '--yk-chart-surface', '--yk-chart-text', '--yk-chart-grid',
  '--yk-tooltip-surface', '--yk-selected', '--yk-excluded'
];

function hexRgb(value) {
  const text = String(value || '').trim();
  const match = /^#([0-9a-f]{6})$/i.exec(text);
  if (!match) return null;
  const number = parseInt(match[1], 16);
  return [number >> 16 & 255, number >> 8 & 255, number & 255];
}

function rgbTuple(value) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(String(value || ''));
  if (!match) return hexRgb(value);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([r, g, b]) {
  const channel = value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(rgbTuple(foreground) || [0, 0, 0]);
  const b = relativeLuminance(rgbTuple(background) || [0, 0, 0]);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function assertGeometry(name, actual, expected) {
  assert.equal(actual, expected, `${name}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
}

async function waitCharts(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('yk-chart')]
    .every(node => node.dataset.state !== 'loading'));
}

async function canvasPixel(page, hostSelector) {
  return page.evaluate(selector => {
    const host = document.querySelector(selector);
    const canvas = host?.shadowRoot?.querySelector('.yk-scatter-canvas:not(.yk-scatter-overlay)');
    if (!canvas) return null;
    return [...canvas.getContext('2d').getImageData(2, 2, 1, 1).data];
  }, hostSelector);
}

async function waitPixel(page, hostSelector, expected) {
  await page.waitForFunction(([selector, rgb]) => {
    const host = document.querySelector(selector);
    const canvas = host?.shadowRoot?.querySelector('.yk-scatter-canvas:not(.yk-scatter-overlay)');
    if (!canvas) return false;
    const seen = canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
    return seen[0] === rgb[0] && seen[1] === rgb[1] && seen[2] === rgb[2] && seen[3] === rgb[3];
  }, [hostSelector, expected]);
}

async function scatterInvariants(page, hostSelector) {
  return page.evaluate(selector => {
    const host = document.querySelector(selector);
    const result = host.inspect();
    return {
      marks: result.marks.length,
      hidden: result.series.filter(item => !item.visible).map(item => item.key),
      keys: result.selectionKeys.slice(),
      table: [...host.shadowRoot.querySelectorAll('.yk-table tbody tr')].map(row => row.dataset.entityKey),
      search: globalThis.location.search,
      theme: globalThis.document.documentElement.dataset.theme
    };
  }, hostSelector);
}

async function readThemeTokens(page) {
  return page.evaluate(keys => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(keys.map(key => [key, style.getPropertyValue(key).trim()]));
  }, TOKEN_KEYS);
}

async function readPanelState(page, selector) {
  return page.evaluate(sel => {
    const panel = document.querySelector(sel);
    const status = panel?.querySelector('.workspace-panel-status');
    return {
      state: panel?.dataset.state || '',
      text: status?.textContent || '',
      color: status ? getComputedStyle(status).color : '',
      background: panel ? getComputedStyle(panel).backgroundColor : ''
    };
  }, selector);
}

async function ensureTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme);
  if (current !== theme) await page.locator('#theme-toggle').click();
  await page.waitForFunction(expected => document.documentElement.dataset.theme === expected, theme);
}

function checkAll(failures, name, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
  } catch {
    failures.push(`${name}: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(actual)}`);
  }
}

function checkTrue(failures, name, condition, detail = '') {
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
}

test('plan29 phase 3 acceptance', { skip: SKIP }, async t => {
  const harness = await startPlan29Harness();
  let browser;
  const failures = [];
  const geometry = {};
  let tokenRecord = null;
  let canvasRecord = null;
  let headerRecord = null;

  const run = async (name, fn) => {
    try {
      await t.test(name, fn);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  };

  try {
    browser = await launchBrowser(environment);
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    harness.attach(context);
    await harness.installSession(context, 'plan29-a');
    await harness.selectTenant(context, 'plan29-a');
    const page = context.pages()[0] || await context.newPage();
    const go = async (target, route) => {
      await target.goto(`${harness.origin}${route}`);
      await harness.waitIdle(target);
    };

    await go(page, '/plans?win=all');
    const planIdentity = await page.locator('.plan-row').first().getAttribute('data-plan-identity');
    await go(page, '/sessions?win=all');
    const sessionId = await page.locator('.session-row').first().getAttribute('data-session-id');
    assert.ok(planIdentity && sessionId, 'fixture exposes one plan and one session identity');
    const [planRepo, planName] = planIdentity.split('/');
    const detailRoutes = [
      `/sessions/${encodeURIComponent(sessionId)}`,
      `/plans/${encodeURIComponent(planRepo)}/${encodeURIComponent(planName)}`
    ];
    const allRoutes = [...ROUTES, ...detailRoutes];

    await run('full-width geometry at 1920 and 1366', async () => {
      for (const width of [1920, 1366]) {
        await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
        for (const route of allRoutes) {
          await go(page, route);
          const measured = await page.evaluate(() => {
            const main = document.querySelector('#app');
            const top = document.querySelector('.topbar');
            const foot = document.querySelector('footer');
            const mainStyle = getComputedStyle(main);
            const topStyle = getComputedStyle(top);
            const footStyle = getComputedStyle(foot);
            const mainRect = main.getBoundingClientRect();
            const topRect = top.getBoundingClientRect();
            const footRect = foot.getBoundingClientRect();
            const bodyStyle = getComputedStyle(document.body);
            return {
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              mainLeft: mainRect.left + parseFloat(mainStyle.paddingLeft),
              mainRight: mainRect.right - parseFloat(mainStyle.paddingRight),
              mainWidth: mainRect.width - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight),
              topLeft: topRect.left + parseFloat(topStyle.paddingLeft),
              topRight: topRect.right - parseFloat(topStyle.paddingRight),
              footLeft: footRect.left + parseFloat(footStyle.paddingLeft),
              footRight: footRect.right - parseFloat(footStyle.paddingRight),
              gutter: parseFloat(mainStyle.paddingLeft),
              bodyFont: bodyStyle.fontSize,
              bodyLineHeight: bodyStyle.lineHeight
            };
          });
          const where = `${route} at ${width}x${width === 1920 ? 1080 : 900}`;
          assert.ok(Math.abs(measured.mainLeft - measured.topLeft) <= 1, `${where}: main left ${measured.mainLeft} != topbar ${measured.topLeft}`);
          assert.ok(Math.abs(measured.mainRight - measured.topRight) <= 1, `${where}: main right ${measured.mainRight} != topbar ${measured.topRight}`);
          assert.ok(Math.abs(measured.mainLeft - measured.footLeft) <= 1, `${where}: main left ${measured.mainLeft} != footer ${measured.footLeft}`);
          assert.ok(Math.abs(measured.mainRight - measured.footRight) <= 1, `${where}: main right ${measured.mainRight} != footer ${measured.footRight}`);
          assert.equal(measured.gutter, 12, `${where}: desktop gutter`);
          assert.ok(Math.abs(measured.mainWidth - (measured.clientWidth - 2 * measured.gutter)) <= 1,
            `${where}: mainWidth ${measured.mainWidth} != clientWidth ${measured.clientWidth} - 2*${measured.gutter}`);
          assert.ok(measured.mainWidth >= (width === 1920 ? 1800 : 1270), `${where}: mainWidth ${measured.mainWidth} is capped`);
          assertGeometry(`${where}: body font`, measured.bodyFont, '13px');
          assert.ok(Math.abs(parseFloat(measured.bodyLineHeight) - 17.55) <= 0.1, `${where}: line height ${measured.bodyLineHeight}`);
          assert.ok(measured.scrollWidth <= measured.clientWidth + 1, `${where}: document overflow ${measured.scrollWidth} > ${measured.clientWidth}`);
          if (route === '/') {
            geometry[width] = {
              clientWidth: measured.clientWidth,
              mainWidth: measured.mainWidth,
              gutter: measured.gutter
            };
          }
        }
      }
    });

    await run('density and local scroll', async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      for (const route of ['/ledger?win=all', '/plans?win=all', '/sessions?win=all']) {
        await go(page, route);
        const measured = await page.evaluate(() => {
          const table = document.querySelector('table');
          const row = table?.querySelector('tbody tr');
          const head = table?.querySelector('thead th');
          const numeric = table?.querySelector('td.numeric');
          let scroller = table?.parentElement || null;
          while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
          const panel = document.querySelector('.workspace-panel');
          const panelStyle = panel ? getComputedStyle(panel) : null;
          return {
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            headerPosition: head ? getComputedStyle(head).position : '',
            scroller: scroller ? getComputedStyle(scroller).overflowX : '',
            numericAlign: numeric ? getComputedStyle(numeric).textAlign : '',
            numericVariant: numeric ? getComputedStyle(numeric).fontVariantNumeric : '',
            paddingTop: panelStyle ? parseFloat(panelStyle.paddingTop) : 0,
            paddingLeft: panelStyle ? parseFloat(panelStyle.paddingLeft) : 0,
            borderTop: panelStyle ? parseFloat(panelStyle.borderTopWidth) : 0,
            radius: panelStyle ? parseFloat(panelStyle.borderTopLeftRadius) : 0
          };
        });
        const where = `${route} density`;
        assert.ok(measured.rowHeight >= 28 && measured.rowHeight <= 32, `${where}: row height ${measured.rowHeight}`);
        assert.equal(measured.headerPosition, 'sticky', `${where}: header is not sticky`);
        assert.ok(['auto', 'scroll'].includes(measured.scroller), `${where}: table does not scroll locally (${measured.scroller})`);
        assert.equal(measured.numericAlign, 'right', `${where}: numeric cell is not right aligned`);
        assert.equal(measured.numericVariant, 'tabular-nums', `${where}: numeric cell is not tabular`);
        assert.ok(measured.paddingTop >= 6 && measured.paddingTop <= 8, `${where}: panel padding ${measured.paddingTop}`);
        assert.ok(measured.paddingLeft >= 6 && measured.paddingLeft <= 8, `${where}: panel padding ${measured.paddingLeft}`);
        assert.equal(measured.borderTop, 1, `${where}: panel border ${measured.borderTop}`);
        assert.ok(measured.radius <= 2, `${where}: panel radius ${measured.radius}`);
      }
      await go(page, '/b/pulse?win=all');
      const gap = await page.evaluate(() => {
        const grid = document.querySelector('.panel-grid');
        return grid ? getComputedStyle(grid).gap : '';
      });
      assert.equal(gap, '8px', 'panel grid gap');
      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      const plotHeight = await page.evaluate(() => {
        const host = document.querySelector('[data-panel="scatter-session"] yk-chart');
        const frame = host?.shadowRoot?.querySelector('.yk-chart-frame');
        return frame ? frame.getBoundingClientRect().height : 0;
      });
      assert.ok(plotHeight >= 200 && plotHeight <= 260, `ordinary chart height ${plotHeight}`);
    });

    await run('one theme family and canvas pixels', async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      const hostSelector = '[data-panel="scatter-session"] yk-chart';
      await page.locator(hostSelector).scrollIntoViewIfNeeded();
      await ensureTheme(page, THEME_LIGHT);
      const lightTokens = await readThemeTokens(page);
      const lightSurface = hexRgb(lightTokens['--yk-surface']);
      assert.deepEqual(await canvasPixel(page, hostSelector), [...lightSurface, 255], 'light canvas equals the resolved surface token');
      assert.notDeepEqual(await canvasPixel(page, hostSelector), [255, 255, 255, 255], 'light plot canvas is pure white');

      const start = await page.evaluate(selector => {
        const host = document.querySelector(selector);
        const result = host.inspect();
        return { plot: result.plot, mark: result.marks[0], series: result.series.map(item => item.key) };
      }, hostSelector);
      assert.ok(start.mark, 'populated session scatter has a mark');
      await page.mouse.move(start.plot.left + start.mark.px, start.plot.top + start.mark.py);
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().inspectedKey === key,
        [hostSelector, start.mark.key]);
      const left = start.plot.left + Math.max(2, Math.min(start.plot.width - 2, start.mark.px - 30));
      const right = start.plot.left + Math.max(2, Math.min(start.plot.width - 2, start.mark.px + 30));
      const top = start.plot.top + Math.max(2, Math.min(start.plot.height - 2, start.mark.py - 30));
      const bottom = start.plot.top + Math.max(2, Math.min(start.plot.height - 2, start.mark.py + 30));
      await page.mouse.move(left, top);
      await page.mouse.down();
      await page.mouse.move(right, bottom, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(selector => Boolean(document.querySelector(selector).inspect().selection), hostSelector);
      const legendKey = start.series[start.series.length - 1];
      await page.locator(`${hostSelector} .yk-legend-item[data-key="${legendKey}"] .yk-legend-toggle`).click();
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().series
        .find(item => item.key === key)?.visible === false, [hostSelector, legendKey]);
      const before = await scatterInvariants(page, hostSelector);
      assert.ok(before.keys.length > 0, 'rectangle selection is not empty');
      assert.ok(before.hidden.includes(legendKey), 'legend-hidden series is hidden');

      await page.locator('#theme-toggle').click();
      await harness.waitIdle(page);
      await waitCharts(page);
      await waitPixel(page, hostSelector, [27, 39, 52, 255]);
      const darkTokens = await readThemeTokens(page);
      assert.deepEqual(await canvasPixel(page, hostSelector), [27, 39, 52, 255], 'dark canvas equals the dark surface token');
      const darkSurface = hexRgb(darkTokens['--yk-surface']);
      assert.deepEqual(darkSurface, [27, 39, 52], 'dark surface token');
      const dark = await scatterInvariants(page, hostSelector);
      assert.equal(dark.theme, THEME_DARK, 'dark theme applied');
      assert.equal(dark.marks, before.marks, 'mark count survives the theme switch');
      assert.deepEqual(dark.hidden, before.hidden, 'hidden series survives the theme switch');
      assert.deepEqual(dark.keys, before.keys, 'selection survives the theme switch');
      assert.deepEqual(dark.table, before.table, 'table data survives the theme switch');
      assert.equal(dark.search, before.search, 'URL state survives the theme switch');

      await page.locator('#theme-toggle').click();
      await harness.waitIdle(page);
      await waitCharts(page);
      await waitPixel(page, hostSelector, [244, 246, 248, 255]);
      const lightAgain = await scatterInvariants(page, hostSelector);
      assert.equal(lightAgain.theme, THEME_LIGHT, 'light theme restored');
      assert.equal(lightAgain.marks, before.marks, 'mark count survives the light switch');
      assert.deepEqual(lightAgain.hidden, before.hidden, 'hidden series survives the light switch');
      assert.deepEqual(lightAgain.keys, before.keys, 'selection survives the light switch');
      assert.deepEqual(lightAgain.table, before.table, 'table data survives the light switch');
      assert.equal(lightAgain.search, before.search, 'URL state survives the light switch');

      await go(page, '/ledger?win=all');
      const lightHeader = await page.evaluate(() => getComputedStyle(document.querySelector('.ledger-table thead th')).backgroundColor);
      assert.notEqual(lightHeader, 'rgb(255, 255, 255)', 'light ledger header is pure white');
      await page.locator('#theme-toggle').click();
      await harness.waitIdle(page);
      const darkHeader = await page.evaluate(() => getComputedStyle(document.querySelector('.ledger-table thead th')).backgroundColor);
      assert.notEqual(darkHeader, 'rgb(255, 255, 255)', 'dark ledger header is pure white');
      assert.deepEqual(rgbTuple(darkHeader), [27, 39, 52], 'dark ledger header follows the dark surface');
      const darkTokensLedger = await readThemeTokens(page);
      await page.locator('#theme-toggle').click();
      await harness.waitIdle(page);

      tokenRecord = { light: lightTokens, dark: { ...darkTokensLedger, ...darkTokens } };
      canvasRecord = { light: [244, 246, 248, 255], dark: [27, 39, 52, 255] };
      headerRecord = { light: lightHeader, dark: darkHeader };
    });

    await run('real interaction and table alternative', async () => {
      await go(page, '/b/trends?win=all');
      await waitCharts(page);
      const trendSelector = '[data-panel="trend-columns"] yk-chart';
      await page.locator(trendSelector).scrollIntoViewIfNeeded();
      const trend = await page.evaluate(selector => {
        const host = document.querySelector(selector);
        const result = host.inspect();
        return { plot: result.plot, mark: result.marks[0], series: result.series };
      }, trendSelector);
      await page.mouse.move(trend.plot.left + trend.mark.px, trend.plot.top + trend.plot.height / 2);
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().inspectedKey === key,
        [trendSelector, trend.mark.key]);
      await page.evaluate(selector => document.querySelector(selector).shadowRoot.querySelector('.yk-chart').focus(), trendSelector);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(selector => Boolean(document.querySelector(selector).inspect().inspectedKey), trendSelector);
      let tabReached = false;
      for (let press = 0; press < 120 && !tabReached; press += 1) {
        await page.keyboard.press('Tab');
        tabReached = await page.evaluate(selector => {
          const host = document.querySelector(selector);
          const active = document.activeElement;
          if (!host || !active) return false;
          if (active === host) return Boolean(host.shadowRoot?.activeElement);
          return host.contains(active) || Boolean(host.shadowRoot?.activeElement);
        }, trendSelector);
      }
      assert.ok(tabReached, 'Tab reaches the chart or its legend');
      await page.mouse.move(trend.plot.left + 24, trend.plot.top + trend.plot.height / 2);
      await page.mouse.down();
      await page.mouse.move(trend.plot.left + trend.plot.width - 24, trend.plot.top + trend.plot.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(selector => Boolean(document.querySelector(selector).inspect().brush), trendSelector);
      const legendKey = trend.series[0].key;
      await page.locator(`${trendSelector} .yk-legend-item[data-key="${legendKey}"] .yk-legend-toggle`).click();
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().series
        .find(item => item.key === key)?.visible === false, [trendSelector, legendKey]);
      await page.locator(`${trendSelector} .yk-legend-item[data-key="${legendKey}"] .yk-legend-toggle`).click();
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().series
        .find(item => item.key === key)?.visible === true, [trendSelector, legendKey]);
    });

    await run('scatter hover, rectangle, inspector and table intent', async () => {
      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      const hostSelector = '[data-panel="scatter-session"] yk-chart';
      await page.locator(hostSelector).scrollIntoViewIfNeeded();
      const layout = await page.evaluate(selector => {
        const host = document.querySelector(selector);
        const result = host.inspect();
        return { plot: result.plot, marks: result.marks };
      }, hostSelector);
      await page.mouse.move(layout.plot.left + layout.marks[0].px, layout.plot.top + layout.marks[0].py);
      await page.waitForFunction(([selector, key]) => document.querySelector(selector).inspect().inspectedKey === key,
        [hostSelector, layout.marks[0].key]);
      await page.mouse.click(layout.plot.left + layout.marks[1].px, layout.plot.top + layout.marks[1].py);
      await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
      const inspector = await page.evaluate(() => ({
        key: document.querySelector('.workspace-inspector').dataset.key,
        facts: document.querySelectorAll('.workspace-inspector-facts dt').length
      }));
      assert.equal(inspector.key, layout.marks[1].key, 'inspector names the clicked mark');
      assert.ok(inspector.facts > 0, 'inspector shows entity facts');

      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      await page.locator(hostSelector).scrollIntoViewIfNeeded();
      const firstKey = await page.evaluate(selector => {
        globalThis.__phase3Select = null;
        const host = document.querySelector(selector);
        host.closest('[data-panel]').addEventListener('select', event => { globalThis.__phase3Select = event.detail; });
        const row = host.shadowRoot.querySelector('.yk-table tbody tr');
        row.focus();
        return row.dataset.entityKey;
      }, hostSelector);
      await page.keyboard.press('Space');
      await page.waitForFunction(() => Boolean(globalThis.__phase3Select));
      const selectIntent = await page.evaluate(() => globalThis.__phase3Select);
      const selectedKeys = selectIntent.keys || (selectIntent.key ? [selectIntent.key] : []);
      assert.ok(selectedKeys.includes(firstKey), 'table Space emits a select intent for the focused row');

      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      await page.locator(hostSelector).scrollIntoViewIfNeeded();
      await page.evaluate(selector => {
        globalThis.__phase3Inspect = 0;
        const host = document.querySelector(selector);
        host.closest('[data-panel]').addEventListener('inspect', () => { globalThis.__phase3Inspect += 1; });
        host.shadowRoot.querySelector('.yk-table tbody tr').focus();
      }, hostSelector);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => globalThis.__phase3Inspect > 0);
    });

    await run('keyboard-open a mark opens the inspector', async () => {
      await go(page, '/b/trends?win=all');
      await waitCharts(page);
      const trendSelector = '[data-panel="trend-columns"] yk-chart';
      await page.locator(trendSelector).scrollIntoViewIfNeeded();
      await page.evaluate(selector => document.querySelector(selector).shadowRoot.querySelector('.yk-chart').focus(), trendSelector);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true',
        undefined, { timeout: 2000 });
      const inspector = await page.evaluate(() => ({
        key: document.querySelector('.workspace-inspector').dataset.key,
        facts: document.querySelectorAll('.workspace-inspector-facts dt').length
      }));
      assert.ok(inspector.key, 'keyboard inspector names the mark');
      assert.ok(inspector.facts > 0, 'keyboard inspector shows entity facts');
    });

    await run('responsive, coarse pointer and 200% reflow', async () => {
      const failures390 = [];
      const narrow = await browser.newContext({ viewport: { width: 768, height: 900 } });
      harness.attach(narrow);
      await harness.installSession(narrow, 'plan29-a');
      await harness.selectTenant(narrow, 'plan29-a');
      const narrowPage = narrow.pages()[0] || await narrow.newPage();
      await go(narrowPage, '/b/scatter?win=all');
      const columns = await narrowPage.evaluate(() => {
        const grid = document.querySelector('.panel-grid');
        return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
      });
      assert.equal(columns, 1, 'panel grid is one column at 768');
      await narrow.close();

      const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
      harness.attach(phone);
      await harness.installSession(phone, 'plan29-a');
      await harness.selectTenant(phone, 'plan29-a');
      const phonePage = phone.pages()[0] || await phone.newPage();
      await go(phonePage, '/ledger?win=all');
      const phoneTable = await phonePage.evaluate(() => {
        const table = document.querySelector('.ledger-table');
        let scroller = table?.parentElement || null;
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          gutter: parseFloat(getComputedStyle(document.querySelector('#app')).paddingLeft),
          scroller: scroller ? getComputedStyle(scroller).overflowX : ''
        };
      });
      assert.equal(phoneTable.gutter, 8, 'narrow gutter');
      assert.ok(phoneTable.scrollWidth <= phoneTable.clientWidth + 1, `narrow ledger overflow ${phoneTable.scrollWidth}`);
      assert.ok(['auto', 'scroll'].includes(phoneTable.scroller), 'narrow table scrolls locally');
      await go(phonePage, '/b/scatter?win=all');
      const phoneScatter = await phonePage.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth
      }));
      checkTrue(failures390, '390px scatter document overflow', phoneScatter.scrollWidth <= phoneScatter.clientWidth + 1,
        `${phoneScatter.scrollWidth} > ${phoneScatter.clientWidth}`);
      await phone.close();

      const coarse = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      harness.attach(coarse);
      await harness.installSession(coarse, 'plan29-a');
      await harness.selectTenant(coarse, 'plan29-a');
      const coarsePage = coarse.pages()[0] || await coarse.newPage();
      await go(coarsePage, '/b/scatter?win=all');
      const small = await coarsePage.evaluate(() => [...document.querySelectorAll('button')]
        .filter(button => button.offsetParent !== null)
        .map(button => ({ text: button.textContent.trim().slice(0, 20), height: button.getBoundingClientRect().height }))
        .filter(button => button.height < 44));
      assert.deepEqual(small, [], `coarse buttons under 44px: ${JSON.stringify(small)}`);
      await coarse.close();

      const zoom = await browser.newContext({ viewport: { width: 683, height: 450 } });
      harness.attach(zoom);
      await harness.installSession(zoom, 'plan29-a');
      await harness.selectTenant(zoom, 'plan29-a');
      const zoomPage = zoom.pages()[0] || await zoom.newPage();
      await go(zoomPage, '/ledger?win=all');
      const zoomed = await zoomPage.evaluate(() => {
        const table = document.querySelector('.ledger-table');
        let scroller = table?.parentElement || null;
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          scroller: scroller ? getComputedStyle(scroller).overflowX : '',
          idle: [...document.querySelectorAll('[data-panel]')].every(panel => panel.dataset.idle === 'true'),
          buttons: [...document.querySelectorAll('button')].filter(button => button.offsetParent !== null).length
        };
      });
      assert.ok(zoomed.scrollWidth <= zoomed.clientWidth + 1, `200% reflow overflow ${zoomed.scrollWidth}`);
      assert.ok(['auto', 'scroll'].includes(zoomed.scroller), '200% table scrolls locally');
      assert.ok(zoomed.idle, '200% page settles');
      assert.ok(zoomed.buttons > 0, '200% controls remain rendered');
      geometry[768] = { clientWidth: 768, mainWidth: 744, gutter: 12 };
      geometry[390] = { clientWidth: phoneTable.clientWidth, mainWidth: phoneTable.clientWidth - 16, gutter: 8 };
      await zoom.close();

      const failures = [...failures390];
      assert.deepEqual(failures, [], failures.join('\n'));
    });

    await run('states in both themes', async () => {
      const empty = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      harness.attach(empty);
      await harness.installSession(empty, 'plan29-b');
      await harness.selectTenant(empty, 'plan29-b');
      const emptyPage = empty.pages()[0] || await empty.newPage();
      await go(emptyPage, '/b/trends?win=all');
      await ensureTheme(emptyPage, THEME_LIGHT);
      for (const theme of [THEME_LIGHT, THEME_DARK]) {
        await go(emptyPage, '/b/trends?win=all');
        await ensureTheme(emptyPage, theme);
        const state = await readPanelState(emptyPage, '[data-panel="trend-columns"]');
        assert.equal(state.state, 'empty', `${theme} empty state name`);
        assert.match(state.text, /no rows match/i, `${theme} empty state text`);
        assert.ok(!/^\s*0\s*$/.test(state.text), `${theme} empty state is not a zero row`);
        const ratio = contrastRatio(state.color, state.background);
        assert.ok(ratio >= 4.5, `${theme} empty contrast ${ratio.toFixed(2)}`);
      }
      await empty.close();

      const states = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      harness.attach(states);
      await harness.installSession(states, 'plan29-a');
      await harness.selectTenant(states, 'plan29-a');
      const statePage = states.pages()[0] || await states.newPage();
      await go(statePage, '/ops');
      await ensureTheme(statePage, THEME_LIGHT);
      for (const theme of [THEME_LIGHT, THEME_DARK]) {
        await ensureTheme(statePage, theme);
        await go(statePage, '/ops');
        const ops = await readPanelState(statePage, '[data-panel="ops-footprint"]');
        assert.equal(ops.state, 'unsupported', `${theme} permission state name`);
        assert.match(ops.text, /administrator only/i, `${theme} permission state text`);
        const opsRatio = contrastRatio(ops.color, ops.background);
        assert.ok(opsRatio >= 4.5, `${theme} permission contrast ${opsRatio.toFixed(2)}`);

        await go(statePage, '/sessions/phase3-unknown-session');
        const error = await readPanelState(statePage, '[data-panel="session-lanes"]');
        assert.equal(error.state, 'error', `${theme} error state name`);
        assert.match(error.text, /not found/i, `${theme} error state text`);
        assert.ok(!/^\s*0\s*$/.test(error.text), `${theme} error state is not a zero row`);
        const errorRatio = contrastRatio(error.color, error.background);
        assert.ok(errorRatio >= 4.5, `${theme} error contrast ${errorRatio.toFixed(2)}`);
      }
      await states.close();
    });

    await run('committed measurement record', async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      for (const width of [1920, 1366, 768, 390]) {
        await page.setViewportSize({ width, height: width === 1920 ? 1080 : width === 1366 ? 900 : width === 768 ? 900 : 844 });
        await go(page, '/');
        const base = await page.evaluate(() => {
          const main = document.querySelector('#app');
          const style = getComputedStyle(main);
          return {
            clientWidth: document.documentElement.clientWidth,
            mainWidth: main.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            gutter: parseFloat(style.paddingLeft)
          };
        });
        await go(page, '/ledger?win=all');
        const rowHeight = await page.evaluate(() => document.querySelector('.ledger-table tbody tr')?.getBoundingClientRect().height ?? 0);
        await go(page, '/b/pulse?win=all');
        const panelGap = await page.evaluate(() => {
          const grid = document.querySelector('.panel-grid');
          return grid ? parseFloat(getComputedStyle(grid).gap) : 0;
        });
        await go(page, '/b/scatter?win=all');
        await waitCharts(page);
        const plotHeight = await page.evaluate(() => {
          const frame = document.querySelector('[data-panel="scatter-session"] yk-chart')?.shadowRoot?.querySelector('.yk-chart-frame');
          return frame ? frame.getBoundingClientRect().height : 0;
        });
        geometry[width] = { ...geometry[width], clientWidth: base.clientWidth, mainWidth: base.mainWidth, gutter: base.gutter, rowHeight, panelGap, plotHeight };
      }

      await ensureTheme(page, THEME_LIGHT);
      await go(page, '/b/scatter?win=all');
      await waitCharts(page);
      const hostSelector = '[data-panel="scatter-session"] yk-chart';
      await page.locator(hostSelector).scrollIntoViewIfNeeded();
      const lightTokens = await readThemeTokens(page);
      const lightCanvas = await canvasPixel(page, hostSelector);
      await ensureTheme(page, THEME_DARK);
      await harness.waitIdle(page);
      await waitCharts(page);
      await waitPixel(page, hostSelector, [27, 39, 52, 255]);
      const darkTokens = await readThemeTokens(page);
      const darkCanvas = await canvasPixel(page, hostSelector);
      await go(page, '/ledger?win=all');
      const darkHeader = await page.evaluate(() => getComputedStyle(document.querySelector('.ledger-table thead th')).backgroundColor);
      await ensureTheme(page, THEME_LIGHT);
      await go(page, '/ledger?win=all');
      const lightHeader = await page.evaluate(() => getComputedStyle(document.querySelector('.ledger-table thead th')).backgroundColor);

      const record = {
        phase: 3,
        routes: [...ROUTES, '/sessions/<id>', '/plans/<repo>/<plan>'],
        viewports: [1920, 1366, 768, 390],
        geometry,
        tokens: { light: lightTokens, dark: darkTokens },
        canvas: { light: lightCanvas, dark: darkCanvas },
        header: { light: lightHeader, dark: darkHeader }
      };
      if (tokenRecord && canvasRecord && headerRecord) {
        record.tokens = tokenRecord;
        record.canvas = canvasRecord;
        record.header = headerRecord;
      }

      if (process.env.YAKKA_PHASE3_RECORD === '1') {
        await writeFile(measurementsPath, `${JSON.stringify(record, null, 2)}\n`);
        return;
      }
      assert.ok(existsSync(measurementsPath), `missing ${measurementsPath}; author it with YAKKA_PHASE3_RECORD=1`);
      const committed = JSON.parse(await readFile(measurementsPath, 'utf8'));
      const drift = [];
      const compare = (key, actual, expected, tolerance = 0) => {
        if (tolerance) {
          if (typeof actual !== 'number' || Math.abs(actual - expected) > tolerance) drift.push(`${key}: ${actual} != ${expected} (±${tolerance})`);
        } else if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          drift.push(`${key}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
        }
      };
      compare('routes', record.routes, committed.routes);
      for (const width of record.viewports) {
        const actual = record.geometry[String(width)] || {};
        const expected = committed.geometry?.[String(width)] || {};
        for (const key of ['clientWidth', 'mainWidth', 'rowHeight', 'plotHeight']) {
          compare(`${width}.${key}`, actual[key], expected[key], key.startsWith('client') || key.startsWith('main') ? 24 : 2);
        }
        for (const key of ['gutter', 'panelGap']) compare(`${width}.${key}`, actual[key], expected[key]);
      }
      compare('tokens.light', record.tokens.light, committed.tokens.light);
      compare('tokens.dark', record.tokens.dark, committed.tokens.dark);
      compare('canvas.light', record.canvas.light, committed.canvas.light);
      compare('canvas.dark', record.canvas.dark, committed.canvas.dark);
      compare('header.light', record.header.light, committed.header.light);
      compare('header.dark', record.header.dark, committed.header.dark);
      assert.deepEqual(drift, [], `phase 3 measurements drifted from ${measurementsPath}:\n${drift.join('\n')}`);
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await harness.close();
  }
});
