import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ApiError,
	apiGet,
	apiPost,
	createToken,
	fetchMe,
	approveDevice,
	DEFAULT_TOKEN_LIFETIME,
	fetchDeviceGrant,
	TOKEN_LIFETIMES,
	denyDevice,
	oauthApiBase,
	oauthCallbackTarget,
	oauthLoginPath,
	revokeToken,
	safeReturnPath,
	isValidLoopbackRedirectUri
} from './api';

let store: Record<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;

function ok(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
	store = {};
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => (k in store ? store[k] : null),
		setItem: (k: string, v: string) => void (store[k] = v)
	});
	fetchMock = vi.fn(() => ok({ ok: true }));
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('apiGet', () => {
	it('uses a relative /v1 for an empty base and sends no Authorization', async () => {
		await apiGet('analytics/summary', new URLSearchParams('repo_id=a&repo_id=b'));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/analytics/summary?repo_id=a&repo_id=b');
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
		expect(init?.credentials).toBe('include');
	});

	it('collector mode ignores a stored key and still omits Authorization', async () => {
		store['yakka-analytics-key'] = 'sekret';
		await apiGet('analytics/summary');
		const [, init] = fetchMock.mock.calls[0];
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
		expect(init?.credentials).toBe('include');
	});

	it('uses the stored base without a trailing slash and sends the bearer token', async () => {
		store['yakka-analytics-base'] = 'https://api.example.com/';
		store['yakka-analytics-key'] = 'sekret';
		await apiGet('analytics/summary');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.example.com/v1/analytics/summary');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sekret');
	});

	it('reads storage on every call', async () => {
		store['yakka-analytics-base'] = 'https://api.example.com';
		await apiGet('baselines');
		store['yakka-analytics-key'] = 'k2';
		await apiGet('baselines');
		expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('authorization')).toBe(false);
		expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer k2');
	});

	it('surfaces status and error text', async () => {
		fetchMock.mockImplementation(() => ok({ error: 'unauthorized' }, 401));
		await expect(apiGet('analytics/summary')).rejects.toMatchObject({
			name: 'ApiError',
			status: 401,
			message: 'unauthorized'
		});
		await expect(apiGet('analytics/summary')).rejects.toBeInstanceOf(ApiError);
	});

	it('fetchMe hits /v1/me with session transport', async () => {
		fetchMock.mockImplementation(() => ok({ github_id: 1, github_login: 'u', admin: false, tenants: [] }));
		await fetchMe();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/me');
		expect(init?.credentials).toBe('include');
	});

	it('apiPost in collector mode sends credentials and JSON without Authorization', async () => {
		await apiPost('tokens', { tenant: 't', scope: 'read', lifetime: '3m' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/tokens');
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
		expect(init?.credentials).toBe('include');
		expect(init?.body).toBe(JSON.stringify({ tenant: 't', scope: 'read', lifetime: '3m' }));
	});

	it('revokeToken posts to the revoke subpath', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
		await revokeToken('abc');
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/tokens/abc/revoke');
		expect(init?.method).toBe('POST');
	});

	it('createToken uses apiPost', async () => {
		fetchMock.mockImplementation(() => ok({ id: '1', token: 'wk_x', tenant: 't', scope: 'read', expires_at: 'x' }));
		await createToken({ tenant: 't', scope: 'read', lifetime: '3m' });
		expect(fetchMock.mock.calls[0][0]).toBe('/v1/tokens');
	});

	it('uses the production API on the Pages host when no base is stored', async () => {
		vi.stubGlobal('location', { hostname: 'yakka.build' });
		fetchMock.mockImplementation(() => ok({ github_id: 1, github_login: 'u', admin: false, tenants: [] }));
		await fetchMe();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.yakka.build/v1/me');
		expect(init?.credentials).toBe('include');
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
	});

	it('sends a bearer for analytics and cookies for session routes when the base is the API', async () => {
		store['yakka-analytics-base'] = 'https://api.yakka.build';
		store['yakka-analytics-key'] = 'sekret';
		await apiGet('analytics/summary');
		const [analyticsURL, analyticsInit] = fetchMock.mock.calls[0];
		expect(analyticsURL).toBe('https://api.yakka.build/v1/analytics/summary');
		expect(new Headers(analyticsInit?.headers).get('authorization')).toBe('Bearer sekret');
		expect(analyticsInit?.credentials).toBeUndefined();
		fetchMock.mockImplementation(() => ok({ github_id: 1, github_login: 'u', admin: false, tenants: [] }));
		await fetchMe();
		const [meURL, meInit] = fetchMock.mock.calls[1];
		expect(meURL).toBe('https://api.yakka.build/v1/me');
		expect(meInit?.credentials).toBe('include');
		expect(new Headers(meInit?.headers).has('authorization')).toBe(false);
	});

	it('oauth completion uses the API on Pages and same-origin elsewhere, ignoring a stored base', () => {
		store['yakka-analytics-base'] = 'https://collector.example';
		expect(oauthApiBase('yakka.build')).toBe('https://api.yakka.build');
		expect(oauthApiBase('www.yakka.build')).toBe('https://api.yakka.build');
		expect(oauthApiBase('localhost')).toBe('');
		expect(oauthLoginPath('yakka.build', '/device?state=abc')).toBe(
			'https://api.yakka.build/oauth/login?return=' + encodeURIComponent('/device?state=abc')
		);
		expect(oauthLoginPath('localhost')).toBe('/oauth/login');
		expect(oauthLoginPath('yakka.build', '/\\evil.com')).toBe('https://api.yakka.build/oauth/login');
		expect(oauthLoginPath('yakka.build', '//evil.com')).toBe('https://api.yakka.build/oauth/login');
	});

	it('safeReturnPath stays on the page origin', () => {
		expect(safeReturnPath('/usage?range=7d')).toBe('/usage?range=7d');
		expect(safeReturnPath('/device?state=abc&redirect_uri=http://127.0.0.1:9/cb')).toBe(
			'/device?state=abc&redirect_uri=http://127.0.0.1:9/cb'
		);
		expect(safeReturnPath('//evil.com')).toBeNull();
		expect(safeReturnPath('/\\evil.com')).toBeNull();
		expect(safeReturnPath('/\t/evil.com')).toBeNull();
		expect(safeReturnPath('/\n/evil.com')).toBeNull();
		expect(safeReturnPath('https://evil.com/')).toBeNull();
		expect(safeReturnPath('')).toBeNull();
	});

	it('oauth callback ignores an off-origin return and a response from another URL', () => {
		const pageOrigin = 'https://yakka.build';
		const requestUrl = 'https://api.yakka.build/oauth/callback?code=c&state=s';
		expect(
			oauthCallbackTarget({
				requestUrl,
				responseUrl: requestUrl,
				responseOk: true,
				body: { ok: true, return: '/\\evil.com' },
				pageOrigin
			})
		).toEqual({ kind: 'navigate', path: '/' });
		expect(
			oauthCallbackTarget({
				requestUrl,
				responseUrl: requestUrl,
				responseOk: true,
				body: { ok: true, return: '/usage?range=7d' },
				pageOrigin
			})
		).toEqual({ kind: 'navigate', path: '/usage?range=7d' });
		expect(
			oauthCallbackTarget({
				requestUrl,
				responseUrl: 'https://evil.com/oauth/callback?code=c&state=s',
				responseOk: true,
				body: { ok: true, return: '/usage' },
				pageOrigin
			})
		).toEqual({ kind: 'failed' });
		expect(
			oauthCallbackTarget({
				requestUrl,
				responseUrl: requestUrl,
				responseOk: false,
				body: { ok: true, return: '/usage' },
				pageOrigin
			})
		).toEqual({ kind: 'failed' });
	});

	it('isValidLoopbackRedirectUri accepts loopback http(s) only', () => {
		expect(isValidLoopbackRedirectUri('http://127.0.0.1:8765/callback')).toBe(true);
		expect(isValidLoopbackRedirectUri('https://localhost:9/')).toBe(true);
		expect(isValidLoopbackRedirectUri('https://example.com/cb')).toBe(false);
		expect(isValidLoopbackRedirectUri('')).toBe(false);
		expect(isValidLoopbackRedirectUri('http://2130706433/cb')).toBe(false);
		expect(isValidLoopbackRedirectUri('http://evil.com%2f@127.0.0.1/cb')).toBe(false);
		expect(isValidLoopbackRedirectUri('http://127.0.0.1\\@evil.com/cb')).toBe(false);
	});

	it('approveDevice posts the grant fields with credentials and no bearer', async () => {
		fetchMock.mockImplementation(() => ok({ approved: true }));
		const body = { user_code: 'WDJB-MJHT', tenant: 'acme', scope: 'read', lifetime: '3m' as const, name: 'laptop' };
		await expect(approveDevice(body)).resolves.toEqual({ approved: true });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/device/authorize');
		expect(init?.method).toBe('POST');
		expect(init?.credentials).toBe('include');
		expect(new Headers(init?.headers).has('authorization')).toBe(false);
		expect(JSON.parse(init?.body as string)).toEqual(body);
	});

	it('fetchDeviceGrant reads the reported host with credentials', async () => {
		fetchMock.mockImplementation(() => ok({ host: 'laptop' }));
		await expect(fetchDeviceGrant('WDJB-MJHT')).resolves.toEqual({ host: 'laptop' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/v1/device/grant?user_code=WDJB-MJHT');
		expect(init?.credentials).toBe('include');
	});

	it('offers six lifetimes, from a day to a year, defaulting to 3 months', () => {
		expect(TOKEN_LIFETIMES.map((l) => l.value)).toEqual(['1d', '1w', '1m', '3m', '6m', '1y']);
		expect(DEFAULT_TOKEN_LIFETIME).toBe('3m');
	});

	it('denyDevice posts user_code and action deny; a 404 is an ApiError', async () => {
		fetchMock.mockImplementation(() => ok({ error: 'unknown_code' }, 404));
		const err = (await denyDevice('X-1').catch((e) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(404);
		expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ user_code: 'X-1', action: 'deny' });
	});

	it('names a non-JSON 200 (a static host without the API) as a connection problem', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(new Response('<!doctype html><html></html>', { status: 200 })));
		const err = await apiGet('analytics/summary').catch((e) => e);
		expect(err).not.toBeInstanceOf(ApiError);
		expect(String(err.message)).toContain('/v1/analytics/summary did not return JSON');
	});
});
