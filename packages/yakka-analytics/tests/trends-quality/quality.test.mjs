import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';
import { QUALITY_PANELS, QUALITY_SPECS, QUALITY_PRESET_ID } from '../../web/js/panels/p10-quality.js';
import {
  BASELINE_LABEL, baselineBand, catalogueChecks, contentSplits, resolveScorer, scoreRangeRows
} from '../../web/js/panels/score-ranges.js';
import { scoreTrendModel } from '../../web/js/panels/score-trend.js';
import { artifactDestination, scoreIdentity, stripRows, stripPopulationText } from '../../web/js/panels/score-strips.js';
import { BAND_KEYS, bandMixRows } from '../../web/js/panels/band-mix.js';
import { p10Schema } from './fixture.mjs';

const schema = p10Schema();

const CATALOGUE = { kind: 'design', checks: [{ name: 'clarity' }, { name: 'structure' }] };
const BASELINES = {
  kind: 'design', population: 'content',
  scorers: {
    'jev-1': {
      clarity: { n: 40, p25: 0.45, median: 0.65, p75: 0.85 },
      structure: { n: 22, p25: 0.3, median: 0.55, p75: 0.75 }
    },
    'jev-0': { clarity: { n: 0, p25: null, median: null, p75: null } }
  }
};

function scoresBody(check = 'clarity') {
  const scale = check === 'structure' ? 0.8 : 1;
  return {
    kind: 'design',
    checks: [{
      name: check, n: 12, min: 0.2, p25: 0.5, median: 0.7, p75: 0.85, max: 1, scorer: 'jev-1',
      groups: [
        { key: 'harness:orca', n: 7, min: 0.2, p25: 0.5, median: 0.7 * scale, p75: 0.85, max: 1 },
        { key: 'harness:claude-code', n: 5, min: 0.3, p25: 0.55, median: 0.75, p75: 0.9, max: 0.95 }
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
        { key: 'model:claude', n: 3, p25: 0.4, median: 0.6, p75: 0.8 },
        { key: 'model:gpt', n: 1, p25: 0.3, median: 0.5, p75: 0.7 }
      ] },
      { t: '2026-09-02T00:00:00Z', n: 5, p25: 0.45, median: 0.65, p75: 0.85, groups: [
        { key: 'model:claude', n: 4, p25: 0.45, median: 0.65, p75: 0.85 }
      ] }
    ]
  }],
  population: { grain: 'content', unit: 'content_hash', scope_n: 9, eligible_n: 9, returned_n: 9 }
};

const ARTIFACT_ENTITIES = {
  rows: [
    { id: 'h1', m: { 'score:clarity': 0.2 }, l: { path: 'docs/a.md', repo_id: 'repo-a', kind: 'design', scorer: 'jev-1', content_hash: 'h1' } },
    { id: 'h2', m: { 'score:clarity': 0.9 }, l: { path: 'docs/b.md', repo_id: 'repo-b', kind: 'design', scorer: 'jev-1', content_hash: 'h2' } },
    { id: 'h3', m: { 'score:clarity': null }, l: { path: 'docs/c.md', repo_id: 'repo-a', kind: 'brief', scorer: 'jev-1', content_hash: 'h3' } }
  ],
  population: { grain: 'artifact', unit: 'file', scope_n: 3, eligible_n: 3, returned_n: 3, missing_by_reason: { unscored: 1 } }
};

