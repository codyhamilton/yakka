import { readRememberedTenant, rememberTenant, type MeFetchResult } from './session-gate';

/** Layout gate state for this document load (mutate fields; do not reassign the object). */
export const sessionGate = $state({
	ready: false,
	me: null as MeFetchResult | null,
	/** Tenant ID the viewer picked; empty means the first tenant. Resolved against `me` by `tenantIdFromMe`. */
	tenant: ''
});

export function beginSessionGate(): void {
	sessionGate.ready = false;
	sessionGate.me = null;
}

export function finishSessionGate(me: MeFetchResult): void {
	sessionGate.me = me;
	sessionGate.tenant = readRememberedTenant();
	sessionGate.ready = true;
}

export function chooseTenant(id: string): void {
	sessionGate.tenant = id;
	rememberTenant(id);
}
