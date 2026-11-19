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
