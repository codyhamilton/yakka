// Phase 12 unit 12-04: bounded first-party artifact line diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import { DIFF_CEILING, diffLines, diffWithinCeiling, loadDiff } from '../../web/js/explorers/artifact-diff.js';
import { p12Content } from '../workspace/fixture.mjs';

const environment = loadBrowserEnvironment();
const H = { before: 'd1'.repeat(32), after: 'd2'.repeat(32), unavailable: 'a2'.repeat(32), large: 'd4'.repeat(32), designA: 'a6'.repeat(32), designB: 'a5'.repeat(32) };
const PATH = 'docs/plans/20-analytics-reset/briefs/diff-fixture.md';
const DESIGN = 'docs/plans/20-analytics-reset/DESIGN.md';
const BEFORE = 'context line\nchanged old\nremoved line\n';
const AFTER = 'context line\nchanged new\nadded line';

test('diff output matches the deterministic fixture and normalizes one final newline', () => {
  const expected = {
    hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [
      { kind: 'context', text: 'context line', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'changed old', oldLine: 2, newLine: null },
      { kind: 'remove', text: 'removed line', oldLine: 3, newLine: null },
      { kind: 'add', text: 'changed new', oldLine: null, newLine: 2 },
      { kind: 'add', text: 'added line', oldLine: null, newLine: 3 }
    ] }], added: 2, removed: 2, unchanged: 1, truncated: false
  };
  assert.deepEqual(diffLines(BEFORE, AFTER), expected);
  assert.deepEqual(diffLines(BEFORE, AFTER), diffLines(BEFORE, AFTER), 'output is stable');
  assert.deepEqual(diffLines('line', 'line\n'), { hunks: [], added: 0, removed: 0, unchanged: 1, truncated: false });
  assert.deepEqual(diffLines('', ''), { hunks: [], added: 0, removed: 0, unchanged: 0, truncated: false });
  assert.deepEqual(diffLines('', 'one'), { hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add', text: 'one', oldLine: null, newLine: 1 }] }], added: 1, removed: 0, unchanged: 0, truncated: false });
});

test('the per-side byte and line ceilings accept the boundary and decline above it', () => {
  assert.deepEqual(DIFF_CEILING, { bytes: 262144, lines: 2000 });
  for (const size of [DIFF_CEILING.bytes - 1, DIFF_CEILING.bytes]) assert.deepEqual(diffWithinCeiling('x'.repeat(size), ''), { ok: true });
  const byteOver = diffWithinCeiling('x'.repeat(DIFF_CEILING.bytes + 1), '');
  assert.deepEqual({ side: byteOver.side, bytes: byteOver.bytes, lines: byteOver.lines }, { side: 'left', bytes: 262145, lines: 1 });
  assert.match(byteOver.reason, /262,144 bytes and 2,000 lines per side/);
  assert.deepEqual(diffWithinCeiling(Array.from({ length: 2000 }, () => 'x').join('\n'), ''), { ok: true });
  const lineOver = diffWithinCeiling(Array.from({ length: 2001 }, () => 'x').join('\n'), '');
  assert.deepEqual({ side: lineOver.side, lines: lineOver.lines }, { side: 'left', lines: 2001 });
});

test('a failed first content request short-circuits the second request', async () => {
  let calls = 0;
  const hadLocation = Object.hasOwn(globalThis, 'location');
  const priorLocation = globalThis.location;
  globalThis.location = { hostname: 'localhost' };
  const scheduler = { async request() {
    calls += 1;
    return { status: 404, async json() { return { error: 'artifact content is unavailable', code: 'content_unavailable', reason: 'pending' }; } };
  } };
  try {
    const result = await loadDiff({ scheduler, repo: 'repo-a', path: PATH, a: H.unavailable, b: H.after });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.match(result.reason, /content_unavailable \(pending\)/);
  } finally {
    if (hadLocation) globalThis.location = priorLocation;
    else delete globalThis.location;
  }
});

