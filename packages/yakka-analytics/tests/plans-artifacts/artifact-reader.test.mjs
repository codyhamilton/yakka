// Phase 12 unit 12-03: the artifact reader core and `/artifact`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBrowserEnvironment, launchBrowser, SKIP_REASON, p12Content, p12Baselines } from './browser.mjs';
import { startWorkspaceHarness } from '../workspace/harness.mjs';
import { watchPage } from '../gallery/harness.mjs';
import {
  artifactKind, bandFor, baselineKey, chunkText, createBaselineCache, mapContentError, parseOutline
} from '../../web/js/explorers/artifact-content.js';
import {
  checkChoices, contentStateText, defaultCheck, parseReaderIdentity, planOfPath, readerUrl, shortHash, versionScore
} from '../../web/js/explorers/artifact.js';
import { parseRoute } from '../../web/js/core/router.js';

const environment = loadBrowserEnvironment();

const H = {
  designV6: 'a6'.repeat(32),
  designV5: 'a5'.repeat(32),
  designV4: 'a4'.repeat(32),
  designV3: 'a3'.repeat(32),
  designV2: 'a2'.repeat(32),
  designV1: 'a1'.repeat(32),
  briefLong: 'b3'.repeat(32),
  oversize: 'c4'.repeat(32),
  integrity: 'c5'.repeat(32)
};

const DESIGN = 'docs/plans/20-analytics-reset/DESIGN.md';
const BRIEF = 'docs/plans/20-analytics-reset/briefs/12-03.md';
const REPORT_OVER = 'docs/plans/20-analytics-reset/reports/12-04.md';
const REPORT_INTEGRITY = 'docs/plans/20-analytics-reset/reports/12-05.md';

test('the router serves /artifact as an explorer and keeps /plans named', () => {
  assert.equal(parseRoute('/artifact').kind, 'explorer');
  assert.equal(parseRoute('/artifact').explorer, 'artifact');
  assert.equal(parseRoute('/artifact').path, '/artifact');
  assert.equal(parseRoute('/plans/acme/20').kind, 'named');
  assert.equal(parseRoute('/plans/acme/20').phase, 12);
});

test('artifactKind matches the server path rule', () => {
  assert.equal(artifactKind(DESIGN), 'design');
  assert.equal(artifactKind(BRIEF), 'brief');
  assert.equal(artifactKind('docs/plans/20/reports/12-03.md'), 'report');
  assert.equal(artifactKind('docs/plans/20/PLAN.md'), 'other');
  assert.equal(artifactKind('README.md'), 'other');
  assert.equal(artifactKind('docs/plans/20/../20/DESIGN.md'), 'design');
});

test('the outline skips fenced headings and keeps 1-based line numbers', () => {
  const text = ['# Top', 'text', '```', '# not heading', '```', '## Real', '### Sub'].join('\n');
  assert.deepEqual(parseOutline(text), [
    { level: 1, text: 'Top', line: 1 },
    { level: 2, text: 'Real', line: 6 },
    { level: 3, text: 'Sub', line: 7 }
  ]);
  const tildes = ['~~~', '## hidden', '~~~', '## shown'].join('\n');
  assert.deepEqual(parseOutline(tildes), [{ level: 2, text: 'shown', line: 4 }]);
  assert.deepEqual(parseOutline('<h1>Not parsed</h1>'), []);
});

test('chunkText counts complete display windows, never truncation', () => {
  const lines = Array.from({ length: 900 }, (_, index) => `line ${index + 1}`);
  const model = chunkText(lines.join('\n'), { lines: 400 });
  assert.equal(model.totalLines, 900);
  assert.equal(model.chunks.length, 3);
  assert.deepEqual(model.chunks.map(chunk => [chunk.start, chunk.end]), [[1, 400], [401, 800], [801, 900]]);
  assert.equal(model.chunks.map(chunk => chunk.text).join('\n'), lines.join('\n'));
});

test('bands use strict p25/p75 boundaries and missing baselines are their own state', () => {
  const baseline = { n: 10, p25: 0.4, median: 0.6, p75: 0.8 };
  assert.equal(bandFor(0.39, baseline), 'low');
  assert.equal(bandFor(0.4, baseline), 'mid');
  assert.equal(bandFor(0.6, baseline), 'mid');
  assert.equal(bandFor(0.8, baseline), 'mid');
  assert.equal(bandFor(0.81, baseline), 'high');
  assert.equal(bandFor(0.5, { n: 0, p25: null, median: null, p75: null }), 'baseline_unavailable');
  assert.equal(bandFor(0.5, null), 'baseline_unavailable');
  assert.equal(baselineKey('design', 'clarity', 'jev-1').split('\u001f').length, 3);
});

