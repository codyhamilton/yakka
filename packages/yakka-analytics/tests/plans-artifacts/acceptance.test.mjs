// Phase 12 acceptance: shipped workflow, plans and artifact paths over the
// committed fixtures and same-origin test stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import '../../web/js/panels/index.js';
import { listPanels, registerPanel } from '../../web/js/panels/registry.js';
import { SESSION_LANES_PANEL } from '../../web/js/panels/session-lanes.js';
import { LEDGER_PANEL } from '../../web/js/panels/ledger-table.js';
import { OPS_PANEL } from '../../web/js/panels/ops-footprint.js';
import { listPresets } from '../../web/js/boards/presets.js';
import { parseRoute } from '../../web/js/core/router.js';

const environment = loadBrowserEnvironment();
const CATALOG = [
  'river', 'pulse-strips', 'movers', 'trend-columns', 'trend-lines', 'trend-multiples',
  'calendar', 'rhythm', 'mix', 'treemap', 'rank', 'dist-ranges', 'dist-hist', 'dist-ecdf',
  'score-ranges', 'score-trend', 'score-strips', 'band-mix', 'scatter-session',
  'scatter-artifact', 'scatter-plan', 'scatter-day', 'shape-bars', 'plan-timeline',
  'coverage', 'session-lanes', 'ledger-table', 'ops-footprint'
];

async function ready(page) {
  await page.waitForFunction(() => document.documentElement.dataset.idle === 'true');
}

async function panelIdle(page, ids) {
  try {
    await page.waitForFunction(names => names.every(id => {
      const panel = document.querySelector(`[data-panel="${id}"]`);
      return panel && panel.dataset.idle === 'true';
    }), ids, { timeout: 10000 });
  } catch (error) {
    const states = await page.evaluate(names => Object.fromEntries(names.map(id => {
      const panel = document.querySelector(`[data-panel="${id}"]`);
      return [id, panel ? { idle: panel.dataset.idle, state: panel.dataset.state, text: panel.textContent.slice(0, 400) } : null];
    })), ids);
    throw new Error(`panels did not settle: ${JSON.stringify(states)}; ${error.message}`);
  }
}

async function planDetailSettled(page) {
  await page.waitForFunction(() => {
    const sections = [...document.querySelectorAll('.plans-detail-section')];
    return sections.length > 0 && sections.every(section => section.dataset.state !== 'loading');
  });
}

async function fixture(t) {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p10: true, p11: true, p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1400, height: 2600 } });
  const diagnostics = await watchPage(page);
  page.on('dialog', dialog => dialog.dismiss());
  return { harness, browser, page, diagnostics };
}

async function assertBound(harness) {
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
}

test('Workflow settles its delivered execution panels', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const { harness, page, diagnostics } = await fixture(t);
  await page.goto(`${harness.origin}/b/workflow?win=all`);
  await panelIdle(page, ['shape-bars', 'plan-timeline', 'rank', 'river']);
  assert.equal(await page.locator('[data-panel="shape-bars"]').getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('[data-panel="plan-timeline"]').getAttribute('data-state'), 'ready');
  assert.match(await page.locator('[data-panel="shape-bars"]').innerText(), /Execution completion, not success/);
  const shape = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="shape-bars"] yk-bars');
    const view = chart.inspect();
    return { series: view.series.map(item => item.key) };
  });
  assert.deepEqual(shape.series.slice().sort(), ['executions_complete', 'executions_started', 'executions_unreported']);
  await diagnostics.assertClean();
  await assertBound(harness);
});

