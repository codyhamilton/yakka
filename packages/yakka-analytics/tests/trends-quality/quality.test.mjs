import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';
import { QUALITY_PANELS, QUALITY_SPECS, QUALITY_PRESET_ID } from '../../web/js/panels/p10-quality.js';
import { p10Schema } from './fixture.mjs';

const CATALOGUE = { kind: 'design', checks: [{ name: 'clarity' }, { name: 'structure' }] };
const BASELINES = {
  kind: 'design', population: 'content',
  scorers: {
    beta: {
      clarity: { n: 40, p25: 0.45, median: 0.65, p75: 0.85 },
      structure: { n: 22, p25: 0.3, median: 0.55, p75: 0.75 }
    },
    alpha: { clarity: { n: 0, p25: null, median: null, p75: null } }
  }
};

function scoresBody(check = 'clarity') {
  return {
    kind: 'design',
    checks: [{
      name: check, n: 12, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1, scorer: 'beta',
      groups: [
        { k: 'harness:orca', n: 7, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1 },
        { k: 'harness:claude-code', n: 5, min: 0.3, p25: 0.55, median: 0.75, p75: 0.9, max: 0.95 }
      ],
      omitted_groups: 1, omitted_n: 2
    }],
    population: { grain: 'content', unit: 'content_hash', scope_n: 14, eligible_n: 14, returned_n: 12 }
  };
}

const SERIES = {
  kind: 'design', bucket: 'day',
  checks: [{
    name: 'clarity',
    points: [
      { t: '2026-09-01T00:00:00Z', n: 4, p25: 0.4, median: 0.6, p75: 0.8, groups: [
        { k: 'session_model:claude', n: 3, p25: 0.4, median: 0.6, p75: 0.8 },
        { k: 'session_model:gpt', n: 1, p25: 0.3, median: 0.5, p75: 0.7 }
      ] },
      { t: '2026-09-02T00:00:00Z', n: 5, p25: 0.45, median: 0.65, p75: 0.85, groups: [
        { k: 'session_model:claude', n: 4, p25: 0.45, median: 0.65, p75: 0.85 }
      ] }
    ]
  }],
  population: { grain: 'content', unit: 'content_hash', scope_n: 9, eligible_n: 9, returned_n: 9 }
};

const ARTIFACT_ENTITIES = {
  rows: [
    { l: { path: 'docs/a.md', repo_id: 'repo-a', kind: 'design', content_hash: 'h1', scorer: 'beta', observed: '2026-09-02' }, m: { 'score:clarity': 0.2 } },
    { l: { path: 'docs/b.md', repo_id: 'repo-b', kind: 'brief', content_hash: 'h2', scorer: 'beta', observed: '2026-09-01' }, m: { 'score:clarity': 0.9 } },
    { l: { path: 'docs/c.md', repo_id: 'repo-a', kind: 'report', content_hash: 'h3', scorer: 'beta', observed: '2026-08-30' }, m: { 'score:clarity': null } }
  ],
  population: { grain: 'artifact', unit: 'file', scope_n: 3, eligible_n: 3, returned_n: 3, missing_by_reason: { unscored: 1 } }
};

const BAND_AGGREGATE = {
  groups: [
    { k: ['low', 'design'], n: 2 }, { k: ['mid', 'design'], n: 3 }, { k: ['high', 'design'], n: 1 },
    { k: ['unscored', 'design'], n: 1 }, { k: ['baseline_unavailable', 'design'], n: 1 },
    { k: ['mid', 'brief'], n: 3 }
  ],
  population: { grain: 'artifact', unit: 'file', scope_n: 11, eligible_n: 11, returned_n: 11 }
};

test('the Quality preset is four valid panels and one registered preset', () => {
  assert.deepEqual(QUALITY_PANELS.map(panel => panel.id), ['score-ranges', 'score-trend', 'score-strips', 'band-mix']);
  for (const panel of QUALITY_PANELS) assert.doesNotThrow(() => validatePanelEntry(panel));
  const preset = lookupPreset(QUALITY_PRESET_ID);
  assert.ok(preset);
  assert.deepEqual(preset.panels, QUALITY_PANELS.map(panel => panel.id));
  assert.deepEqual(Object.keys(QUALITY_SPECS).sort(), QUALITY_PANELS.map(panel => panel.id).sort());
  assert.deepEqual(preset.specs, QUALITY_SPECS);
});

