export const BASE_KEY = 'yakka-analytics-base';
export const TOKEN_KEY = 'yakka-analytics-key';

/** Production Fly API. Pages at yakka.build calls this origin with credentials. */
export const API_ORIGIN = 'https://api.yakka.build';

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

/** A tenant: `id` is the immutable unique key the API takes; `name` is a display label, unique per owner only. */
export type Tenant = { id: string; name: string };

export type MeResponse = {
	github_id: number;
	github_login: string;
	admin: boolean;
	tenants: Tenant[];
};

export type TokenListItem = {
	id: string;
	tenant: string;
	tenant_name: string;
	scope: string;
	/** Absent on tokens issued before names existed. */
	name?: string;
	expires_at: string;
	revoked: boolean;
	created_at: string;
};

/** Token lifetimes the server accepts; it computes the expiry, so no date is ever sent. */
export const TOKEN_LIFETIMES = [
	{ value: '1d', label: '1 day' },
	{ value: '1w', label: '1 week' },
	{ value: '1m', label: '1 month' },
	{ value: '3m', label: '3 months' },
	{ value: '6m', label: '6 months' },
	{ value: '1y', label: '1 year' }
] as const;

export type TokenLifetime = (typeof TOKEN_LIFETIMES)[number]['value'];

export const DEFAULT_TOKEN_LIFETIME: TokenLifetime = '3m';

export type CreatedTokenResponse = TokenListItem & { token: string };

export type AdminTokenListItem = TokenListItem & { github_id: number };

// localStorage is read on every call: no caching, so /settings takes effect without a reload.
function read(key: string): string {
	try {
		return (localStorage.getItem(key) ?? '').trim();
	} catch {
		return '';
	}
}

function configuredBase(): string {
	return read(BASE_KEY).replace(/\/+$/, '');
}

/** True on the production Pages hosts (apex and www). */
export function isPagesHost(hostname?: string): boolean {
	const host = hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
	return host === 'yakka.build' || host === 'www.yakka.build';
}

/**
 * API origin for this page. A stored base wins. On the Pages hosts an empty base is the
 * production API. An embedded local serve stays same-origin (empty).
 */
export function resolvedBase(hostname?: string): string {
	const configured = configuredBase();
	if (configured) return configured;
	if (isPagesHost(hostname)) return API_ORIGIN;
	return '';
}

function originOf(base: string): string {
	try {
		return new URL(base).origin;
	} catch {
		return '';
	}
}

/**
 * Session cookie transport: same-origin embed, the Pages hosts, or a base whose origin is
 * the production API. Analytics GETs may still send a bearer when a key is stored.
 */
export function isCollectorMode(hostname?: string): boolean {
	const configured = configuredBase();
	if (configured === '') return true;
	return originOf(configured) === API_ORIGIN || isPagesHost(hostname);
}

/**
 * Origin that sets and reads the OAuth state cookie.
 * Pages talks to the production API. Any other host, including an embedded serve, stays
 * same-origin. A stored analytics base is not this origin: the state cookie is not sent there.
 */
export function oauthApiBase(hostname?: string): string {
	const host = hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
	return isPagesHost(host) ? API_ORIGIN : '';
}

const RETURN_BASE = 'https://return.invalid';

/**
 * A same-origin path safe to store as an OAuth return and to pass to `location.assign`.
 * Rejects protocol-relative URLs, backslashes (the URL parser turns those into a new
 * origin), and ASCII controls. Null means the caller must not navigate there.
 */
export function safeReturnPath(raw: string): string | null {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
	if (!raw.startsWith('/') || raw.startsWith('//')) return null;
	if (raw.includes('\\') || raw.includes('\u2028') || raw.includes('\u2029')) return null;
	for (let i = 0; i < raw.length; i++) {
		const c = raw.charCodeAt(i);
		if (c < 0x20 || c === 0x7f) return null;
	}
	let url: URL;
	try {
		url = new URL(raw, RETURN_BASE);
	} catch {
		return null;
	}
	if (url.origin !== RETURN_BASE) return null;
	if (!url.pathname.startsWith('/') || url.pathname.startsWith('//') || url.username || url.password) {
		return null;
	}
	return url.pathname + url.search + url.hash;
}