const BAND_AGGREGATE = {
  rows: [
    { k: ['low', 'design'], v: 2 }, { k: ['mid', 'design'], v: 3 }, { k: ['high', 'design'], v: 1 },
    { k: ['unscored', 'design'], v: 1 }, { k: ['baseline_unavailable', 'design'], v: 1 }
  ],
  omitted_groups: 1, omitted_n: 1,
  population: { grain: 'artifact', unit: 'file', scope_n: 8, eligible_n: 8, returned_n: 8 }
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

test('hash-weighted ranges keep n and the scorer p25–p75 baseline', () => {
  assert.deepEqual(catalogueChecks(CATALOGUE), ['clarity', 'structure']);
  const chosen = resolveScorer(BASELINES, 'clarity', '');
  assert.equal(chosen.scorer, 'jev-1');
  assert.equal(chosen.entry.n, 40);
  const band = baselineBand(chosen.entry);
  assert.equal(band.from, 0.45);
  assert.equal(band.to, 0.85);
  assert.equal(band.label, BASELINE_LABEL);
  assert.equal(baselineBand({ n: 0, p25: null, p75: null }), null);
  const unknown = resolveScorer(BASELINES, 'clarity', 'ghost');
  assert.equal(unknown.unknown, true);
  const model = scoreRangeRows(scoresBody('clarity'), 'clarity');
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].key, 'harness:orca');
  assert.equal(model.rows[0].n, 7);
  assert.equal(model.rows[0].values.q1, 0.5);
  assert.equal(model.rows[0].values.q3, 0.85);
  assert.equal(model.omittedGroups, 1);
  assert.equal(model.omittedN, 2);
  assert.equal(model.population.unit, 'content_hash');
  assert.deepEqual(contentSplits(schema), ['harness', 'session_model', 'repo_id', 'plan']);
});

test('the score trend draws p25, median and p75 per group and names bucket reuse', () => {
  const model = scoreTrendModel({ body: SERIES, check: 'clarity', split: 'session_model', baseline: baselineBand(BASELINES.scorers['jev-1'].clarity) });
  assert.deepEqual(model.series.map(series => series.key), [
    'model:claude|p25', 'model:claude|median', 'model:claude|p75',
    'model:gpt|p25', 'model:gpt|median', 'model:gpt|p75'
  ]);
  assert.equal(model.rows.length, 2);
  assert.equal(model.rows[0].values['model:claude|median'], 0.6);
  assert.match(model.baselineText, /all-time scorer baseline/);
  const missing = scoreTrendModel({ body: SERIES, check: 'clarity', split: '', baseline: null });
  assert.match(missing.baselineText, /baseline_unavailable/);
});

test('file-weighted strips key the canonical identity and open the artifact destination', () => {
  const model = stripRows(ARTIFACT_ENTITIES, 'clarity', 'kind');
  assert.equal(model.rows.length, 3);
  const key = JSON.stringify({ path: 'docs/a.md', repo_id: 'repo-a' });
  assert.equal(model.rows[0].key, key);
  assert.equal(model.entities[key].destination, '/artifact?repo_id=repo-a&path=docs%2Fa.md&hash=h1');
  assert.match(model.entities[key].destination, /^\/artifact\?repo_id=/);
  assert.equal(scoreIdentity(ARTIFACT_ENTITIES.rows[0]).hash, 'h1');
  assert.equal(artifactDestination({ repo_id: 'r', path: 'p', hash: 'h' }), '/artifact?repo_id=r&path=p&hash=h');
  assert.equal(model.population.unit, 'file');
  assert.match(stripPopulationText(ARTIFACT_ENTITIES), /3 of 3 files/);
  assert.match(stripPopulationText(ARTIFACT_ENTITIES), /1 missing: unscored/);
});

test('band mix keeps low, mid, high, unscored and baseline_unavailable separate', () => {
  const model = bandMixRows(BAND_AGGREGATE);
  assert.deepEqual(model.series.map(series => series.key), BAND_KEYS);
  assert.equal(model.rows.length, 1);
  assert.deepEqual(model.rows[0].values, {
    low: 2, mid: 3, high: 1, unscored: 1, baseline_unavailable: 1
  });
  assert.equal(model.omittedGroups, 1);
  assert.equal(model.population.unit, 'file');
});

// ---------------------------------------------------------------------------
// Browser acceptance: /b/quality settles its four frames, both populations are
// labelled, the baseline band is drawn (or named missing), a strip mark opens
// the artifact destination, and check/scorer changes regroup with stable styles.
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