test('Plans pages and detail show stored context without inferring completion; absent plans stay absent', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const { harness, page, diagnostics } = await fixture(t);
  await page.goto(`${harness.origin}/plans?win=all`);
  await panelIdle(page, ['plans-list']);
  assert.equal(await page.locator('[data-panel="plans-list"]').getAttribute('data-state'), 'ready');
  await page.selectOption('.plans-sort-measure', 'associated_cost_usd');
  await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'associated_cost_usd:desc');
  await panelIdle(page, ['plans-list']);
  assert.match(await page.locator('.plans-overlap-banner').innerText(), /non-additive/);
  const requestedSort = harness.api.state.requests.filter(item => item.path.endsWith('/entities') && /grain=plan/.test(item.search));
  assert.ok(requestedSort.some(item => new URLSearchParams(item.search).has('sort')));

  await page.goto(`${harness.origin}/plans/acme%2Fwidgets/20-analytics-reset?win=all`);
  await planDetailSettled(page);
  await panelIdle(page, ['plan-timeline']);
  for (const section of ['summary', 'planline', 'artifacts', 'executions', 'sessions', 'events']) {
    assert.equal(await page.locator(`[data-section="${section}"]`).getAttribute('data-state'), 'ready', `${section} settles`);
  }
  const detail = await page.locator('body').innerText();
  for (const word of ['artifacts', 'executions', 'sessions', 'events', 'briefs/']) assert.match(detail, new RegExp(word, 'i'));
  assert.equal(await page.locator('.plans-phase, .plans-completion, [data-complete]').count(), 0, 'Plan 30 does not infer phase completion');

  await page.goto(`${harness.origin}/plans/acme%2Fwidgets/missing?win=all`);
  await planDetailSettled(page);
  assert.match(await page.locator('.plans-detail-absent').innerText(), /plan|not found/i);
  assert.doesNotMatch(await page.locator('body').innerText(), /20-analytics-reset/);
  for (const route of ['/plans/a/b/extra', '/plans/a']) {
    assert.equal(parseRoute(route).kind, 'not-found', route);
    await page.goto(`${harness.origin}${route}`);
    await ready(page);
    assert.match(await page.locator('body').innerText(), /not found/i, route);
  }
  await diagnostics.assertClean();
  await assertBound(harness);
});

