import { expect, test, type Page } from '@playwright/test';

const ME = { github_id: 1, github_login: 'u', admin: false, tenants: [{ id: 't-acme', name: 'acme' }] };
const ME_TWO = {
	...ME,
	tenants: [
		{ id: 't-one', name: 'default' },
		{ id: 't-two', name: 'default' }
	]
};

async function mockMe(page: Page, me: unknown = ME) {
	await page.route('**/v1/me', (route) => route.fulfill({ json: me }));
}

type Captured = { calls: { body: Record<string, unknown>; creds: boolean }[] };

async function mockAuthorize(page: Page, status = 200, json: unknown = { approved: true }): Promise<Captured> {
	const cap: Captured = { calls: [] };
	await page.route('**/v1/device/authorize', async (route) => {
		const req = route.request();
		cap.calls.push({
			body: JSON.parse(req.postData() ?? '{}'),
			creds: ((await req.allHeaders())['cookie'] ?? '').includes('yakka_session=1')
		});
		await route.fulfill({ status, json });
	});
	return cap;
}

async function fillChoices(page: Page, scope = 'read_write') {
	await page.getByTestId('device-grant').selectOption(scope);
	await page.getByTestId('device-expires').fill('2099-06-15T12:00');
}

test('shows the code and keeps Approve disabled until scope and expiry are set', async ({ page }) => {
	await mockMe(page);
	await page.goto('/device?user_code=WDJB-MJHT');
	await expect(page.getByTestId('device-user-code')).toHaveText('WDJB-MJHT');
	await expect(page.locator('body')).toContainText('Check this matches the code in your terminal');
	await expect(page.getByTestId('device-expires')).toHaveValue('');
	await expect(page.getByTestId('device-submit')).toBeDisabled();
	await page.getByTestId('device-grant').selectOption('read');
	await expect(page.getByTestId('device-submit')).toBeDisabled();
	await page.getByTestId('device-expires').fill('2099-06-15T12:00');
	await expect(page.getByTestId('device-submit')).toBeEnabled();
});

test('Approve sends one credentialed fetch with the four fields and shows Approved', async ({ page, baseURL }) => {
	await mockMe(page);
	const cap = await mockAuthorize(page);
	await page.context().addCookies([{ name: 'yakka_session', value: '1', url: baseURL! }]);
	await page.goto('/device?user_code=WDJB-MJHT');
	await page.evaluate(() => ((window as unknown as { __stay: number }).__stay = 1));
	await fillChoices(page);
	await page.getByTestId('device-submit').click();
	await expect(page.getByTestId('device-result')).toContainText('Approved');
	expect(cap.calls).toHaveLength(1);
	expect(cap.calls[0].creds).toBe(true);
	expect(Object.keys(cap.calls[0].body).sort()).toEqual(['expires_at', 'scope', 'tenant', 'user_code']);
	expect(cap.calls[0].body).toMatchObject({ user_code: 'WDJB-MJHT', tenant: 't-acme', scope: 'read_write' });
	expect(String(cap.calls[0].body.expires_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
	expect(new URL(page.url()).pathname).toBe('/device');
	await expect(page.getByTestId('device-submit')).toBeDisabled();
	await expect(page.getByTestId('device-deny')).toBeDisabled();
});

test('Deny sends user_code and action deny and shows Denied', async ({ page }) => {
	await mockMe(page);
	const cap = await mockAuthorize(page, 200, { denied: true });
	await page.goto('/device?user_code=WDJB-MJHT');
	await page.getByTestId('device-deny').click();
	await expect(page.getByTestId('device-result')).toContainText('Denied');
	expect(cap.calls).toHaveLength(1);
	expect(cap.calls[0].body).toEqual({ user_code: 'WDJB-MJHT', action: 'deny' });
});

test('a 404 from authorize shows the unknown-code error', async ({ page }) => {
	await mockMe(page);
	await mockAuthorize(page, 404, { error: 'unknown_code' });
	await page.goto('/device?user_code=WDJB-MJHT');
	await fillChoices(page);
	await page.getByTestId('device-submit').click();
	await expect(page.getByTestId('device-code-error')).toContainText('unknown or has expired');
	await expect(page.getByTestId('device-result')).not.toContainText('Approved');
});

test('one tenant: no tenant picker is shown', async ({ page }) => {
	await mockMe(page);
	await page.goto('/device?user_code=WDJB-MJHT');
	await expect(page.getByTestId('device-authorize-form')).toBeVisible();
	await expect(page.getByTestId('device-tenant')).toHaveCount(0);
});

test('several tenants: picker lists them by name, and Approve sends the chosen ID', async ({ page }) => {
	await mockMe(page, ME_TWO);
	const cap = await mockAuthorize(page);
	await page.goto('/device?user_code=WDJB-MJHT');
	await expect(page.getByTestId('device-tenant').locator('option')).toHaveText(['Select tenant', 'default', 'default']);
	await page.getByTestId('device-grant').selectOption('read');
	await page.getByTestId('device-expires').fill('2099-06-15T12:00');
	await expect(page.getByTestId('device-submit')).toBeDisabled();
	await page.getByTestId('device-tenant').selectOption('t-two');
	await page.getByTestId('device-submit').click();
	await expect(page.getByTestId('device-result')).toContainText('Approved');
	expect(cap.calls[0].body).toMatchObject({ tenant: 't-two' });
});

test('no parameter shows the entry field and no tenant form', async ({ page }) => {
	await mockMe(page);
	await page.goto('/device');
	await expect(page.getByTestId('device-user-code')).toBeVisible();
	await expect(page.getByTestId('device-tenant')).toHaveCount(0);
	await expect(page.getByTestId('device-authorize-form')).toHaveCount(0);
	await page.getByTestId('device-user-code').fill('abcd-efgh');
	await page.getByTestId('device-code-submit').click();
	await expect(page).toHaveURL(/user_code=ABCD-EFGH/);
	await expect(page.getByTestId('device-authorize-form')).toBeVisible();
});

test('signed out keeps user_code in the sign-in return URL', async ({ page }) => {
	await page.route('**/v1/me', (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
	await page.goto('/device?user_code=X-1');
	const href = await page.getByTestId('device-oauth-login').getAttribute('href');
	expect(href).toContain('/oauth/login?return=');
	const ret = new URL(href!, 'http://x').searchParams.get('return');
	expect(ret).toBe('/device?user_code=X-1');
});

test('state and redirect_uri in the URL are ignored', async ({ page }) => {
	await mockMe(page);
	const cap = await mockAuthorize(page);
	const loopback: string[] = [];
	page.on('request', (r) => {
		if (r.url().startsWith('http://127.0.0.1:8765')) loopback.push(r.url());
	});
	await page.goto(
		'/device?user_code=WDJB-MJHT&state=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcb'
	);
	await fillChoices(page);
	await page.getByTestId('device-submit').click();
	await expect(page.getByTestId('device-result')).toContainText('Approved');
	expect(cap.calls[0].body).not.toHaveProperty('redirect_uri');
	expect(cap.calls[0].body).not.toHaveProperty('state');
	expect(loopback).toEqual([]);
});

test('the page body never contains wk_', async ({ page }) => {
	await mockMe(page);
	await mockAuthorize(page);
	await page.goto('/device?user_code=WDJB-MJHT');
	await fillChoices(page);
	await page.getByTestId('device-submit').click();
	await expect(page.getByTestId('device-result')).toContainText('Approved');
	await expect(page.locator('body')).not.toContainText('wk_');
});
