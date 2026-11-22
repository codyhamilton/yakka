// Plan 30 phase 1 acceptance: the real-Go two-tenant cookie fixture and real
// Chromium prove S1, N1, C1-C11, V1/V4/V5 and T1-T4. No request interception,
// no synthetic API response, no fixed sleeps. Every number comes from
// /__plan30/fixture; waits are URL/request-count/render predicates or the
// harness idle attribute. The legacy-capability unit check lives in
// legacy-counts.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../charts-time/browser.mjs';
import { startPlan30Harness } from './harness.mjs';
import { encodeCohort } from '../../web/js/core/selection-model.js';
import { encodePanelSpec } from '../../web/js/core/view-spec.js';
import { LEDGER_CAPTION, LEDGER_COLUMNS, ledgerStateModel } from '../../web/js/panels/ledger-table.js';

const environment = loadBrowserEnvironment();
const SKIP = environment.ok ? false : (environment.reason || SKIP_REASON);
const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const screensRoot = resolve(repoRoot, '.scratch', 'plan30-chrome', 'screens');

const fmt = value => Number(value).toLocaleString('en-US');
const countsLine = (matched, total) => `Events matching filters: ${fmt(matched.events)} · Rejections: ${fmt(matched.rejections)} · All retained events in tenant: ${fmt(total.events)}`;
const activityLine = count => `${fmt(count)} observations displayed of ${fmt(count)} matching observations`;
const ACTIVITY_CAPTION = 'Each row is a session start, artifact version, brief execution or rejection; these observations are not a count of all events.';

function checkAll(failures, id, actual, expected) {
  try {
    assert.deepEqual(actual, expected);
  } catch (error) {
    failures.push(`${id}: ${error.message}`);
  }
}

function checkTrue(failures, id, condition, detail = '') {
  if (!condition) failures.push(`${id}${detail ? `: ${detail}` : ''}`);
}

