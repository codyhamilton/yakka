import test from 'node:test';
import assert from 'node:assert/strict';

import {
  currentWindow, previousWindow, stripModel, qualityMedian, formatStripCost, rejectionTotal,
  emptyCausesFor, summaryIsEmpty, whenPanelBody
} from '../../web/js/panels/pulse-strips.js';
import { moverLenses, repoLensOffered, offeredMeasures, buildMoverModel, groupTotals, sparkline } from '../../web/js/panels/movers.js';
import { coverageModel } from '../../web/js/panels/coverage.js';
import { mapActivityList, laneRows, countsByType } from '../../web/js/panels/river.js';
import { calendarRows, coarsenedLabel, suggestedMeasures } from '../../web/js/panels/calendar.js';
import { PULSE_PANELS } from '../../web/js/panels/index.js';
import { validatePanelEntry, CHART_NAMES } from '../../web/js/panels/registry.js';
import { makeSchema, summary, activityList, COUNTS } from './fixture.mjs';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

const DAY = 86400e3;
const NOW = Date.parse('2026-10-01T00:00:00Z');

test('a panel paint after a newer route generation does not write into the new body', async () => {
  const hosts = new Map();
  const doc = {
    documentElement: { dataset: { renderGeneration: '1' } },
    querySelector(selector) { return hosts.get(selector) || null; }
  };
  const host = { painted: 0 };
  let calls = 0;
  whenPanelBody('pulse', doc, node => { calls += 1; node.painted += 1; });
  assert.equal(calls, 0);
  doc.documentElement.dataset.renderGeneration = '2';
  hosts.set('[data-panel="pulse"] .workspace-panel-body', host);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(calls, 0);
  assert.equal(host.painted, 0);
  whenPanelBody('pulse', doc, node => { calls += 1; node.painted += 1; });
  assert.equal(calls, 1);
  assert.equal(host.painted, 1);
});

test('the previous window is the equal length immediately before the current one, and all-history has none', () => {
  assert.equal(previousWindow({ win: 'all' }, NOW), null);
  assert.equal(previousWindow({ win: '' , from: '2026-01-01T00:00:00Z', to: '2026-01-11T00:00:00Z' }, NOW).from, Date.parse('2025-12-22T00:00:00Z'));
  const prev = previousWindow({ win: '10d' }, NOW);
  assert.equal(prev.to, NOW - 10 * DAY);
  assert.equal(prev.from, NOW - 20 * DAY);
  assert.deepEqual(currentWindow({ win: '10d' }, NOW), { from: NOW - 10 * DAY, to: NOW });
  assert.equal(previousWindow({ win: '0d' }, NOW), null);
});

test('strips compare against the previous window and never fake zero for unpriced cost', () => {
  const model = stripModel({ summary: summary(), previous: summary(), scope: { win: '30d' }, scores: { checks: [{ name: 'clarity', n: 10, median: 0.72, scorer: 'jev-1' }] } });
  const cost = model.rows.find(row => row.key === 'cost_usd');
  assert.match(cost.display, /unpriced/);
  assert.notEqual(cost.display, '$0.00');
  const all = stripModel({ summary: summary(), previous: null, scope: { win: 'all' } });
  assert.equal(all.hasPrevious, false);
  assert.equal(all.rows.find(row => row.key === 'cost_usd').previousDisplay, 'no previous period');
  assert.equal(all.rows.every(row => row.change === 'no previous period'), true);
  assert.equal(formatStripCost({ cost_usd: null, unpriced_calls: 4 }), 'unpriced');
  assert.equal(formatStripCost({ cost_usd: 0, unpriced_calls: 4, priced_calls: 0 }), 'unpriced');
  assert.deepEqual(rejectionTotal({ precheck: 1, screen: 2 }), 3);
  assert.equal(rejectionTotal(null), null);
});

