import { BASE_KEY, safeReturnPath, TOKEN_KEY, type MeResponse, type Tenant } from './api';

function readStorage(key: string): string {
	try {
		return (localStorage.getItem(key) ?? '').trim();
	} catch {
		return '';
	}
}

/** Configured API base (`yakka-analytics-base`), trimmed with trailing slashes removed. */
export function readConfiguredBase(): string {
	return readStorage(BASE_KEY).replace(/\/+$/, '');
}

export function readBearer(): string {
	return readStorage(TOKEN_KEY);
}

export function isLoopbackLocal(hostname: string, configuredBase: string): boolean {
	if (configuredBase !== '') return false;
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

const STAY_PATHS = new Set(['/login', '/oauth/callback', '/settings']);

export function isAuthStayPath(pathname: string): boolean {
	return STAY_PATHS.has(pathname);
}

/**
 * Whether the layout may mount route children.
 * `/login`, `/oauth/callback`, and `/settings` do not wait on `GET /v1/me`: those
 * pages are how a person signs in or replaces a base URL that never answers.
 * Every other route waits until the remembered result says stay, so a redirect
 * does not also start analytics.
 */
export function routeAllowsChildren(
	pathname: string,
	ready: boolean,
	decision: GateAfterMe | null
): boolean {
	if (isAuthStayPath(pathname)) return true;
	if (!ready || decision === null) return false;
	return decision === 'stay';
}

export type MeFetchResult =
	| { kind: 'ok'; body: MeResponse }
	| { kind: 'http'; status: number; message: string }
	| { kind: 'other' };

export type GateAfterMe = 'stay' | { login: string };

/** Predicate after `GET /v1/me` settles (steps 2–7 in the session-gate contract). */
export function decideAfterMeFetch(params: {
	hostname: string;
	pathname: string;
	search: string;
	configuredBase: string;
	bearer: string;
	me: MeFetchResult;
}): GateAfterMe {
	const { hostname, pathname, search, configuredBase, bearer, me } = params;

	if (isAuthStayPath(pathname)) {
		return 'stay';
	}

	if (isLoopbackLocal(hostname, configuredBase)) {
		return 'stay';
	}

	if (me.kind === 'ok') {
		return 'stay';
	}

	if (me.kind === 'http' && me.status === 401) {
		if (bearer !== '' && configuredBase !== '') {
			return 'stay';
		}
		return { login: safeReturnPath(pathname + search) ?? '/' };
	}

	return 'stay';
}

/** Step 8: 403 `no such tenant` when me had no tenant. */
export function shouldNavigateToProfile(params: {
	pathname: string;
	me: MeFetchResult;
	fetchErrorStatus: number;
	fetchErrorMessage: string;
}): boolean {
	if (params.pathname === '/profile') return false;
	if (params.fetchErrorStatus !== 403 || params.fetchErrorMessage !== 'no such tenant') return false;
	if (params.me.kind !== 'ok') return false;
	return params.me.body.tenants.length === 0;
}

export function tenantsFromMe(me: MeFetchResult | null): Tenant[] {
	return me && me.kind === 'ok' ? me.body.tenants : [];
}

/** The tenant views query: the remembered choice when the user still owns it, else the first. */
export function currentTenantFromMe(me: MeFetchResult | null, remembered: string): Tenant | null {
	const tenants = tenantsFromMe(me);
	return tenants.find((t) => t.id === remembered) ?? tenants[0] ?? null;
}

export function tenantIdFromMe(me: MeFetchResult | null, remembered: string): string | null {
	return currentTenantFromMe(me, remembered)?.id ?? null;
}

/** A tenant picker only earns its place when there is something to pick between. */
export function showsTenantChoice(tenants: Tenant[]): boolean {
	return tenants.length > 1;
}

/**
 * The tenant a form should start on: the one already chosen, the only one, or the remembered
 * current tenant. Empty when there are several and the person has not said which.
 */
export function initialTenantChoice(tenants: Tenant[], chosen: string, remembered: string): string {
	for (const id of [chosen, remembered]) {
		if (id !== '' && tenants.some((t) => t.id === id)) return id;
	}
	return tenants.length === 1 ? tenants[0].id : '';
}

export const TENANT_KEY = 'yakka-analytics-tenant';

export function readRememberedTenant(): string {
	return readStorage(TENANT_KEY);
}

export function rememberTenant(id: string): void {
	try {
		localStorage.setItem(TENANT_KEY, id);
	} catch {
		// Per-viewer convenience only; the choice still holds for this page load.
	}
}
