import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from './harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { validatePanelEntry } from '../../web/js/panels/registry.js';
import {
  DECLARED_FILTERS,
  LEDGER_PANEL,
  appendPage,
  costNote,
  displayedCount,
  entityKeyForRow,
  filterToParameters,
  formatRowCost,
  mapExploreResponse,
  mapLoadError,
  pageParameters,
  pagingSummary,
  resolveWindow,
  rowKey,
  selectionGrain,
  unpricedCount
} from '../../web/js/panels/ledger-table.js';

const environment = loadBrowserEnvironment();
const NOW = Date.parse('2026-11-18T12:00:00Z');

function row(overrides = {}) {
  return {
    type: 'hook_event', ts: '2026-11-18T10:00:00Z', harness: 'orca', repo_id: 'repo-a', plan: '20',
    kind: 'design', event: 'PreToolUse', tool: 'Bash', norm_event: 'tool', model: '', path: '',
    conversation_id: 'conv-a', source: 'worktree', sha: '', screen_verdict: '', rejection_stage: '',
    ...overrides
  };
}

test('filter parameters: from/to beat win, repeated excludes survive, undeclared lenses are dropped', () => {
  const params = filterToParameters({
    win: '7d', from: '2026-01-02T00:00:00Z', to: '2026-01-03T00:00:00Z', tz: 'Europe/Paris',
    filters: { harness: ['orca', 'claude'], kind: ['design'] },
    exclude: ['model:gpt-5', 'model:claude', 'screen_verdict:pass']
  }, { now: NOW });
  assert.equal(params.get('from'), '2026-01-02T00:00:00.000Z');
  assert.equal(params.get('to'), '2026-01-03T00:00:00.000Z');
  assert.equal(params.has('win'), false);
  assert.equal(params.get('tz'), 'Europe/Paris');
  assert.deepEqual(params.getAll('harness'), ['orca', 'claude']);
  assert.deepEqual(params.getAll('kind'), ['design']);
  assert.deepEqual(params.getAll('exclude'), ['model:gpt-5', 'model:claude'], 'a lens the panel does not send is never sent');
  assert.equal(DECLARED_FILTERS.includes('screen_verdict'), false);
});

test('a relative window is frozen to absolute bounds and all=1 is named', () => {
  const relative = resolveWindow({ win: '2d' }, NOW);
  assert.equal(relative.to, '2026-11-18T12:00:00.000Z');
  assert.equal(relative.from, '2026-11-16T12:00:00.000Z');
  const all = filterToParameters({ win: 'all', tz: 'UTC' }, { now: NOW });
  assert.equal(all.get('all'), '1');
  assert.equal(all.has('from'), false);
  assert.equal(all.get('to'), '2026-11-18T12:00:00.000Z');
});

test('cursor paging keeps the frozen filter and only adds cursor+limit', () => {
  const base = filterToParameters({ win: '1d', tz: 'UTC', filters: { harness: ['orca'] } }, { now: NOW });
  const next = pageParameters(base, { cursor: 'opaque-cursor', limit: 500 });
  assert.equal(next.get('cursor'), 'opaque-cursor');
  assert.equal(next.get('limit'), '500');
  assert.equal(next.get('harness'), 'orca');
  assert.equal(next.get('to'), base.get('to'));
  assert.equal(base.has('cursor'), false, 'the base filter is not mutated');
});

test('appendPage dedupes by row identity and preserves server order', () => {
  const a = row({ ts: '2026-11-18T10:00:00Z', event: 'a' });
  const b = row({ ts: '2026-11-18T09:00:00Z', event: 'b' });
  const c = row({ ts: '2026-11-18T08:00:00Z', event: 'c' });
  const first = appendPage([], [a, b]);
  assert.deepEqual(first.rows, [a, b]);
  const second = appendPage(first.rows, [b, c]);
  assert.deepEqual(second.rows, [a, b, c]);
  assert.equal(second.added, 1);
  assert.equal(second.duplicates, 1);
  assert.equal(new Set(second.rows.map(rowKey)).size, 3);
});

test('selection resolves to the entity key, not the per-row identity', () => {
  assert.equal(entityKeyForRow(row()), 'conv-a');
  assert.equal(entityKeyForRow(row({ conversation_id: '', path: 'docs/a.md' })), 'repo-a\u001fdocs/a.md');
  assert.equal(entityKeyForRow(row({ conversation_id: '', repo_id: '', path: '' })), rowKey(row({ conversation_id: '', repo_id: '', path: '' })));
});