test('the quality median names kind, check, scorer and n rather than inventing a value', () => {
  const median = qualityMedian({ checks: [{ name: 'clarity', n: 8, median: 0.5, scorer: 'jev-1' }, { name: 'empty', n: 0, median: null }] }, 'design');
  assert.deepEqual([median.kind, median.check, median.scorer, median.n, median.median], ['design', 'clarity', 'jev-1', 8, 0.5]);
  const absent = qualityMedian({ checks: [] }, 'brief');
  assert.equal(absent.median, null);
  assert.match(absent.label, /brief/);
});

test('movers offers the repo lens only when the time grain publishes session_repo', () => {
  const plain = makeSchema();
  assert.equal(repoLensOffered(plain), false);
  assert.deepEqual(moverLenses(plain), ['harness', 'model']);
  const withRepo = makeSchema();
  withRepo.grains.time.lenses = ['harness', 'session_model', 'session_repo'];
  assert.equal(repoLensOffered(withRepo), true);
  assert.ok(moverLenses(withRepo).includes('session_repo'));
  assert.deepEqual(offeredMeasures(plain), ['cost_usd', 'model_calls', 'commits']);
  assert.equal(offeredMeasures(plain).includes('unpriced_calls'), false);
});

test('movers ranks by change and names a missing per-group n instead of inventing one', () => {
  const model = buildMoverModel({
    lens: 'harness',
    measure: 'cost_usd',
    current: new Map([['orca', 10], ['claude', 4]]),
    previous: new Map([['orca', 2], ['claude', 6]]),
    unpriced: new Map([['orca', 0]]),
    series: new Map([['orca', [{ t: '2026-09-01', value: 1 }, { t: '2026-09-02', value: 3 }]]])
  });
  assert.deepEqual(model.rows.map(row => row.label), ['orca', 'claude']);
  assert.equal(model.rows[0].change, 8);
  assert.equal(model.rows[0].unpriced, 0);
  assert.equal(model.rows[1].unpriced, null);
  assert.equal(model.nPerGroup, 'not supplied per group');
  assert.equal(model.rows[0].sparkline.length, 2);
  assert.equal(sparkline([]), '—');
  assert.equal(groupTotals({ rows: [{ k: ['a'], v: 2 }, { k: ['a'], v: 3 }] }).get('a'), 5);
});

test('coverage keeps typed populations in their own units and never blends a percentage', () => {
  const model = coverageModel({ coverage: makeSchema().coverage, summary: summary() });
  assert.deepEqual(model.columns, ['Source', 'Latest retained timestamp', 'Age', 'Missing-data count', 'Unit']);
  const sources = model.rows.map(row => row.source);
  assert.deepEqual([...sources].sort(), sources, 'source rows are codepoint ascending');
  const serialized = JSON.stringify(model);
  assert.equal(/%/.test(serialized), false);
  assert.ok(serialized.includes('unpriced calls'));
  const usage = model.rows.find(row => row.source === 'usage');
  assert.equal(usage.unit, 'unpriced calls');
  assert.equal(usage.missing, String(summary().unpriced_calls ?? 0));
});

test('river maps four observation types with their clocks and entity keys', () => {
  const result = mapActivityList({ status: 200, body: activityList() });
  assert.equal(result.state, 'ready');
  const model = laneRows(result.rows);
  assert.deepEqual(model.data.map(row => row.key), ['session_start:fixture-session', 'artifact_version:fixture-version']);
  assert.equal(model.data[0].at, '2026-10-01T00:00:00Z');
  assert.deepEqual(model.series.map(series => series.key), ['session_start', 'artifact_version']);
  const counts = countsByType({ session_start: 2, artifact_version: 3, execution: 1, rejection: 4 });
  assert.deepEqual(counts.map(item => item.type), ['session_start', 'artifact_version', 'execution', 'rejection']);
  assert.deepEqual(counts.map(item => item.unit), ['session', 'version', 'execution', 'rejection']);
});