/** Where the OAuth callback page may navigate after the API answers, or why it must not. */
export function oauthCallbackTarget(input: {
	requestUrl: string;
	responseUrl: string;
	responseOk: boolean;
	body: { ok?: boolean; error?: string; return?: unknown };
	pageOrigin: string;
}): { kind: 'navigate'; path: string } | { kind: 'denied' } | { kind: 'failed' } {
	let expected: URL;
	let finalUrl: URL;
	try {
		expected = new URL(input.requestUrl, input.pageOrigin);
		finalUrl = new URL(input.responseUrl, input.pageOrigin);
	} catch {
		return { kind: 'failed' };
	}
	if (!input.responseOk || finalUrl.origin !== expected.origin || finalUrl.pathname !== expected.pathname) {
		return input.body.error === 'denied' ? { kind: 'denied' } : { kind: 'failed' };
	}
	if (input.body.ok === true) {
		const path = typeof input.body.return === 'string' ? safeReturnPath(input.body.return) : null;
		return { kind: 'navigate', path: path ?? '/' };
	}
	if (input.body.error === 'denied') return { kind: 'denied' };
	return { kind: 'failed' };
}

/** GitHub login navigation. On Pages this hits the API so the state cookie is host-only there. */
export function oauthLoginPath(hostname: string, returnTo = ''): string {
	const base = oauthApiBase(hostname);
	const safe = returnTo ? safeReturnPath(returnTo) : null;
	const q = safe ? `?return=${encodeURIComponent(safe)}` : '';
	return `${base}/oauth/login${q}`;
}

