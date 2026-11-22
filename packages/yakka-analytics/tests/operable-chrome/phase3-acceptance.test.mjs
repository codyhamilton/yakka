// Plan 30 phase 3 acceptance proof. One real Chromium at 1440x900 covers every
// phase 3 outcome ID: the account console and its contract-faithful stub, the
// account connection/auth/error routes, the real Go lifecycle template with
// only its destructive calls stubbed, and C1/C10/V1-V5 on every account screen.
// No analytics request is intercepted and the not-found route performs no
// analytics read. Failures are recorded per ID with the observed value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadBrowserEnvironment, launchBrowser, SKIP_REASON } from '../charts-time/browser.mjs';
import {
  startPhase3Harness, installAccountStub, installLifecycleStub,
  PHASE3_SCREENS, phase3ScreensRoot, mockupsRoot, mockupPng, mockupSrc, pngSize
} from './phase3-harness.mjs';

const environment = loadBrowserEnvironment();
const SKIP = environment.ok ? false : (environment.reason || SKIP_REASON);

const ANALYTICS_NAV = ['Start', 'Pulse', 'Trends', 'Cost', 'Quality', 'Tools', 'Workflow', 'Compare', 'Scatter', 'Plans', 'Sessions', 'Ledger', 'Operations'];
const ACCOUNT_NAV = ['Tokens', 'Tenants', 'Membership', 'Settings', 'Device approval'];
const FORBIDDEN = ['Invite', 'Add member', 'Change role'];

