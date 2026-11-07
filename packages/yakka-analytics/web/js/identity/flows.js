import { oauthCallbackTarget, oauthLoginPath, safeReturnPath } from '../../contract/return-path.js';
import { formTenant, rememberedTenant } from '../../contract/session-gate.js';

const node = (tag, text, attrs = {}) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; for (const [k, v] of Object.entries(attrs)) { if (k === 'className') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== undefined) el.setAttribute(k, v); } return el; };
const field = (form, label, name, value = '', type = 'text') => { const wrap = node('label', `${label} `); const input = node('input', undefined, { name, type, value, autocomplete: name === 'key' ? 'off' : undefined }); wrap.append(input); form.append(wrap); return input; };
const button = (form, text, type = 'submit') => { const b = node('button', text, { type }); form.append(b); return b; };
function status(root, text, error = false) { let out = root.querySelector('[data-identity-status]'); if (!out) { out = node('p', undefined, { 'data-identity-status': '', className: 'notice' }); root.append(out); } out.textContent = text; out.classList.toggle('error', error); }
async function call(api, path, options) { const { response, body } = await api.request(path, options); if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`); return body; }
const lifetimeOptions = [['1d','1 day'],['1w','1 week'],['1m','1 month'],['3m','3 months'],['6m','6 months'],['1y','1 year']];
export const normalizeUserCode = value => String(value || '').trim().toUpperCase();
export function deviceApprovalPayload({ user_code, tenant, scope, lifetime, name }) {
  const body = { user_code: normalizeUserCode(user_code), tenant, scope, lifetime };
  if (name?.trim()) body.name = name.trim();
  return body;
}
export const deviceDenialPayload = userCode => ({ user_code: normalizeUserCode(userCode), action: 'deny' });

export async function renderIdentity(root, path, api, me) {
  if (path === '/login') return login(root);
  if (path === '/oauth/callback') return callback(root, api);
  if (path === '/settings') return settings(root, api);
  if (path === '/device') return device(root, api, me);
  if (path === '/profile') return profile(root, api, me);
}
function login(root) {
  root.append(node('p', 'Sign in to your Yakka account to continue.'));
  const ret = safeReturnPath(new URLSearchParams(location.search).get('return')) || '/';
  root.append(node('a', 'Continue with GitHub', { href: oauthLoginPath(ret), 'data-testid': 'identity-login' }));
  const error = new URLSearchParams(location.search).get('error'); if (error) status(root, error, true);
}
async function callback(root, api) {
  root.append(node('p', 'Completing sign in…'));
  try {
    const { response, body, requestUrl } = await api.callback(new URLSearchParams(location.search));
    if (response.redirected || (response.url && response.url !== requestUrl) || response.type === 'opaqueredirect') throw new Error('The sign-in callback redirected unexpectedly.');
    const target = oauthCallbackTarget(body);
    if (!response.ok || !target) throw new Error(body?.error || 'Sign in failed. Please try again.');
    location.assign(target);
  } catch (error) { status(root, error.message || 'Sign in failed. Please try again.', true); }
}
function settings(root, api) {
  const heading = node('p', 'Connection settings'); root.append(heading);
  const form = node('form'); root.append(form);
  const base = field(form, 'API base URL', 'base', localStorageSafe('yakka-analytics-base')); base.dataset.testid = 'settings-base';
  const key = field(form, 'Bearer token', 'key', localStorageSafe('yakka-analytics-key'), 'password'); key.dataset.testid = 'settings-key';
  const save = button(form, 'Save settings'); save.dataset.testid = 'settings-save';
  form.addEventListener('submit', event => { event.preventDefault(); try { localStorage.setItem('yakka-analytics-base', base.value.trim().replace(/\/+$/, '')); localStorage.setItem('yakka-analytics-key', key.value.trim()); status(root, 'Settings saved.'); } catch { status(root, 'Browser storage is unavailable.', true); } });
  const clear = node('button', 'Clear settings', { type: 'button', 'data-testid': 'settings-clear' }); root.append(clear);
  clear.addEventListener('click', () => { try { localStorage.removeItem('yakka-analytics-base'); localStorage.removeItem('yakka-analytics-key'); base.value = ''; key.value = ''; status(root, 'Settings cleared.'); } catch { status(root, 'Browser storage is unavailable.', true); } });
  const signout = node('button', 'Sign out', { type: 'button' }); root.append(signout);
  signout.addEventListener('click', async () => { try { const res = await api.logout(); if (!res.ok && res.status !== 204) throw new Error('Sign out failed.'); location.assign('/login'); } catch (e) { status(root, e.message, true); } });
}
function localStorageSafe(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }

async function device(root, api, me) {
  if (!me && ['localhost', '127.0.0.1', '::1'].includes(location.hostname) && !localStorageSafe('yakka-analytics-base')) {
    status(root, 'Device approval is available through the hosted collector. Configure the API connection in Settings to continue.');
    root.append(node('a', 'Open Settings', { href: '/settings' }));
    return;
  }
  let code = normalizeUserCode(new URLSearchParams(location.search).get('user_code'));
  root.append(node('p', 'Check this matches the code in your terminal.'));
  const entry = node('form'); root.append(entry);
  const codeInput = field(entry, 'User code', 'user_code', code); codeInput.dataset.testid = 'device-user-code';
  const continueButton = button(entry, 'Continue'); continueButton.dataset.testid = 'device-code-submit';
  const form = node('form'); form.hidden = !code; form.dataset.testid = 'device-authorize-form'; root.append(form);
  const hostLine = node('p', ''); root.append(hostLine);
  const query = () => { const next = normalizeUserCode(codeInput.value); codeInput.value = next; const safe = `/device?user_code=${encodeURIComponent(next)}`; history.replaceState(null, '', safe); return next; };
  const load = async () => {
    code = query(); if (!code) { form.hidden = true; return; }
    try { const params = new URLSearchParams({ user_code: code }); const grant = await call(api, `device/grant?${params}`); hostLine.textContent = grant.host ? `Request from ${grant.host}` : 'Check the code in your terminal.'; }
    catch (e) { status(root, e.message, true); }
    form.hidden = false;
  };
  entry.addEventListener('submit', e => { e.preventDefault(); load(); });
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  let tenantSelect;
  if (tenants.length > 1) { tenantSelect = node('select'); tenantSelect.dataset.testid = 'device-tenant'; tenantSelect.append(node('option', 'Select tenant', { value: '' })); for (const t of tenants) tenantSelect.append(node('option', t.name, { value: t.id })); tenantSelect.value = formTenant(me); const label = node('label', 'Tenant '); label.append(tenantSelect); form.append(label); }
  const scope = node('select'); scope.dataset.testid = 'device-grant'; scope.append(node('option','Choose access',{value:''})); for (const [v, label] of [['read','Read'],['read_write','Read and write']]) scope.append(node('option', label, { value: v }));
  const lifetime = node('select'); lifetime.dataset.testid = 'device-lifetime'; for (const [v,label] of lifetimeOptions) lifetime.append(node('option', label, { value: v })); lifetime.value = '3m';
  const scopeLabel = node('label', 'Access '); scopeLabel.append(scope); form.append(scopeLabel);
  const lifeLabel = node('label', 'Lifetime '); lifeLabel.append(lifetime); form.append(lifeLabel);
  const name = field(form, 'Token name (optional)', 'name'); name.dataset.testid = 'device-token-name';
  const approve = button(form, 'Approve'); approve.dataset.testid = 'device-submit';
  const deny = button(form, 'Deny', 'button'); deny.dataset.testid = 'device-deny';
  deny.addEventListener('click', () => authorize(deviceDenialPayload(code)));
  form.addEventListener('submit', e => { e.preventDefault(); const tenant = form.querySelector('[data-testid="device-tenant"]')?.value || tenants[0]?.id || ''; authorize(deviceApprovalPayload({ user_code: code, tenant, scope: scope.value, lifetime: lifetime.value, name: name.value })); });
  const updateReady = () => { approve.disabled = !code || !scope.value || tenants.length === 0 || (tenants.length > 1 && !tenantSelect.value); };
  scope.addEventListener('change', updateReady); tenantSelect?.addEventListener('change', () => { try { if (tenantSelect.value) localStorage.setItem('yakka-analytics-tenant', tenantSelect.value); } catch {} updateReady(); }); updateReady();
  async function authorize(body) { try { await call(api, 'device/authorize', { method: 'POST', body }); status(root, body.action ? 'Denied.' : 'Approved.'); approve.disabled = true; deny.disabled = true; } catch(e) { status(root, e.message, true); } }
  if (code) await load();
  if (!me) root.append(node('a', 'Sign in to approve this request', { href: oauthLoginPath(`${location.pathname}${location.search}`) }));
  else if (!tenants.length) root.append(node('a', 'Create a tenant in Profile', { href: '/profile' }));
}

async function profile(root, api, me) {
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  root.append(node('p', me?.github_login ? `Signed in as ${me.github_login}` : 'Profile and access tokens'));
  if (tenants.length > 1) {
    const active = node('select'); for (const t of tenants) active.append(node('option', t.name, { value: t.id })); active.value = rememberedTenant(me);
    const label = node('label', 'Active tenant '); label.append(active); root.append(label);
    active.addEventListener('change', () => { try { localStorage.setItem('yakka-analytics-tenant', active.value); } catch { status(root, 'Browser storage is unavailable.', true); } });
  }
  const tenantForm = node('form'); root.append(tenantForm); field(tenantForm, 'New tenant', 'name'); button(tenantForm, 'Create tenant');
  tenantForm.addEventListener('submit', async e => { e.preventDefault(); try { const name = tenantForm.elements.name.value; const created = await call(api, 'tenants', { method: 'POST', body: { name } }); status(root, `Created ${created.name}.`); location.reload(); } catch(err) { status(root, err.message, true); } });
  if (tenants.length) {
    const tokenForm = node('form'); root.append(tokenForm);
    const tenant = node('select'); for (const t of tenants) tenant.append(node('option', t.name, { value: t.id })); tenant.value = formTenant(me); tenant.addEventListener('change', () => { try { localStorage.setItem('yakka-analytics-tenant', tenant.value); } catch {} });
    const label = node('label', 'Tenant '); label.append(tenant); tokenForm.append(label);
    const scope = node('select'); for (const [v,l] of [['read','Read'],['read_write','Read and write']]) scope.append(node('option',l,{value:v})); const sl = node('label','Scope '); sl.append(scope); tokenForm.append(sl);
    const life = node('select'); for (const [v,l] of lifetimeOptions) life.append(node('option',l,{value:v})); life.value='3m'; const ll=node('label','Lifetime ');ll.append(life);tokenForm.append(ll);
    field(tokenForm,'Token name','name','token'); button(tokenForm,'Create token');
    tokenForm.addEventListener('submit',async e=>{e.preventDefault();try{const body={tenant:tenant.value,scope:scope.value,lifetime:life.value};if(tokenForm.elements.name.value.trim())body.name=tokenForm.elements.name.value.trim();const minted=await call(api,'tokens',{method:'POST',body}); const out=node('code',minted.token); out.dataset.testid='issued-token-once'; status(root,'Copy this token now. It will not be shown again.'); root.append(out);}catch(err){status(root,err.message,true);}});
  } else root.append(node('p','Create a tenant to issue a token.'));
  try { const tokens = await call(api, 'tokens'); const list = node('ul'); for (const token of tokens) { const li = node('li', `${token.name || 'token'} · ${token.tenant_name} · ${token.scope}`); if (!token.revoked) { const revoke=node('button','Revoke',{type:'button'});revoke.addEventListener('click',async()=>{try{await call(api,`tokens/${encodeURIComponent(token.id)}/revoke`,{method:'POST',body:{}});li.textContent+=' · revoked';}catch(e){status(root,e.message,true);}});li.append(' ',revoke);} list.append(li); } root.append(node('h2','Tokens'),list); } catch(e) { status(root,e.message,true); }
}