test('rowKey is stable, order-preserving and safe for the pick grammar', () => {
  const a = row();
  assert.equal(rowKey(a), rowKey({ ...a }));
  assert.notEqual(rowKey(a), rowKey({ ...a, event: 'PostToolUse' }));
  assert.doesNotMatch(rowKey({ ...a, path: 'docs/a,b|c.md' }), /[,|]/);
});

test('the displayed count is rows shown, never a total from a partial page', () => {
  assert.equal(displayedCount([row(), row({ event: 'z' })]), 2);
  assert.match(pagingSummary({ shown: 20000, truncated: true, hasNext: true }), /more rows remain/);
  const noCursor = pagingSummary({ shown: 20000, truncated: true, hasNext: false });
  assert.match(noCursor, /reported more rows but returned no cursor/);
  assert.doesNotMatch(noCursor, /total/i);
  assert.match(pagingSummary({ shown: 17, truncated: false, hasNext: false }), /end of the ledger/);
});

test('unpriced is never $0 and a lower bound names the unpriced count', () => {
  assert.equal(formatRowCost({ priced: false, cost_usd: 0 }), 'unpriced');
  assert.equal(formatRowCost({}), 'unpriced');
  assert.equal(formatRowCost({ cost_usd: 0.5 }), '$0.50');
  assert.notEqual(formatRowCost({ priced: false, cost_usd: 0 }), '$0.00');
  const rows = [row({ priced: false }), row({ cost_usd: 1.25 })];
  assert.equal(unpricedCount(rows), 1);
  assert.match(costNote(rows), /lower bound; 1 unpriced row/);
  assert.equal(costNote([row({ cost_usd: 1 })]), '');
});

test('event rows resolve to the contract entity mapping: session, artifact, otherwise event', () => {
  assert.equal(selectionGrain([row()]).grain, 'session');
  assert.equal(selectionGrain([row()]).key, 'conv-a');
  assert.equal(selectionGrain([row({ conversation_id: '', path: 'docs/a.md' })]).grain, 'artifact');
  assert.equal(selectionGrain([row({ conversation_id: '', path: 'docs/a.md' }), row({ conversation_id: '', repo_id: '', path: '' })]).grain, 'event');
});

test('the explore response classifies into the one panel-state vocabulary', () => {
  const ready = mapExploreResponse({ status: 200, body: { rows: [row()], truncated: true, next: 'cursor-1' } });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.next, 'cursor-1');
  assert.equal(ready.truncated, true);
  assert.equal(mapExploreResponse({ status: 200, body: { rows: [], truncated: false } }).state, 'empty');
  const stale = mapExploreResponse({ status: 409, body: { error: 'changed', code: 'cursor_stale' } });
  assert.equal(stale.state, 'error');
  assert.equal(stale.code, 'cursor_stale');
  const failed = mapExploreResponse({ status: 500, body: { error: 'read failed', code: 'read failed' } });
  assert.equal(failed.state, 'error');
  assert.equal(failed.message, 'read failed');
  const unsupported = mapExploreResponse({ status: 404, body: { error: 'not found' } });
  assert.equal(unsupported.state, 'unsupported');
  assert.match(unsupported.missing, /explore/);
  assert.equal(mapLoadError(new DOMException('Aborted', 'AbortError')).state, 'cancelled');
  assert.equal(mapLoadError(new Error('boom')).state, 'error');
});

test('the ledger panel is a valid event-grain, table-only registry entry', () => {
  assert.doesNotThrow(() => validatePanelEntry(LEDGER_PANEL));
  assert.equal(LEDGER_PANEL.id, 'ledger-table');
  assert.equal(LEDGER_PANEL.grain, 'event');
  assert.deepEqual(LEDGER_PANEL.charts, []);
  assert.equal(LEDGER_PANEL.table, true);
  assert.equal(LEDGER_PANEL.load instanceof Function, true);
  assert.deepEqual(LEDGER_PANEL.requests(), [{ route: '/v1/analytics/explore', method: 'GET' }]);
});

// --- Chromium ------------------------------------------------------------

async function settle(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="ledger-table"]')?.dataset.idle === 'true');
}

