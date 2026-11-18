import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

const environment = loadBrowserEnvironment();

const BARS_SPEC = {
  chart: 'bars', type: 'ranked', title: 'Session movers', units: 'sessions',
  x: { label: 'Harness', kind: 'text' },
  series: [{ key: 'sessions', label: 'Sessions', unit: 'sessions', kind: 'count' }],
  top: 4, sort: 'desc'
};
const BARS_ROWS = [
  { key: 'harness:orca', values: { sessions: 12 }, n: 12 },
  { key: 'harness:pine', values: { sessions: 8 }, n: 8 }
];

async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
  await page.waitForFunction(() => document.querySelector('.workspace-panel')?.dataset.state === 'ready');
}

async function registerDemo(page, { search = '/b/demo?win=all', spec = BARS_SPEC, rows = BARS_ROWS } = {}) {
  await page.evaluate(async ({ search }) => {
    const { registerPanel } = await import('/js/panels/registry.js');
    const { registerPreset } = await import('/js/boards/presets.js');
    registerPanel({
      id: 'demo-panel', grain: 'session', measures: ['cost_usd'], lenses: ['harness'], charts: ['bars'],
      requires: ['entities_session'], caveats: 'Scoped to fixture sessions.',
      load: async () => ({ state: 'ready', population: { grain: 'session', unit: 'session', scope_n: 1880, eligible_n: 1880, returned_n: 2 }, basis: 'fixture facts.ts' })
    });
    registerPreset({ id: 'demo', title: 'Demo', phase: 9, panels: ['demo-panel'] });
    history.pushState({}, '', search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, { search });
  await settle(page);
  await page.evaluate(async ({ spec, rows }) => {
    await import('/js/charts/yk-bars.js');
    let chart = document.getElementById('demo-chart');
    if (!chart) {
      chart = document.createElement('yk-bars');
      chart.id = 'demo-chart';
      document.querySelector('.workspace-panel-body').append(chart);
    }
    chart.spec = spec;
    chart.data = rows;
    await chart.whenSettled();
  }, { spec, rows });
}

async function markPoint(page, key) {
  return page.evaluate(entityKey => {
    const element = document.getElementById('demo-chart');
    const result = element.inspect();
    const index = result.marks.findIndex(mark => mark.key === entityKey);
    const hit = element.shadowRoot.querySelector(`[data-mark="${index}"] [data-hit]`);
    hit.scrollIntoView({ block: 'center' });
    const rect = hit.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, key);
}

test('inspect opens the side panel with the entity, keeps actions and focus, and copies the committed link', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const diagnostics = await watchPage(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: harness.origin });

  await page.goto(`${harness.origin}/`);
  await registerDemo(page, { search: '/b/demo?win=all&pick=s1%2Cs2%7C' });

  const point = await markPoint(page, 'harness:orca');
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');

  const inspector = page.locator('.workspace-inspector');
  assert.equal(await inspector.getAttribute('role'), 'dialog');
  assert.equal(await inspector.getAttribute('data-position'), 'side');
  assert.equal(await inspector.getAttribute('data-grain'), 'session');
  assert.equal(await inspector.getAttribute('data-key'), 'harness:orca');
  assert.match(await inspector.innerText(), /harness:orca/);
  assert.match(await inspector.innerText(), /12 sessions/);
  for (const action of ['open', 'filter', 'exclude', 'cohort', 'copy-link']) {
    assert.equal(await page.locator(`.workspace-inspector-action[data-action="${action}"]`).count(), 1, action);
  }

  // Copy link copies the committed URL, including the committed selection.
  await page.locator('.workspace-inspector-action[data-action="copy-link"]').click();
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.copied === 'true');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(copied).searchParams.get('pick'), 's1,s2|');

  // Esc closes and focus returns to the chart host that opened the inspector.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'demo-chart');

  // Keyboard Enter on a focused mark opens the inspector too.
  await page.evaluate(() => {
    const element = document.getElementById('demo-chart');
    element.shadowRoot.querySelector('.yk-chart').focus();
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  assert.equal(await inspector.getAttribute('data-key'), 'harness:orca');
  await page.keyboard.press('Escape');

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('below 900 px the inspector is a bottom sheet', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/`);
  await registerDemo(page);
  const point = await markPoint(page, 'harness:pine');
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  const inspector = page.locator('.workspace-inspector');
  assert.equal(await inspector.getAttribute('data-position'), 'sheet');
  const position = await inspector.evaluate(node => getComputedStyle(node).position);
  assert.equal(position, 'fixed');
  assert.equal(await inspector.getAttribute('role'), 'dialog');
  await diagnostics.assertClean();
});

test('the selection tray writes a canonical cohort A inside the URL budget', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/`);
  await registerDemo(page, { search: '/b/demo?win=30d&pick=s1%2Cs2%7C' });

  const tray = page.locator('.selection-tray');
  assert.equal(await tray.getAttribute('data-open'), 'true');
  assert.match(await tray.innerText(), /2 sessions of 1,880 in scope/);
  assert.match(await tray.innerText(), /session selection/);

  await page.locator('.selection-tray-action[data-action="make-cohort"][data-slot="A"]').click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('ca'));
  const ca = await page.evaluate(() => JSON.parse(new URLSearchParams(location.search).get('ca')));
  assert.equal(ca.v, 1);
  assert.equal(ca.grain, 'session');
  assert.equal(ca.op, 'include');
  assert.deepEqual(ca.predicate, { in: { lens: 'id', values: ['s1', 's2'] } });
  assert.ok(ca.scope.from && ca.scope.to, 'the promoted scope has absolute bounds');
  assert.ok(new URL(page.url()).search.length <= 8192);
  await page.waitForFunction(() => document.querySelector('.workspace-chip[data-kind="cohort"]'));
  assert.match(await page.locator('.workspace-chip[data-kind="cohort"]').innerText(), /cohort A/);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('an unmapped legend focus adds no null filter chip and the panel names it', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const diagnostics = await watchPage(page);
  await page.goto(`${harness.origin}/`);
  await registerDemo(page);

  await page.evaluate(async () => {
    const chart = document.getElementById('demo-chart');
    chart.spec = {
      chart: 'bars', type: 'stacked', title: 'Movers', units: 'sessions · calls', x: { label: 'Harness', kind: 'text' },
      series: [{ key: 'sessions', label: 'Sessions', unit: 'sessions', kind: 'count' }, { key: 'calls', label: 'Calls', unit: 'calls', kind: 'count' }]
    };
    chart.data = [{ key: 'harness:orca', values: { sessions: 12, calls: 40 }, n: 12 }];
    await chart.whenSettled();
  });
  await page.evaluate(() => {
    const button = document.getElementById('demo-chart').shadowRoot.querySelector('.yk-legend-item[data-key="sessions"] .yk-legend-focus');
    if (!button) throw new Error('legend focus button is missing');
    button.click();
  });
  await page.waitForFunction(() => document.querySelector('.workspace-chip[data-kind="unmapped"]'));
  assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 0);
  assert.match(await page.locator('.workspace-chip[data-kind="unmapped"]').innerText(), /not applied here: sessions/);
  assert.doesNotMatch(page.url(), /sessions=/);

  // A mapped series lens emits a real board filter.
  await page.evaluate(async () => {
    const chart = document.getElementById('demo-chart');
    chart.spec = {
      chart: 'bars', type: 'stacked', title: 'Movers', units: 'sessions', x: { label: 'Harness', kind: 'text' },
      series: [
        { key: 'harness:orca', label: 'Orca', lens: 'harness', unit: 'sessions', kind: 'count' },
        { key: 'harness:pine', label: 'Pine', lens: 'harness', unit: 'sessions', kind: 'count' }
      ]
    };
    chart.data = [{ key: 'row-1', values: { 'harness:orca': 12, 'harness:pine': 8 }, n: 20 }];
    await chart.whenSettled();
  });
  await page.evaluate(() => {
    const button = document.getElementById('demo-chart').shadowRoot.querySelector('.yk-legend-item[data-key="harness:orca"] .yk-legend-focus');
    if (!button) throw new Error('mapped legend focus button is missing');
    button.click();
  });
  await page.waitForFunction(() => new URLSearchParams(location.search).get('harness') === 'orca');
  assert.equal(await page.locator('.workspace-chip[data-kind="filter"][data-applied="false"]').count(), 0);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
