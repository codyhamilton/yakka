import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPreset } from '../../web/js/boards/presets.js';
import { hasPanel, lookupPanel, validatePanelEntry } from '../../web/js/panels/registry.js';
import {
  COST_TOOL_REASON, COST_TOOL_TRY, REPO_TOOL_REASON, REPO_TOOL_TRY, TOOLS_MEASURES,
  TOOLS_NOTES, TOOLS_PANELS, TOOLS_SPECS, assertToolsRegistered, registerToolsPanels,
  toolsChooserModel, toolsJoinGuard, toolsMixSplits, toolsToolPublished, toolsTreemapChild, toolsTreemapSpec
} from '../../web/js/panels/p10-tools.js';
import { buildMix, mixTableRows, MIX_PANEL } from '../../web/js/panels/mix.js';
import { TREEMAP_PANEL } from '../../web/js/panels/treemap.js';
import { p10Phase, p10Query, p10Schema } from './fixture.mjs';

const schema = p10Schema();

test('the Tools preset registers four shared panels with canonical hook_events specs', () => {
  registerToolsPanels();
  const preset = lookupPreset('tools');
  assert.ok(preset);
  assert.deepEqual(preset.panels, ['mix', 'treemap', 'rank', 'rhythm']);
  assert.deepEqual(TOOLS_PANELS.map(panel => panel.id), preset.panels);
  for (const panel of TOOLS_PANELS) {
    assert.ok(hasPanel(panel.id), `${panel.id} is registered`);
    assert.doesNotThrow(() => validatePanelEntry(lookupPanel(panel.id)));
  }
  assert.deepEqual(Object.keys(TOOLS_SPECS).sort(), preset.panels.slice().sort());
  for (const spec of Object.values(TOOLS_SPECS)) {
    assert.equal(spec.grain, 'time');
    assert.deepEqual(spec.measures, ['hook_events']);
  }
  assert.equal(TOOLS_SPECS.mix.split, 'tool_kind');
  assert.equal(TOOLS_SPECS.mix.scope.second, 'harness');
  assert.equal(TOOLS_SPECS.mix.scope.mode, 'stacked');
  assert.equal(TOOLS_SPECS.treemap.scope.parent, 'harness');
  assert.equal(TOOLS_SPECS.treemap.split, 'tool');
  assert.equal(TOOLS_SPECS.rank.split, 'tool');
  assert.equal(TOOLS_SPECS.rank.chart, 'rank');
  assert.equal(TOOLS_SPECS.rhythm.chart, 'heatmap');
  assert.deepEqual(preset.notes, TOOLS_NOTES);
  assert.doesNotThrow(() => registerToolsPanels());
  assert.doesNotThrow(() => assertToolsRegistered());
  assert.throws(() => assertToolsRegistered([{ id: 'ghost-tool-panel' }], () => false), /ghost-tool-panel/);
});

test('cost and repo requests in a tool view are named unsupported with a try', () => {
  assert.deepEqual(TOOLS_MEASURES, ['hook_events']);
  const cost = toolsJoinGuard('cost_usd', ['harness', 'tool']);
  assert.equal(cost.reason, COST_TOOL_REASON);
  assert.match(cost.reason, /hook_events and cost_usd are different measures/);
  assert.match(cost.reason, /use hook_events by tool or cost by model\/harness/);
  assert.equal(cost.try, COST_TOOL_TRY);
  const repo = toolsJoinGuard('hook_events', ['repo_id']);
  assert.equal(repo.reason, REPO_TOOL_REASON);
  assert.equal(repo.try, REPO_TOOL_TRY);
  assert.equal(toolsJoinGuard('hook_events', ['session_repo']).try, 'harness');
  assert.equal(toolsJoinGuard('hook_events', ['tool_kind', 'harness']), null);
});

test('the Tools chooser offers hook_events and tool lenses only, naming cost and repo', () => {
  const base = toolsChooserModel(MIX_PANEL, { measures: ['hook_events'], split: 'tool_kind' }, schema);
  assert.deepEqual(base.measures, ['hook_events']);
  assert.equal(base.splits.includes('repo_id'), false);
  assert.equal(base.splits.includes('session_repo'), false);
  assert.ok(base.splits.includes('tool_kind'));
  assert.ok(base.splits.includes('tool'), 'tool is published by the fixture schema');
  const cost = toolsChooserModel(TREEMAP_PANEL, { measures: ['cost_usd'], split: 'tool' }, schema);
  assert.deepEqual(cost.measures, ['hook_events']);
  const costItem = cost.unsupported.find(item => item.kind === 'measure' && item.name === 'cost_usd');
  assert.ok(costItem);
  assert.equal(costItem.reason, COST_TOOL_REASON);
  assert.equal(costItem.try, COST_TOOL_TRY);
  const repo = toolsChooserModel(MIX_PANEL, { measures: ['hook_events'], split: 'repo_id' }, schema);
  assert.equal(repo.split, '', 'a repo split is never offered');
  const repoItem = repo.unsupported.find(item => item.kind === 'split' && item.name === 'repo_id');
  assert.ok(repoItem);
  assert.equal(repoItem.reason, REPO_TOOL_REASON);
  assert.equal(repoItem.try, REPO_TOOL_TRY);
});

