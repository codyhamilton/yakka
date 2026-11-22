import { safeReturnPath } from './return-path.js';

const storage = key => { try { return (localStorage.getItem(key) || '').trim(); } catch { return ''; } };
const exempt = new Set(['/login', '/oauth/callback', '/settings']);
export function sessionGateDecision({ path, search = '', hostname = location.hostname, base = storage('yakka-analytics-base'), meStatus }) {
  if (exempt.has(path)) return { stay: true };
  if (['localhost', '127.0.0.1', '::1'].includes(hostname) && !base) return { stay: true };
  if (meStatus === 200) return { stay: true };
  if (meStatus === 401) {
    if (storage('yakka-analytics-key') && base) return { stay: true };
    const ret = safeReturnPath(`${path}${search}`) || '/';
    return { stay: false, redirect: `/login?return=${encodeURIComponent(ret)}` };
  }
  return { stay: true, hint: 'The server could not confirm your session. Check the connection in Settings.' };
}

export function shouldRecoverTenant({ status, error, me, path }) {
  return status === 403 && error === 'no such tenant' && Array.isArray(me?.tenants) && me.tenants.length === 0 && path !== '/profile';
}

export function rememberedTenant(me) {
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  let remembered = ''; try { remembered = localStorage.getItem('yakka-analytics-tenant') || ''; } catch {}
  return tenants.some(t => t.id === remembered) ? remembered : (tenants[0]?.id || '');
}

export function formTenant(me) {
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  let remembered = ''; try { remembered = localStorage.getItem('yakka-analytics-tenant') || ''; } catch {}
  if (tenants.some(t => t.id === remembered)) return remembered;
  return tenants.length === 1 ? tenants[0].id : '';
}

function lifecycle(tenant) {
  return String(tenant?.lifecycle_state || tenant?.state || 'active');
}

// Only these two states are mid-cleanup: the server answers tenant_busy for them.
// Every other value, including a missing marker (unmarked, unsupported, unknown),
// is selectable. Policy: Plan 31, 22 Nov 2026.
const CLEANUP_STATES = new Set(['resetting', 'deleting']);

export function tenantCleanupState(tenant) {
  const state = lifecycle(tenant);
  return CLEANUP_STATES.has(state) ? state : '';
}

export function tenantSelectable(tenant) {
  return Boolean(tenant && tenant.id) && !tenantCleanupState(tenant);
}

export function selectableTenants(me) {
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  return tenants.filter(tenantSelectable);
}

// S1 collector precedence: a URL tenant found in /me.tenants wins, then a valid remembered tenant, then the first selectable owned tenant. A supplied tenant that is foreign or mid-cleanup stops reads instead of falling back. A tenant with no lifecycle marker is selectable.
export function authorizedTenant({ me, urlTenant = '' } = {}) {
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  if (!tenants.length) return { tenant: '', unavailable: false, source: 'none' };
  let remembered = ''; try { remembered = (localStorage.getItem('yakka-analytics-tenant') || '').trim(); } catch {}
  if (urlTenant) {
    const found = tenants.find(tenant => tenant.id === urlTenant);
    if (found && tenantSelectable(found)) return { tenant: found.id, unavailable: false, source: 'url' };
    return found ? { tenant: '', unavailable: true, source: 'url', reason: 'cleanup' } : { tenant: '', unavailable: true, source: 'url' };
  }
  const validRemembered = tenants.find(tenant => tenant.id === remembered && tenantSelectable(tenant));
  if (validRemembered) return { tenant: validRemembered.id, unavailable: false, source: 'remembered' };
  const first = tenants.find(tenantSelectable);
  if (first) return { tenant: first.id, unavailable: false, source: 'first' };
  return { tenant: '', unavailable: false, source: 'none' };
}

export function tenantOptionLabel(tenant) {
  const name = String(tenant?.name || tenant?.id || '');
  const id = String(tenant?.id || '');
  return id ? `${name} · ${id}` : name;
}
