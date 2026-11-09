import { ApiError, fetchMe, isLifecycleTracked, tenantLifecycleState, type Tenant } from './api';
import { client } from './query';
import { clearError, clearNotices } from './state.svelte';
import {
	INVALIDATED_TENANT,
	invalidateTenantSelection,
	readRememberedGeneration,
	readRememberedTenant,
	readSelectionInvalidated,
	rememberTenant,
	selectionReadBlock,
	TenantSelectionError,
	tenantsFromMe,
	validateSelection,
	clearSelectionInvalidation,
	type MeFetchResult,
	type SelectionOutcome
} from './session-gate';

/** Layout gate state for this document load (mutate fields; do not reassign the object). */
export const sessionGate = $state({
	ready: false,
	me: null as MeFetchResult | null,
	/** Tenant ID the viewer picked; empty means the first tenant. Resolved against `me` by `tenantIdFromMe`. */
	tenant: '',
	/** True after an absent/changed selection was cleared; the first-tenant fallback is suppressed. */
	invalidated: false,
	/** Set while recovery reports reset/delete still running; tenant reads stay suspended. */
	pending: '' as '' | 'resetting' | 'deleting',
	/** Human-readable re-selection / in-progress message for the profile and error panel. */
	notice: ''
});

function clearTenantData(): void {
	client.clearCache();
	clearNotices();
	clearError();
}

function applySelection(me: MeFetchResult): SelectionOutcome {
	const outcome = validateSelection({
		me,
		rememberedId: sessionGate.tenant,
		rememberedGeneration: readRememberedGeneration(),
		invalidated: sessionGate.invalidated
	});
	sessionGate.pending = '';
	sessionGate.notice = '';
	switch (outcome.kind) {
		case 'selected':
			sessionGate.invalidated = false;
			clearSelectionInvalidation();
			break;
		case 'pending':
			sessionGate.pending = outcome.state;
			sessionGate.notice = selectionReadBlock(outcome) ?? '';
			clearTenantData();
			break;
		case 'invalidate':
			invalidateTenantSelection();
			sessionGate.tenant = INVALIDATED_TENANT;
			sessionGate.invalidated = true;
			sessionGate.notice =
				outcome.reason === 'changed'
					? 'This tenant was reset. Choose a tenant again.'
					: outcome.reason === 'needs-generation'
						? 'Confirm your tenant selection again.'
						: 'Your selected tenant is no longer available. Choose a tenant again.';
			clearTenantData();
			broadcastInvalidation();
			break;
		case 'unselected':
			sessionGate.tenant = INVALIDATED_TENANT;
			sessionGate.invalidated = true;
			sessionGate.notice = 'Choose a tenant before loading analytics.';
			clearTenantData();
			break;
		case 'none':
			sessionGate.tenant = '';
			sessionGate.invalidated = false;
			clearSelectionInvalidation();
			clearTenantData();
			break;
	}
	return outcome;
}

export function beginSessionGate(): void {
	sessionGate.ready = false;
	sessionGate.me = null;
	sessionGate.tenant = '';
	sessionGate.invalidated = false;
	sessionGate.pending = '';
	sessionGate.notice = '';
}

export function finishSessionGate(me: MeFetchResult): void {
	sessionGate.me = me;
	sessionGate.invalidated = readSelectionInvalidated();
	sessionGate.tenant = sessionGate.invalidated ? INVALIDATED_TENANT : readRememberedTenant();
	if (me.kind === 'ok') applySelection(me);
	sessionGate.ready = true;
}

/** Reconcile a caller's fresh `/v1/me` result (e.g. the profile reload) with the shared gate. */
export function reconcileTenantSelection(me: MeFetchResult): SelectionOutcome | null {
	if (me.kind !== 'ok') return null;
	sessionGate.me = me;
	return applySelection(me);
}

export function chooseTenant(id: string, known?: Tenant): void {
	const tenant = known ?? tenantsFromMe(sessionGate.me).find((t) => t.id === id);
	const state = tenant ? tenantLifecycleState(tenant) : 'active';
	const generation = tenant && isLifecycleTracked(tenant) ? (tenant.lifecycle_generation ?? '') : '';
	const pending = state === 'resetting' || state === 'deleting' ? state : '';
	sessionGate.tenant = id;
	sessionGate.invalidated = false;
	sessionGate.pending = pending;
	sessionGate.notice = pending
		? (selectionReadBlock({ kind: 'pending', tenant: tenant ?? { id, name: id }, state: pending }) ?? '')
		: '';
	rememberTenant(id, generation);
}

let dirty = false;
let revalidating: Promise<SelectionOutcome | null> | null = null;

/** Mark the selection stale; the next tenant data read (or event handler) revalidates `/v1/me`. */
export function markTenantReadsDirty(): void {
	dirty = true;
}

/**
 * Revalidate `/v1/me` and reconcile the remembered id/generation. A failed read leaves the
 * dirty flag set and does not clear state: completion is unknown, so the next read retries.
 */
export async function revalidateTenantSelection(): Promise<SelectionOutcome | null> {
	if (revalidating) return revalidating;
	revalidating = (async () => {
		let me: MeFetchResult;
		try {
			me = { kind: 'ok', body: await fetchMe() };
		} catch (e) {
			me =
				e instanceof ApiError
					? { kind: 'http', status: e.status, message: e.message }
					: { kind: 'other' };
		}
		if (me.kind !== 'ok') {
			dirty = true;
			return null;
		}
		dirty = false;
		sessionGate.me = me;
		return applySelection(me);
	})();
	try {
		return await revalidating;
	} finally {
		revalidating = null;
	}
}

/** Guard installed on the API client: revalidate when dirty, then refuse blocked reads. */
export async function ensureTenantReadable(): Promise<void> {
	if (!sessionGate.ready || sessionGate.me?.kind !== 'ok') return;
	if (dirty) {
		const outcome = await revalidateTenantSelection();
		if (outcome === null) throw new TenantSelectionError('Could not confirm the tenant state. Try again.');
		const block = selectionReadBlock(outcome);
		if (block) throw new TenantSelectionError(block);
		return;
	}
	const outcome = validateSelection({
		me: sessionGate.me,
		rememberedId: sessionGate.tenant,
		rememberedGeneration: readRememberedGeneration(),
		invalidated: sessionGate.invalidated
	});
	const block = selectionReadBlock(outcome);
	if (block) throw new TenantSelectionError(block);
}

const CHANNEL = 'yakka-analytics-tenant-selection';
let channel: BroadcastChannel | null = null;

function broadcastInvalidation(): void {
	try {
		channel?.postMessage({ type: 'invalidate' });
	} catch {
		// Same-origin notification is best-effort; the other tab revalidates on focus anyway.
	}
}

/** Same-origin tabs hear about an invalidation; cross-origin Pages observes it at its next validation. */
export function startSelectionSync(): () => void {
	if (typeof BroadcastChannel === 'undefined') return () => {};
	try {
		channel = new BroadcastChannel(CHANNEL);
	} catch {
		return () => {};
	}
	const ch = channel;
	ch.onmessage = (event: MessageEvent) => {
		if (event.data?.type !== 'invalidate') return;
		invalidateTenantSelection();
		sessionGate.tenant = INVALIDATED_TENANT;
		sessionGate.invalidated = true;
		sessionGate.pending = '';
		sessionGate.notice = 'A tenant changed in another tab. Choose a tenant again.';
		dirty = true;
		clearTenantData();
	};
	return () => {
		ch.close();
		if (channel === ch) channel = null;
	};
}