test('the fixture contains complete known, unavailable, oversized and non-reader states', () => {
  assert.equal(p12Content('repo-a', PATH, H.before).text, BEFORE);
  assert.equal(p12Content('repo-a', PATH, H.after).text, AFTER);
  assert.equal(p12Content('repo-a', PATH, H.unavailable).body.reason, 'not_stored');
  assert.equal(p12Content('repo-a', PATH, H.large).status, 200);
  assert.ok(p12Content('repo-a', PATH, H.large).text.split('\n').length > DIFF_CEILING.lines);
  assert.equal(p12Content('repo-a', 'docs/plans/20-analytics-reset/IMPLEMENTATION.md', 'd3'.repeat(32)).status, 404);
});

function openArtifact(page, origin, path, hash, compare) {
  const params = new URLSearchParams({ repo_id: 'repo-a', path, hash, compare });
  return page.goto(`${origin}/artifact?${params.toString()}`);
}

async function launchFixture(t) {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const diagnostics = await watchPage(page);
  return { harness, page, diagnostics };
}

async function waitReader(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
  await page.waitForFunction(() => document.querySelector('.artifact-show-diff'));
}

test('Chromium compares both complete versions, round-trips URL, and keeps malicious text inert', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const { harness, page, diagnostics } = await launchFixture(t);
  await openArtifact(page, harness.origin, PATH, H.before, H.after);
  await waitReader(page);
  await page.locator('.artifact-show-diff').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff')?.textContent.includes('2 added, 2 removed'));
  const output = await page.locator('.artifact-diff').innerText();
  assert.match(output, /\+ changed new/);
  assert.match(output, /- changed old/);
  assert.match(output, /\+ added line/);
  assert.match(output, /- removed line/);
  const url = new URL(page.url());
  assert.deepEqual([...url.searchParams.keys()].sort(), ['compare', 'hash', 'path', 'repo_id']);
  assert.equal(url.searchParams.get('hash'), H.before);
  assert.equal(url.searchParams.get('compare'), H.after);

  await openArtifact(page, harness.origin, DESIGN, H.designA, H.designB);
  await waitReader(page);
  await page.locator('.artifact-show-diff').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff'));
  assert.match(await page.locator('.artifact-diff').innerText(), /<script>alert\(1\)<\/script>/);
  assert.equal(await page.locator('.artifact-diff script').count(), 0);

  await openArtifact(page, harness.origin, 'docs/plans/20-analytics-reset/briefs/12-03.md', 'b3'.repeat(32), '');
  await waitReader(page);
  assert.equal(await page.locator('.artifact-show-diff').isDisabled(), true);
  await openArtifact(page, harness.origin, 'docs/plans/20-analytics-reset/IMPLEMENTATION.md', 'd3'.repeat(32), '');
  await waitReader(page);
  assert.equal(await page.locator('.artifact-show-diff').isDisabled(), true);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*404/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('Chromium declines unavailable and oversized versions without a partial diff', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const { harness, page, diagnostics } = await launchFixture(t);
  await openArtifact(page, harness.origin, PATH, H.before, H.unavailable);
  await waitReader(page);
  await page.locator('.artifact-show-diff').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff-message')?.textContent.includes('content_unavailable'));
  assert.equal(await page.locator('.artifact-diff').count(), 0);

  await openArtifact(page, harness.origin, PATH, H.before, H.large);
  await waitReader(page);
  await page.locator('.artifact-show-diff').click();
  await page.waitForFunction(() => document.querySelector('.artifact-diff-message')?.textContent.includes('2,000 lines per side'));
  const refusal = await page.locator('.artifact-diff-message').innerText();
  assert.match(refusal, /Diff declined: right is \d+ bytes \/ 2001 lines; the ceiling is 262,144 bytes and 2,000 lines per side\./);
  assert.equal(await page.locator('.artifact-diff').count(), 0);
  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*404/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