test('plan30 phase 3 acceptance', { skip: SKIP }, async t => {
  const harness = await startPhase3Harness();
  const failures = [];
  const results = {};
  const comparisons = [];
  const analytics = [];
  let browser;
  let accountContext;
  let accountPage;
  let account;
  let lifecycleContext;
  let lifecyclePage;
  let lifecycle;

  const pass = (id, evidence) => { if (results[id]?.status !== 'fail') results[id] = { status: 'pass', evidence }; };
  const fail = (id, message) => { failures.push(`${id}: ${message}`); results[id] = { status: 'fail', evidence: message }; };
  const group = async (id, fn, evidence) => {
    try { await fn(); pass(id, evidence); } catch (error) { fail(id, error.message); }
  };
  const clean = async () => {
    account.reset();
    await accountPage.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  };
  const openProfile = async () => {
    await clean();
    await harness.go(accountPage, '/profile');
    await accountPage.locator('[data-account="tenants"]').waitFor();
    await accountPage.locator('[data-account="tokens"]').waitFor();
    await accountPage.waitForFunction(() => !document.querySelector('[data-account="tokens"]')?.innerText.includes('Loading tokens…'));
  };
  const openReady = async route => {
    await clean();
    await harness.go(accountPage, route);
  };
  const rows = selector => accountPage.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0));
  const heights = selector => accountPage.locator(selector).evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => Math.round(node.getBoundingClientRect().height * 10) / 10));
  const textOf = async selector => (await accountPage.locator(selector).first().textContent() || '').trim();
  const headers = selector => accountPage.locator(`${selector} thead th`).evaluateAll(nodes => nodes.map(node => node.textContent.trim()));
  const widths = selector => accountPage.locator(`${selector} thead th`).evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)));

  try {
    browser = await launchBrowser(environment);
    accountContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
    harness.attach(accountContext);
    await harness.installSession(accountContext, 'a-plan30');
    accountPage = accountContext.pages()[0] || await accountContext.newPage();
    harness.watch(accountPage);
    accountPage.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/v1/analytics/')) analytics.push({ path: url.pathname });
    });
    account = await installAccountStub(accountPage);
    await harness.go(accountPage, '/login');

    lifecycleContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, timezoneId: 'UTC' });
    harness.attach(lifecycleContext);
    await harness.installSession(lifecycleContext, 'a-plan30');
    lifecyclePage = lifecycleContext.pages()[0] || await lifecycleContext.newPage();
    harness.watch(lifecyclePage);
    lifecycle = await installLifecycleStub(lifecyclePage);

    // ----- A1: owned membership inventory, states and recovery -----
    await group('A1', async () => {
      await openProfile();
      assert.equal(await textOf('#app > h1'), 'Account, tenants & tokens');
      assert.deepEqual(await headers('[data-account="tenants"]'), ['Name', 'Immutable ID', 'Your access', 'Lifecycle state', 'Generation', 'Actions']);
      const tableRows = accountPage.locator('[data-account-tenant-row]');
      assert.equal(await tableRows.count(), 3);
      assert.deepEqual(await tableRows.nth(0).locator('td').allTextContents().then(v => v.slice(0, 5)), ['Alpha', 'tenant-a', 'Owner', 'Active', '3']);
      assert.deepEqual(await tableRows.nth(1).locator('td').allTextContents().then(v => v.slice(0, 5)), ['Beta', 'tenant-b', 'Owner', 'Active', '5']);
      assert.deepEqual(await tableRows.nth(2).locator('td').allTextContents().then(v => v.slice(0, 5)), ['Pending', 'tenant-p', 'Owner', 'Pending', '1']);
      assert.deepEqual((await widths('[data-account="tenants"]')).slice(0, 5), [240, 260, 100, 160, 100]);
      assert.ok((await heights('[data-account-tenant-row]')).every(height => Math.abs(height - 30) <= 1));
      const link = accountPage.locator('[data-testid="lifecycle-link-tenant-a"]');
      const href = new URL(await link.getAttribute('href'), harness.origin);
      assert.equal(href.pathname, '/profile/lifecycle');
      assert.equal(href.searchParams.get('tenant'), 'tenant-a');
      assert.equal(await link.getAttribute('target'), null);
      assert.match(await link.textContent(), /Reset or delete… \(API owner page\)/);
      assert.equal(await accountPage.getByRole('button', { name: /^(Invite|Add member|Change role)$/ }).count(), 0);
      assert.equal(await accountPage.locator('.scope-bar, .scope-filters, .coverage-strip, .yk-chart, .event-counts').count(), 0);
      assert.equal(analytics.length, 0, '/profile performed an analytics read');
      const before = account.calls('/v1/me').length;
      await accountPage.locator('[data-testid="account-refresh"]').click();
      await accountPage.waitForFunction(() => document.querySelectorAll('[data-account-tenant-row]').length === 3);
      assert.ok(account.calls('/v1/me').length > before, 'Refresh account did not read /v1/me');
    }, 'A1 /me order, membership columns/widths/30px rows, Owner, Use tenant link and Refresh account');

    await group('A1', async () => {
      await clean();
      account.state.emptyTenants = true;
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('You do not own any tenants yet.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="create-tenant"]').count(), 1);
      await accountPage.getByText('Create a tenant to issue a token.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="create-token"]').isDisabled(), true);
    }, 'A1 empty inventory keeps the create form and disables token creation');

    await group('A1', async () => {
      await clean();
      account.state.status.me = 500;
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('Could not load tenants.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="retry-account"]').count(), 1);
    }, 'A1 error state names tenants failure and offers Retry account');

    await group('A1', async () => {
      await clean();
      account.state.status.me = 500;
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('Could not load tenants.').waitFor();
      account.state.status.me = 200;
      const gate = account.hold.hold('/v1/me');
      await accountPage.locator('[data-testid="retry-account"]').click();
      await gate.started;
      await accountPage.getByText('Loading tenants…').waitFor();
      gate.release();
      await accountPage.waitForFunction(() => document.querySelectorAll('[data-account-tenant-row]').length === 3);
    }, 'A1 retry shows Loading tenants… and then the /me order');

    await group('A1', async () => {
      await clean();
      const gate = account.hold.hold('/v1/tokens');
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('Loading tokens…').waitFor();
      gate.release();
      await accountPage.waitForFunction(() => document.querySelectorAll('[data-token-row]').length === 4);
    }, 'A1 token loading keeps the caption and clears prior rows');

    for (const status of [401, 403]) {
      await group('A1', async () => {
        await clean();
        account.state.status.me = status;
        await harness.go(accountPage, '/profile');
        await accountPage.getByText('Could not load tenants.').waitFor();
        assert.equal(await accountPage.locator('[data-account-tenant-row]').count(), 0, `${status} painted a fake tenant row`);
        assert.equal(await accountPage.getByText('Sign in to manage account').count(), 1);
      }, `A1 ${status} leaves no optimistic rows and offers the sign-in boundary`);
    }

    // ----- A2: create tenant -----
    await group('A2', async () => {
      await openProfile();
      await accountPage.locator('[data-testid="new-tenant-name"]').fill('   ');
      await accountPage.locator('[data-testid="create-tenant"]').click();
      await accountPage.getByText('Use 1–64 characters with no control characters.').waitFor();
      assert.equal(account.calls('/v1/tenants', 'POST').length, 0);
      await accountPage.locator('[data-testid="new-tenant-name"]').evaluate(input => { input.value = 'Bad\u0001Name'; input.dispatchEvent(new Event('input', { bubbles: true })); });
      await accountPage.locator('[data-testid="create-tenant"]').click();
      await accountPage.getByText('Use 1–64 characters with no control characters.').waitFor();
      assert.equal(account.calls('/v1/tenants', 'POST').length, 0);
    }, 'A2 blank/control-character names send no request and show the exact validation');

    await group('A2', async () => {
      await openProfile();
      const beforeMe = account.calls('/v1/me').length;
      const gate = account.hold.hold('/v1/tenants');
      await accountPage.locator('[data-testid="new-tenant-name"]').fill('Delta');
      await accountPage.locator('[data-testid="create-tenant"]').click();
      await gate.started;
      assert.equal(await accountPage.locator('[data-testid="create-tenant"]').isDisabled(), true, 'create button stayed enabled during the request');
      assert.equal(await accountPage.locator('[data-testid="new-tenant-name"]').isDisabled(), true, 'name input stayed enabled during the request');
      await accountPage.evaluate(() => document.querySelector('form.account-tenant-form')?.requestSubmit());
      gate.release();
      await accountPage.waitForFunction(() => document.querySelectorAll('[data-account-tenant-row]').length === 4);
      assert.equal(account.calls('/v1/tenants', 'POST').length, 1, 'double submit issued more than one POST /v1/tenants');
      assert.deepEqual(JSON.parse(account.calls('/v1/tenants', 'POST')[0].body), { name: 'Delta' });
      assert.ok(account.calls('/v1/me').length > beforeMe, 'create did not refresh /v1/me');
      const created = account.state.tenants.at(-1);
      await accountPage.waitForFunction(id => document.querySelector('#tenant-select')?.value === id, created.id);
      assert.match(accountPage.url(), new RegExp(`tenant=${created.id}`));
      const focused = await accountPage.evaluate(() => document.activeElement?.closest('[data-account-tenant-row]')?.getAttribute('data-account-tenant-row') || '');
      assert.equal(focused, created.id);
      assert.deepEqual(await accountPage.locator('[data-account-tenant-row]').last().locator('td').allTextContents().then(v => v.slice(0, 5)), ['Delta', created.id, 'Owner', 'Active', '1']);
    }, 'A2 exact {name} POST, no double submit, fresh /me, selection and focus');

    await group('A2', async () => {
      await openProfile();
      await accountPage.locator('[data-testid="new-tenant-name"]').fill('Alpha');
      await accountPage.locator('[data-testid="create-tenant"]').click();
      await accountPage.getByText('You already have a tenant with this name.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="new-tenant-name"]').inputValue(), 'Alpha');
    }, 'A2 409 keeps the input and names the duplicate');

    await group('A2', async () => {
      await openProfile();
      account.state.status.createTenant = 500;
      await accountPage.locator('[data-testid="new-tenant-name"]').fill('Epsilon');
      await accountPage.locator('[data-testid="create-tenant"]').click();
      await accountPage.getByText('Could not create tenant.').waitFor();
      assert.equal(await accountPage.locator('[data-account-tenant-row]').count(), 3, 'failed create painted a row');
    }, 'A2 failed create leaves no optimistic row');

    // ----- A3: create token -----
    await group('A3', async () => {
      await openProfile();
      assert.equal(await accountPage.locator('[data-testid="token-name"]').inputValue(), 'token');
      assert.equal(await accountPage.locator('[data-testid="token-scope"]').inputValue(), 'read');
      assert.equal(await accountPage.locator('[data-testid="token-lifetime"]').inputValue(), '3m');
      const gate = account.hold.hold('/v1/tokens');
      await accountPage.locator('[data-testid="create-token"]').click();
      await gate.started;
      assert.equal(await accountPage.locator('[data-testid="create-token"]').isDisabled(), true);
      gate.release();
      await accountPage.locator('[data-testid="issued-token-once"]').waitFor();
      const posts = account.calls('/v1/tokens', 'POST');
      assert.equal(posts.length, 1);
      assert.deepEqual(JSON.parse(posts[0].body), { tenant: 'tenant-a', scope: 'read', lifetime: '3m', name: 'token' });
      assert.equal(await accountPage.locator('[data-testid="issued-token-once"]').inputValue(), 'fixture-plaintext-token');
      await accountPage.getByText('Copy this token now. It will not be shown again.').waitFor();
      assert.ok(account.calls('/v1/tokens', 'GET').every(entry => !entry.search.includes('tenant')));
      await accountPage.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { globalThis.__copied = value; } } }); });
      await accountPage.locator('[data-testid="copy-token"]').click();
      await accountPage.waitForFunction(() => globalThis.__copied === 'fixture-plaintext-token');
      const stored = await accountPage.evaluate(() => ({ local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), url: location.href }));
      assert.ok(!stored.local.includes('fixture-plaintext-token'));
      assert.ok(!stored.session.includes('fixture-plaintext-token'));
      assert.ok(!stored.url.includes('fixture-plaintext-token'));
      await accountPage.locator('[data-testid="dismiss-token"]').click();
      assert.equal(await accountPage.locator('[data-testid="issued-token-once"]').count(), 0);
      assert.equal((await accountPage.evaluate(() => document.body.innerHTML)).includes('fixture-plaintext-token'), false);
    }, 'A3 exact {tenant,scope,lifetime,name} POST, one-time plaintext, copy/dismiss, no storage/URL secret');

    await group('A3', async () => {
      await openProfile();
      await accountPage.locator('[data-testid="token-name"]').fill('');
      await accountPage.locator('[data-testid="token-scope"]').selectOption('read_write');
      await accountPage.locator('[data-testid="token-lifetime"]').selectOption('1y');
      await accountPage.locator('[data-testid="create-token"]').click();
      await accountPage.locator('[data-testid="issued-token-once"]').waitFor();
      assert.deepEqual(JSON.parse(account.calls('/v1/tokens', 'POST')[0].body), { tenant: 'tenant-a', scope: 'read_write', lifetime: '1y' });
      await accountPage.locator('[data-testid="dismiss-token"]').click();
      await accountPage.locator('[data-testid="token-name"]').fill('token');
      await accountPage.locator('[data-testid="token-scope"]').selectOption('read');
      await accountPage.locator('[data-testid="token-lifetime"]').selectOption('3m');
      await accountPage.locator('[data-testid="create-token"]').click();
      await accountPage.locator('[data-testid="issued-token-once"]').waitFor();
      await accountPage.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); });
      await accountPage.locator('[data-testid="copy-token"]').click();
      await accountPage.getByText('Select and copy the token manually.').waitFor();
      await accountPage.selectOption('#tenant-select', 'tenant-b');
      await accountPage.getByText('beta-active').waitFor();
      assert.equal(await accountPage.locator('[data-testid="issued-token-once"]').count(), 0, 'tenant switch kept the plaintext token');
      await harness.go(accountPage, '/settings?tenant=tenant-b');
      await harness.go(accountPage, '/profile?tenant=tenant-b');
      await accountPage.locator('[data-account="tokens"]').waitFor();
      await accountPage.getByText('beta-active').waitFor();
      assert.equal((await accountPage.evaluate(() => document.body.innerHTML)).includes('fixture-plaintext-token'), false, 'navigation kept the plaintext token');
    }, 'A3 blank name omits name, copy failure names manual copy, tenant switch/navigation clears plaintext');

    await group('A3', async () => {
      await clean();
      account.state.emptyTenants = true;
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('Create a tenant to issue a token.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="create-token"]').isDisabled(), true);
    }, 'A3 no tenant disables token creation with the exact sentence');

    await group('A3', async () => {
      await openProfile();
      account.state.status.token = 401;
      await accountPage.locator('[data-testid="create-token"]').click();
      await accountPage.getByText('Could not create token.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="issued-token-once"]').count(), 0);
    }, 'A3 rejected token write shows no plaintext and no optimistic success');

    // ----- A4: token inventory -----
    await group('A4', async () => {
      await openProfile();
      assert.deepEqual(await headers('[data-account="tokens"]'), ['Name', 'Tenant', 'Scope', 'Created', 'Expires', 'State', 'Action']);
      assert.equal((await headers('[data-account="tokens"]')).includes('Secret'), false);
      const tokenRows = accountPage.locator('[data-token-row]');
      assert.equal(await tokenRows.count(), 4);
      assert.deepEqual(await tokenRows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-token-row'))), ['token-a1', 'token-a4', 'token-a2', 'token-a3']);
      assert.deepEqual(await tokenRows.locator('td:nth-child(6)').allTextContents(), ['Active', 'Active', 'Expired', 'Revoked']);
      assert.deepEqual((await widths('[data-account="tokens"]')).slice(0, 6), [220, 180, 140, 160, 160, 120]);
      assert.equal(await accountPage.locator('[data-testid="revoke-token-a1"]').count(), 1);
      assert.equal(await accountPage.locator('[data-testid="revoke-token-a2"]').count(), 0);
      assert.equal(await accountPage.locator('[data-testid="revoke-token-a3"]').count(), 0);
      assert.ok(account.calls('/v1/tokens', 'GET').every(entry => !entry.search.includes('tenant')));
    }, 'A4 exact columns/widths, created_at DESC, derived Expired/Revoked, no secret column');

    await group('A4', async () => {
      await openProfile();
      await accountPage.selectOption('#tenant-select', 'tenant-b');
      await accountPage.getByText('beta-active').waitFor();
      assert.equal(await accountPage.locator('[data-token-row]').count(), 1);
      assert.equal(await accountPage.getByText('alpha-active').count(), 0);
      assert.equal(await accountPage.getByText('alpha-expired').count(), 0);
    }, 'A4 client exact-tenant filtering removes every tenant A token after A→B');

    await group('A4', async () => {
      await clean();
      account.state.status.tokens = 500;
      await harness.go(accountPage, '/profile');
      await accountPage.getByText('Could not load tokens.').waitFor();
      assert.equal(await accountPage.locator('[data-testid="retry-tokens"]').count(), 1);
      assert.equal(await accountPage.locator('[data-token-row]').count(), 0);
    }, 'A4 token failure keeps no rows and offers Retry tokens');

    // ----- A5: revoke -----
    await group('A5', async () => {
      await openProfile();
      await accountPage.locator('[data-testid="revoke-token-a1"]').click();
      await accountPage.getByText('Revoke alpha-active? Clients using it will lose access.').waitFor();
      const before = account.calls('/v1/tokens/token-a1/revoke', 'POST').length;
      await accountPage.locator('[data-testid="cancel-revoke"]').click();
      assert.equal(account.calls('/v1/tokens/token-a1/revoke', 'POST').length, before, 'Cancel issued a revoke write');
      assert.equal(await accountPage.locator('[data-testid="revoke-token-a1"]').count(), 1);

      const gate = account.hold.hold('/v1/tokens/token-a1/revoke');
      await accountPage.locator('[data-testid="revoke-token-a1"]').click();
      await accountPage.locator('[data-testid="confirm-revoke"]').click();
      await gate.started;
      assert.equal(await accountPage.locator('[data-testid="confirm-revoke"]').isDisabled(), true);
      gate.release();
      await accountPage.waitForFunction(() => document.querySelector('[data-token-row="token-a1"] td:nth-child(6)')?.textContent === 'Revoked');
      assert.equal(account.calls('/v1/tokens/token-a1/revoke', 'POST').length, 1);
      assert.deepEqual(JSON.parse(account.calls('/v1/tokens/token-a1/revoke', 'POST')[0].body), {});
    }, 'A5 inline confirmation, Cancel sends nothing, one exact revoke POST on 204');

    await group('A5', async () => {
      await openProfile();
      account.state.status.revoke = 500;
      await accountPage.locator('[data-testid="revoke-token-a4"]').click();
      await accountPage.locator('[data-testid="confirm-revoke"]').click();
      await accountPage.locator('[data-testid="retry-revoke"]').waitFor();
      assert.equal(await accountPage.locator('[data-token-row="token-a4"] td:nth-child(6)').textContent(), 'Active');
      assert.equal(account.calls('/v1/tokens/token-a4/revoke', 'POST').length, 1, 'failed revoke auto-retried');
      const height = (await heights('[data-token-row="token-a4"]'))[0];
      assert.ok(Math.abs(height - 30) <= 1, `data row stretched to ${height}`);
      assert.equal((await accountPage.evaluate(() => document.body.innerHTML)).includes('fixture-plaintext-token'), false);
      account.state.status.revoke = 204;
      await accountPage.locator('[data-testid="retry-revoke"]').click();
      await accountPage.waitForFunction(() => document.querySelector('[data-token-row="token-a4"] td:nth-child(6)')?.textContent === 'Revoked');
      assert.equal(account.calls('/v1/tokens/token-a4/revoke', 'POST').length, 2);
    }, 'A5 failed write keeps Active, click-only Retry, no secret, data row stays 30px');

    // ----- A6: lifecycle link and the real lifecycle page -----
    await group('A6', async () => {
      await clean();
      await accountPage.evaluate(base => { localStorage.setItem('yakka-analytics-base', base); }, harness.upstreamOrigin);
      await harness.go(accountPage, '/profile');
      await accountPage.locator('[data-account="tenants"]').waitFor();
      const link = accountPage.locator('[data-testid="lifecycle-link-tenant-a"]');
      assert.equal(await link.getAttribute('href'), `${harness.upstreamOrigin}/profile/lifecycle?tenant=tenant-a`);
      assert.equal(await link.getAttribute('target'), null);
      await accountPage.evaluate(() => localStorage.removeItem('yakka-analytics-base'));
    }, 'A6 configured API-origin /profile/lifecycle?tenant={id} link in the same tab');

    const openLifecycle = async tenant => {
      lifecycle.reset();
      await lifecyclePage.goto(harness.lifecycleUrl(tenant));
      await lifecyclePage.waitForFunction(() => document.querySelectorAll('#tenants tr[data-tenant-id]').length === 3);
    };

    await group('A6', async () => {
      await openLifecycle('t-a');
      const requestsBefore = lifecycle.state.requests.length;
      await lifecyclePage.locator('tr[data-tenant-id="t-a"]').getByRole('button', { name: 'Reset tenant' }).click();
      const dialog = lifecyclePage.locator('#confirm-dialog');
      await dialog.waitFor();
      assert.equal(await lifecyclePage.locator('#typed-id').inputValue(), '');
      assert.equal(await lifecyclePage.locator('#confirm-action').isDisabled(), true);
      const box = await dialog.boundingBox();
      assert.ok(Math.abs(box.x - 12) <= 1, `dialog left ${box.x}`);
      assert.ok(Math.abs(box.width - 600) <= 1, `dialog width ${box.width}`);
      await lifecyclePage.locator('#typed-id').fill('wrong-id');
      assert.equal(await lifecyclePage.locator('#confirm-action').isDisabled(), true);
      assert.equal(lifecycle.state.requests.length, requestsBefore, 'opening/typing issued a lifecycle request');
      await lifecyclePage.locator('#cancel-action').click();
      assert.equal(await lifecyclePage.locator('#confirm-dialog').evaluate(node => node.open), false);
      assert.equal(lifecycle.state.requests.length, requestsBefore, 'Cancel issued a lifecycle request');
      await lifecyclePage.locator('tr[data-tenant-id="t-a"]').getByRole('button', { name: 'Reset tenant' }).click();
      await lifecyclePage.locator('#typed-id').fill('t-a');
      assert.equal(await lifecyclePage.locator('#confirm-action').isDisabled(), false);
      await lifecyclePage.locator('#confirm-action').click();
      await lifecyclePage.locator('#selection-note').waitFor();
      const resets = lifecycle.calls('/v1/tenants/t-a/reset', 'POST');
      assert.equal(resets.length, 1);
      assert.deepEqual(JSON.parse(resets[0].body), { confirm_tenant_id: 't-a' });
      assert.equal(resets[0].headers['x-yakka-ui'], 'tenant-lifecycle');
      assert.match(resets[0].headers['content-type'], /application\/json/);
      assert.equal(resets[0].headers.authorization, undefined, 'reset constructed an Authorization header');
      assert.match(resets[0].headers.origin || '', new RegExp(harness.upstreamOrigin), `reset origin ${resets[0].headers.origin}`);
      if (resets[0].headers['sec-fetch-site'] !== undefined) assert.equal(resets[0].headers['sec-fetch-site'], 'same-origin');
      await lifecyclePage.waitForFunction(() => document.querySelectorAll('#tenants tr[data-tenant-id]').length === 3);
      assert.ok(await lifecyclePage.locator('tr[data-tenant-id="t-a"]').count(), 'reset removed the tenant');
    }, 'A6 typed confirmation, left-anchored 600px dialog, Cancel no write, 204 reset keeps the tenant');

    await group('A6', async () => {
      await openLifecycle('t-a');
      await lifecyclePage.locator('tr[data-tenant-id="t-a"]').getByRole('button', { name: 'Delete tenant' }).click();
      await lifecyclePage.locator('#typed-id').fill('t-a');
      await lifecyclePage.locator('#confirm-action').click();
      await lifecyclePage.waitForFunction(() => document.querySelectorAll('#tenants tr[data-tenant-id]').length === 2);
      const deletes = lifecycle.calls('/v1/tenants/t-a', 'DELETE');
      assert.equal(deletes.length, 1);
      assert.deepEqual(JSON.parse(deletes[0].body), { confirm_tenant_id: 't-a' });
      assert.equal(await lifecyclePage.locator('#tenant-select').inputValue(), '');
      assert.equal(await lifecyclePage.locator('#selection-note').isVisible(), true);
      const returnHref = await lifecyclePage.locator('#return-link').getAttribute('href');
      assert.equal(returnHref, 'https://yakka.build/?tenant=t-b');
      assert.equal(await lifecyclePage.locator('tr[data-tenant-id="t-a"]').count(), 0);
    }, 'A6 204 delete clears the deleted selection and returns with the surviving tenant');

    await group('A6', async () => {
      await openLifecycle('t-a');
      lifecycle.state.abort.reset = true;
      await lifecyclePage.locator('tr[data-tenant-id="t-a"]').getByRole('button', { name: 'Reset tenant' }).click();
      await lifecyclePage.locator('#typed-id').fill('t-a');
      await lifecyclePage.locator('#confirm-action').click();
      await lifecyclePage.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('completion unknown'));
      assert.equal(lifecycle.calls('/v1/tenants/t-a/reset', 'POST').length, 1, 'ambiguous failure replayed the destructive write');
      assert.match(await lifecyclePage.locator('#status').textContent(), /completion unknown/);
      assert.ok(await lifecyclePage.locator('tr[data-tenant-id="t-a"]').count(), 'ambiguous failure lost the owner state');
    }, 'A6 ambiguous failure shows completion unknown and issues exactly one destructive request');

    // ----- F7 -----
    await group('F7', async () => {
      await openProfile();
      await accountPage.selectOption('#tenant-select', 'tenant-b');
      await accountPage.getByText('beta-active').waitFor();
      assert.equal(await accountPage.locator('[data-account-tenant-row]').count(), 3);
      assert.deepEqual(await accountPage.locator('[data-account-tenant-row] td:nth-child(3)').allTextContents(), ['Owner', 'Owner', 'Owner']);
      assert.equal(await accountPage.locator('[data-token-row]').count(), 1);
      assert.equal(await accountPage.getByText('alpha-active').count(), 0);
      assert.equal(await accountPage.getByRole('button', { name: /^(Invite|Add member|Change role)$/ }).count(), 0);
      assert.equal(await accountPage.locator('.scope-filters, #scope-win, #scope-repo, #scope-kind, .event-counts').count(), 0);
    }, 'F7 tenant B exposes only B tokens while membership lists all owned tenants with Owner');

    // ----- S-profile -----
    await group('S-profile', async () => {
      await openProfile();
      assert.equal(await textOf('#app > h1'), 'Account, tenants & tokens');
      assert.match(await textOf('.account-context'), /Account controls use the selected tenant/);
      const order = await accountPage.evaluate(() => {
        const top = selector => document.querySelector(selector)?.getBoundingClientRect().top ?? -1;
        return { identity: top('[data-account-identity]'), tenants: top('[data-account="tenants"]'), tokens: top('[data-account="tokens"]') };
      });
      assert.ok(order.identity >= 0 && order.identity < order.tenants && order.tenants < order.tokens, JSON.stringify(order));
      assert.equal(await accountPage.evaluate(() => document.getElementById('membership')?.closest('section')?.id), 'tenants');
      assert.equal(await accountPage.evaluate(() => document.getElementById('tokens')?.tagName), 'SECTION');
      assert.deepEqual(await accountPage.locator('[data-account="tenants"] h2, [data-account="tokens"] h2').allTextContents(), ['Tenants & membership', 'Tokens — selected tenant']);
      assert.equal(await accountPage.locator('.scope-bar, .scope-filters, .coverage-strip, .yk-chart').count(), 0);
    }, 'S-profile exact heading, region order, anchor targets and no analytics controls');

    // ----- S-settings -----
    await group('S-settings', async () => {
      await openReady('/settings');
      assert.equal(await textOf('#app > h1'), 'Connection settings');
      assert.equal(await textOf('.account-section h2'), 'Connection');
      assert.equal(await accountPage.getByTestId('settings-base').inputValue(), '');
      assert.equal(await accountPage.getByTestId('settings-key').inputValue(), '');
      const column = await accountPage.locator('.account-form-column').boundingBox();
      assert.ok(Math.abs(column.width - 480) <= 1, `settings column ${column.width}`);
      const navigation = accountPage.waitForNavigation();
      await accountPage.getByTestId('settings-base').fill(`${harness.origin}/`);
      await accountPage.getByTestId('settings-key').fill('fixture-key');
      await accountPage.getByTestId('settings-save').click();
      await navigation;
      await accountPage.getByTestId('settings-base').waitFor();
      assert.equal(await accountPage.evaluate(() => localStorage.getItem('yakka-analytics-base')), harness.origin);
      assert.equal(await accountPage.evaluate(() => localStorage.getItem('yakka-analytics-key')), 'fixture-key');
      assert.equal(await accountPage.getByTestId('settings-key').inputValue(), '');
      assert.equal((await accountPage.evaluate(() => document.documentElement.outerHTML)).includes('fixture-key'), false);
      assert.equal(accountPage.url().includes('fixture-key'), false);
      assert.ok(account.state.requests.every(entry => !entry.search.includes('fixture-key')));
      assert.equal(new URL(accountPage.url()).pathname, '/settings', 'save did not reload the same safe route');

      await accountPage.getByTestId('settings-base').fill('javascript:alert(1)');
      await accountPage.getByTestId('settings-save').click();
      await accountPage.getByText('Enter an absolute http(s) API base URL.').waitFor();
      assert.equal(await accountPage.evaluate(() => localStorage.getItem('yakka-analytics-base')), harness.origin);

      const cleared = accountPage.waitForNavigation();
      await accountPage.getByTestId('settings-clear').click();
      await cleared;
      await accountPage.getByTestId('settings-base').waitFor();
      assert.equal(await accountPage.evaluate(() => localStorage.getItem('yakka-analytics-base')), null);
      assert.equal(await accountPage.evaluate(() => localStorage.getItem('yakka-analytics-key')), null);
      assert.equal(account.state.tokens.length, 5, 'Clear changed owned server tokens');

      account.state.status.logout = 500;
      await accountPage.getByTestId('settings-signout').click();
      await accountPage.getByText('Sign out failed.').waitFor();
      assert.match(accountPage.url(), /\/settings/);
      assert.equal(accountPage.url().includes('/login'), false);
      account.state.status.logout = 204;
      await accountPage.getByTestId('settings-signout').click();
      await accountPage.waitForURL(/\/login$/);
      const logouts = account.calls('/logout', 'POST');
      assert.equal(logouts.length, 2);
      assert.deepEqual(JSON.parse(logouts[1].body), {});
    }, 'S-settings exact copy, trimmed save+reload, invalid base, clear both keys, non-optimistic sign out');

    // ----- S-login -----
    await group('S-login', async () => {
      await openReady('/login?return=%2Fdevice%3Fuser_code%3DABCD-EFGH');
      assert.equal(await textOf('#app > h1'), 'Sign in');
      assert.equal(await accountPage.getByText('Sign in to your Yakka account to continue.').count(), 1);
      const link = await accountPage.getByTestId('identity-login').getAttribute('href');
      const target = new URL(link, harness.origin);
      assert.equal(target.pathname, '/oauth/login');
      assert.equal(target.searchParams.get('return'), '/device?user_code=ABCD-EFGH');
      assert.equal(await accountPage.locator('#tenant-select').isDisabled(), true);
      assert.match(await accountPage.locator('#tenant-select option').textContent(), /Sign in to select a tenant/);
      assert.equal(await accountPage.locator('.scope-bar, .coverage-strip, .yk-chart, table').count(), 0);
      await openReady('/login?error=%3Cb%3Ebad%3C%2Fb%3E');
      assert.equal(await accountPage.locator('[data-identity-status] b').count(), 0);
      assert.match(await accountPage.locator('[data-identity-status]').textContent(), /bad/);
    }, 'S-login exact sentence/link, disabled tenant, escaped failure, no tables or filter bar');

    // ----- S-callback -----
    await group('S-callback', async () => {
      await openReady('/oauth/callback?code=denied&state=nonce&return=%2Fdevice%3Fuser_code%3DABCD-EFGH');
      await accountPage.locator('[data-identity-status]').waitFor();
      assert.equal(await textOf('#app > h1'), 'Completing sign in');
      assert.equal(await textOf('[data-identity-status]'), 'Sign in failed. Please try again.');
      assert.equal(await accountPage.getByRole('link', { name: 'Try sign in again' }).getAttribute('href'), '/login?return=%2Fdevice%3Fuser_code%3DABCD-EFGH');
      const bodyText = await accountPage.locator('#app').innerText();
      assert.doesNotMatch(bodyText, /denied|nonce|code/);
      assert.equal(await accountPage.locator('.scope-bar, .coverage-strip, .yk-chart, table').count(), 0);
      await openReady('/oauth/callback?code=error&state=nonce');
      await accountPage.locator('[data-identity-status]').waitFor();
      assert.equal(await textOf('[data-identity-status]'), 'Sign in failed. Please try again.');
      assert.equal(await accountPage.getByRole('link', { name: 'Try sign in again' }).getAttribute('href'), '/login');
      await clean();
      await harness.go(accountPage, '/oauth/callback?code=success&state=nonce&return=%2Fprofile');
      await accountPage.waitForURL(/\/profile(?:\?|$)/);
      assert.equal(account.state.callbacks.at(-1).code, 'success');
    }, 'S-callback failure copy/retry with no credential leak; success reaches the safe return');

    // ----- S-device -----
    await group('S-device', async () => {
      await openReady('/device?user_code=abcd-efgh&tenant=tenant-b');
      await accountPage.getByText('Request from fixture-terminal').waitFor();
      assert.equal(await textOf('#app > h1'), 'Device approval');
      assert.equal(new URL(accountPage.url()).searchParams.get('user_code'), 'ABCD-EFGH');
      assert.equal(await accountPage.locator('[data-testid="device-tenant"]').count(), 0);
      assert.equal(await accountPage.locator('#tenant-select').inputValue(), 'tenant-b');
      assert.equal(await accountPage.locator('[data-testid="device-token-name"]').inputValue(), '');
      assert.equal(await accountPage.locator('[data-testid="device-grant"]').inputValue(), '');
      assert.equal(await accountPage.locator('[data-testid="device-lifetime"]').inputValue(), '3m');
      assert.equal(await accountPage.locator('[data-testid="device-submit"]').isDisabled(), true);
      await accountPage.locator('[data-testid="device-grant"]').selectOption('read_write');
      assert.equal(await accountPage.locator('[data-testid="device-submit"]').isDisabled(), false);
      await accountPage.locator('[data-testid="device-submit"]').click();
      await accountPage.getByText('Device approved.').waitFor();
      assert.deepEqual(account.state.device[0], { user_code: 'ABCD-EFGH', tenant: 'tenant-b', scope: 'read_write', lifetime: '3m' });
      assert.ok(account.state.requests.some(entry => entry.path === '/v1/device/grant' && entry.search.includes('user_code=ABCD-EFGH')));
      assert.equal(JSON.stringify(account.state.device).includes('token'), false);
    }, 'S-device code normalization, mandatory header tenant, exact approve payload and success copy');

    await group('S-device', async () => {
      await openReady('/device?user_code=abcd-efgh&tenant=tenant-b');
      await accountPage.getByText('Request from fixture-terminal').waitFor();
      await accountPage.locator('[data-testid="device-deny"]').click();
      await accountPage.getByText('Device denied.').waitFor();
      assert.deepEqual(account.state.device[0], { user_code: 'ABCD-EFGH', action: 'deny' });
    }, 'S-device Deny posts only {user_code,action:deny}');

    await group('S-device', async () => {
      await openReady('/device?user_code=zzzz-yyyy&tenant=tenant-b');
      await accountPage.locator('[data-identity-status]').waitFor();
      assert.match(await textOf('[data-identity-status]'), /unknown_code/);
      assert.equal(await accountPage.locator('[data-testid="device-authorize-form"]').isHidden(), false);
      assert.equal(await accountPage.locator('[data-testid="device-submit"]').isDisabled(), true);
      await openReady('/device?user_code=abcd-efgh&tenant=tenant-b');
      await accountPage.getByText('Request from fixture-terminal').waitFor();
      account.state.status.authorize = 403;
      await accountPage.locator('[data-testid="device-grant"]').selectOption('read');
      await accountPage.locator('[data-testid="device-submit"]').click();
      await accountPage.getByText('approval failed').waitFor();
      assert.equal(await accountPage.getByText('Device approved.').count(), 0);
    }, 'S-device unknown code and rejected approval keep the form with an inline reason');

    // ----- S-notfound -----
    await group('S-notfound', async () => {
      await clean();
      const before = analytics.length;
      await harness.go(accountPage, '/missing?tenant=tenant-b&win=90d&repo_id=acme');
      await accountPage.getByText('No page matches this address.').waitFor();
      assert.equal(await textOf('#app > h1'), 'Page not found');
      assert.equal(await accountPage.locator('#tenant-select').inputValue(), 'tenant-b');
      assert.equal(await accountPage.getByRole('button', { name: 'Theme' }).count(), 1);
      assert.equal(await accountPage.locator('.scope-bar, .coverage-strip, .yk-chart, table').count(), 0);
      assert.equal(analytics.length, before, 'not-found performed an analytics read');
      const start = new URL(await accountPage.getByRole('link', { name: 'Open Start' }).getAttribute('href'), harness.origin);
      const pulse = new URL(await accountPage.getByRole('link', { name: 'Open Pulse' }).getAttribute('href'), harness.origin);
      for (const url of [start, pulse]) {
        assert.equal(url.searchParams.get('tenant'), 'tenant-b');
        assert.equal(url.searchParams.get('win'), '90d');
        assert.equal(url.searchParams.get('repo_id'), 'acme');
      }
      assert.equal(await accountPage.locator('.not-found-routes a').count(), 2);
      await harness.go(accountPage, '/missing%3Cb%3Enot-injected%3C%2Fb%3E');
      await accountPage.getByText('No page matches this address.').waitFor();
      assert.equal(await accountPage.locator('.not-found-path b').count(), 0);
      assert.match(await textOf('.not-found-path'), /not-injected/);
      account.state.status.me = 401;
      const signedOutBefore = analytics.length;
      await harness.go(accountPage, '/missing?tenant=tenant-a');
      await accountPage.getByText('No page matches this address.').waitFor();
      assert.equal(await accountPage.locator('#tenant-select').isDisabled(), true);
      assert.match(await accountPage.locator('#tenant-select option').textContent(), /Sign in to select a tenant/);
      assert.equal(analytics.length, signedOutBefore, 'signed-out not-found performed an analytics read');
      assert.equal(await accountPage.locator('.not-found-routes a').count(), 2);
    }, 'S-notfound escapes the path, preserves committed scope, reads no analytics and keeps navigation');

    // ----- C1: one truthful tenant select on every account screen -----
    await group('C1', async () => {
      await openProfile();
      const select = accountPage.locator('#tenant-select');
      assert.equal(await select.count(), 1);
      assert.ok(Math.abs((await select.boundingBox()).width - 260) <= 1);
      assert.equal(await select.inputValue(), 'tenant-a');
      assert.deepEqual(await select.locator('option').evaluateAll(nodes => nodes.map(node => [node.textContent, node.disabled])), [
        ['Alpha · tenant-a', false], ['Beta · tenant-b', false], ['Pending · tenant-p · pending', true]
      ]);
      await accountPage.selectOption('#tenant-select', 'tenant-b');
      await accountPage.waitForFunction(() => new URL(location.href).searchParams.get('tenant') === 'tenant-b');
      await accountPage.getByText('beta-active').waitFor();
      await openReady('/login');
      assert.equal(await accountPage.locator('#tenant-select').isDisabled(), true);
      assert.match(await accountPage.locator('#tenant-select option').textContent(), /Sign in to select a tenant/);
    }, 'C1 shared tenant select: /me order, {name} · {id}, pending disabled, committed selection');

    // ----- C10/V1-V5 on every account screen in both themes -----
    const openScreen = async id => {
      if (id === 'profile') return openProfile();
      if (id === 'settings') return openReady('/settings');
      if (id === 'login') return openReady('/login');
      if (id === 'device') { await openReady('/device?user_code=abcd-efgh&tenant=tenant-b'); return accountPage.getByText('Request from fixture-terminal').waitFor(); }
      if (id === 'callback') { await openReady('/oauth/callback?code=denied&state=nonce'); return accountPage.locator('[data-identity-status]').waitFor(); }
      if (id === 'notfound') { await clean(); await harness.go(accountPage, '/missing?tenant=tenant-b'); return accountPage.getByText('No page matches this address.').waitFor(); }
    };

    for (const screen of ['profile', 'settings', 'login', 'callback', 'device', 'notfound']) {
      await group('V1', async () => {
        await openScreen(screen);
        const geometry = await accountPage.evaluate(() => {
          const rect = selector => { const node = document.querySelector(selector); if (!node) return null; const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, height: box.height }; };
          return { identity: rect('.identity-row'), analytics: rect('.analytics-nav'), account: rect('.account-nav'), heading: rect('#app > h1'), main: rect('main'), scrollWidth: document.documentElement.scrollWidth };
        });
        assert.equal(geometry.identity.height, 46);
        assert.equal(geometry.analytics.height, 32);
        assert.equal(geometry.account.height, 32);
        assert.equal(geometry.heading.height, 32);
        assert.equal(geometry.main.left, 0);
        assert.ok(Math.abs(geometry.heading.left - 12) <= 1, `${screen} heading left ${geometry.heading.left}`);
        assert.ok(geometry.heading.right <= 1428, `${screen} heading right ${geometry.heading.right}`);
        assert.ok(geometry.scrollWidth <= 1440, `${screen} scrollWidth ${geometry.scrollWidth}`);
      }, `${screen} 1440 geometry: 46/32/32/32 bands, 12px gutter, no horizontal overflow`);
    }

    await group('V2', async () => {
      await openProfile();
      const style = await accountPage.evaluate(() => ({
        body: getComputedStyle(document.body).fontSize,
        heading: getComputedStyle(document.querySelector('#app > h1')).fontSize,
        h2: getComputedStyle(document.querySelector('[data-account="tenants"] h2')).fontSize,
        align: getComputedStyle(document.querySelector('[data-account="tenants"] td')).textAlign,
        numeric: getComputedStyle(document.querySelector('[data-account="tenants"] table')).fontVariantNumeric
      }));
      assert.deepEqual(style, { body: '13px', heading: '19px', h2: '14px', align: 'left', numeric: 'tabular-nums' });
      assert.ok((await heights('[data-account-tenant-row]')).every(height => Math.abs(height - 30) <= 1));
      assert.ok((await heights('[data-token-row]')).every(height => Math.abs(height - 30) <= 1));
      assert.ok((await accountPage.locator('button, select, input').evaluateAll(nodes => nodes.filter(node => node.offsetParent !== null).map(node => node.getBoundingClientRect().height))).every(height => height >= 28));
    }, 'V2 13/19/14px type, left tabular 30px rows and 28px controls');

    for (const screen of ['profile', 'settings', 'login', 'callback', 'device', 'notfound']) {
      await group('V3', async () => {
        await openScreen(screen);
        for (const theme of ['light', 'dark']) {
          await harness.toggleTheme(accountPage, theme);
          const white = await accountPage.evaluate(() => Array.from(document.querySelectorAll('body *'))
            .filter(node => getComputedStyle(node).backgroundColor === 'rgb(255, 255, 255)')
            .map(node => node.tagName).slice(0, 5));
          assert.deepEqual(white, [], `${screen} ${theme} white surfaces ${white}`);
        }
        const tokens = await accountPage.evaluate(() => {
          const style = getComputedStyle(document.documentElement);
          return ['--yk-bg', '--yk-surface', '--yk-surface-alt', '--yk-text', '--yk-muted', '--yk-border'].map(name => style.getPropertyValue(name).trim());
        });
        assert.ok(tokens.every(Boolean), `${screen} missing --yk-* tokens`);
      }, `${screen} toggles both themes with no white surface and real --yk-* tokens`);
    }

    for (const screen of ['profile', 'settings', 'login', 'callback', 'device', 'notfound']) {
      await group('V4', async () => {
        await openScreen(screen);
        const style = await accountPage.evaluate(() => Array.from(document.querySelectorAll('main *')).map(node => getComputedStyle(node)).filter(cs => /gradient/i.test(cs.backgroundImage) || cs.boxShadow !== 'none' || cs.animationName !== 'none').length);
        assert.equal(style, 0, `${screen} has gradients/shadows/animations`);
        const body = await accountPage.evaluate(() => document.body.innerText);
        for (const forbidden of FORBIDDEN) assert.ok(!body.includes(forbidden), `${screen} shows ${forbidden}`);
        assert.equal(await accountPage.locator('.workspace-chip[data-kind="scope"] .workspace-chip-remove').count(), 0);
      }, `${screen} has no decoration, invitation controls or removable default chip`);
    }

    await group('V5', async () => {
      for (const screen of ['profile', 'settings', 'device', 'login', 'callback', 'notfound']) {
        await openScreen(screen);
        assert.deepEqual(await accountPage.locator('.analytics-nav a').allTextContents().then(values => values.map(value => value.trim())), ANALYTICS_NAV, `${screen} analytics nav`);
        assert.deepEqual(await accountPage.locator('.account-nav a').allTextContents().then(values => values.map(value => value.trim())), ACCOUNT_NAV, `${screen} account nav`);
        assert.equal(await accountPage.locator('.brand').getAttribute('href'), '/');
        const themeAfterTenant = await accountPage.evaluate(() => Boolean(document.querySelector('#tenant-select').compareDocumentPosition(document.querySelector('#theme-toggle')) & Node.DOCUMENT_POSITION_FOLLOWING));
        assert.equal(themeAfterTenant, true, `${screen} Theme is not after the tenant field`);
      }
      await openReady('/settings');
      assert.equal(await accountPage.locator('.account-nav a[aria-current="location"]').textContent(), 'Settings');
      await openReady('/device?user_code=abcd-efgh&tenant=tenant-b');
      await accountPage.getByText('Request from fixture-terminal').waitFor();
      assert.equal(await accountPage.locator('.account-nav a[aria-current="location"]').textContent(), 'Device approval');
    }, 'V5 nav orders, brand, Theme placement and account aria-current');

    // ----- S-lifecycle on the real Go template -----
    await group('S-lifecycle', async () => {
      await openLifecycle('t-b');
      assert.equal(await lifecyclePage.locator('h1').innerText(), 'Tenant lifecycle');
      const geometry = await lifecyclePage.evaluate(() => {
        const rect = selector => { const node = document.querySelector(selector); if (!node) return null; const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, height: box.height }; };
        return { identity: rect('.identity-row'), analytics: rect('.analytics-nav'), account: rect('.account-nav'), heading: rect('.page-title'), main: rect('main'), title: rect('.page-title h1'), scrollWidth: document.documentElement.scrollWidth };
      });
      assert.equal(geometry.identity.height, 46);
      assert.equal(geometry.analytics.height, 32);
      assert.equal(geometry.account.height, 32);
      assert.equal(geometry.heading.height, 32);
      assert.equal(geometry.main.left, 0);
      assert.ok(Math.abs(geometry.title.left - 12) <= 1, `lifecycle title left ${geometry.title.left}`);
      assert.ok(geometry.scrollWidth <= 1440, `lifecycle scrollWidth ${geometry.scrollWidth}`);
      assert.deepEqual(await lifecyclePage.locator('.tenant-table thead th').allTextContents(), ['Tenant name', 'Immutable ID', 'Lifecycle state', 'Generation', 'Actions']);
      assert.deepEqual((await lifecyclePage.locator('.tenant-table thead th').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().width)))).slice(0, 4), [240, 260, 180, 100]);
      assert.deepEqual(await lifecyclePage.locator('#tenants tr[data-tenant-id]').evaluateAll(nodes => nodes.map(node => node.dataset.tenantId)), ['t-a', 't-b', 't-p']);
      assert.ok((await lifecyclePage.locator('#tenants tr[data-tenant-id]').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height > 0).map(node => Math.round(node.getBoundingClientRect().height)))).every(height => Math.abs(height - 30) <= 1));
      assert.equal(await lifecyclePage.locator('.scope-bar, .scope-filters, .coverage-strip, .tenant-chart, table.analytics').count(), 0);
      assert.equal(await lifecyclePage.locator('#win, #repo, #kind').count(), 0);
      assert.equal(await lifecyclePage.evaluate(() => getComputedStyle(document.body).fontSize), '13px');
      assert.equal(await lifecyclePage.evaluate(() => getComputedStyle(document.querySelector('h1')).fontSize), '19px');
    }, 'S-lifecycle real template: dense bands, exact table, 30px rows, no analytics controls');

    await group('C1', async () => {
      await openLifecycle('t-b');
      assert.equal(await lifecyclePage.locator('#tenant-select').inputValue(), 't-b');
      assert.equal(await lifecyclePage.locator('tr[data-tenant-id="t-b"]').getAttribute('data-selected'), 'true');
      assert.deepEqual(await lifecyclePage.locator('#tenant-select option').evaluateAll(nodes => nodes.map(node => [node.textContent, node.disabled])), [
        ['Alpha · t-a', false], ['Beta · t-b', false], ['Pending · t-p · pending', true]
      ]);
      await lifecyclePage.selectOption('#tenant-select', 't-a');
      await lifecyclePage.waitForFunction(() => new URL(location.href).searchParams.get('tenant') === 't-a');
      assert.equal(await lifecyclePage.locator('tr[data-tenant-id="t-a"]').getAttribute('data-selected'), 'true');
      assert.equal(await lifecyclePage.locator('tr[data-tenant-id="t-b"]').getAttribute('data-selected'), null);
    }, 'C1 lifecycle deep link highlights the row and selection replaces the tenant URL');

    for (const theme of ['light', 'dark']) {
      await group('C10', async () => {
        await openLifecycle('t-b');
        await harness.toggleTheme(lifecyclePage, theme);
        assert.equal(await lifecyclePage.evaluate(() => document.documentElement.dataset.theme), theme);
        const white = await lifecyclePage.evaluate(() => Array.from(document.querySelectorAll('body *'))
          .filter(node => getComputedStyle(node).backgroundColor === 'rgb(255, 255, 255)')
          .map(node => node.tagName).slice(0, 5));
        assert.deepEqual(white, [], `lifecycle ${theme} white surfaces ${white}`);
      }, `C10/V3 lifecycle Theme toggles ${theme} with no white surface`);
    }

    await group('V5', async () => {
      await openLifecycle('t-b');
      assert.deepEqual(await lifecyclePage.locator('.analytics-nav a').allTextContents().then(values => values.map(value => value.trim())), ANALYTICS_NAV);
      assert.deepEqual(await lifecyclePage.locator('.account-nav a').allTextContents().then(values => values.map(value => value.trim())), ACCOUNT_NAV);
      assert.equal(await lifecyclePage.locator('.brand').getAttribute('href'), 'https://yakka.build/');
      assert.equal(await lifecyclePage.locator('#return-link').innerText(), 'Return to analytics');
      const styleViolations = await lifecyclePage.evaluate(() => Array.from(document.querySelectorAll('main *')).map(node => getComputedStyle(node)).filter(cs => /gradient/i.test(cs.backgroundImage) || cs.boxShadow !== 'none' || cs.animationName !== 'none').length);
      assert.equal(styleViolations, 0);
      assert.equal(await lifecyclePage.getByRole('button', { name: /^(Invite|Add member|Change role)$/ }).count(), 0);
    }, 'V5/V4 lifecycle nav order, Pages brand/return link and no decoration');

    // ----- Screenshots + mockup comparison -----
    await group('screenshots', async () => {
      for (const id of ['profile', 'settings', 'login', 'callback', 'device', 'notfound']) {
        await openScreen(id);
        const screen = PHASE3_SCREENS.find(item => item.id === id);
        assert.equal(await textOf('#app > h1'), screen.h1, `${id} heading vs mockup`);
        const mockup = mockupPng(screen.mockup);
        const mockupSize = await pngSize(mockup);
        assert.deepEqual(mockupSize, { width: 1440, height: 900 }, `${screen.mockup}.png mockup size`);
        assert.ok(existsSync(mockupSrc(screen.src)), `${screen.src} mockup source present`);
        for (const theme of ['light', 'dark']) {
          await harness.toggleTheme(accountPage, theme);
          const file = await harness.screenshot(accountPage, id, theme);
          assert.deepEqual(await pngSize(file), { width: 1440, height: 900 }, `${id}-${theme} screenshot size`);
        }
        comparisons.push({
          screen: id, mockup, mockupSrc: mockupSrc(screen.src),
          light: resolve(phase3ScreensRoot, `${id}-light.png`), dark: resolve(phase3ScreensRoot, `${id}-dark.png`),
          note: 'Heading, region order, width, controls and light/dark tokens compared with the mockup; the written DESIGN text wins where they differ.'
        });
      }
      await lifecycle.reset();
      await lifecyclePage.goto(harness.lifecycleUrl('t-b'));
      await lifecyclePage.waitForFunction(() => document.querySelectorAll('#tenants tr[data-tenant-id]').length === 3);
      const screen = PHASE3_SCREENS.find(item => item.id === 'lifecycle');
      assert.equal(await lifecyclePage.locator('h1').innerText(), screen.h1);
      const mockupSize = await pngSize(mockupPng(screen.mockup));
      assert.deepEqual(mockupSize, { width: 1440, height: 900 });
      for (const theme of ['light', 'dark']) {
        await harness.toggleTheme(lifecyclePage, theme);
        const file = await harness.screenshot(lifecyclePage, 'lifecycle', theme);
        assert.deepEqual(await pngSize(file), { width: 1440, height: 900 }, `lifecycle-${theme} screenshot size`);
      }
      comparisons.push({
        screen: 'lifecycle', mockup: mockupPng(screen.mockup), mockupSrc: mockupSrc(screen.src),
        light: resolve(phase3ScreensRoot, 'lifecycle-light.png'), dark: resolve(phase3ScreensRoot, 'lifecycle-dark.png'),
        note: 'Written S-lifecycle wins over the mockup: Lifecycle state + Generation columns, a left-anchored dialog instead of the inline panel, and Pages-origin links.'
      });
      await writeFile(resolve(phase3ScreensRoot, 'comparisons.json'), JSON.stringify(comparisons, null, 2), 'utf8');
    }, 'seven screens captured at 1440x900 in both themes and compared with their committed mockups');

    // Diagnostics: deliberate 401/403/404/409/500/aborted writes are expected.
    const expected = value => /Failed to load resource: the server responded with a status of (400|401|403|404|409|500|503)\b/.test(value)
      || /net::ERR_FAILED/.test(value);
    const diagnostics = harness.diagnostics.filter(value => !expected(value));
    if (diagnostics.length) fail('diagnostics', diagnostics.join('\n'));
    else pass('diagnostics', 'no unexpected page error or console error');
  } finally {
    await browser?.close().catch(() => {});
    await harness.close().catch(() => {});
    await writeFile(resolve(phase3ScreensRoot, 'results.json'), JSON.stringify({ failures, results, comparisons }, null, 2), 'utf8').catch(() => {});
    await writeFile(resolve(phase3ScreensRoot, 'comparisons.json'), JSON.stringify(comparisons, null, 2), 'utf8').catch(() => {});
  }

  assert.deepEqual(analytics, [], 'an account route performed an analytics read');
  assert.deepEqual(failures, [], failures.join('\n'));
});