test('content errors map to the exact server codes, reasons and limits', () => {
  const notFound = mapContentError(404, { error: 'not found' });
  assert.equal(notFound.code, 'not_found');
  assert.equal(contentStateText(notFound).message, 'not found for this repo and path');
  const pending = mapContentError(404, { error: 'artifact content is unavailable', code: 'content_unavailable', reason: 'pending' });
  assert.equal(pending.reason, 'pending');
  assert.equal(contentStateText(pending).message, 'pending: not served until ingest completes');
  const removed = mapContentError(404, { code: 'content_unavailable', reason: 'removed_by_screen' });
  assert.equal(contentStateText(removed).message, 'removed by screen');
  const notStored = mapContentError(404, { code: 'content_unavailable', reason: 'not_stored' });
  assert.equal(contentStateText(notStored).message, 'not stored: this ledger has no blob for this version');
  const oversize = mapContentError(413, { code: 'content_too_large', size_bytes: 20000000, limit_bytes: 16777216 });
  assert.equal(oversize.size_bytes, 20000000);
  assert.equal(contentStateText(oversize).message, 'content too large: 20,000,000 bytes exceeds the 16,777,216-byte limit; no prefix is shown');
  const integrity = mapContentError(500, { code: 'content_integrity' });
  assert.equal(contentStateText(integrity).message, 'content integrity check failed');
  const identity = mapContentError(400, { error: 'repo_id, path and a 64-hex hash are required', code: 'content_identity_required' });
  assert.equal(contentStateText(identity).kind, 'identity');
  assert.equal(contentStateText({ ok: true, status: 200 }).kind, 'ready');
});

test('the clean URL keeps only repo_id, path and hash and identity parses the rest away', () => {
  const url = readerUrl({ repo_id: 'repo-a', path: DESIGN, hash: H.designV6 });
  const parsed = new URL(url, 'http://x');
  assert.equal(parsed.pathname, '/artifact');
  assert.equal(parsed.searchParams.get('repo_id'), 'repo-a');
  assert.equal(parsed.searchParams.get('path'), DESIGN);
  assert.equal(parsed.searchParams.get('hash'), H.designV6);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['hash', 'path', 'repo_id']);
  const identity = parseReaderIdentity(`?win=7d&repo_id=repo-a&path=${encodeURIComponent(DESIGN)}&hash=${H.designV6}&future=x`);
  assert.equal(identity.repo_id, 'repo-a');
  assert.equal(identity.path, DESIGN);
  assert.equal(identity.hash, H.designV6);
  assert.equal(identity.invalidHash, false);
  assert.equal(parseReaderIdentity('?hash=abc').invalidHash, true);
  assert.equal(shortHash(H.designV6), `${H.designV6.slice(0, 12)}…`);
  assert.equal(planOfPath(DESIGN), '20-analytics-reset');
  assert.equal(planOfPath('README.md'), '');
});

test('check choices, defaults and per-version scores never turn missing into zero', () => {
  const rows = [
    { scores: { structure: { score: 0.4, scorer: 's' } } },
    { scores: { clarity: { score: 0.5, scorer: 's' } } }
  ];
  assert.deepEqual(checkChoices(rows), ['clarity', 'structure']);
  assert.equal(defaultCheck(rows, ['clarity', 'structure']), 'structure');
  assert.deepEqual(versionScore(rows[1], 'clarity'), { score: 0.5, scorer: 's' });
  assert.equal(versionScore(rows[0], 'clarity'), null);
  assert.deepEqual(checkChoices(rows, [{ name: 'preview' }]), ['clarity', 'preview', 'structure']);
});

test('one baseline request is shared by repeated kind/check/scorer', async () => {
  let calls = 0;
  const transport = {
    async request() {
      calls += 1;
      return { response: { ok: true }, body: { scorers: { s: { clarity: { n: 4, p25: 0.2, median: 0.5, p75: 0.8 } } } } };
    }
  };
  const cache = createBaselineCache({ transport });
  const first = await cache.get('design', 'clarity', 's');
  const second = await cache.get('design', 'clarity', 's');
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.equal(cache.size, 1);
});

