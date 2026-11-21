import { oauthLoginPath } from '../../contract/return-path.js';
import { resolvedBase } from '../../contract/transport.js';

const node = (tag, text, attrs = {}) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== undefined) el.setAttribute(key, value);
  }
  return el;
};

const SCOPE_LABELS = { read: 'Read', read_write: 'Read and write' };
const LIFETIMES = [['1d', '1 day'], ['1w', '1 week'], ['1m', '1 month'], ['3m', '3 months'], ['6m', '6 months'], ['1y', '1 year']];
const MONTHS = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const stateLabel = value => {
  const text = String(value || '');
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : '—';
};
const scopeLabel = value => SCOPE_LABELS[value] || String(value || '—');
const formatDate = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? MONTHS.format(new Date(time)) : '—';
};

export function tokensForTenant(tokens, tenantId) {
  const list = Array.isArray(tokens) ? tokens : [];
  return list.filter(token => token && token.tenant === tenantId);
}

export function tokenState(token, now = Date.now()) {
  if (token?.revoked) return 'Revoked';
  const expires = Date.parse(token?.expires_at || '');
  if (Number.isFinite(expires) && expires <= now) return 'Expired';
  return 'Active';
}

export function sortTokens(tokens) {
  const list = Array.isArray(tokens) ? [...tokens] : [];
  return list.sort((a, b) => {
    const left = Date.parse(a?.created_at || '');
    const right = Date.parse(b?.created_at || '');
    if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

const tenantState = tenant => String(tenant?.lifecycle_state || tenant?.state || 'active');
const activeTenant = tenant => Boolean(tenant && tenant.id && tenantState(tenant) === 'active');

function table(caption, widths, className) {
  const el = node('table', undefined, { className: `account-table ${className}` });
  const cap = node('caption', caption, { className: 'account-sr-only' });
  el.append(cap);
  const row = node('tr');
  for (const [index, label] of widths.entries()) {
    const th = node('th', label, { scope: 'col', className: `account-col-${index + 1}` });
    row.append(th);
  }
  const head = node('thead');
  head.append(row);
  el.append(head);
  el.append(node('tbody'));
  return el;
}

const tbody = el => el.querySelector('tbody');

function statusRow(tableEl, columns, text, className = 'account-status-cell') {
  const body = tbody(tableEl);
  const row = node('tr');
  const cell = node('td', text, { colspan: String(columns), className });
  row.append(cell);
  body.append(row);
  return row;
}

function actionButton(label, attrs = {}) {
  return node('button', label, { type: 'button', ...attrs });
}

export function renderAccountConsole(root, context = {}) {
  const view = node('div', undefined, { className: 'account-console', 'data-account-console': '' });
  root.append(view);
  paint(view, context);
  return view;
}

function paint(view, context) {
  view.replaceChildren();
  const { me, meStatus } = context;
  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  view.append(node('p', 'Account controls use the selected tenant. Time, repository and kind filters apply on analytics pages.', { className: 'account-context' }));

  const identity = node('div', undefined, { className: 'account-identity', 'data-account-identity': '' });
  identity.append(node('p', me?.github_login ? `Signed in as ${me.github_login}` : 'Profile and access tokens'));
  if (meStatus === 200 && me) {
    const refresh = actionButton('Refresh account', { 'data-testid': 'account-refresh' });
    refresh.addEventListener('click', async () => {
      if (refresh.disabled) return;
      refresh.disabled = true;
      try {
        const fresh = await context.onRefreshMe?.();
        if (context.onStatus) context.onStatus('');
        paint(view, { ...context, me: fresh, meStatus: fresh ? 200 : 0 });
      } catch {
        if (context.onStatus) context.onStatus('Could not refresh account.', true);
        refresh.disabled = false;
      }
    });
    identity.append(refresh);
  }
  view.append(identity);

  if (!me || meStatus !== 200) {
    view.append(renderTenants(view, context, null));
    view.append(renderTokens(view, context, null));
    return;
  }
  view.append(renderTenants(view, context, me));
  view.append(renderTokens(view, context, me));
}

function renderTenants(view, context, me) {
  const section = node('section', undefined, { className: 'account-section', id: 'tenants', 'data-account': 'tenants' });
  section.append(node('span', undefined, { id: 'membership', className: 'account-anchor', 'aria-hidden': 'true' }));
  section.append(node('h2', 'Tenants & membership'));
  section.append(node('p', 'Memberships below are tenants you own.', { className: 'account-note' }));

  const form = node('form', undefined, { className: 'account-form account-tenant-form' });
  const label = node('label', 'New tenant ');
  const input = node('input', undefined, { name: 'name', type: 'text', maxlength: '64', autocomplete: 'off', 'data-testid': 'new-tenant-name' });
  label.append(input);
  form.append(label);
  const submit = node('button', 'Create tenant', { type: 'submit', 'data-testid': 'create-tenant' });
  form.append(submit);
  section.append(form);

  const status = node('p', undefined, { className: 'account-status', 'data-tenant-status': '', role: 'status' });
  section.append(status);
  const setStatus = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  const wrap = node('div', undefined, { className: 'account-table-wrap' });
  const grid = table('Tenants & membership', ['Name', 'Immutable ID', 'Your access', 'Lifecycle state', 'Generation', 'Actions'], 'account-tenants-table');
  wrap.append(grid);
  section.append(wrap);

  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  let selected = context.tenant || '';
  const paintRows = list => {
    const body = tbody(grid);
    body.replaceChildren();
    if (!list.length) {
      statusRow(grid, 6, 'You do not own any tenants yet.');
      return;
    }
    for (const tenant of list) {
      const row = node('tr', undefined, { tabindex: '-1', dataset: { accountTenantRow: String(tenant.id) } });
      const state = tenantState(tenant);
      row.append(node('td', String(tenant.name || '')));
      row.append(node('td', String(tenant.id || ''), { title: String(tenant.id || '') }));
      row.append(node('td', 'Owner'));
      row.append(node('td', stateLabel(state), { className: `account-state account-state-${state}` }));
      row.append(node('td', tenant.lifecycle_generation === undefined || tenant.lifecycle_generation === null ? '—' : String(tenant.lifecycle_generation)));
      const actions = node('td', undefined, { className: 'account-actions' });
      const use = actionButton('Use tenant', { 'data-testid': `use-tenant-${tenant.id}` });
      use.addEventListener('click', () => { selected = tenant.id; context.onSelectTenant?.(tenant.id); });
      actions.append(use, ' ');
      const href = `${resolvedBase()}/profile/lifecycle?tenant=${encodeURIComponent(tenant.id)}`;
      actions.append(node('a', 'Reset or delete… (API owner page)', { href, className: 'account-lifecycle-link', 'data-testid': `lifecycle-link-${tenant.id}` }));
      row.append(actions);
      body.append(row);
    }
  };

  const load = async () => {
    const body = tbody(grid);
    body.replaceChildren();
    statusRow(grid, 6, 'Loading tenants…');
    try {
      const { response, body: fresh } = await context.api.request('me');
      if (!response.ok || !fresh || !Array.isArray(fresh.tenants)) throw new Error('tenants');
      context.onStatus?.('');
      paint(view, { ...context, me: fresh, meStatus: 200 });
    } catch {
      const body2 = tbody(grid);
      body2.replaceChildren();
      const row = statusRow(grid, 6, 'Could not load tenants.');
      const retry = actionButton('Retry account', { 'data-testid': 'retry-account' });
      retry.addEventListener('click', load);
      row.firstChild.append(' ', retry);
    }
  };

  if (!me) {
    const body = tbody(grid);
    body.replaceChildren();
    const row = statusRow(grid, 6, 'Could not load tenants.');
    const retry = actionButton('Retry account', { 'data-testid': 'retry-account' });
    retry.addEventListener('click', load);
    row.firstChild.append(' ', retry);
    const links = node('p', undefined, { className: 'account-links' });
    const signIn = node('a', 'Sign in to manage account', { href: oauthLoginPath('/profile') });
    const settings = node('a', 'Connection settings', { href: '/settings' });
    links.append(signIn, ' · ', settings);
    section.append(links);
  } else {
    paintRows(tenants);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const name = input.value.trim();
    if (!name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name)) {
      setStatus('Use 1–64 characters with no control characters.', true);
      return;
    }
    setStatus('');
    submit.disabled = true;
    input.disabled = true;
    try {
      const { response, body } = await context.api.request('tenants', { method: 'POST', body: { name } });
      if (response.status === 409) {
        setStatus('You already have a tenant with this name.', true);
        return;
      }
      if (!response.ok || !body || !body.id) throw new Error('create tenant');
      const fresh = await context.onRefreshMe?.();
      if (context.onSelectTenant) context.onSelectTenant(body.id);
      else if (fresh) paint(view, { ...context, me: fresh, meStatus: 200, tenant: body.id });
      else paintRows([...tenants, body]);
    } catch {
      setStatus('Could not create tenant.', true);
    } finally {
      submit.disabled = false;
      input.disabled = false;
    }
  });

  return section;
}

function renderTokens(view, context, me) {
  const section = node('section', undefined, { className: 'account-section', id: 'tokens', 'data-account': 'tokens' });
  section.append(node('h2', 'Tokens — selected tenant'));
  section.append(node('p', 'A newly issued token appears once; existing token secrets are never listed.', { className: 'account-note' }));

  const tenants = Array.isArray(me?.tenants) ? me.tenants : [];
  const selectedTenant = tenants.find(tenant => tenant.id === context.tenant && activeTenant(tenant)) || null;
  const tenantLine = node('p', undefined, { className: 'account-token-tenant', 'data-token-tenant': '' });
  if (selectedTenant) tenantLine.textContent = `Selected tenant: ${selectedTenant.name} · ${selectedTenant.id}`;
  else tenantLine.textContent = 'Create a tenant to issue a token.';
  section.append(tenantLine);

  const form = node('form', undefined, { className: 'account-form account-token-form' });
  const nameLabel = node('label', 'Token name ');
  const name = node('input', undefined, { name: 'name', type: 'text', value: 'token', autocomplete: 'off', 'data-testid': 'token-name' });
  nameLabel.append(name);
  form.append(nameLabel);

  const scopeLabelEl = node('label', 'Scope ');
  const scope = node('select', undefined, { name: 'scope', 'data-testid': 'token-scope' });
  for (const [value, label] of [['read', 'Read'], ['read_write', 'Read and write']]) scope.append(node('option', label, { value }));
  scope.value = 'read';
  scopeLabelEl.append(scope);
  form.append(scopeLabelEl);

  const lifeLabel = node('label', 'Lifetime ');
  const lifetime = node('select', undefined, { name: 'lifetime', 'data-testid': 'token-lifetime' });
  for (const [value, label] of LIFETIMES) lifetime.append(node('option', label, { value }));
  lifetime.value = '3m';
  lifeLabel.append(lifetime);
  form.append(lifeLabel);

  const submit = node('button', 'Create token', { type: 'submit', 'data-testid': 'create-token' });
  submit.disabled = !selectedTenant;
  form.append(submit);
  section.append(form);

  const status = node('p', undefined, { className: 'account-status', 'data-token-status': '', role: 'status' });
  section.append(status);
  const setStatus = (text, error = false) => { status.textContent = text; status.classList.toggle('error', error); };

  const issued = node('div', undefined, { className: 'account-issued' });
  let plaintext = '';
  const clearIssued = () => {
    plaintext = '';
    issued.replaceChildren();
    issued.remove();
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!selectedTenant || submit.disabled) return;
    const trimmed = name.value.trim();
    const body = { tenant: selectedTenant.id, scope: scope.value, lifetime: lifetime.value };
    if (trimmed) body.name = trimmed;
    submit.disabled = true;
    setStatus('');
    try {
      const { response, body: minted } = await context.api.request('tokens', { method: 'POST', body });
      if (!response.ok || !minted?.token) throw new Error('create token');
      plaintext = String(minted.token);
      issued.replaceChildren();
      const label = node('label', 'New token ');
      const output = node('input', undefined, { readonly: '', type: 'text', 'data-testid': 'issued-token-once', className: 'account-token-plaintext' });
      output.value = plaintext;
      output.addEventListener('focus', () => output.select());
      label.append(output);
      issued.append(label);
      issued.append(node('p', 'Copy this token now. It will not be shown again.', { className: 'account-issued-notice' }));
      const copy = actionButton('Copy token', { 'data-testid': 'copy-token' });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(plaintext);
          setStatus('Token copied.');
        } catch {
          setStatus('Select and copy the token manually.', true);
        }
      });
      const dismiss = actionButton('Dismiss token', { 'data-testid': 'dismiss-token' });
      dismiss.addEventListener('click', clearIssued);
      issued.append(copy, ' ', dismiss);
      form.after(issued);
    } catch {
      setStatus('Could not create token.', true);
    } finally {
      submit.disabled = !selectedTenant;
    }
  });

  const wrap = node('div', undefined, { className: 'account-table-wrap' });
  const grid = table('Tokens', ['Name', 'Tenant', 'Scope', 'Created', 'Expires', 'State', 'Action'], 'account-tokens-table');
  wrap.append(grid);
  section.append(wrap);

  let inventory = [];
  const tenantName = id => tenants.find(tenant => tenant.id === id)?.name || '';
  const paintRows = () => {
    const body = tbody(grid);
    body.replaceChildren();
    const scoped = sortTokens(tokensForTenant(inventory, selectedTenant?.id || ''));
    if (!scoped.length) {
      statusRow(grid, 7, 'No tokens for this tenant.');
      return;
    }
    for (const token of scoped) {
      const state = tokenState(token);
      const row = node('tr', undefined, { dataset: { tokenRow: String(token.id) } });
      row.append(node('td', String(token.name || 'token'), { title: String(token.name || 'token') }));
      row.append(node('td', String(token.tenant_name || tenantName(token.tenant) || token.tenant || '')));
      row.append(node('td', scopeLabel(token.scope)));
      row.append(node('td', formatDate(token.created_at)));
      row.append(node('td', formatDate(token.expires_at)));
      row.append(node('td', state, { className: `account-state account-state-${state.toLowerCase()}` }));
      const actions = node('td', undefined, { className: 'account-actions' });
      if (state === 'Active') {
        const revoke = actionButton('Revoke', { 'data-testid': `revoke-${token.id}` });
        revoke.addEventListener('click', () => confirmRevoke(row, token));
        actions.append(revoke);
      } else {
        actions.append('—');
      }
      row.append(actions);
      body.append(row);
    }
  };

  const load = async () => {
    if (!selectedTenant) { inventory = []; paintRows(); return; }
    const body = tbody(grid);
    body.replaceChildren();
    statusRow(grid, 7, 'Loading tokens…');
    try {
      const { response, body: list } = await context.api.request('tokens');
      if (!response.ok || !Array.isArray(list)) throw new Error('tokens');
      inventory = list;
      paintRows();
    } catch {
      const body2 = tbody(grid);
      body2.replaceChildren();
      const row = statusRow(grid, 7, 'Could not load tokens.');
      const retry = actionButton('Retry tokens', { 'data-testid': 'retry-tokens' });
      retry.addEventListener('click', load);
      row.firstChild.append(' ', retry);
    }
  };

  const confirmRevoke = (row, token) => {
    const prior = section.querySelector('.account-confirm-row');
    if (prior) prior.remove();
    const confirm = node('tr', undefined, { className: 'account-confirm-row' });
    const cell = node('td', undefined, { colspan: '7' });
    const question = node('p', `Revoke ${String(token.name || 'token')}? Clients using it will lose access.`);
    const cancel = actionButton('Cancel', { 'data-testid': 'cancel-revoke' });
    const confirmButton = actionButton('Revoke token', { 'data-testid': 'confirm-revoke' });
    cell.append(question, cancel, ' ', confirmButton);
    confirm.append(cell);
    row.after(confirm);
    cancel.addEventListener('click', () => confirm.remove());
    const run = async () => {
      if (confirmButton.disabled) return;
      confirmButton.disabled = true;
      cancel.disabled = true;
      try {
        const { response } = await context.api.request(`tokens/${encodeURIComponent(token.id)}/revoke`, { method: 'POST', body: {} });
        if (!response.ok) throw new Error('revoke');
        confirm.remove();
        await load();
      } catch {
        cell.replaceChildren();
        cell.append(node('p', 'Could not revoke token.', { className: 'account-status error' }));
        const retry = actionButton('Retry revoke', { 'data-testid': 'retry-revoke' });
        retry.addEventListener('click', () => { confirmButton.disabled = false; run(); });
        cell.append(retry);
      }
    };
    confirmButton.addEventListener('click', run);
  };

  load();
  return section;
}