test('quality settles four frames, separates populations, draws the baseline and opens the artifact destination', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
    const diagnostics = await watchPage(page);
    await stubQuality(page);
    await openBoard(page, harness.origin, '/b/quality?win=30d');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['score-ranges', 'score-trend', 'score-strips', 'band-mix']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const ranges = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="score-ranges"]');
      const chart = root.querySelector('yk-ranges');
      return {
        text: root.textContent,
        baseline: Boolean(chart?.shadowRoot?.querySelector('[data-baseline="true"]')),
        marks: chart?.inspect().marks.map(mark => ({ key: mark.key, cssVar: mark.style?.cssVar || '' })) || []
      };
    });
    assert.match(ranges.text, /distinct content hashes/);
    assert.match(ranges.text, /all-time scorer baseline/);
    assert.match(ranges.text, /groups omitted/);
    assert.equal(ranges.baseline, true, 'the all-time baseline band is drawn');
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
    assert.match(strips.text, /file-weighted/);
    assert.match(strips.text, /3 of 3 files/);
    assert.match(strips.text, /1 missing: unscored/);
    assert.match(strips.text, /Open this identity in the artifact reader/);
    const stripKey = JSON.stringify({ path: 'docs/a.md', repo_id: 'repo-a' });
    assert.ok(strips.marks.includes(stripKey));
    assert.match(strips.entities[stripKey].destination, /^\/artifact\?repo_id=/);

    const bands = await page.evaluate(() => document.querySelector('[data-panel="band-mix"]').textContent);
    for (const label of ['below p25', 'mid (p25–p75 inclusive)', 'above p75', 'unscored', 'baseline_unavailable']) {
      assert.ok(bands.includes(label), `band-mix names ${label}`);
    }
    assert.match(bands, /2/);

    // A check change regroups the ranges and surviving entity styles hold.
    const before = ranges.marks.find(mark => mark.key === 'harness:orca').cssVar;
    await page.evaluate(() => {
      const selects = [...document.querySelectorAll('[data-panel="score-ranges"] .workspace-panel-chooser select')];
      selects[1].value = 'structure';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).scope?.check === 'structure';
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return panel.dataset.idle === 'true' && panel.textContent.includes('structure');
    });
    const after = await page.evaluate(() => {
      const chart = document.querySelector('[data-panel="score-ranges"] yk-ranges');
      return chart.inspect().marks.map(mark => ({ key: mark.key, cssVar: mark.style?.cssVar || '' }));
    });
    assert.equal(after.find(mark => mark.key === 'harness:orca').cssVar, before, 'a surviving entity keeps its colour');

    // A scorer with n=0 is named baseline_unavailable, never unscored.
    await page.evaluate(() => {
      const selects = [...document.querySelectorAll('[data-panel="score-ranges"] .workspace-panel-chooser select')];
      const scorer = selects.find(select => [...select.options].some(option => option.value === 'jev-0'));
      scorer.value = 'jev-0';
      scorer.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p1');
      return raw && JSON.parse(raw).scope?.scorer === 'jev-0';
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-panel="score-ranges"]');
      return panel.dataset.idle === 'true' && panel.textContent.includes('baseline_unavailable');
    });

    // Inspect a strip mark; the shared inspector opens the artifact destination.
    await page.evaluate(key => {
      const chart = document.querySelector('[data-panel="score-strips"] yk-ranges');
      chart.dispatchEvent(new CustomEvent('inspect', { bubbles: true, composed: true, detail: { key, values: {} } }));
    }, stripKey);
    await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
    const inspected = await page.evaluate(() => {
      const node = document.querySelector('.workspace-inspector');
      return { key: node.dataset.key, grain: node.dataset.grain };
    });
    assert.equal(inspected.key, stripKey);
    assert.equal(inspected.grain, 'artifact');
    await page.click('.workspace-inspector button:has-text("Open")');
    await page.waitForFunction(() => location.pathname === '/artifact');
    const destination = new URL(page.url());
    assert.equal(destination.searchParams.get('repo_id'), 'repo-a');
    assert.equal(destination.searchParams.get('path'), 'docs/a.md');
    assert.equal(destination.searchParams.get('hash'), 'h1');

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
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
