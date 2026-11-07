export const API_ORIGIN = 'https://api.yakka.build';
const storage = key => { try { return (localStorage.getItem(key) || '').trim(); } catch { return ''; } };
const isPages = () => ['yakka.build', 'www.yakka.build'].includes(location.hostname);
export function resolvedBase() { return storage('yakka-analytics-base').replace(/\/+$/, '') || (isPages() ? API_ORIGIN : ''); }
export function isCollectorMode() {
  const base = storage('yakka-analytics-base');
  if (!base || isPages()) return true;
  try { return new URL(base).origin === API_ORIGIN; } catch { return false; }
}
function sessionRoute(path) {
  const route = path.replace(/^\/?v1\//, '').split('?')[0];
  return route === 'me' || route.startsWith('device/') || route.startsWith('tenants') || route.startsWith('tokens') || route.startsWith('admin/');
}
export function authInit(path) {
  const collector = isCollectorMode();
  const session = collector && sessionRoute(path);
  const key = storage('yakka-analytics-key');
  const headers = new Headers();
  if (!session && key && resolvedBase()) headers.set('Authorization', `Bearer ${key}`);
  return { headers, credentials: session || !key || !resolvedBase() ? 'include' : 'omit' };
}
export function createTransport(scheduler, { fetchImpl = fetch } = {}) {
  const schemas = new Map();
  async function get(path, params = new URLSearchParams(), { tenant = '', stateKey = '', signal } = {}) {
    const query = new URLSearchParams(params);
    if (isCollectorMode() && tenant) query.set('tenant', tenant);
    if (path !== 'schema' && !query.has('tz')) query.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const suffix = query.size ? `?${query}` : '';
    const base = resolvedBase();
    const url = `${base}/v1/analytics/${path}${suffix}`;
    const auth = authInit(`analytics/${path}`);
    if (signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      signal.addEventListener('abort', () => scheduler.supersede(stateKey), { once: true });
    }
    let response = await scheduler.request(url, { ...auth, signal }, stateKey);
    const retryAfter = response.headers.get('Retry-After');
    const retryDelay = retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now())) : 0;
    if (response.status === 503 && retryAfter && (await response.clone().json().catch(() => ({}))).code === 'busy') {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, retryDelay);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      response = await scheduler.request(url, { ...auth, signal }, stateKey);
    }
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }
  return {
    get,
    async schema(tenant = '') {
      if (!schemas.has(tenant)) schemas.set(tenant, get('schema', new URLSearchParams(), { tenant }).then(({ response, body }) => ({ response, body })));
      return schemas.get(tenant);
    }
  };
}