function apiUrl(path: string, params?: URLSearchParams | string): string {
	const base = resolvedBase();
	const qs = params ? params.toString() : '';
	return `${base}/v1/${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
}

function apiInit(method: string, collector: boolean, key: string, body?: unknown, signal?: AbortSignal): RequestInit {
	const headers: Record<string, string> = { accept: 'application/json' };
	if (key) headers.authorization = `Bearer ${key}`;
	if (body !== undefined) headers['content-type'] = 'application/json';
	const init: RequestInit = { method, headers, signal };
	if (collector) init.credentials = 'include';
	if (body !== undefined) init.body = JSON.stringify(body);
	return init;
}

async function parseJsonResponse<T>(res: Response, url: string): Promise<T> {
	if (!res.ok) {
		let msg = res.statusText || `HTTP ${res.status}`;
		try {
			const body = await res.json();
			if (body && typeof body.error === 'string') msg = body.error;
		} catch {
			/* non-JSON error body */
		}
		throw new ApiError(res.status, msg);
	}
	if (res.status === 204) return undefined as T;
	try {
		return (await res.json()) as T;
	} catch {
		throw new Error(`${url} did not return JSON: this origin does not serve the workflow API. Set the API base URL.`);
	}
}

function sessionRoute(path: string): boolean {
	const p = path.replace(/^\/+/, '');
	return p === 'me' || p.startsWith('device/') || p.startsWith('tenants') || p.startsWith('tokens') || p.startsWith('admin/');
}

/** GET <base>/v1/<path>?<params>. `path` is relative to /v1, e.g. "analytics/summary". */
export async function apiGet<T = unknown>(
	path: string,
	params?: URLSearchParams | string,
	signal?: AbortSignal
): Promise<T> {
	const collector = isCollectorMode();
	const session = collector && sessionRoute(path);
	const key = session || read(TOKEN_KEY) === '' || resolvedBase() === '' ? '' : read(TOKEN_KEY);
	const creds = session || key === '';
	const url = apiUrl(path, params);
	const res = await fetch(url, apiInit('GET', creds, key, undefined, signal));
	return parseJsonResponse<T>(res, url);
}

/** POST <base>/v1/<path> with a JSON body. Collector session routes use cookies, not a bearer. */
export async function apiPost<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
	const collector = isCollectorMode();
	const session = collector && sessionRoute(path);
	const key = session || read(TOKEN_KEY) === '' || resolvedBase() === '' ? '' : read(TOKEN_KEY);
	const creds = session || key === '';
	const url = apiUrl(path);
	const res = await fetch(url, apiInit('POST', creds, key, body, signal));
	return parseJsonResponse<T>(res, url);
}

export async function createTenant(name: string, signal?: AbortSignal): Promise<Tenant> {
	return apiPost('tenants', { name }, signal);
}

export async function createToken(
	body: { tenant: string; scope: string; lifetime: TokenLifetime; name?: string },
	signal?: AbortSignal
): Promise<CreatedTokenResponse> {
	return apiPost('tokens', body, signal);
}

export async function listTokens(signal?: AbortSignal): Promise<TokenListItem[]> {
	return apiGet('tokens', undefined, signal);
}

export async function listAdminTokens(signal?: AbortSignal): Promise<AdminTokenListItem[]> {
	return apiGet('admin/tokens', undefined, signal);
}

export type AdminFootprint = {
	ledger_bytes: number;
	wal_bytes: number;
	archive_bytes: number;
	archive_files: number;
	blob_bytes: number;
	blobs: number;
	pending_bytes: number;
	pending: number;
	other_bytes: number;
};

export type AdminRescore = {
	running: boolean;
	total: number;
	done: number;
	failed: number;
	started: number;
	finished: number;
	error?: string;
};

export type AdminFailure = {
	stage: string;
	pattern: string;
	reason: string;
	path: string;
	content_hash: string;
	at: number;
};

export type AdminTenantStatus = {
	id: string;
	name: string;
	facts: number;
	compaction: string;
	footprint: AdminFootprint;
	screens: {
		verdicts: Record<string, number>;
		scored_content: number;
		score_rows: number;
		rejections: { stage: string; pattern: string; count: number; last: number }[] | null;
		total_rejections: number;
	};
	failures: AdminFailure[];
	rescore: AdminRescore;
	error?: string;
};

export type AdminStatus = {
	version: string;
	scoring: { scorer: boolean; checks: boolean; rescorable: boolean };
	volume?: { total_bytes: number; free_bytes: number };
	tenants: AdminTenantStatus[];
};

export async function fetchAdminStatus(signal?: AbortSignal): Promise<AdminStatus> {
	return apiGet('admin/status', undefined, signal);
}

/** Starts a background rescore of a tenant's unscored content. Resolves with the job's initial state. */
export async function startRescore(tenant: string, signal?: AbortSignal): Promise<AdminRescore> {
	return apiPost('admin/rescore', { tenant }, signal);
}

export async function revokeToken(id: string, signal?: AbortSignal): Promise<void> {
	await apiPost(`tokens/${id}/revoke`, {}, signal);
}

/** Session identity and owned tenants (`GET /v1/me`). Collector mode only; same transport as `apiGet`. */
export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
	return apiGet<MeResponse>('me', undefined, signal);
}

function rawRedirectHost(raw: string): string | null {
	if (/[\u0000-\u0020\u007f\\]/.test(raw)) return null;
	const m = /^(https?):\/\/([^/?#]*)/i.exec(raw);
	if (!m) return null;
	const authority = m[2];
	if (authority.includes('@') || authority.includes('\\')) return null;
	if (authority.startsWith('[')) {
		const end = authority.indexOf(']');
		if (end < 0) return null;
		const rest = authority.slice(end + 1);
		if (rest !== '' && !/^:\d+$/.test(rest)) return null;
		return authority.slice(0, end + 1);
	}
	const colon = authority.lastIndexOf(':');
	if (colon !== -1) {
		if (!/^\d+$/.test(authority.slice(colon + 1))) return null;
		return authority.slice(0, colon);
	}
	return authority;
}

function isLoopbackHostname(host: string): boolean {
	const h = host.toLowerCase();
	if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (!m) return false;
	const parts = m.slice(1).map(Number);
	return parts[0] === 127 && parts.every((n) => n <= 255);
}

/**
 * Loopback http(s) redirect URIs for device authorization.
 * The raw host must already be a loopback name: values that only become loopback
 * after URL normalization (decimal IPs, unicode digits, userinfo) are rejected,
 * and that raw value is what the authorize form posts.
 */
export function isValidLoopbackRedirectUri(raw: string): boolean {
	if (!raw) return false;
	const hostRaw = rawRedirectHost(raw);
	if (hostRaw === null) return false;
	try {
		const u = new URL(raw);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
		if (u.username || u.password) return false;
		if (hostRaw.toLowerCase() !== u.hostname.toLowerCase()) return false;
		return isLoopbackHostname(u.hostname);
	} catch {
		return false;
	}
}

export type DeviceDecision = { approved: true } | { denied: true };

/** Approve a device user code (`POST /v1/device/authorize`, session cookie). */
export async function approveDevice(
	body: { user_code: string; tenant: string; scope: string; lifetime: TokenLifetime; name?: string },
	signal?: AbortSignal
): Promise<DeviceDecision> {
	return apiPost('device/authorize', body, signal);
}

/** Deny a device user code. */
export async function denyDevice(userCode: string, signal?: AbortSignal): Promise<DeviceDecision> {
	return apiPost('device/authorize', { user_code: userCode, action: 'deny' }, signal);
}

/** The host name the device reported for a pending user code (`GET /v1/device/grant`), "" if none. */
export async function fetchDeviceGrant(userCode: string, signal?: AbortSignal): Promise<{ host: string }> {
	return apiGet('device/grant', new URLSearchParams({ user_code: userCode }), signal);
}