test('calendar rows map to day cells and coarsening is named', () => {
  const rows = calendarRows({ rows: [{ t: '2026-09-01T00:00:00Z', v: 3 }] }, 'cost_usd');
  assert.equal(rows[0].key, 'day:2026-09-01T00:00:00Z');
  assert.equal(rows[0].values.cost_usd, 3);
  assert.match(coarsenedLabel({ requested: { bucket: 'day' }, effective: { bucket: 'week' } }), /coarsened them to week/);
  assert.match(coarsenedLabel({ requested: { bucket: 'day' }, effective: { bucket: 'day' } }), /day buckets/);
  assert.deepEqual(suggestedMeasures(makeSchema()), ['cost_usd', 'model_calls', 'commits']);
});

test('the five pulse panels are valid registry entries with real chart names and one preset worth', () => {
  assert.deepEqual(PULSE_PANELS.map(panel => panel.id), ['pulse-strips', 'river', 'movers', 'calendar', 'coverage']);
  for (const panel of PULSE_PANELS) {
    assert.doesNotThrow(() => validatePanelEntry(panel));
    for (const chart of panel.charts) assert.ok(CHART_NAMES.has(chart), `${panel.id} chart ${chart}`);
    assert.equal(typeof panel.requests, 'function');
    assert.equal(typeof panel.load, 'function');
  }
  assert.equal(PULSE_PANELS.length <= 12, true);
});

test('empty causes name each applied scope and clear it through the board handle', () => {
  const cleared = [];
  const clear = request => cleared.push(request);
  const causes = emptyCausesFor({
    win: '30d',
    harness: ['orca'],
    exclude: ['repo_id:r2'],
    cohorts: { ca: '{"grain":"session"}' },
    pick: 'c2VsZWN0aW9u'
  }, clear);
  assert.deepEqual(causes.map(cause => cause.kind), ['filter', 'filter', 'cohort', 'selection']);
  assert.match(causes[0].label, /harness: orca/);
  assert.match(causes[1].label, /exclude repo_id:r2/);
  assert.match(causes[2].label, /cohort A/);
  for (const cause of causes) cause.clear();
  assert.deepEqual(cleared.map(request => request.kind), ['filter', 'filter', 'cohort', 'selection']);
  assert.deepEqual([cleared[0].key, cleared[0].value], ['harness', 'orca']);
  assert.deepEqual([cleared[1].key, cleared[1].value], ['exclude', 'repo_id:r2']);
  assert.equal(cleared[2].key, 'ca');
  assert.equal(emptyCausesFor({ win: '30d' }, clear).length, 0);
  assert.equal(emptyCausesFor({ win: '30d', cohort: null }, null).length, 0);
  assert.equal(summaryIsEmpty({}), false);
  assert.equal(summaryIsEmpty({ conversations: 0, model_calls: 0 }), true);
  assert.equal(summaryIsEmpty({ conversations: 0, model_calls: 1 }), false);
  assert.equal(summaryIsEmpty({ cost_usd: 0, rejections: { precheck: 0, screen: 0 } }), true);
});

// Deterministic responses for the panels the stub leaves empty (query rows).
const ACTIVITY_ROWS = ['session_start', 'artifact_version', 'execution', 'rejection'].map((type, index) => ({
  event_time: new Date(Date.parse('2026-09-30T12:00:00Z') - index * DAY).toISOString(),
  type,
  identity: `fix-${type}`,
  conversation_id: 'fix-session',
  repo_id: type === 'session_start' ? '' : 'fix-repo',
  path: type === 'artifact_version' ? 'docs/plans/20-fix/PLAN.md' : '',
  harness: 'orca',
  kind: type === 'artifact_version' ? 'design' : '',
  plan: '20',
  stage: type === 'rejection' ? 'screen' : ''
}));