test('reader content, exact unavailable states, bounded diff and reciprocal links use real routes', {
  skip: 'Plan 30 replaces the Plan 29 version-mark reader; S-artifact and version-table coverage lives in phase 2 acceptance.'
}, async t => {
  const { harness, page, diagnostics } = await fixture(t);
  const design = 'docs/plans/20-analytics-reset/DESIGN.md';
  const hash = 'a6'.repeat(32);
  const open = async (path, version, compare = '') => {
    const params = new URLSearchParams({ repo_id: 'repo-a', path, hash: version });
    if (compare) params.set('compare', compare);
    await page.goto(`${harness.origin}/artifact?${params}`);
    await page.waitForFunction(() => document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
    if (version && await page.locator('.artifact-version-missing').count()) {
      while (await page.locator('.artifact-version-mark[data-hash="' + version + '"]').count() === 0) {
        const more = page.locator('.artifact-versions-more');
        assert.ok(await more.count(), `version ${version} is absent from history`);
        await more.click();
        await page.waitForFunction(hashValue => document.querySelector(`.artifact-version-mark[data-hash="${hashValue}"]`)
          || !document.querySelector('.artifact-versions-more'), version);
      }
      await page.locator(`.artifact-version-mark[data-hash="${version}"]`).click();
    }
    await page.waitForFunction(() => document.querySelector('.artifact-content') || document.querySelector('.artifact-content-message'));
  };
  let dialogs = 0;
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => { dialogs += 1; dialog.dismiss(); });
  await open(design, hash);
  assert.equal(await page.locator('.artifact-version-mark[data-selected="true"]').getAttribute('data-hash'), hash);
  assert.match(await page.locator('.artifact-content').innerText(), /<script>alert\(1\)<\/script>/);
  assert.equal(await page.locator('.artifact-content script, .artifact-content img').count(), 0);
  assert.equal(dialogs, 0);
  assert.match(await page.locator('.artifact-version').innerText(), /clarity|score/i);
  assert.match(await page.locator('.artifact-reader').innerText(), /Harness[\s\S]*orca/);
  assert.match(await page.locator('.artifact-reader').innerText(), /Session model[\s\S]*claude/);
  assert.match(await page.locator('.artifact-version-mark[data-selected="true"]').innerText(), /jev-1\.13\.0/);
  assert.equal(await page.locator('.artifact-plan-link').getAttribute('href'), '/plans/repo-a/20-analytics-reset');
  assert.equal(await page.locator('.artifact-session-link').getAttribute('href'), '/sessions/conv-20b');
  await page.reload();
  assert.equal(new URL(page.url()).searchParams.get('hash'), hash);
  await page.locator('.artifact-session-link').click();
  await page.waitForFunction(() => location.pathname === '/sessions/conv-20b'
    && document.querySelector('[data-panel="session-lanes"]')?.dataset.idle === 'true');
  await page.goto(`${harness.origin}/artifact?${new URLSearchParams({ repo_id: 'repo-a', path: design, hash })}`);
  await page.waitForFunction(() => document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
  await page.locator('.artifact-plan-link').click();
  await ready(page);
  assert.equal(new URL(page.url()).pathname, '/plans/repo-a/20-analytics-reset');

  const states = [
    ['a2'.repeat(32), /not stored: this ledger has no blob for this version/, /404 content_unavailable \(not_stored\)/],
    ['a3'.repeat(32), /pending: not served until ingest completes/, /404 content_unavailable \(pending\)/],
    ['a4'.repeat(32), /removed by screen/, /404 content_unavailable \(removed_by_screen\)/],
    ['a1'.repeat(32), /not found for this repo and path/i, /404 not_found/],
    ['c4'.repeat(32), /20,000,000 bytes exceeds the 16,777,216-byte limit/, /413 content_too_large/],
    ['c5'.repeat(32), /content integrity check failed/, /500 content_integrity/]
  ];
  for (const [version, expected, code] of states) {
    const path = version === 'c4'.repeat(32) ? 'docs/plans/20-analytics-reset/reports/12-04.md'
      : version === 'c5'.repeat(32) ? 'docs/plans/20-analytics-reset/reports/12-05.md' : design;
    await open(path, version);
    assert.match(await page.locator('.artifact-content-message, .artifact-content').innerText(), expected, version);
    assert.match(await page.locator('.artifact-content-code').innerText(), code, version);
    assert.equal(await page.locator('.artifact-chunk').count(), 0, 'unavailable content has no prefix body');
  }
  await open('docs/plans/20-analytics-reset/briefs/diff-fixture.md', 'd1'.repeat(32), 'd2'.repeat(32));
  await page.locator('.artifact-compare-button').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff')?.textContent.includes('2 added, 2 removed'));
  let diff = await page.locator('.artifact-diff').innerText();
  for (const line of ['+ changed new', '- changed old', '+ added line', '- removed line']) assert.match(diff, new RegExp(line.replace(/[+]/g, '\\+').replace(/[-]/g, '\\-')));
  await page.selectOption('.artifact-compare-left', 'a2'.repeat(32));
  await page.locator('.artifact-compare-button').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff-message')?.textContent.includes('content_unavailable'));
  assert.match(await page.locator('.artifact-diff-message').innerText(), /content_unavailable/);
  assert.equal(await page.locator('.artifact-diff').count(), 0);
  await page.selectOption('.artifact-compare-left', 'd4'.repeat(32));
  await page.locator('.artifact-compare-button').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff-message')?.textContent.includes('2,000'));
  assert.match(await page.locator('.artifact-diff-message').innerText(), /ceiling is 262,144 bytes and 2,000 lines per side/);
  assert.equal(await page.locator('.artifact-diff').count(), 0);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /^Failed to load resource.*(404|413|500)/.test(text)),
    `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  await assertBound(harness);
});

test('P10 and P11 destinations click into delivered explorers; all catalog panels and presets resolve', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const { harness, page, diagnostics } = await fixture(t);
  await page.goto(`${harness.origin}/b/quality?win=all`);
  await panelIdle(page, ['score-strips']);
  await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="score-strips"] yk-ranges');
      chart.dispatchEvent(new CustomEvent('inspect', { bubbles: true, composed: true, detail: { key: JSON.stringify({ path: 'docs/a.md', repo_id: 'repo-a' }), values: {} } }));
  });
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => location.pathname === '/artifact' && document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
  assert.equal(await page.locator('[data-panel="artifact-reader"]').getAttribute('data-state'), 'identity-required');
  assert.match(await page.locator('[data-panel="artifact-reader"]').innerText(), /hash must be a 64-hex content hash/);

  await page.goto(`${harness.origin}/b/scatter?win=all`);
  await panelIdle(page, ['scatter-artifact']);
  await page.locator('[data-panel="scatter-artifact"] yk-chart').scrollIntoViewIfNeeded();
  const artifactPoint = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="scatter-artifact"] yk-chart');
    const view = chart.inspect(); const mark = view.marks[0];
    return mark && { x: view.plot.left + mark.px, y: view.plot.top + mark.py };
  });
  assert.ok(artifactPoint, 'artifact scatter has an inspectable mark');
  await page.mouse.click(artifactPoint.x, artifactPoint.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => location.pathname === '/artifact'
    && document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
  assert.equal(await page.locator('[data-panel="artifact-reader"]').getAttribute('data-state'), 'identity-required');

  await page.goto(`${harness.origin}/sessions/conv-000`);
  await page.waitForFunction(() => document.querySelector('[data-panel="session-lanes"]')?.dataset.idle === 'true');
  const artifactLink = page.locator('.session-artifact-link').first();
  assert.match(await artifactLink.getAttribute('href'), /^\/artifact\?/);
  await artifactLink.click();
  await page.waitForFunction(() => location.pathname === '/artifact' && document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
  assert.equal(await page.locator('[data-panel="artifact-reader"]').getAttribute('data-state'), 'identity-required');

  await page.goto(`${harness.origin}/b/scatter?win=all`);
  await panelIdle(page, ['scatter-plan']);
  await page.locator('[data-panel="scatter-plan"] yk-chart').scrollIntoViewIfNeeded();
  const point = await page.evaluate(() => {
    const chart = document.querySelector('[data-panel="scatter-plan"] yk-chart');
    const view = chart.inspect(); const mark = view.marks[0];
    return mark && { x: view.plot.left + mark.px, y: view.plot.top + mark.py };
  });
  assert.ok(point);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('.workspace-inspector')?.dataset.open === 'true');
  await page.locator('.workspace-inspector-action[data-action="open"]').click();
  await page.waitForFunction(() => /^\/plans\/[^/]+\/[^/]+$/.test(location.pathname));
  await planDetailSettled(page);
  assert.equal(await page.locator('.plans-detail-identity').count(), 1);

  await page.goto(`${harness.origin}/artifact?repo_id=repo-z&path=missing.md&hash=bogus`);
  await ready(page);
  assert.equal(await page.locator('[data-panel="artifact-reader"]').getAttribute('data-state'), 'identity-required');
  assert.match(await page.locator('body').innerText(), /identity required: hash must be a 64-hex content hash/);
  registerPanel(SESSION_LANES_PANEL);
  registerPanel(LEDGER_PANEL);
  registerPanel(OPS_PANEL);
  const registered = new Set(listPanels().map(panel => panel.id));
  for (const id of CATALOG) assert.ok(registered.has(id), `${id} is registered`);
  for (const id of ['calendar', 'rhythm', 'dist-hist', 'dist-ecdf', 'mix']) assert.ok(registered.has(id));
  for (const preset of listPresets()) {
    assert.notEqual(parseRoute(`/b/${preset.id}`).kind, 'not-found', `${preset.id} resolves`);
    for (const id of preset.panels) assert.ok(registered.has(id), `${preset.id} references registered ${id}`);
  }
  assert.ok(['explorer', 'named'].includes(parseRoute('/plans').kind));
  assert.ok(['explorer', 'named'].includes(parseRoute('/artifact').kind));
  assert.equal(parseRoute('/b/workflow').kind, 'board');
  assert.doesNotMatch(await page.locator('body').innerText(), /(?:arrives in|is) Phase 12/);
  await diagnostics.assertClean();
  await assertBound(harness);
});
