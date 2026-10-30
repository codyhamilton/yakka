import { describe, expect, it } from 'vitest';
import {
	decideAfterMeFetch,
	currentTenantFromMe,
	initialTenantChoice,
	routeAllowsChildren,
	shouldNavigateToProfile,
	showsTenantChoice,
	tenantIdFromMe,
	type MeFetchResult
} from './session-gate';

const me401: MeFetchResult = { kind: 'http', status: 401, message: 'unauthorized' };
const me200Empty: MeFetchResult = {
	kind: 'ok',
	body: { github_id: 1, github_login: 'u', admin: false, tenants: [] }
};
const me200Acme: MeFetchResult = {
	kind: 'ok',
	body: { github_id: 1, github_login: 'u', admin: false, tenants: [{ id: 't-1', name: 'acme' }] }
};

function decide(
	overrides: Partial<{
		hostname: string;
		pathname: string;
		search: string;
		configuredBase: string;
		bearer: string;
		me: MeFetchResult;
	}>
) {
	return decideAfterMeFetch({
		hostname: 'example.com',
		pathname: '/',
		search: '',
		configuredBase: 'https://collector.example',
		bearer: '',
		me: me401,
		...overrides
	});
}

describe('decideAfterMeFetch', () => {
	it('loopback empty base + 401 stays (localhost)', () => {
		expect(
			decide({ hostname: 'localhost', configuredBase: '', me: me401, pathname: '/trends', search: '?range=7d' })
		).toBe('stay');
	});

	it('loopback empty base + 401 stays (127.0.0.1)', () => {
		expect(decide({ hostname: '127.0.0.1', configuredBase: '', me: me401 })).toBe('stay');
	});

	it('yakka.build empty base + 401 + no bearer navigates to login with return', () => {
		expect(
			decide({
				hostname: 'yakka.build',
				configuredBase: '',
				me: me401,
				pathname: '/usage',
				search: '?range=7d'
			})
		).toEqual({ login: '/usage?range=7d' });
	});

	it('401 + bearer + non-empty base stays', () => {
		expect(
			decide({
				configuredBase: 'https://collector.example',
				bearer: 'tok',
				me: me401
			})
		).toBe('stay');
	});

	it('401 + no bearer + non-empty base on 127.0.0.1 navigates to login', () => {
		expect(
			decide({
				hostname: '127.0.0.1',
				configuredBase: 'https://collector.example',
				me: me401,
				pathname: '/usage',
				search: '?range=7d'
			})
		).toEqual({ login: '/usage?range=7d' });
	});

	it('200 stays', () => {
		expect(decide({ me: me200Acme })).toBe('stay');
	});

	it('/login, /oauth/callback, /settings with 401 + no bearer + non-empty base stay', () => {
		const base = { configuredBase: 'https://collector.example', me: me401, bearer: '' };
		expect(decide({ ...base, pathname: '/login' })).toBe('stay');
		expect(decide({ ...base, pathname: '/oauth/callback' })).toBe('stay');
		expect(decide({ ...base, pathname: '/settings' })).toBe('stay');
	});

	it('non-401 fetchMe failure stays', () => {
		expect(decide({ me: { kind: 'other' } })).toBe('stay');
		expect(decide({ me: { kind: 'http', status: 500, message: 'err' } })).toBe('stay');
	});

	it('401 login return drops a path the URL parser would send off-origin', () => {
		expect(decide({ pathname: '/\\evil.com', search: '', me: me401, bearer: '' })).toEqual({ login: '/' });
		expect(decide({ pathname: '/usage', search: '?range=7d', me: me401, bearer: '' })).toEqual({
			login: '/usage?range=7d'
		});
	});
});

describe('routeAllowsChildren', () => {
	it('sign-in, callback, and settings render before /v1/me settles', () => {
		expect(routeAllowsChildren('/login', false, null)).toBe(true);
		expect(routeAllowsChildren('/oauth/callback', false, null)).toBe(true);
		expect(routeAllowsChildren('/settings', false, null)).toBe(true);
	});

	it('other routes wait for a stay decision', () => {
		expect(routeAllowsChildren('/', false, null)).toBe(false);
		expect(routeAllowsChildren('/profile', false, null)).toBe(false);
		expect(routeAllowsChildren('/', true, 'stay')).toBe(true);
		expect(routeAllowsChildren('/', true, { login: '/' })).toBe(false);
	});
});

describe('shouldNavigateToProfile', () => {
	it('403 no such tenant + 200 with no tenants navigates to profile', () => {
		expect(
			shouldNavigateToProfile({
				pathname: '/',
				me: me200Empty,
				fetchErrorStatus: 403,
				fetchErrorMessage: 'no such tenant'
			})
		).toBe(true);
	});

	it('403 no such tenant + 200 with tenant stays', () => {
		expect(
			shouldNavigateToProfile({
				pathname: '/',
				me: me200Acme,
				fetchErrorStatus: 403,
				fetchErrorMessage: 'no such tenant'
			})
		).toBe(false);
	});
});

const two = [
	{ id: 't-a', name: 'default' },
	{ id: 't-b', name: 'default' }
];
const meTwo: MeFetchResult = {
	kind: 'ok',
	body: { github_id: 1, github_login: 'u', admin: false, tenants: two }
};

describe('current tenant', () => {
	it('is the first tenant until one is chosen, and names need not be unique', () => {
		expect(tenantIdFromMe(meTwo, '')).toBe('t-a');
		expect(tenantIdFromMe(meTwo, 't-b')).toBe('t-b');
	});

	it('ignores a remembered tenant the user no longer owns', () => {
		expect(currentTenantFromMe(meTwo, 't-gone')).toEqual(two[0]);
	});

	it('is null without a session or tenants', () => {
		expect(tenantIdFromMe(null, '')).toBeNull();
		expect(tenantIdFromMe(me401, '')).toBeNull();
		expect(tenantIdFromMe(me200Empty, '')).toBeNull();
	});
});

describe('tenant choice UI', () => {
	it('shows a picker only when there is more than one tenant', () => {
		expect(showsTenantChoice([])).toBe(false);
		expect(showsTenantChoice(two.slice(0, 1))).toBe(false);
		expect(showsTenantChoice(two)).toBe(true);
	});

	it('preselects the only tenant, else the remembered one, else nothing', () => {
		expect(initialTenantChoice(two.slice(0, 1), '', '')).toBe('t-a');
		expect(initialTenantChoice(two, '', 't-b')).toBe('t-b');
		expect(initialTenantChoice(two, 't-a', 't-b')).toBe('t-a');
		expect(initialTenantChoice(two, '', '')).toBe('');
		expect(initialTenantChoice(two, 'gone', 'gone')).toBe('');
	});
});