test('the fixture exposes exact content states, headers and baselines', () => {
  const ok = p12Content('repo-a', DESIGN, H.designV6);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(ok.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(ok.headers['Cache-Control'], 'private, no-store');
  assert.match(ok.text, /<script>alert\(1\)<\/script>/);
  assert.equal(p12Content('repo-a', DESIGN, H.designV2).body.reason, 'not_stored');
  assert.equal(p12Content('repo-a', DESIGN, H.designV3).body.reason, 'pending');
  assert.equal(p12Content('repo-a', DESIGN, H.designV4).body.reason, 'removed_by_screen');
  assert.deepEqual(p12Content('repo-a', DESIGN, H.designV1).body, { error: 'not found' });
  assert.equal(p12Content('repo-a', REPORT_OVER, H.oversize).status, 413);
  assert.equal(p12Content('repo-a', REPORT_INTEGRITY, H.integrity).status, 500);
  assert.equal(p12Content('repo-a', DESIGN, 'f'.repeat(64)).status, 404);
  assert.equal(p12Baselines({ kind: 'design', check: 'clarity', scorer: 'jev-1.13.0' }).scorers['jev-1.13.0'].clarity.p25, 0.4);
  assert.deepEqual(p12Baselines({ kind: 'design', check: 'structure', scorer: 'jev-missing' }).scorers['jev-missing'].structure, { n: 0, p25: null, median: null, p75: null });
});

// --- Chromium --------------------------------------------------------------

async function settleReader(page) {
  await page.waitForFunction(() => document.querySelector('[data-panel="artifact-reader"]')?.dataset.idle === 'true');
}

async function settleContent(page) {
  await page.waitForFunction(() => document.querySelector('.artifact-version')?.dataset.state === 'ready'
    || document.querySelector('.artifact-content-message'));
}

function openArtifact(page, origin, { path, hash = '' }) {
  const params = new URLSearchParams({ repo_id: 'repo-a', path });
  if (hash) params.set('hash', hash);
  return page.goto(`${origin}/artifact?${params.toString()}`);
}

test('a deep link with no hash selects the latest version and renders inert text with score and band', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const diagnostics = await watchPage(page);

  await openArtifact(page, harness.origin, { path: DESIGN });
  await settleReader(page);
  await settleContent(page);

  const reader = page.locator('[data-panel="artifact-reader"]');
  assert.equal(await reader.getAttribute('data-state'), 'ready');
  assert.equal(await page.locator('.artifact-version-mark').count(), 4, 'page_max = 4 versions on page one');
  const selected = await page.locator('.artifact-version-mark[data-selected="true"]').getAttribute('data-hash');
  assert.equal(selected, H.designV6);
  await page.waitForFunction(() => document.querySelector('.artifact-version-mark[data-selected="true"] .artifact-mark-band')?.dataset.band === 'high');
  const bands = await page.locator('.artifact-version-mark .artifact-mark-band').evaluateAll(nodes => nodes.map(node => node.dataset.band));
  assert.ok(bands.includes('unscored'), `expected an unscored check, got ${JSON.stringify(bands)}`);
  assert.ok(bands.includes('low') || bands.includes('high'));

  const bodyText = await page.locator('.artifact-body').innerText();
  assert.match(bodyText, /<script>alert\(1\)<\/script>/);
  assert.match(bodyText, /<img src=x onerror=alert\(1\)>/);
  assert.equal(await page.locator('[data-panel="artifact-reader"] script').count(), 0);
  assert.equal(await page.locator('[data-panel="artifact-reader"] img').count(), 0);
  assert.match(await page.locator('.artifact-more').innerText(), /Showing lines 1–\d+ of \d+/);

  assert.equal(await page.locator('.artifact-plan-link').getAttribute('href'), '/plans/repo-a/20-analytics-reset');
  assert.equal(await page.locator('.artifact-session-link').getAttribute('href'), '/sessions/conv-20b');
  assert.match(await page.locator('.artifact-session').innerText(), /captured provenance, not proven authorship/);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a hash selects that version, restores on reload, and a chosen check recomputes bands', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await openArtifact(page, harness.origin, { path: DESIGN, hash: H.designV5 });
  await settleReader(page);
  await settleContent(page);
  assert.equal(page.url().includes(`hash=${H.designV5}`), true, 'a deep-linked hash stays in the URL');
  assert.equal(await page.locator('.artifact-version-mark[data-selected="true"]').getAttribute('data-hash'), H.designV5);
  assert.match(await page.locator('.artifact-body').innerText(), /Design B/);

  await page.selectOption('.artifact-check-chooser', 'structure');
  await page.waitForFunction(() => [...document.querySelectorAll('.artifact-mark-band')].some(node => node.dataset.band === 'baseline_unavailable'));
  const bands = await page.locator('.artifact-version-mark .artifact-mark-band').evaluateAll(nodes => nodes.map(node => node.dataset.band));
  assert.deepEqual(bands, ['low', 'high', 'baseline_unavailable', 'unscored']);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a long body chunks, Show more appends windows and the outline jumps to its chunk', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const diagnostics = await watchPage(page);

  await openArtifact(page, harness.origin, { path: BRIEF });
  await settleReader(page);
  await settleContent(page);
  assert.match(await page.locator('.artifact-more').innerText(), /Showing lines 1–400 of 900/);
  assert.equal(await page.locator('.artifact-chunk').count(), 1);
  const outline = await page.locator('.artifact-outline-item').allInnerTexts();
  assert.ok(outline.some(text => /Second section/.test(text)));
  assert.equal(outline.some(text => /fenced not a heading/.test(text)), false, 'fenced headings never enter the outline');

  await page.locator('.artifact-outline-item', { hasText: 'Second section' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.artifact-chunk').length === 2);
  assert.match(await page.locator('.artifact-body').innerText(), /## Second section/);
  assert.match(await page.locator('.artifact-more').innerText(), /Showing lines 1–800 of 900/);

  await page.locator('.artifact-show-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.artifact-chunk').length === 3);
  assert.match(await page.locator('.artifact-more').innerText(), /Showing lines 1–900 of 900/);
  assert.equal(/truncated/i.test(await page.locator('.artifact-more').innerText()), false);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('every unavailable, oversized and integrity state names its exact reason and shows no prefix body', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  async function expectState(path, hash, message, code) {
    await openArtifact(page, harness.origin, { path, hash });
    await settleReader(page);
    await page.waitForFunction(() => document.querySelector('.artifact-content-message'));
    assert.match(await page.locator('.artifact-content-message').innerText(), message);
    if (code) assert.match(await page.locator('.artifact-content-code').innerText(), code);
    assert.equal(await page.locator('.artifact-chunk').count(), 0, 'no prefix body is shown');
  }

  await expectState(DESIGN, H.designV4, /removed by screen/, /404 content_unavailable \(removed_by_screen\)/);
  await expectState(DESIGN, H.designV3, /pending: not served until ingest completes/, /404 content_unavailable \(pending\)/);
  await expectState(REPORT_OVER, H.oversize, /content too large: 20,000,000 bytes exceeds the 16,777,216-byte limit; no prefix is shown/, /413 content_too_large/);
  await expectState(REPORT_INTEGRITY, H.integrity, /content integrity check failed/, /500 content_integrity/);

  // The two page-two states: load the second page, then select each mark.
  await openArtifact(page, harness.origin, { path: DESIGN });
  await settleReader(page);
  await settleContent(page);
  await page.locator('.artifact-versions-more').click();
  await page.waitForFunction(() => document.querySelectorAll('.artifact-version-mark').length === 6);
  await page.locator(`.artifact-version-mark[data-hash="${H.designV2}"]`).click();
  await page.waitForFunction(() => document.querySelector('.artifact-content-message'));
  assert.match(await page.locator('.artifact-content-message').innerText(), /not stored: this ledger has no blob for this version/);
  assert.match(await page.locator('.artifact-content-code').innerText(), /404 content_unavailable \(not_stored\)/);
  assert.equal(await page.locator('.artifact-chunk').count(), 0);

  await page.locator(`.artifact-version-mark[data-hash="${H.designV1}"]`).click();
  await page.waitForFunction(() => /not found for this repo and path/.test(document.querySelector('.artifact-content-message')?.textContent || ''));
  assert.match(await page.locator('.artifact-content-code').innerText(), /404 not_found/);
  assert.equal(await page.locator('.artifact-chunk').count(), 0);

  assert.deepEqual(diagnostics.pageErrors, []);
  assert.deepEqual(await diagnostics.cspViolations(), []);
  assert.ok(diagnostics.consoleErrors.every(text => /Failed to load resource.*(404|413|500)/.test(text)), `unexpected console errors: ${JSON.stringify(diagnostics.consoleErrors)}`);
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});

test('a hash outside the returned versions is named, never substituted, and identity is required', { skip: environment.ok ? false : SKIP_REASON }, async t => {
  const harness = await startWorkspaceHarness();
  harness.api.set({ p12: true });
  const browser = await launchBrowser(environment);
  t.after(async () => { await browser.close(); await harness.close(); });
  const page = await browser.newPage();
  const diagnostics = await watchPage(page);

  await openArtifact(page, harness.origin, { path: DESIGN, hash: 'f'.repeat(64) });
  await settleReader(page);
  assert.match(await page.locator('.artifact-version-missing').innerText(), /version not found for this artifact/);
  assert.equal(await page.locator('.artifact-body').count(), 0);

  await page.goto(`${harness.origin}/artifact`);
  await settleReader(page);
  assert.equal(await page.locator('[data-panel="artifact-reader"]').getAttribute('data-state'), 'identity-required');
  assert.match(await page.locator('.artifact-reader-status').innerText(), /identity required: repo_id and path are required/);

  await page.goto(`${harness.origin}/artifact?repo_id=repo-a&path=${encodeURIComponent(DESIGN)}&hash=nothex`);
  await settleReader(page);
  assert.match(await page.locator('.artifact-reader-status').innerText(), /hash must be a 64-hex content hash/);

  await diagnostics.assertClean();
  const stats = await (await fetch(`${harness.origin}/__test/stats`)).json();
  assert.ok(stats.maxInFlight <= 4, `max in flight ${stats.maxInFlight}`);
});