test('plan30 phase 1 acceptance', { skip: SKIP }, async t => {
  const harness = await startPlan30Harness();
  const A = harness.tenants.find(item => item.name === 'a-plan30')?.id || '';
  const B = harness.tenants.find(item => item.name === 'b-plan30')?.id || '';
  const expectedA = harness.expected.a || {};
  const expectedB = harness.expected.b || {};
  const markers = harness.markers || {};
  const failures = [];
  let browser;
  let context;
  let page;

  const requests = [];
  const analyticsRequests = () => requests;

  const run = async (name, fn) => {
    try {
      await t.test(name, fn);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  };
  const mark = () => requests.length;
  const since = index => requests.slice(index);
  const lastExplore = () => {
    for (let i = requests.length - 1; i >= 0; i -= 1) {
      const url = requests[i];
      if (url.pathname.endsWith('/v1/analytics/explore') && !url.searchParams.has('cursor')) return url;
    }
    return null;
  };
  const go = async path => {
    await page.goto(`${harness.origin}${path}`);
    await harness.waitIdle(page);
  };
  const waitUrl = async (predicate, arg) => {
    await page.waitForFunction(predicate, arg);
  };
  const countsText = async () => (await page.locator('.event-counts-text').first().textContent() || '').trim();
  const waitCounts = async text => {
    await page.waitForFunction(expected => (document.querySelector('.event-counts-text')?.textContent || '').trim() === expected, text);
  };
  const rows = async () => page.locator('.ledger-row').count();
  const waitRows = async count => {
    await page.waitForFunction(expected => document.querySelectorAll('.ledger-row').length === expected, count);
  };
  const rowKeys = async () => page.locator('.ledger-row').evaluateAll(nodes => nodes.map(node => node.dataset.rowKey));
  const selectTenant = async id => {
    await page.selectOption('#tenant-select', id);
    await waitUrl(expected => new URL(location.href).searchParams.get('tenant') === expected, id);
    await harness.waitIdle(page);
  };
  const applyAndWait = async (predicate, arg) => {
    await page.locator('.scope-apply').click();
    if (predicate) await waitUrl(predicate, arg);
    await harness.waitIdle(page);
  };
  try {
    browser = await launchBrowser(environment);
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
    harness.attach(context);
    await harness.installSession(context, 'a-plan30');
    page = context.pages()[0] || await context.newPage();
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/v1/analytics/')) requests.push(url);
    });
    await mkdir(screensRoot, { recursive: true });

    await run('S1', async () => {
      assert.ok(A && B, 'fixture tenant ids');
      await harness.control.delay('a-plan30', 700);
      await page.goto(`${harness.origin}/ledger?win=30d`);
      await page.waitForFunction(() => document.querySelector('#tenant-select')?.value);
      await page.waitForFunction(id => new URL(location.href).searchParams.get('tenant') === id, A);
      const historyBefore = await page.evaluate(() => history.length);
      const aLoadStarted = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname.startsWith('/v1/analytics/') && url.searchParams.get('tenant') === A;
      });
      await aLoadStarted;
      const delayedResponse = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/v1/analytics/event-counts') && url.searchParams.get('tenant') === A;
      });
      const delayedA = page.evaluate(async () => {
        const response = await fetch('/v1/analytics/event-counts?tenant=' + new URLSearchParams(location.search).get('tenant'));
        return { status: response.status, body: await response.json() };
      });
      await page.selectOption('#tenant-select', B);
      const bMark = mark();
      await waitUrl(id => new URL(location.href).searchParams.get('tenant') === id, B);
      await harness.waitIdle(page);
      const late = await delayedResponse;
      const delayed = await delayedA;
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.equal(late.status(), 200, 'delayed A response was a real 200');
      assert.equal(delayed.body?.matched?.events, expectedA.window30d.events, 'delayed A payload is the A manifest');
      await waitCounts(countsLine(expectedB.window30d, expectedB.window30d));
      assert.equal(await countsText(), countsLine(expectedB.window30d, expectedB.window30d));
      const postSwitch = since(bMark).filter(url => url.searchParams.get('tenant') === A);
      checkAll(failures, 'S1-requests', postSwitch.map(url => url.pathname), []);
      const body = await page.evaluate(() => document.body.innerText);
      const html = await page.evaluate(() => document.body.innerHTML);
      checkTrue(failures, 'S1-paint', !body.includes(markers.a) && !html.includes(markers.a), `marker ${markers.a} painted after switch`);
      checkTrue(failures, 'S1-paint-rows', (await rows()) >= 1 && !body.includes('plan30-a-only'));
      const historyAfterSelect = await page.evaluate(() => history.length);
      checkTrue(failures, 'S1-history-select', historyAfterSelect === historyBefore + 1, `${historyBefore} -> ${historyAfterSelect}`);
      await page.goBack();
      await waitUrl(id => new URL(location.href).searchParams.get('tenant') === id, A);
      const backMark = mark();
      await harness.waitIdle(page);
      await waitCounts(countsLine(expectedA.window30d, expectedA.total));
      assert.equal(await countsText(), countsLine(expectedA.window30d, expectedA.total));
      checkTrue(failures, 'S1-back-request', since(backMark).some(url => url.searchParams.get('tenant') === A && url.pathname.startsWith('/v1/analytics/')), 'Back issued no fresh A read');
      const backBody = await page.evaluate(() => document.body.innerText);
      checkTrue(failures, 'S1-back-stale', !backBody.includes(markers.b), 'B marker visible after Back');
      const historyAfterBack = await page.evaluate(() => history.length);
      checkTrue(failures, 'S1-history-back', historyAfterBack === historyAfterSelect, 'Back pushed a history entry');
      await page.goForward();
      await waitUrl(id => new URL(location.href).searchParams.get('tenant') === id, B);
      await harness.waitIdle(page);
      await waitCounts(countsLine(expectedB.window30d, expectedB.window30d));
      const forwardBody = await page.evaluate(() => document.body.innerText);
      checkTrue(failures, 'S1-forward-stale', !forwardBody.includes(markers.a), 'A marker visible after Forward');
      const historyAfterForward = await page.evaluate(() => history.length);
      checkTrue(failures, 'S1-history-forward', historyAfterForward === historyAfterSelect, 'Forward pushed a history entry');
      await harness.control.delay('a-plan30', 0);
    });

    await run('N1', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      await waitCounts(countsLine(expectedA.window30d, expectedA.total));
      assert.equal(await countsText(), countsLine(expectedA.window30d, expectedA.total));
      await waitRows(100);
      assert.equal(await page.locator('.ledger-population').first().textContent(), `100 rows displayed of ${fmt(expectedA.window30d.rows)} matching records`);
      await page.locator('.ledger-load-more').click();
      await waitRows(200);
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`200 rows displayed of ${total} matching records`), fmt(expectedA.window30d.rows));

      await go(`/b/pulse?win=30d&tenant=${A}`);
      await page.waitForFunction(text => (document.querySelector('[data-panel="river"] .activity-population')?.textContent || '').trim() === text, activityLine(expectedA.activity30d));
      assert.equal((await page.locator('[data-panel="river"] .activity-population').textContent()).trim(), activityLine(expectedA.activity30d));
      assert.equal((await page.locator('[data-panel="river"] .workspace-panel-caption').textContent()).trim(), ACTIVITY_CAPTION);
      assert.equal(expectedA.activity30d, 16, 'fixture binds 16 in-window observations');

      const explore = lastExplore();
      assert.ok(explore, 'a real /explore request was observed');
      const traversal = await page.evaluate(async path => {
        const url = new URL(path, location.origin);
        url.searchParams.delete('limit');
        url.searchParams.set('limit', '500');
        let cursor = '';
        let seen = 0;
        for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
          const next = new URL(url);
          if (cursor) next.searchParams.set('cursor', cursor);
          const response = await fetch(next);
          if (!response.ok) return { error: response.status };
          const body = await response.json();
          seen += Array.isArray(body.rows) ? body.rows.length : 0;
          cursor = body.next || '';
          if (!cursor) break;
        }
        return { seen };
      }, explore.href);
      assert.equal(traversal.seen, expectedA.window30d.rows, 'full /explore traversal equals matched.rows');

      const api = await page.evaluate(async tenant => {
        const params = new URLSearchParams({ tenant });
        const counts = await (await fetch('/v1/analytics/event-counts?' + params)).json();
        const schema = await (await fetch('/v1/analytics/schema?' + new URLSearchParams({ tenant }))).json();
        return { counts, features: schema.features || {} };
      }, A);
      assert.deepEqual(api.counts.matched, expectedA.window30d);
      assert.deepEqual(api.counts.tenant_total, expectedA.total);
      assert.equal(api.counts.unit, 'retained_record');
      assert.equal(api.counts.matched.rows, api.counts.matched.events + api.counts.matched.rejections);
      assert.equal(api.features.event_counts, true);
      assert.equal(api.features.record_filters, true);

      await page.locator('.scope-all').click();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === 'all');
      await harness.waitIdle(page);
      await waitCounts(countsLine(expectedA.total, expectedA.total));
      assert.equal(await countsText(), countsLine(expectedA.total, expectedA.total));
      await go(`/ledger?win=all&tenant=${A}`);
      await waitCounts(countsLine(expectedA.total, expectedA.total));
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`rows displayed of ${total} matching records`), fmt(expectedA.total.rows));
      const allExplore = lastExplore();
      assert.ok(allExplore, 'all-history /explore request observed');

      await go(`/b/pulse?win=all&tenant=${A}`);
      await page.waitForFunction(text => (document.querySelector('[data-panel="river"] .activity-population')?.textContent || '').trim() === text, activityLine(expectedA.activityAll));
      assert.equal((await page.locator('[data-panel="river"] .activity-population').textContent()).trim(), activityLine(expectedA.activityAll));
      const allBody = await page.evaluate(() => document.body.innerText);
      checkTrue(failures, 'N1-activity-not-events', !allBody.includes(`of ${fmt(expectedA.total.events)} matching observations`));

      await go(`/ledger?win=30d&tenant=${A}&repo_id=repo-a`);
      await waitCounts(countsLine(expectedA.repoA, expectedA.total));
      await go(`/ledger?win=30d&tenant=${A}&kind=brief`);
      await waitCounts(countsLine(expectedA.kindBrief, expectedA.total));
      await go(`/ledger?win=30d&tenant=${A}&repo_id=repo-a&kind=brief`);
      await waitCounts(countsLine(expectedA.repoABrief, expectedA.total));

      await go(`/ledger?win=30d&tenant=${A}&conversation_id=${encodeURIComponent(markers.a)}`);
      await waitCounts(countsLine(expectedA.conversation, expectedA.total));
      await waitRows(expectedA.conversation.rows);
      const convText = await page.locator('.ledger-body').innerText();
      checkTrue(failures, 'N1-conversation', convText.includes('briefs/01.md') && convText.includes('briefs/03.md') && !convText.includes('briefs/02.md') && !convText.includes('reports/01.md'), 'marker conversation exposes exactly rejections 1 and 4');

      await go(`/ledger?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z&tenant=${A}`);
      await waitCounts(countsLine(expectedA.empty2020, expectedA.total));
      await page.waitForFunction(() => document.querySelector('.ledger-state-row[data-state="empty"]'));
      assert.equal((await page.locator('.ledger-state-text').textContent()).trim(), 'No records match these filters.');

      await go(`/ledger?tenant=${harness.foreign}`);
      await page.waitForFunction(() => document.body.innerText.includes('This tenant is unavailable to your account.'));
      assert.ok((await page.locator('.tenant-unavailable').textContent()).includes('This tenant is unavailable to your account.'));
      const foreignStatus = await page.evaluate(async tenant => {
        const response = await fetch('/v1/analytics/event-counts?' + new URLSearchParams({ tenant }));
        return response.status;
      }, harness.foreign);
      assert.equal(foreignStatus, 403);
      const foreignText = await page.evaluate(() => document.body.innerText);
      checkTrue(failures, 'N1-foreign-fallback', !foreignText.includes(fmt(expectedA.window30d.events)), 'foreign tenant painted an A fallback');

      await go(`/ledger?win=30d&tenant=${A}`);
      await waitCounts(countsLine(expectedA.window30d, expectedA.total));
    });

    await run('C1', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      const box = await page.locator('#tenant-select').boundingBox();
      assert.ok(box && box.width > 0, 'tenant selector is visible');
      const options = await page.locator('#tenant-select option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent, disabled: node.disabled })));
      const labelA = `${harness.tenants.find(x => x.id === A).name} · ${A}`;
      const labelB = `${harness.tenants.find(x => x.id === B).name} · ${B}`;
      const values = options.map(option => option.value);
      assert.ok(values.indexOf(A) !== -1 && values.indexOf(B) !== -1, 'both owned fixture tenants are offered');
      assert.ok(values.indexOf(A) < values.indexOf(B), 'fixture tenants keep /me order');
      assert.equal(options.find(option => option.value === A).text, labelA);
      assert.equal(options.find(option => option.value === B).text, labelB);
      assert.ok(!values.includes(harness.foreign), 'foreign tenant is not offered');
      assert.equal(options.find(option => option.value === A).disabled, false);
      assert.equal(await page.locator('#tenant-select').inputValue(), A);
      const before = mark();
      const generationBefore = await page.evaluate(() => Number(document.documentElement.dataset.renderGeneration));
      await selectTenant(B);
      const generationAfter = await page.evaluate(() => Number(document.documentElement.dataset.renderGeneration));
      checkTrue(failures, 'C1-generation', generationAfter > generationBefore, 'selection did not start a new render generation');
      checkAll(failures, 'C1-requests', since(before).filter(url => url.searchParams.get('tenant') === A), []);
      checkTrue(failures, 'C1-b-read', since(before).some(url => url.searchParams.get('tenant') === B), 'selection issued no B read');
      await go(`/ledger?win=30d`);
      await harness.waitIdle(page);
      assert.equal(await page.locator('#tenant-select').inputValue(), B, 'reload remembers B');
      await selectTenant(A);
      await go(`/ledger?win=30d&tenant=${B}`);
      assert.equal(await page.locator('#tenant-select').inputValue(), B, 'URL B wins over remembered A');
    });

    await run('C2', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      for (const [win, label] of [['7d', '7 days'], ['1d', '24 hours'], ['90d', '90 days']]) {
        await page.selectOption('#scope-window', win);
        assert.equal(await page.locator('#scope-window option:checked').textContent(), label);
        const before = mark();
        await applyAndWait(expected => new URL(location.href).searchParams.get('win') === expected, win);
        const read = since(before).find(url => url.pathname.endsWith('/v1/analytics/explore'));
        assert.ok(read, `${win} apply issued an /explore read`);
        assert.ok(read.searchParams.has('from') && read.searchParams.has('to'), `${win} read has frozen absolute bounds`);
        assert.equal(read.searchParams.get('win'), null, 'API never receives win');
      }
      await go(`/ledger?win=24h&tenant=${A}`);
      const legacy = (await page.locator('#scope-window option:checked').textContent()).trim();
      checkTrue(failures, 'C2-24h', legacy === 'URL window: 24h', `legacy 24h selected ${legacy} (DESIGN line 120 requires the literal legacy option)`);
      await page.selectOption('#scope-window', 'custom');
      assert.equal(await page.locator('.scope-from').isVisible(), true);
      assert.equal(await page.locator('.scope-to').isVisible(), true);
      assert.equal(await page.locator('.scope-apply').isDisabled(), true);
      assert.equal((await page.locator('.scope-error').textContent()).trim(), 'Enter a start before the end.');
      await page.locator('.scope-from').fill('2026-01-02T00:00');
      await page.locator('.scope-to').fill('2026-01-01T00:00');
      assert.equal((await page.locator('.scope-error').textContent()).trim(), 'Enter a start before the end.');
      await page.locator('.scope-from').fill('2026-01-01T00:00');
      await page.locator('.scope-to').fill('2026-01-03T00:00');
      const beforeCustom = mark();
      await applyAndWait(() => new URL(location.href).searchParams.has('from') && !new URL(location.href).searchParams.has('win'));
      const customRead = since(beforeCustom).find(url => url.pathname.endsWith('/v1/analytics/explore'));
      assert.ok(customRead, 'valid custom window issued a read');
      assert.equal(customRead.searchParams.get('from'), '2026-01-01T00:00:00.000Z');
      assert.equal(customRead.searchParams.get('to'), '2026-01-03T00:00:00.000Z');

      await page.selectOption('#scope-tz', 'America/New_York');
      await applyAndWait(() => new URL(location.href).searchParams.get('tz') === 'America/New_York');
      await page.selectOption('#scope-window', 'custom');
      await page.locator('.scope-from').fill('2026-03-08T02:30');
      await page.locator('.scope-to').fill('2026-03-08T04:00');
      assert.equal((await page.locator('.scope-error').textContent()).trim(), 'Use an unambiguous time in the selected timezone.');
      assert.equal(await page.locator('.scope-apply').isDisabled(), true);
    });

    await run('C3/C4', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      const repos = await page.locator('#scope-repo option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, text: node.textContent })));
      assert.ok(repos.some(option => option.value === 'repo-a') && repos.some(option => option.value === 'repo-b'));
      checkTrue(failures, 'C3-window-facets', !repos.some(option => option.value === 'repo-c'), 'old-only repo appeared in the 30d facet list');
      await go(`/ledger?win=30d&tenant=${A}&repo_id=repo-missing`);
      const missing = await page.locator('#scope-repo option:checked').textContent();
      assert.equal(missing, 'repo-missing (not in this window)');
      await go(`/ledger?win=30d&tenant=${A}&repo_id=repo-a&repo_id=repo-b`);
      assert.equal(await page.locator('#scope-repo').getAttribute('multiple'), '');
      assert.deepEqual(await page.locator('#scope-repo').evaluate(node => [...node.selectedOptions].map(option => option.value)), ['repo-a', 'repo-b']);
      await go(`/ledger?win=30d&tenant=${A}`);
      const before = mark();
      await page.selectOption('#scope-repo', 'repo-a');
      await page.selectOption('#scope-kind', 'brief');
      assert.equal((await page.locator('.scope-dirty').textContent()).trim(), 'Unapplied changes');
      checkAll(failures, 'C3/C4-preapply', since(before), []);
      await page.selectOption('#scope-kind', '');
      assert.equal(await page.locator('#scope-kind').inputValue(), '', 'All kinds clears a draft kind');
      assert.equal(await page.locator('.scope-apply').isDisabled(), true, 'clearing to the committed draft disables Apply');
      await page.selectOption('#scope-kind', 'brief');
      assert.equal(await page.locator('.scope-apply').isEnabled(), true);
      await applyAndWait(() => new URL(location.href).searchParams.get('repo_id') === 'repo-a' && new URL(location.href).searchParams.get('kind') === 'brief');
      await waitCounts(countsLine(expectedA.repoABrief, expectedA.total));
      const read = since(before).find(url => url.pathname.endsWith('/v1/analytics/explore'));
      assert.ok(read && read.searchParams.get('repo_id') === 'repo-a' && read.searchParams.get('kind') === 'brief');
      await go(`/ledger?win=30d&tenant=${A}&kind=weird`);
      assert.equal(await page.locator('#scope-kind option:checked').textContent(), 'Unsupported kind: weird');
      assert.equal(await page.locator('.scope-apply').isDisabled(), true);
      await page.selectOption('#scope-kind', 'brief');
      assert.equal(await page.locator('.scope-apply').isEnabled(), true, 'correcting an unknown committed kind enables Apply');
    });

    await run('C5', async () => {
      await go(`/b/pulse?win=30d&tenant=${A}&tz=Europe/London`);
      checkTrue(failures, 'C5-url-zone', (await page.locator('#scope-tz').inputValue()) === 'Europe/London', 'URL timezone was not selected');
      await go(`/b/pulse?win=30d&tenant=${A}`);
      const beforeCounts = await countsText();
      const zones = await page.locator('#scope-tz option').evaluateAll(nodes => nodes.map(node => node.value));
      const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      assert.ok(zones.includes(browserZone) && zones.includes('UTC') && zones.includes('Australia/Brisbane') && zones.includes('Europe/London'));
      const before = mark();
      await page.selectOption('#scope-tz', 'UTC');
      await applyAndWait(() => new URL(location.href).searchParams.get('tz') === 'UTC');
      const read = since(before).find(url => url.pathname.endsWith('/v1/analytics/summary'));
      assert.ok(read && read.searchParams.get('tz') === 'UTC');
      assert.equal(await countsText(), beforeCounts, 'timezone changed retention math');
    });

    await run('C6', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      const historyBefore = await page.evaluate(() => history.length);
      const before = mark();
      await page.selectOption('#scope-window', '7d');
      await page.selectOption('#scope-repo', 'repo-a');
      await page.selectOption('#scope-kind', 'brief');
      checkAll(failures, 'C6-preapply', since(before), []);
      assert.equal((await page.locator('.scope-dirty').textContent()).trim(), 'Unapplied changes');
      assert.equal(await page.locator('.scope-apply').isEnabled(), true);
      await applyAndWait(() => new URL(location.href).searchParams.get('win') === '7d' && new URL(location.href).searchParams.get('repo_id') === 'repo-a');
      const historyAfter = await page.evaluate(() => history.length);
      assert.equal(historyAfter, historyBefore + 1, 'Apply pushes exactly once');
      assert.equal(await page.locator('.scope-apply').isDisabled(), true);
      const afterApply = mark();
      await page.locator('.scope-apply').click({ force: true }).catch(() => {});
      checkAll(failures, 'C6-second-apply', since(afterApply), []);
      await page.goBack();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === '30d');
      await harness.waitIdle(page);
      assert.equal(await page.locator('#scope-window').inputValue(), '30d');
      assert.equal(await page.locator('#scope-repo').inputValue(), '');
      assert.equal(await page.locator('#scope-kind').inputValue(), '');
      assert.equal(await page.evaluate(() => history.length), historyAfter, 'Back pushed a history entry');
    });

    await run('C7', async () => {
      const cohort = encodeCohort({
        grain: 'session', op: 'include', predicate: { in: { lens: 'id', values: ['s1'] } },
        scope: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', tz: 'UTC', include: [], exclude: [] }
      });
      const panel = encodePanelSpec({ grain: 'event', measures: [], split: '', chart: 'table' });
      const query = new URLSearchParams({
        tenant: A, from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', tz: 'UTC',
        repo_id: 'repo-a', kind: 'brief', exclude: 'stage:screen', ca: cohort, pick: 's1|', sel: 'range', p1: panel
      });
      await go(`/ledger?${query}`);
      await page.locator('.scope-reset').click();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === '30d');
      await harness.waitIdle(page);
      const url = new URL(await page.evaluate(() => location.href));
      assert.equal(url.searchParams.get('tenant'), A);
      assert.equal(url.searchParams.get('tz'), 'UTC');
      assert.equal(url.searchParams.get('win'), '30d');
      for (const key of ['from', 'to', 'repo_id', 'kind', 'exclude', 'ca', 'pick', 'sel']) {
        checkTrue(failures, 'C7-reset', !url.searchParams.has(key), `${key} survived Reset`);
      }
      assert.equal(url.searchParams.get('p1'), panel, 'Reset dropped the panel selection');
      await go(`/b/compare?win=30d&cmp=period&tenant=${A}`);
      await page.locator('.scope-reset').click();
      await harness.waitIdle(page);
      checkTrue(failures, 'C7-compare', new URL(await page.evaluate(() => location.href)).searchParams.get('cmp') === 'period', 'Compare lost cmp=period on Reset');
      await go(`/ledger?win=30d&tenant=${A}`);
      const removableDefault = await page.locator('.workspace-chip[data-kind="scope"] .workspace-chip-remove').count();
      checkTrue(failures, 'C7-default-chips', removableDefault === 0, `${removableDefault} removable default chip(s) present`);
    });

    await run('C8', async () => {
      await go(`/ledger?win=30d&tenant=${A}&repo_id=repo-a`);
      await waitCounts(countsLine(expectedA.repoA, expectedA.total));
      await waitRows(100);
      const before = mark();
      await page.locator('.scope-all').click();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === 'all');
      await harness.waitIdle(page);
      const url = new URL(await page.evaluate(() => location.href));
      assert.equal(url.searchParams.get('win'), 'all');
      assert.equal(url.searchParams.has('from'), false);
      assert.equal(url.searchParams.has('to'), false);
      assert.equal(url.searchParams.get('repo_id'), 'repo-a');
      assert.equal(url.searchParams.get('tenant'), A);
      await waitRows(100);
      await waitCounts(countsLine(expectedA.repoA, expectedA.total));
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`rows displayed of ${total} matching records`), fmt(expectedA.repoA.rows));
      checkTrue(failures, 'C8-request', since(before).some(value => value.searchParams.get('all') === '1'));
    });

    await run('C10', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      const before = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, box: document.querySelector('#app').getBoundingClientRect().height }));
      await page.locator('#theme-toggle').click();
      await page.waitForFunction(prior => document.documentElement.dataset.theme !== prior, before.theme);
      const dark = await page.evaluate(() => {
        const white = [];
        for (const node of document.querySelectorAll('body *')) {
          const background = getComputedStyle(node).backgroundColor;
          if (background === 'rgb(255, 255, 255)') white.push(node.className || node.tagName);
        }
        return { theme: document.documentElement.dataset.theme, stored: localStorage.getItem('yakka-analytics-theme'), white, box: document.querySelector('#app').getBoundingClientRect().height };
      });
      assert.equal(dark.theme, 'dark');
      assert.equal(dark.stored, 'dark');
      checkAll(failures, 'C10-white', dark.white, []);
      checkTrue(failures, 'C10-shift', dark.box === before.box, `${before.box} -> ${dark.box}`);
      await page.locator('#theme-toggle').click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    });

    await run('C11', async () => {
      const c11Diagnostics = harness.diagnostics.length;
      await go(`/ledger?win=30d&tenant=${A}&exclude=stage:screen&tool=Read`);
      await page.locator('.scope-advanced > summary').click();
      const labels = await page.locator('.scope-advanced-row > span').evaluateAll(nodes => nodes.map(node => node.textContent));
      assert.ok(labels.includes('tool: Read') && labels.includes('exclude stage:screen'), 'advanced scope shows both deep-link rows');
      await waitRows(100);
      await page.locator('.ledger-row').first().click({ modifiers: ['Control'] });
      await page.waitForFunction(() => document.querySelector('.selection-tray')?.dataset.open === 'true');
      await page.getByRole('button', { name: 'Make cohort A' }).click();
      await waitUrl(() => new URL(location.href).searchParams.has('ca'));
      await harness.waitIdle(page);
      const deepLink = await page.evaluate(() => location.href);
      let cohortScope = null;
      try { cohortScope = JSON.parse(new URL(deepLink).searchParams.get('ca') || '{}').scope; } catch {}
      checkTrue(failures, 'C11-cohort-scope', Boolean(cohortScope && cohortScope.tz && cohortScope.from && cohortScope.to), `generated cohort scope=${JSON.stringify(cohortScope)}`);
      await page.goto(deepLink);
      await harness.waitIdle(page);
      await page.locator('.scope-advanced > summary').click();
      const afterReload = await page.locator('.scope-advanced-row > span').evaluateAll(nodes => nodes.map(node => node.textContent));
      assert.ok(afterReload.some(label => label.startsWith('cohort A')), 'reloaded deep link keeps the created cohort');
      const before = new URL(await page.evaluate(() => location.href));
      await page.locator('.scope-advanced-row button', { hasText: 'Remove tool: Read' }).click();
      await harness.waitIdle(page);
      const after = new URL(await page.evaluate(() => location.href));
      checkTrue(failures, 'C11-tool-removed', !after.searchParams.has('tool'), 'tool filter survived removal');
      checkTrue(failures, 'C11-window', after.searchParams.get('win') === before.searchParams.get('win'), 'removal reset the window');
      checkTrue(failures, 'C11-exclude', after.searchParams.get('exclude') === before.searchParams.get('exclude'), 'removal changed the unrelated exclude');
      checkTrue(failures, 'C11-cohort', after.searchParams.get('ca') === before.searchParams.get('ca'), 'removal changed the cohort');
      checkTrue(failures, 'C11-pick-sel', !after.searchParams.has('pick') && !after.searchParams.has('sel'), `pick/sel survived: pick=${after.searchParams.get('pick')} sel=${after.searchParams.get('sel')}`);
      const rejected = harness.diagnostics.slice(c11Diagnostics).filter(value => value.startsWith('400:') && value.includes('cohort='));
      checkTrue(failures, 'C11-cohort-request', rejected.length === 0, `${rejected.length} cohort request(s) rejected: ${rejected[0] || ''}`);
    });

    await run('V1/V4/V5', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const box = node.getBoundingClientRect();
          return { left: box.left, right: box.right, width: box.width, height: box.height };
        };
        return {
          identity: rect('.identity-row'), analytics: rect('.analytics-nav'), account: rect('.account-nav'),
          heading: rect('#app > h1'), filters: rect('.scope-filters'), counts: rect('.event-counts'), main: rect('main'),
          inner: rect('.scope-controls'), scrollWidth: document.documentElement.scrollWidth
        };
      });
      assert.equal(geometry.identity.height, 46);
      assert.equal(geometry.analytics.height, 32);
      assert.equal(geometry.account.height, 32);
      assert.equal(geometry.heading.height, 32);
      checkTrue(failures, 'V1-filter-row', geometry.filters.height >= 44, `filter row ${geometry.filters.height}px`);
      assert.equal(geometry.counts.height, 32);
      assert.equal(geometry.main.left, 0);
      assert.equal(geometry.inner.left, 12);
      checkTrue(failures, 'V1-right', geometry.inner.right <= 1440, `inner right ${geometry.inner.right}`);
      checkTrue(failures, 'V1-scroll', geometry.scrollWidth <= 1440, `document scrollWidth ${geometry.scrollWidth}`);

      const nav = await page.locator('.analytics-nav a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.getAttribute('href') })));
      assert.deepEqual(nav, [
        { text: 'Start', href: '/' }, { text: 'Pulse', href: '/b/pulse' }, { text: 'Trends', href: '/b/trends' },
        { text: 'Cost', href: '/b/cost' }, { text: 'Quality', href: '/b/quality' }, { text: 'Tools', href: '/b/tools' },
        { text: 'Workflow', href: '/b/workflow' }, { text: 'Compare', href: '/b/compare' }, { text: 'Scatter', href: '/b/scatter' },
        { text: 'Plans', href: '/plans' }, { text: 'Sessions', href: '/sessions' }, { text: 'Ledger', href: '/ledger' }, { text: 'Operations', href: '/ops' }
      ]);
      const account = await page.locator('.account-nav a').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, href: node.getAttribute('href') })));
      assert.deepEqual(account, [
        { text: 'Tokens', href: '/profile#tokens' }, { text: 'Tenants', href: '/profile#tenants' },
        { text: 'Membership', href: '/profile#membership' }, { text: 'Settings', href: '/settings' }, { text: 'Device approval', href: '/device' }
      ]);
      assert.equal(await page.locator('.brand').getAttribute('href'), '/');
      const active = await page.locator('.analytics-nav a[aria-current="page"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert.deepEqual(active, ['/ledger']);
      const identityOrder = await page.evaluate(() => {
        const brand = document.querySelector('.brand');
        const tenant = document.querySelector('#tenant-select');
        const theme = document.querySelector('#theme-toggle');
        return Boolean(brand.compareDocumentPosition(tenant) & Node.DOCUMENT_POSITION_FOLLOWING) && Boolean(tenant.compareDocumentPosition(theme) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      assert.equal(identityOrder, true, 'Theme follows the tenant field');
      const pageText = await page.evaluate(() => document.body.innerText);
      checkTrue(failures, 'V4-lifecycle', !/lifecycle/i.test(pageText), 'lifecycle nav entry present');
      for (const forbidden of ['Invite', 'Add member', 'Change role']) checkTrue(failures, 'V4-invite', !pageText.includes(forbidden), `${forbidden} control present`);
      await page.evaluate(() => document.querySelector('.brand').focus());
      const order = [];
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Tab');
        order.push(await page.evaluate(() => {
          const node = document.activeElement;
          return node === document.querySelector('.brand') ? 'brand'
            : node === document.querySelector('#tenant-select') ? 'tenant'
              : node === document.querySelector('#theme-toggle') ? 'theme'
                : node?.closest('.analytics-nav') ? 'nav' : node?.tagName || '';
        }));
      }
      assert.deepEqual(order, ['tenant', 'theme', 'nav', 'nav'], `tab order ${order.join(' -> ')}`);
    });

    await run('T1', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      await waitRows(100);
      await harness.control.delay('a-plan30', 900);
      await page.locator('.scope-refresh').click();
      await page.waitForFunction(() => {
        const row = document.querySelector('.ledger-state-row[data-state="loading"]');
        return row && row.querySelector('.ledger-state-text')?.textContent.trim() === 'Loading Event ledger…'
          && row.closest('tbody')?.getAttribute('aria-busy') === 'true';
      });
      const loading = await page.evaluate(() => {
        const row = document.querySelector('.ledger-state-row[data-state="loading"]');
        return {
          caption: document.querySelector('.ledger-caption')?.textContent,
          rows: document.querySelectorAll('.ledger-row').length,
          height: row.getBoundingClientRect().height,
          span: row.querySelector('td')?.colSpan,
          text: document.body.innerText
        };
      });
      assert.equal(loading.caption, LEDGER_CAPTION);
      assert.equal(loading.rows, 0, 'prior rows survived the loading state');
      checkTrue(failures, 'T1-no-prior', !loading.text.includes(markers.a), 'prior tenant marker remained');
      checkTrue(failures, 'T1-full-span', loading.span === LEDGER_COLUMNS.length, `status row colSpan ${loading.span}, ledger columns ${LEDGER_COLUMNS.length}`);
      checkTrue(failures, 'T1-30px', Math.abs(loading.height - 30) <= 1, `status row ${loading.height}px`);
      await harness.waitIdle(page);
      await waitRows(100);
      await harness.control.delay('a-plan30', 0);
    });

    await run('T2', async () => {
      await go(`/ledger?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z&tenant=${A}`);
      assert.equal((await page.locator('.ledger-state-text').textContent()).trim(), 'No records match these filters.');
      const beforeAll = mark();
      await page.locator('.ledger-state-action[data-action="all-history"]').click();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === 'all');
      await harness.waitIdle(page);
      await waitCounts(countsLine(expectedA.total, expectedA.total));
      checkTrue(failures, 'T2-all-request', since(beforeAll).some(url => url.searchParams.get('all') === '1'));
      await go(`/ledger?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z&tenant=${A}`);
      const beforeReset = mark();
      await page.locator('.ledger-state-action[data-action="reset-filters"]').click();
      await waitUrl(() => new URL(location.href).searchParams.get('win') === '30d');
      await harness.waitIdle(page);
      await waitCounts(countsLine(expectedA.window30d, expectedA.total));
      checkTrue(failures, 'T2-reset-request', since(beforeReset).some(url => url.pathname.endsWith('/v1/analytics/explore')));
    });

    await run('T3', async () => {
      await harness.control.hold('a-plan30', true);
      await page.goto(`${harness.origin}/ledger?win=30d&tenant=${A}`);
      await page.waitForFunction(() => {
        const text = document.querySelector('.ledger-state-text')?.textContent.trim();
        const code = document.querySelector('.ledger-state-code')?.textContent.trim();
        return text === 'Could not load Event ledger.' && code === 'busy';
      });
      const busy = await page.evaluate(() => ({
        text: document.querySelector('.ledger-state-text')?.textContent.trim(),
        detail: document.querySelector('.ledger-state-detail')?.textContent.trim(),
        code: document.querySelector('.ledger-state-code')?.textContent.trim(),
        counts: document.querySelector('.event-counts-text')?.textContent.trim(),
        retry: document.querySelector('.ledger-state-action[data-action="retry"]')?.textContent.trim()
      }));
      assert.equal(busy.text, 'Could not load Event ledger.');
      assert.equal(busy.detail, 'The server is busy; retry shortly.');
      assert.equal(busy.code, 'busy');
      assert.ok(!busy.text.includes('<') && !/stack/i.test(busy.text));
      assert.equal(busy.retry, 'Retry');
      assert.equal(busy.counts, 'Event counts unavailable');
      const focusable = await page.evaluate(() => {
        const button = document.querySelector('.ledger-state-action[data-action="retry"]');
        button.focus();
        return document.activeElement === button;
      });
      assert.equal(focusable, true, 'Retry is not focusable');
      await harness.control.hold('a-plan30', false);
      await page.locator('.ledger-state-action[data-action="retry"]').click();
      await harness.waitIdle(page);
      await waitRows(100);
      await page.locator('.event-counts-retry').click();
      await waitCounts(countsLine(expectedA.window30d, expectedA.total));

      const unit = {
        unauthorized: ledgerStateModel('error', { status: 401, code: 'unauthorized' }),
        forbidden: ledgerStateModel('error', { status: 403, code: 'no such tenant' })
      };
      assert.equal(unit.unauthorized.actions[0].label, 'Sign in');
      assert.equal(unit.forbidden.detail, 'You do not have access to this tenant');
      const foreignStatus = await page.evaluate(async tenant => {
        const response = await fetch('/v1/analytics/explore?' + new URLSearchParams({ tenant }));
        return response.status;
      }, harness.foreign);
      assert.equal(foreignStatus, 403, 'real foreign-tenant request was not 403');
    });

    await run('T4', async () => {
      await go(`/ledger?win=30d&tenant=${A}`);
      await waitRows(100);
      const first = lastExplore();
      assert.ok(first && first.searchParams.get('limit') === '100', 'first ledger page limit is 100');
      const firstKeys = await rowKeys();
      assert.equal(new Set(firstKeys).size, 100);
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`100 rows displayed of ${total} matching records`), fmt(expectedA.window30d.rows));

      await harness.control.delay('a-plan30', 700);
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(() => {
        const button = document.querySelector('.ledger-load-more');
        return button && button.disabled && button.textContent.trim() === 'Loading…';
      });
      await waitRows(200);
      const twoHundred = await rowKeys();
      assert.equal(new Set(twoHundred).size, 200);
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`200 rows displayed of ${total} matching records`), fmt(expectedA.window30d.rows));
      await harness.control.delay('a-plan30', 0);

      await harness.control.hold('a-plan30', true);
      await page.locator('.ledger-load-more').click();
      await page.waitForFunction(() => document.querySelector('.ledger-retry-next')?.textContent.trim() === 'Retry next page');
      assert.equal(await rows(), 200, 'failed next page discarded loaded rows');
      await harness.control.hold('a-plan30', false);
      await page.locator('.ledger-retry-next').click();
      await page.waitForFunction(() => document.querySelectorAll('.ledger-row').length > 200);
      const keys = await rowKeys();
      assert.equal(new Set(keys).size, keys.length, 'duplicate row identities after continuation');

      const before = mark();
      await page.selectOption('#scope-repo', 'repo-a');
      await applyAndWait(() => new URL(location.href).searchParams.get('repo_id') === 'repo-a');
      await waitRows(100);
      await waitCounts(countsLine(expectedA.repoA, expectedA.total));
      const reset = since(before).find(url => url.pathname.endsWith('/v1/analytics/explore'));
      assert.ok(reset && !reset.searchParams.has('cursor'), 'scope change did not clear the cursor');
      assert.equal(reset.searchParams.get('limit'), '100');
    });

    await run('C9', async () => {
      await go(`/ledger?win=30d&tenant=${B}`);
      await waitCounts(countsLine(expectedB.window30d, expectedB.window30d));
      await waitRows(expectedB.window30d.rows);
      const generationBefore = await page.evaluate(() => Number(document.documentElement.dataset.renderGeneration));
      await harness.control.append('b-plan30');
      await page.locator('.scope-refresh').click();
      await harness.waitIdle(page);
      const generationAfter = await page.evaluate(() => Number(document.documentElement.dataset.renderGeneration));
      checkTrue(failures, 'C9-generation', generationAfter > generationBefore, 'Refresh did not start a new generation');
      await waitCounts(countsLine(expectedB.afterAppend, expectedB.afterAppend));
      assert.equal(await countsText(), countsLine(expectedB.afterAppend, expectedB.afterAppend));
      await waitRows(expectedB.afterAppend.rows);
      const url = new URL(await page.evaluate(() => location.href));
      assert.equal(url.searchParams.get('tenant'), B);
      await page.waitForFunction(total => (document.querySelector('.ledger-population')?.textContent || '').includes(`${total} rows displayed of ${total} matching records`), expectedB.afterAppend.rows);
    });

    await run('screenshots', async () => {
      const shots = [
        ['start', `/?tenant=${A}&win=30d`],
        ['pulse', `/b/pulse?tenant=${A}&win=30d`],
        ['ledger', `/ledger?tenant=${A}&win=30d`],
        ['trends', `/b/trends?tenant=${A}&win=30d`]
      ];
      for (const [name, route] of shots) {
        await go(route);
        await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
        await page.screenshot({ path: resolve(screensRoot, `${name}.png`), fullPage: true });
        await writeFile(resolve(screensRoot, `${name}.txt`), await page.evaluate(() => document.body.innerText), 'utf8');
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        await page.screenshot({ path: resolve(screensRoot, `${name}-light.png`), fullPage: true });
      }
    });

    const expected400 = value => {
      if (!value.startsWith('400:')) return false;
      const url = new URL(value.slice(5));
      return url.searchParams.get('kind') === 'weird' || url.searchParams.has('cohort');
    };
    checkAll(failures, 'diagnostics', harness.diagnostics.filter(value => !expected400(value)), []);
  } finally {
    await browser?.close().catch(() => {});
    await harness.close().catch(() => {});
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