function queryBody(url) {
  const measure = url.searchParams.get('measure') || 'cost_usd';
  const bucket = url.searchParams.get('bucket') || 'none';
  const dim = url.searchParams.get('dim');
  const population = { grain: 'time', unit: 'bucket', scope_n: 14, cohort_n: 14, eligible_n: 14, returned_n: 0, missing_by_reason: {}, relation: null };
  if (!dim) {
    const start = Date.parse('2026-09-01T00:00:00Z');
    const rows = Array.from({ length: 14 }, (_, index) => ({ t: new Date(start + index * DAY).toISOString(), k: [], v: index + 1 }));
    return { requested: { bucket: 'day' }, effective: { bucket: 'day' }, rows, population: { ...population, returned_n: rows.length } };
  }
  if (bucket === 'day') {
    const start = Date.parse('2026-09-01T00:00:00Z');
    const rows = ['orca', 'claude'].flatMap((key, group) => Array.from({ length: 7 }, (_, index) => ({
      t: new Date(start + index * DAY).toISOString(), k: [key], v: group === 0 ? index + 1 : 7 - index
    })));
    return { requested: { bucket: 'day' }, effective: { bucket: 'day' }, rows, population: { ...population, returned_n: rows.length } };
  }
  const rows = measure === 'unpriced_calls'
    ? [{ k: ['orca'], v: 1 }, { k: ['claude'], v: 0 }]
    : [{ k: ['orca'], v: 10 }, { k: ['claude'], v: 4 }];
  return { requested: { bucket: 'none' }, effective: { bucket: 'none' }, rows, population: { ...population, returned_n: rows.length } };
}

async function openPulse(page, origin) {
  await page.goto(`${origin}/b/pulse?win=30d`);
  await page.waitForFunction(() => document.querySelectorAll('.workspace-panel').length === 5 &&
    [...document.querySelectorAll('.workspace-panel')].every(panel => panel.dataset.idle === 'true'));
}

test('the pulse preset settles five panels, inspects the river, and brushes then zooms the calendar in Chromium', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
    const diagnostics = await watchPage(page);
    await page.route(/\/v1\/analytics\/activity/, route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('mode') !== 'list') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'list',
          rows: ACTIVITY_ROWS,
          population: { grain: 'activity', unit: 'typed_observation', scope_n: 4, cohort_n: 4, eligible_n: 4, returned_n: 4, missing_by_reason: {}, by_type: {} }
        })
      });
    });
    await page.route(/\/v1\/analytics\/query/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queryBody(new URL(route.request().url()))) }));
    await page.route(/\/v1\/analytics\/scores/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'design', checks: [{ name: 'clarity', n: 10, median: 0.72, scorer: 'jev-1' }] })
    }));

    await openPulse(page, harness.origin);

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['pulse-strips', 'river', 'movers', 'calendar', 'coverage']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    assert.equal(states.river, 'ready');
    assert.equal(states['pulse-strips'], 'ready');
    assert.equal(states.movers, 'ready');
    assert.equal(states.calendar, 'ready');
    assert.equal(states.coverage, 'ready');

    // River: table by default; the lanes chart is the alternative view.
    const riverTable = await page.evaluate(() => document.querySelector('[data-panel="river"] .pulse-table')?.textContent || '');
    assert.match(riverTable, /Brief execution/);
    await page.locator('[data-panel="river"] button', { hasText: 'Show chart' }).click();
    await page.waitForFunction(() => document.querySelector('[data-panel="river"] yk-lanes')?.dataset.state === 'ready');
    const lanes = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="river"] yk-lanes');
      return { categories: chart.inspect().categories, series: chart.inspect().series.map(series => series.key), state: chart.dataset.state };
    });
    assert.equal(lanes.state, 'ready');
    assert.equal(lanes.categories.length, 4);
    assert.deepEqual(lanes.series.sort(), ['artifact_version', 'execution', 'rejection', 'session_start']);
    await page.evaluate(() => document.querySelector('[data-panel="river"] yk-lanes').shadowRoot.querySelector('.yk-chart').focus());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
    const inspected = await page.evaluate(() => document.querySelector('.workspace-inspector').textContent);
    assert.match(inspected, /fix-/);
    await page.keyboard.press('Escape');

    // Strips: current vs previous and unpriced is never $0 (table view).
    await page.locator('[data-panel="pulse-strips"] button', { hasText: 'Show table' }).click();
    const strips = await page.evaluate(() => document.querySelector('[data-panel="pulse-strips"]').textContent);
    assert.match(strips, /previous/i);
    assert.match(strips, /unpriced/i);
    assert.match(strips, /Priced spend\$12\.50\+ \(1 unpriced\)/);
    assert.doesNotMatch(strips, /Priced spend\$0\.00/);

    // Movers: one combined priced-spend chart and table; no measure chooser.
    const movers = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="movers"]');
      return {
        options: [...root.querySelectorAll('select option')].map(option => option.value),
        headers: [...root.querySelectorAll('.pulse-table thead th')].map(cell => cell.textContent),
        text: root.textContent
      };
    });
    assert.deepEqual(movers.options, []);
    assert.deepEqual(movers.headers, ['Harness/model', 'Current priced spend (USD)', 'Previous priced spend (USD)', 'Change (USD)', 'Unpriced calls']);
    assert.match(movers.text, /Repository lens not offered/);

    // Calendar: brush previews with no URL change, zoom commits and clears sel.
    const caveat = await page.evaluate(() => document.querySelector('[data-panel="calendar"] .pulse-calendar-caveat').textContent);
    assert.match(caveat, /share entity keys/);
    await page.locator('[data-panel="calendar"] yk-matrix').scrollIntoViewIfNeeded();
    const points = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="calendar"] yk-matrix');
      return [1, 8].map(index => {
        const rect = chart.shadowRoot.querySelector(`[data-mark="${index}"] [data-hit]`).getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
    });
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await page.mouse.move(points[1].x, points[1].y, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('[data-panel="calendar"] .pulse-preview')?.dataset.state === 'preview');
    let search = new URLSearchParams(await page.evaluate(() => location.search));
    assert.ok(search.get('sel'), 'the brush writes a transient sel');
    assert.equal(search.get('from'), null);
    assert.equal(search.get('to'), null);
    const preview = await page.evaluate(() => document.querySelector('[data-panel="calendar"] .pulse-preview').textContent);
    assert.match(preview, /Peer preview only/);
    await page.locator('[data-panel="calendar"] .pulse-zoom').click();
    await page.waitForFunction(() => document.querySelector('[data-panel="calendar"]') === null ||
      document.querySelector('[data-panel="calendar"]').dataset.idle === 'true');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('from') !== null);
    search = new URLSearchParams(await page.evaluate(() => location.search));
    assert.ok(search.get('from') && search.get('to'));
    assert.equal(search.get('sel'), null);

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});