// ---------------------------------------------------------------------------
// Browser acceptance: /b/quality settles its four frames in two rows, the four
// literal captions sit above their charts, every table row is 30px, the score
// baseline is drawn, and a Check/Scorer change updates plot, baseline and caption
// together. No animation or fixed sleeps.
// ---------------------------------------------------------------------------

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function openBoard(page, origin, path) {
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length === 4 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function stubQuality(page) {
  const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/v1/analytics/schema*', route => route.fulfill(json(p10Schema())));
  await page.route('**/v1/analytics/scores*', route => {
    const check = new URL(route.request().url()).searchParams.get('check');
    route.fulfill(json(check ? scoresBody(check) : CATALOGUE));
  });
  await page.route('**/v1/analytics/score-series*', route => route.fulfill(json(SERIES)));
  await page.route('**/v1/baselines*', route => route.fulfill(json(BASELINES)));
  await page.route('**/v1/analytics/entities*', route => {
    const search = new URL(route.request().url()).searchParams;
    route.fulfill(json(search.get('mode') === 'aggregate' ? BAND_AGGREGATE : ARTIFACT_ENTITIES));
  });
}

const CAPTIONS = {
  'score-ranges': 'Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.',
  'score-trend': 'Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.',
  'score-strips': 'Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.',
  'band-mix': 'Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.'
};

test('quality settles two rows with literal captions, baseline, 30px rows and live Check/Scorer', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = await watchPage(page);
    await stubQuality(page);
    await openBoard(page, harness.origin, '/b/quality?win=30d');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['score-ranges', 'score-trend', 'score-strips', 'band-mix']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const layout = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => {
      const rect = panel.getBoundingClientRect();
      return { id: panel.dataset.panel, top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width) };
    }));
    assert.equal(layout[0].top, layout[1].top, 'scores and trend share the first row');
    assert.equal(layout[2].top, layout[3].top, 'strips and bands share the second row');
    assert.ok(layout[2].top > layout[0].top, 'the second row is below the first');
    for (const panel of layout) assert.ok(panel.width >= 700, `${panel.id} is an equal column (${panel.width}px)`);

    const captions = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [
      panel.dataset.panel, panel.querySelector('.workspace-panel-caption')?.textContent || ''
    ])));
    for (const [id, text] of Object.entries(CAPTIONS)) assert.equal(captions[id], text, `${id} literal caption`);

    const headers = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [
      panel.dataset.panel,
      [...panel.querySelectorAll('.workspace-panel-chooser select')].map(select => select.getAttribute('aria-label'))
    ])));
    assert.deepEqual(headers['score-ranges'], ['Check', 'Scorer', 'Group by']);
    assert.deepEqual(headers['score-trend'], ['Check', 'Scorer', 'Group by']);
    assert.deepEqual(headers['score-strips'], ['Check', 'Scorer']);
    assert.deepEqual(headers['band-mix'], ['Check', 'Scorer']);

    const chartHeights = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => ({
      id: panel.dataset.panel,
      height: Math.round(panel.querySelector('.p10-quality-chart')?.getBoundingClientRect().height || 0)
    })));
    for (const chart of chartHeights) assert.ok(chart.height >= 160, `${chart.id} chart is at least 160px (${chart.height})`);

    const ranges = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="score-ranges"]');
      const chart = root.querySelector('yk-ranges');
      return {
        text: root.textContent,
        baseline: Boolean(chart?.shadowRoot?.querySelector('[data-baseline="true"]')),
        marks: chart?.inspect().marks.map(mark => ({ key: mark.key, cssVar: mark.style?.cssVar || '' })) || []
      };
    });
    assert.match(ranges.text, /content versions/);
    assert.match(ranges.text, /All-history baseline for this scorer in this tenant/);
    assert.match(ranges.text, /groups omitted/);
    assert.equal(ranges.baseline, true, 'the all-history baseline band is drawn');
    assert.ok(ranges.marks.some(mark => mark.key === 'harness:orca'));

    const strips = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="score-strips"]');
      const chart = root.querySelector('yk-ranges');
      return {
        text: root.textContent,
        marks: chart?.inspect().marks.map(mark => mark.key) || [],
        entities: chart?.spec?.entities || {}
      };
    });
    assert.match(strips.text, /one dot per latest artifact file/);
    assert.match(strips.text, /3 of 3 files/);
    assert.match(strips.text, /1 missing: unscored/);
    const stripKey = JSON.stringify({ path: 'docs/a.md', repo_id: 'repo-a' });
    assert.ok(strips.marks.includes(stripKey));
    assert.match(strips.entities[stripKey].destination, /^\/artifact\?repo_id=/);

    const bands = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="band-mix"]');
      const chart = root.querySelector('yk-bars');
      return { text: root.textContent, tokens: (chart?.spec?.series || []).map(series => [series.key, series.cssVar]) };
    });
    for (const label of ['below p25', 'mid (p25–p75 inclusive)', 'above p75', 'unscored', 'baseline unavailable']) {
      assert.ok(bands.text.includes(label), `band-mix names ${label}`);
    }
    assert.deepEqual(bands.tokens, [
      ['low', '--yk-status-bad'], ['mid', '--yk-status-warn'], ['high', '--yk-status-good'],
      ['unscored', '--yk-neutral-unscored'], ['baseline_unavailable', '--yk-neutral-unknown']
    ]);

    // Toggle every panel to its table and measure the fixed 30px rows.
    for (const id of ids) {
      await page.click(`[data-panel="${id}"] .p10-view-toggle[data-view="table"]`);
      const rows = await page.evaluate(panelId => {
        const root = document.querySelector(`[data-panel="${panelId}"]`);
        return [...root.querySelectorAll('tbody tr')].map(row => Math.round(row.getBoundingClientRect().height));
      }, id);
      assert.ok(rows.length > 0, `${id} table has rows`);
      for (const height of rows) assert.ok(Math.abs(height - 30) <= 1, `${id} row is 30±1px (${height})`);
    }
    const bandTable = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="band-mix"]');
      return {
        headers: [...root.querySelectorAll('thead th')].map(cell => cell.textContent),
        first: [...root.querySelectorAll('tbody tr')][0]?.textContent
      };
    });
    assert.deepEqual(bandTable.headers, ['Kind', 'Band', 'Files']);
    assert.equal(bandTable.first, 'briefmid (p25–p75 inclusive)3');
    for (const id of ids) await page.click(`[data-panel="${id}"] .p10-view-toggle[data-view="chart"]`);

    // A Check change updates the ranges, the caption and the all-history baseline.
    await page.selectOption('[data-panel="score-ranges"] select[aria-label="Check"]', 'structure');
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).scope?.check === 'structure';
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return panel.dataset.idle === 'true' && panel.querySelector('.workspace-panel-caption')?.textContent.includes('structure');
    });
    const changed = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return { caption: panel.querySelector('.workspace-panel-caption')?.textContent || '', text: panel.textContent };
    });
    assert.match(changed.caption, /design structure scores/);
    assert.match(changed.text, /structure over content versions by harness; scorer beta/);
    assert.match(changed.text, /p25 0.3 – p75 0.75 \(n 22\)/);

    // A scorer with n=0 is labelled baseline unavailable, never unscored.
    await page.selectOption('[data-panel="score-ranges"] select[aria-label="Scorer"]', 'alpha');
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).scope?.scorer === 'alpha';
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return panel.dataset.idle === 'true' && panel.textContent.includes('baseline unavailable');
    });
    const missing = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="score-ranges"] yk-ranges');
      return { band: Boolean(chart?.shadowRoot?.querySelector('[data-baseline="true"]')), text: document.querySelector('[data-panel="score-ranges"]').textContent };
    });
    assert.equal(missing.band, false, 'no baseline band is drawn for a missing baseline');
    assert.match(missing.text, /baseline unavailable for this scorer and check/);

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});

test('an unknown check is a named unsupported state, not an empty range', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await stubQuality(page);
    const spec = { grain: 'content', measures: ['score'], split: 'harness', chart: 'ranges', scope: { check: 'ghost' } };
    await page.goto(`${harness.origin}/b/quality?win=30d&p1=${encodeURIComponent(JSON.stringify(spec))}`);
    await page.waitForFunction(() => document.querySelector('[data-panel="score-ranges"]')?.dataset.idle === 'true');
    const result = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return { state: panel.dataset.state, text: panel.textContent };
    });
    assert.equal(result.state, 'unsupported');
    assert.match(result.text, /ghost/);
    assert.match(result.text, /not in the score catalogue/);
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