test('tool and tool_kind stay distinct and an unknown kind is never folded away', () => {
  assert.equal(toolsToolPublished(schema), true);
  assert.equal(toolsTreemapChild(schema), 'tool');
  assert.equal(toolsTreemapSpec(schema).split, 'tool');
  const noTool = {
    ...schema,
    grains: { ...schema.grains, time: { ...schema.grains.time, lenses: schema.grains.time.lenses.filter(lens => lens !== 'tool') } },
    measures: schema.measures.map(item => item.name === 'hook_events' ? { ...item, dims: item.dims.filter(dim => dim !== 'tool') } : item)
  };
  assert.equal(toolsToolPublished(noTool), false);
  assert.equal(toolsTreemapChild(noTool), 'tool_kind');
  assert.equal(toolsTreemapSpec(noTool).split, 'tool_kind');
  assert.deepEqual(toolsMixSplits(schema), ['tool', 'tool_kind']);
  assert.deepEqual(toolsMixSplits(noTool), ['tool_kind']);

  const rows = [
    { k: ['shell', 'Bash'], v: 4 },
    { k: ['unknown', 'Bash'], v: 2 },
    { k: ['', 'Read'], v: 1 },
    { k: ['(mixed)', 'Read'], v: 3 }
  ];
  const model = buildMix({ rows, measure: 'hook_events', dims: ['tool_kind', 'tool'], mode: 'stacked' });
  assert.deepEqual(model.rows.map(row => row.label), ['shell', 'unknown', '', '(mixed)']);
  const labels = model.series.map(series => series.label);
  for (const label of ['Bash', 'Read']) assert.ok(labels.includes(label));
  assert.equal(labels.includes('(other)'), false);
  assert.equal(mixTableRows(model).length, 4);
});

// ---------------------------------------------------------------------------
// Browser acceptance: /b/tools settles four frames, tables equal the fixture,
// a split change regroups, special tool groups stay separate, rhythm shows the
// shared-key note, and the unsupported tool joins carry their `try`.
// ---------------------------------------------------------------------------

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';

async function openBoard(page, origin, path) {
  await page.goto(`${origin}${path}`);
  await page.waitForFunction(() => {
    const panels = [...document.querySelectorAll('.workspace-panel')];
    return panels.length > 0 && panels.every(panel => panel.dataset.idle === 'true' && panel.dataset.state !== 'loading');
  });
}