test('an empty river names the applied filter and its Clear button pushes the scope without it', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2200 } });
    const diagnostics = await watchPage(page);
    await page.route(/\/v1\/analytics\/activity/, route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('mode') !== 'list') return route.continue();
      const filtered = url.searchParams.getAll('harness').includes('orca');
      const rows = filtered ? [] : ACTIVITY_ROWS;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'list',
          rows,
          population: { grain: 'activity', unit: 'typed_observation', scope_n: rows.length, cohort_n: rows.length, eligible_n: rows.length, returned_n: rows.length, missing_by_reason: {}, by_type: {} }
        })
      });
    });
    await page.route(/\/v1\/analytics\/query/, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(queryBody(new URL(route.request().url()))) }));
    await page.route(/\/v1\/analytics\/scores/, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'design', checks: [{ name: 'clarity', n: 10, median: 0.72, scorer: 'jev-1' }] })
    }));

    await page.goto(`${harness.origin}/b/pulse?win=30d&harness=orca`);
    await page.waitForFunction(() => document.querySelector('[data-panel="river"]')?.dataset.state === 'empty');
    const empty = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel="river"]');
      return { text: panel.textContent, buttons: [...panel.querySelectorAll('button')].map(button => button.textContent) };
    });
    assert.match(empty.text, /harness: orca/);
    assert.ok(empty.buttons.includes('Clear filter'), `expected a Clear filter button, saw ${empty.buttons.join(', ')}`);

    await page.locator('[data-panel="river"] button', { hasText: 'Clear filter' }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).getAll('harness').length === 0 &&
      document.querySelector('[data-panel="river"]')?.dataset.state === 'ready');
    const search = new URLSearchParams(await page.evaluate(() => location.search));
    assert.equal(search.get('harness'), null);
    assert.ok(harness.stats.maxInFlight <= 4, `in-flight analytics requests peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
