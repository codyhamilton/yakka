import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, oauthLoginPath, oauthCallbackTarget } from '../../web/contract/return-path.js';
import { sessionGateDecision, shouldRecoverTenant, formTenant } from '../../web/contract/session-gate.js';
import { authInit } from '../../web/contract/transport.js';
import { deviceApprovalPayload, deviceDenialPayload, normalizeUserCode } from '../../web/js/identity/flows.js';

function installStorage(values = {}) {
  globalThis.localStorage = { getItem: key => values[key] || '', setItem: (key, value) => { values[key] = value; }, removeItem: key => { delete values[key]; } };
}

test('return paths reject unsafe destinations and callback only accepts safe success', () => {
  for (const value of ['//evil.test', '/\\evil', '/bad\npath', 'https://evil.test', '/'.repeat(4097)]) assert.equal(safeReturnPath(value), null);
  assert.equal(safeReturnPath('/device?user_code=ABCD-EFGH#step'), '/device?user_code=ABCD-EFGH#step');
  assert.equal(oauthCallbackTarget({ ok: true, return: '//evil.test' }), '/');
  assert.equal(oauthCallbackTarget({ ok: false, error: 'denied' }), null);
});

test('session gate preserves auth exceptions and redirects signed-out deep links safely', () => {
  installStorage();
  globalThis.location = { hostname: 'example.test' };
  assert.deepEqual(sessionGateDecision({ path: '/settings', meStatus: 0 }), { stay: true });
  assert.equal(sessionGateDecision({ path: '/device', search: '?user_code=ABCD-EFGH', hostname: 'example.test', base: '', meStatus: 401 }).redirect, '/login?return=%2Fdevice%3Fuser_code%3DABCD-EFGH');
  installStorage({ 'yakka-analytics-key': 'fixture-key' });
  assert.deepEqual(sessionGateDecision({ path: '/ledger', hostname: 'example.test', base: 'https://api.example', meStatus: 401 }), { stay: true });
  assert.match(sessionGateDecision({ path: '/ledger', hostname: 'example.test', base: '', meStatus: 0 }).hint, /Settings/);
});

test('tenant recovery and form defaults follow the empty, remembered and sole-tenant rules', () => {
  installStorage({ 'yakka-analytics-tenant': 'b' });
  assert.equal(shouldRecoverTenant({ status: 403, error: 'no such tenant', me: { tenants: [] }, path: '/' }), true);
  assert.equal(shouldRecoverTenant({ status: 403, error: 'no such tenant', me: { tenants: [{ id: 'a' }] }, path: '/' }), false);
  assert.equal(formTenant({ tenants: [{ id: 'a' }, { id: 'b' }] }), 'b');
  assert.equal(formTenant({ tenants: [{ id: 'a' }, { id: 'b' }] }), 'b');
  installStorage();
  assert.equal(formTenant({ tenants: [{ id: 'a' }, { id: 'b' }] }), '');
  assert.equal(formTenant({ tenants: [{ id: 'only' }] }), 'only');
});

test('Pages OAuth login uses the API origin and encodes a safe return path', () => {
  globalThis.location = { hostname: 'yakka.build' };
  assert.equal(oauthLoginPath('/profile'), 'https://api.yakka.build/oauth/login?return=%2Fprofile');
  globalThis.location = { hostname: '127.0.0.1' };
  assert.equal(oauthLoginPath('/'), '/oauth/login?return=%2F');
});

test('session routes use cookies without bearer; foreign-base data can use its bearer', () => {
  globalThis.location = { hostname: 'collector.example' };
  installStorage({ 'yakka-analytics-base': 'https://api.yakka.build', 'yakka-analytics-key': 'fixture-key' });
  const session = authInit('v1/me');
  assert.equal(session.headers.has('Authorization'), false);
  assert.equal(session.credentials, 'include');
  const data = authInit('analytics/schema');
  assert.equal(data.headers.get('Authorization'), 'Bearer fixture-key');
  assert.equal(data.credentials, 'omit');
});

test('device approval normalizes the code and emits only the documented fields', () => {
  assert.equal(normalizeUserCode('  abcd-efgh  '), 'ABCD-EFGH');
  assert.deepEqual(deviceApprovalPayload({ user_code: ' abcd-efgh ', tenant: 'tenant-a', scope: 'read', lifetime: '1w', name: ' workstation ', ignored: 'x' }), {
    user_code: 'ABCD-EFGH', tenant: 'tenant-a', scope: 'read', lifetime: '1w', name: 'workstation'
  });
  assert.deepEqual(deviceApprovalPayload({ user_code: 'ABCD-EFGH', tenant: 'tenant-a', scope: 'read_write', lifetime: '3m', name: ' ' }), {
    user_code: 'ABCD-EFGH', tenant: 'tenant-a', scope: 'read_write', lifetime: '3m'
  });
  assert.deepEqual(deviceDenialPayload(' abcd-efgh '), { user_code: 'ABCD-EFGH', action: 'deny' });
});
