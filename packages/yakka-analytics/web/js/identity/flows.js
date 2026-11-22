import { oauthCallbackTarget, oauthLoginPath, safeReturnPath } from '../../contract/return-path.js';
import { renderAccountConsole } from './account-console.js';

const node = (tag, text, attrs = {}) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; for (const [k, v] of Object.entries(attrs)) { if (k === 'className') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== undefined) el.setAttribute(k, v); } return el; };
const field = (form, label, name, value = '', type = 'text', attrs = {}) => { const wrap = node('label', `${label} `); const input = node('input', undefined, { name, type, value, autocomplete: 'off', ...attrs }); wrap.append(input); form.append(wrap); return input; };
function status(root, text, error = false) { let out = root.querySelector('[data-identity-status]'); if (!out) { out = node('p', undefined, { 'data-identity-status': '', className: 'account-status', role: 'status' }); root.append(out); } out.textContent = text; out.classList.toggle('error', error); }
const accountNote = root => root.append(node('p', 'Account controls use the selected tenant. Time, repository and kind filters apply on analytics pages.', { className: 'account-context' }));
async function call(api, path, options) { const { response, body } = await api.request(path, options); if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`); return body; }
const lifetimeOptions = [['1d','1 day'],['1w','1 week'],['1m','1 month'],['3m','3 months'],['6m','6 months'],['1y','1 year']];
export const normalizeUserCode = value => String(value || '').trim().toUpperCase();
export function deviceApprovalPayload({ user_code, tenant, scope, lifetime, name }) {
  const body = { user_code: normalizeUserCode(user_code), tenant, scope, lifetime };
  if (name?.trim()) body.name = name.trim();
  return body;
}
export const deviceDenialPayload = userCode => ({ user_code: normalizeUserCode(userCode), action: 'deny' });

function storageGet(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
// response.url is always absolute; the request URL is relative when no API base
// is configured (same-origin collector). Compare them in one absolute space so a
// successful callback is not mistaken for an unexpected redirect.
const absoluteUrl = value => { try { return new URL(value, globalThis.location.href).href; } catch { return String(value || ''); } };
function isHttpUrl(value) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }

export async function renderIdentity(root, path, api, me, isCurrent = () => true, account = null) {
  if (path === '/login') return login(root);
  if (path === '/oauth/callback') return callback(root, api, isCurrent);
  if (path === '/settings') return settings(root, api);
  if (path === '/device') return device(root, api, me, account);
  if (path === '/profile') return profile(root, account || { api, me });
}
function login(root) {
  accountNote(root);
  const section = node('section', undefined, { className: 'account-section account-connection' });
  section.append(node('p', 'Sign in to your Yakka account to continue.'));
  const ret = safeReturnPath(new URLSearchParams(location.search).get('return')) || '/';
  section.append(node('a', 'Continue with GitHub', { href: oauthLoginPath(ret), 'data-testid': 'identity-login' }));
  root.append(section);
  const error = new URLSearchParams(location.search).get('error'); if (error) status(section, error, true);
}
async function callback(root, api, isCurrent = () => true) {
  accountNote(root);
  const section = node('section', undefined, { className: 'account-section account-connection' });
  root.append(section);
  status(section, 'Completing sign in…');
  try {
    const { response, body, requestUrl } = await api.callback(new URLSearchParams(location.search));
    if (!isCurrent()) return;
    if (response.redirected || (response.url && absoluteUrl(response.url) !== absoluteUrl(requestUrl)) || response.type === 'opaqueredirect') throw new Error('The sign-in callback redirected unexpectedly.');
    const target = oauthCallbackTarget(body);
    if (!response.ok || !target) throw new Error('Sign in failed. Please try again.');
    location.assign(target);
  } catch {
    if (!isCurrent()) return;
    status(section, 'Sign in failed. Please try again.', true);
    if (!section.querySelector('[data-testid="identity-retry"]')) {
      const ret = safeReturnPath(new URLSearchParams(location.search).get('return'));
      section.append(node('a', 'Try sign in again', { href: ret ? `/login?return=${encodeURIComponent(ret)}` : '/login', 'data-testid': 'identity-retry' }));
    }
  }
}
function settings(root, api) {
  accountNote(root);
  const section = node('section', undefined, { className: 'account-section account-connection' });
  section.append(node('h2', 'Connection'));
  const form = node('form', undefined, { className: 'account-form-column', method: 'post', autocomplete: 'off' });
  const base = field(form, 'API base URL', 'base', storageGet('yakka-analytics-base'));
  base.dataset.testid = 'settings-base';
  const key = field(form, 'Bearer token', 'key', '', 'password');
  key.dataset.testid = 'settings-key';
  const actions = node('div', undefined, { className: 'account-form-actions' });
  const save = node('button', 'Save settings', { type: 'submit', 'data-testid': 'settings-save' });
  const clear = node('button', 'Clear settings', { type: 'button', 'data-testid': 'settings-clear' });
  const signout = node('button', 'Sign out', { type: 'button', 'data-testid': 'settings-signout' });
  actions.append(save, clear, signout);
  form.append(actions);
  section.append(form);
  root.append(section);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const nextBase = base.value.trim().replace(/\/+$/, '');
    if (nextBase && !isHttpUrl(nextBase)) { status(section, 'Enter an absolute http(s) API base URL.', true); return; }
    try {
      localStorage.setItem('yakka-analytics-base', nextBase);
      const nextKey = key.value.trim();
      if (nextKey) localStorage.setItem('yakka-analytics-key', nextKey);
      location.reload();
    } catch { status(section, 'Browser storage is unavailable.', true); }
  });
  clear.addEventListener('click', () => {
    try {
      localStorage.removeItem('yakka-analytics-base');
      localStorage.removeItem('yakka-analytics-key');
      location.reload();
    } catch { status(section, 'Browser storage is unavailable.', true); }
  });
  signout.addEventListener('click', async () => {
    if (signout.disabled) return;
    signout.disabled = true;
    try {
      const response = await api.logout();
      if (!response.ok && response.status !== 204) throw new Error('Sign out failed.');
      location.assign('/login');
    } catch {
      signout.disabled = false;
      status(section, 'Sign out failed.', true);
    }
  });
}

async function device(root, api, me, account = null) {
  accountNote(root);
  if (!me && ['localhost', '127.0.0.1', '::1'].includes(location.hostname) && !storageGet('yakka-analytics-base')) {
    status(root, 'Device approval is available through the hosted collector. Configure the API connection in Settings to continue.');
    root.append(node('a', 'Open Settings', { href: '/settings' }));
    return;
  }
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  const tenant = account?.tenant || '';
  let code = normalizeUserCode(new URLSearchParams(location.search).get('user_code'));
  const section = node('section', undefined, { className: 'account-section account-connection' });
  section.append(node('h2', 'Check this code matches your terminal'));
  const entry = node('form', undefined, { className: 'account-form-column' });
  const codeInput = field(entry, 'User code', 'user_code', code);
  codeInput.dataset.testid = 'device-user-code';
  entry.append(node('button', 'Continue', { type: 'submit', 'data-testid': 'device-code-submit' }));
  section.append(entry);
  const hostLine = node('p', '', { className: 'account-note' });
  section.append(hostLine);
  const form = node('form', undefined, { className: 'account-form-column', 'data-testid': 'device-authorize-form' });
  form.hidden = !code;
  section.append(form);
  root.append(section);
  const query = () => { const next = normalizeUserCode(codeInput.value); codeInput.value = next; const safe = `/device?user_code=${encodeURIComponent(next)}`; history.replaceState(null, '', safe); return next; };
  const load = async () => {
    code = query(); if (!code) { form.hidden = true; return; }
    try { const params = new URLSearchParams({ user_code: code }); const grant = await call(api, `device/grant?${params}`); hostLine.textContent = grant.host ? `Request from ${grant.host}` : 'Check the code in your terminal.'; }
    catch (e) { status(section, e.message, true); }
    form.hidden = false;
    updateReady();
  };
  entry.addEventListener('submit', e => { e.preventDefault(); load(); });
  const scope = node('select', undefined, { name: 'scope', 'data-testid': 'device-grant' });
  scope.append(node('option', 'Choose access', { value: '' }));
  for (const [value, label] of [['read', 'Read'], ['read_write', 'Read and write']]) scope.append(node('option', label, { value }));
  const scopeLabel = node('label', 'Scope '); scopeLabel.append(scope); form.append(scopeLabel);
  const lifetime = node('select', undefined, { name: 'lifetime', 'data-testid': 'device-lifetime' });
  for (const [value, label] of lifetimeOptions) lifetime.append(node('option', label, { value }));
  lifetime.value = '3m';
  const lifeLabel = node('label', 'Lifetime '); lifeLabel.append(lifetime); form.append(lifeLabel);
  const name = field(form, 'Token name', 'name');
  name.dataset.testid = 'device-token-name';
  const actions = node('div', undefined, { className: 'account-form-actions' });
  const approve = node('button', 'Approve', { type: 'submit', 'data-testid': 'device-submit' });
  const deny = node('button', 'Deny', { type: 'button', 'data-testid': 'device-deny' });
  actions.append(approve, deny);
  form.append(actions);
  const updateReady = () => { approve.disabled = !code || !scope.value || !tenant; deny.disabled = !code; };
  scope.addEventListener('change', updateReady);
  deny.addEventListener('click', () => authorize(deviceDenialPayload(code)));
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (approve.disabled) return;
    authorize(deviceApprovalPayload({ user_code: code, tenant, scope: scope.value, lifetime: lifetime.value, name: name.value }));
  });
  async function authorize(body) {
    approve.disabled = true; deny.disabled = true;
    try {
      await call(api, 'device/authorize', { method: 'POST', body });
      status(section, body.action ? 'Device denied.' : 'Device approved.');
    } catch (e) {
      status(section, e.message, true);
      updateReady();
    }
  }
  updateReady();
  if (code) await load();
  if (!me) section.append(node('a', 'Sign in to approve this request', { href: oauthLoginPath(`${location.pathname}${location.search}`) }));
  else if (!tenant) section.append(node('a', tenants.length ? 'Choose a tenant in Profile' : 'Create a tenant in Profile', { href: '/profile' }));
}

async function profile(root, account) {
  return renderAccountConsole(root, account);
}
