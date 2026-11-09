import {
	BASE_KEY,
	isLifecycleTracked,
	safeReturnPath,
	tenantLifecycleState,
	TOKEN_KEY,
	type MeResponse,
	type Tenant
} from './api';

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

/**
 * The tenant views query: the remembered choice when the user still owns it, else the first.
 * `INVALIDATED_TENANT` means an explicit re-selection is required, so no automatic fallback applies.
 */
export function currentTenantFromMe(me: MeFetchResult | null, remembered: string): Tenant | null {
	if (remembered === INVALIDATED_TENANT) return null;
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
export const TENANT_GENERATION_KEY = 'yakka-analytics-tenant-generation';
export const TENANT_INVALIDATED_KEY = 'yakka-analytics-tenant-invalidated';

/**
 * Runtime stand-in for a selection that must be re-made explicitly. It is never a real tenant id,
 * so consumers resolving it get no tenant and the automatic first-tenant fallback stays suppressed.
 */
export const INVALIDATED_TENANT = '\u0000invalidated';

function writeStorage(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Per-viewer convenience only; the choice still holds for this page load.
	}
}

function removeStorage(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Storage may be unavailable (private mode); nothing to clear.
	}
}

export function readRememberedTenant(): string {
	return readStorage(TENANT_KEY);
}

export function readRememberedGeneration(): string {
	return readStorage(TENANT_GENERATION_KEY);
}

export function readSelectionInvalidated(): boolean {
	return readStorage(TENANT_INVALIDATED_KEY) === '1';
}

/** Remember an explicit choice with the generation it was observed at. */
export function rememberTenant(id: string, generation = ''): void {
	writeStorage(TENANT_KEY, id);
	if (generation !== '') writeStorage(TENANT_GENERATION_KEY, generation);
	else removeStorage(TENANT_GENERATION_KEY);
	removeStorage(TENANT_INVALIDATED_KEY);
}

export function forgetTenant(): void {
	removeStorage(TENANT_KEY);
	removeStorage(TENANT_GENERATION_KEY);
}

/**
 * Clear a stale/absent/changed selection and persist the invalidation, so a reload does not
 * silently adopt the first remaining tenant. Only an explicit re-selection clears it.
 */
export function invalidateTenantSelection(): void {
	forgetTenant();
	writeStorage(TENANT_INVALIDATED_KEY, '1');
}

export function clearSelectionInvalidation(): void {
	removeStorage(TENANT_INVALIDATED_KEY);
}

export class TenantSelectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TenantSelectionError';
	}
}

export type SelectionOutcome =
	| { kind: 'selected'; tenant: Tenant }
	| { kind: 'pending'; tenant: Tenant; state: 'resetting' | 'deleting' }
	| { kind: 'invalidate'; reason: 'absent' | 'changed' | 'needs-generation' }
	| { kind: 'unselected' }
	| { kind: 'none' };

/**
 * Compare the remembered id/generation with `GET /v1/me`.
 * - absent/changed: the tenant went away or completed a reset under a new generation.
 * - needs-generation: a pre-lifecycle remembered selection cannot silently adopt a post-reset generation.
 * - pending: reset/delete is still running, so target reads stay suspended.
 * - unselected: invalidation was already recorded, so no automatic first-tenant fallback applies.
 * A pre-lifecycle payload (no lifecycle fields) keeps the old usable-selection behavior.
 */
export function validateSelection(params: {
	me: MeFetchResult | null;
	rememberedId: string;
	rememberedGeneration: string;
	invalidated: boolean;
}): SelectionOutcome {
	const tenants = tenantsFromMe(params.me);
	if (params.rememberedId === INVALIDATED_TENANT || params.invalidated) {
		return { kind: 'unselected' };
	}
	if (tenants.length === 0) {
		if (params.rememberedId !== '') return { kind: 'invalidate', reason: 'absent' };
		return { kind: 'none' };
	}
	const explicit = params.rememberedId !== '';
	const candidate = explicit ? tenants.find((t) => t.id === params.rememberedId) : tenants[0];
	if (!candidate) return { kind: 'invalidate', reason: 'absent' };

	const state = tenantLifecycleState(candidate);
	if (state === 'resetting' || state === 'deleting') {
		return { kind: 'pending', tenant: candidate, state };
	}
	if (explicit && isLifecycleTracked(candidate)) {
		if (params.rememberedGeneration === '') return { kind: 'invalidate', reason: 'needs-generation' };
		if ((candidate.lifecycle_generation ?? '') !== params.rememberedGeneration) {
			return { kind: 'invalidate', reason: 'changed' };
		}
	}
	return { kind: 'selected', tenant: candidate };
}

/** Why a tenant data read must not be issued yet, or null when it may proceed. */
export function selectionReadBlock(outcome: SelectionOutcome): string | null {
	switch (outcome.kind) {
		case 'selected':
			return null;
		case 'pending':
			return outcome.state === 'resetting'
				? 'This tenant is being reset. Analytics will resume after it completes.'
				: 'This tenant is being deleted. Analytics will resume if the deletion does not complete.';
		case 'invalidate':
			if (outcome.reason === 'changed') return 'This tenant was reset. Choose a tenant again before loading analytics.';
			if (outcome.reason === 'needs-generation') return 'Confirm your tenant selection again before loading analytics.';
			return 'Your selected tenant is no longer available. Choose a tenant on your profile.';
		case 'unselected':
			return 'Choose a tenant on your profile before loading analytics.';
		case 'none':
			return 'You do not have a tenant yet. Create one on your profile.';
	}
}