async function rowsOf(page, id) {
  return page.evaluate(panelId => {
    const root = document.querySelector(`[data-panel="${panelId}"]`);
    return [...root.querySelectorAll('table tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent));
  }, id);
}

test('tools settles four panels, matches the fixture and names unsupported tool joins', async t => {
  const environment = loadBrowserEnvironment();
  if (!environment.ok) { t.skip(environment.reason || SKIP_REASON); return; }
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true });
  let browser;
  try {
    browser = await launchBrowser(environment);
    const page = await browser.newPage({ viewport: { width: 1280, height: 3200 } });
    const diagnostics = await watchPage(page);
    harness.resetStats();
    await openBoard(page, harness.origin, '/b/tools?win=30d');

    const ids = await page.evaluate(() => [...document.querySelectorAll('.workspace-panel')].map(panel => panel.dataset.panel));
    assert.deepEqual(ids, ['mix', 'treemap', 'rank', 'rhythm']);
    const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.workspace-panel')].map(panel => [panel.dataset.panel, panel.dataset.state])));
    for (const id of ids) assert.equal(states[id], 'ready', `${id} is ready`);

    const phase = p10Phase({ to: new Date().toISOString() });
    assert.equal(phase >= 0, true);

    const treemapRows = p10Query({ measure: 'hook_events', dims: ['harness', 'tool'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.k[0]), String(row.v)]);
    const rankRows = p10Query({ measure: 'hook_events', dims: ['tool'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.v)]);
    const mixQuery = p10Query({ measure: 'hook_events', dims: ['tool_kind', 'harness'], bucket: 'none', to: new Date().toISOString() });
    const mixRows = mixTableRows(buildMix({ rows: mixQuery.rows, measure: 'hook_events', dims: ['tool_kind', 'harness'], mode: 'stacked' }));
    assert.deepEqual(await rowsOf(page, 'treemap'), treemapRows);
    assert.deepEqual(await rowsOf(page, 'rank'), rankRows);
    assert.deepEqual(await rowsOf(page, 'mix'), mixRows);

    const rhythm = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="rhythm"]');
      return {
        text: root.textContent,
        rows: root.querySelectorAll('table tbody tr').length,
        chart: Boolean(root.querySelector('yk-matrix'))
      };
    });
    assert.equal(rhythm.chart, true);
    assert.equal(rhythm.rows, 7 * 24);
    assert.match(rhythm.text, /weekday by hour_of_day|weekday and hour/i);
    assert.match(rhythm.text, /Shared entity key/);

    const rankBefore = await page.evaluate(() => document.querySelector('[data-panel="rank"] yk-bars').inspect());

    // Changing the rank split from tool to tool_kind regroups it; the
    // surviving measure series keeps its key and style.
    await page.evaluate(() => {
      const selects = document.querySelectorAll('[data-panel="rank"] .workspace-panel-chooser select');
      selects[1].value = 'tool_kind';
      selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const raw = new URLSearchParams(location.search).get('p3');
      return raw && JSON.parse(raw).split === 'tool_kind';
    });
    await openBoard(page, harness.origin, page.url().replace(harness.origin, ''));
    const rankAfter = await rowsOf(page, 'rank');
    const expectedKinds = p10Query({ measure: 'hook_events', dims: ['tool_kind'], bucket: 'none', to: new Date().toISOString() })
      .rows.map(row => [String(row.k[0]), String(row.v)]);
    assert.deepEqual(rankAfter, expectedKinds);
    assert.deepEqual(rankAfter.map(row => row[0]), ['shell', 'read']);
    const rankAfterInspect = await page.evaluate(() => document.querySelector('[data-panel="rank"] yk-bars').inspect());
    assert.deepEqual(rankAfterInspect.series.map(series => series.key), rankBefore.series.map(series => series.key));

    // A fixture mix that returns both levels keeps unknown and (mixed) as
    // their own series, never folded into (other).
    let mixRouteHits = 0;
    await page.route('**/v1/analytics/query**', async route => {
      const url = new URL(route.request().url());
      const dims = url.searchParams.getAll('dim');
      if (!(dims.includes('tool_kind') && dims.includes('harness'))) return route.continue();
      mixRouteHits += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          measure: 'hook_events', bucket: 'none', requested_bucket: 'none', coarsened: false,
          dims, rows: [
            { k: ['shell', 'unknown'], v: 4 },
            { k: ['read', '(mixed)'], v: 2 }
          ],
          population: { grain: 'time', unit: 'group', scope_n: 2, cohort_n: 2, eligible_n: 2, returned_n: 2, missing_by_reason: {} }
        })
      });
    });
    await openBoard(page, harness.origin, '/b/tools?win=30d&special=1');
    const special = await page.evaluate(() => {
      const root = document.querySelector('[data-panel="mix"]');
      const chart = root.querySelector('yk-bars');
      return {
        labels: chart.inspect().series.map(series => series.label),
        text: root.textContent
      };
    });
    assert.ok(mixRouteHits >= 1, 'the two-level mix query was served by the fixture route');
    for (const label of ['unknown', '(mixed)']) assert.ok(special.labels.includes(label), label);
    assert.equal(special.labels.includes('(other)'), false);
    await page.unroute('**/v1/analytics/query**');

    // A cost-by-tool treemap is refused by the shared panel with the
    // hook_events-by-tool alternative; the Tools module's own refusal names
    // the measure mismatch exactly.
    const costSpec = { grain: 'time', measures: ['cost_usd'], split: 'tool', chart: 'treemap', scope: { parent: 'harness' } };
    await page.goto(`${harness.origin}/b/tools?win=30d&cost=1&p2=${encodeURIComponent(JSON.stringify(costSpec))}`);
    await page.waitForFunction(() => document.querySelector('[data-panel="treemap"]')?.dataset.idle === 'true');
    assert.equal(await page.evaluate(() => document.querySelector('[data-panel="treemap"]').dataset.state), 'unsupported');
    const costText = await page.evaluate(() => document.querySelector('[data-panel="treemap"]').textContent);
    assert.match(costText, /hook_events by tool/);
    const costGuard = await page.evaluate(async () => (await import('/js/panels/p10-tools.js')).toolsJoinGuard('cost_usd', ['tool']));
    assert.match(costGuard.reason, /hook_events and cost_usd are different measures/);
    assert.equal(costGuard.try, 'hook_events by tool');

    // The repo refusal is the module's guard; the shared panels have no seam
    // for a preset-specific restriction, so it is exercised here in Chromium.
    const repo = await page.evaluate(async () => (await import('/js/panels/p10-tools.js')).toolsJoinGuard('hook_events', ['repo_id']));
    assert.match(repo.reason, /hook facts carry no repo_id/);
    assert.equal(repo.try, 'harness');

    assert.ok(harness.stats.maxInFlight <= 4, `in-flight peaked at ${harness.stats.maxInFlight}`);
    await diagnostics.assertClean();
  } finally {
    if (browser) await browser.close();
    await harness.close();
  }
});