async function control(origin, body) {
  const response = await fetch(`${origin}/__test/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return response.json();
}

test('the ledger pages beyond 20,000 with no duplicates, chips that restore, inspection and honest costs', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  try {
    const probe = await fetch(`${harness.origin}/v1/analytics/explore?limit=1&from=2020-01-01T00:00:00Z&to=2026-12-01T00:00:00Z`);
    if (!probe.ok) {
      t.skip('the workspace stub has no /explore route (owned by 9-01, outside this unit); see gate');
      return;
    }
    const page = await browser.newPage();
    const diagnostics = await watchPage(page);

    await page.goto(`${harness.origin}/ledger?win=all`);
    await settle(page);
    const panel = page.locator('[data-panel="ledger-table"]');
    assert.equal(await panel.getAttribute('data-state'), 'ready');
    assert.equal(await panel.getAttribute('data-chart'), 'table');

    let guard = 0;
    while (await page.locator('.ledger-load-more').count() && guard++ < 200) {
      const before = await page.locator('.ledger-row').count();
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(count => document.querySelectorAll('.ledger-row').length > count, before);
      await settle(page);
    }
    const keys = await page.locator('.ledger-row').evaluateAll(rows => rows.map(item => item.dataset.rowKey));
    assert.ok(keys.length > 20000, `expected > 20,000 rows, saw ${keys.length}`);
    assert.equal(new Set(keys).size, keys.length, 'no duplicate row keys across pages');
    const times = await page.locator('.ledger-row').evaluateAll(rows => rows.map(item => item.dataset.ts));
    for (let index = 1; index < times.length; index += 1) assert.ok(times[index - 1] >= times[index], `row ${index} breaks non-increasing order`);
    assert.match(await panel.innerText(), /rows shown/);

    assert.ok(await page.locator('.ledger-row .ledger-cost', { hasText: 'unpriced' }).count() > 0);
    assert.equal(await page.locator('.ledger-cost', { hasText: /^\$0(\.00)?$/ }).count(), 0, 'an unpriced row is never $0');
    assert.match(await panel.innerText(), /lower bound/);

    await page.locator('.ledger-row').first().click();
    await page.waitForSelector('.workspace-inspector[data-open="true"]');
    const inspector = page.locator('.workspace-inspector');
    assert.match(await inspector.innerText(), /Conversation/);
    assert.match(await inspector.innerText(), /Cost/);
    await page.keyboard.press('Escape');

    await diagnostics.assertClean();
    const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
    assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
  } finally {
    await browser.close();
    await harness.close();
  }
});

test('a removed chip pushes history, Back restores it, and an inapplicable filter is named', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  try {
    const probe = await fetch(`${harness.origin}/v1/analytics/explore?limit=1`);
    if (!probe.ok) {
      t.skip('the workspace stub has no /explore route (owned by 9-01, outside this unit); see gate');
      return;
    }
    const page = await browser.newPage();
    const diagnostics = await watchPage(page);

    await page.goto(`${harness.origin}/ledger?win=all&harness=orca`);
    await settle(page);
    assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 1);
    await page.locator('.workspace-chip[data-kind="filter"] .workspace-chip-remove').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('harness'));
    await settle(page);
    assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 0);

    await page.goBack();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('harness') === 'orca');
    await settle(page);
    assert.equal(await page.locator('.workspace-chip[data-kind="filter"]').count(), 1);

    await page.goto(`${harness.origin}/ledger?exclude=screen_verdict:pass`);
    await settle(page);
    assert.match(await page.locator('[data-panel="ledger-table"]').innerText(), /not applied here: screen_verdict/);
    await diagnostics.assertClean();
  } finally {
    await browser.close();
    await harness.close();
  }
});

test('empty and error follow the frame vocabulary; legacy servers are the server error verbatim', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  const browser = await launchBrowser(environment);
  try {
    const probe = await fetch(`${harness.origin}/v1/analytics/explore?limit=1`);
    if (!probe.ok) {
      t.skip('the workspace stub has no /explore route (owned by 9-01, outside this unit); see gate');
      return;
    }
    const page = await browser.newPage();
    const diagnostics = await watchPage(page);
    const panel = page.locator('[data-panel="ledger-table"]');

    await control(harness.origin, { empty: true });
    await page.goto(`${harness.origin}/ledger?win=all`);
    await settle(page);
    assert.equal(await panel.getAttribute('data-state'), 'empty');
    assert.match(await panel.innerText(), /No rows match/);

    await control(harness.origin, { scenario: 'legacy' });
    await page.goto(`${harness.origin}/ledger?win=all`);
    await settle(page);
    assert.equal(await panel.getAttribute('data-state'), 'error');
    assert.match(await panel.innerText(), /range too wide/);
    // The deliberate legacy 400 makes Chromium log one failed-resource console
    // entry; the product is honestly in the error state. Assert no page error or
    // CSP violation and allow only that one expected console entry.
    assert.deepEqual(diagnostics.pageErrors, []);
    assert.deepEqual(await diagnostics.cspViolations(), []);
    assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*400/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  } finally {
    await control(harness.origin, { scenario: 'default', empty: false }).catch(() => {});
    await browser.close();
    await harness.close();
  }
});
