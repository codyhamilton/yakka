import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeUrlState, encodeUrlState } from '../../web/contract/url-state.js';
import { authorizedTenant, activeTenants } from '../../web/contract/session-gate.js';
import { createScheduler } from '../../web/js/core/request-scheduler.js';
import { advancedScopeRows, removeAdvancedRow, resetScopeState } from '../../web/js/core/chips.js';
import {
  CUSTOM_TIME_ERROR, commitDraft, customTimeError, panelOverridePlan, resetPanelScope,
  wallTimeToIso
} from '../../web/js/core/scope-controls.js';

const ME = {
  tenants: [
    { id: 'tenant-a', name: 'Alpha', lifecycle_state: 'active' },
    { id: 'tenant-b', name: 'Beta', lifecycle_state: 'active' },
    { id: 'tenant-c', name: 'Gamma', lifecycle_state: 'pending' }
  ]
};

test('tenant is a reserved URL field and never a filter or unknown key', () => {
  const state = decodeUrlState('?tenant=tenant-b&win=7d&repo_id=r1&future=x');
  assert.equal(state.tenant, 'tenant-b');
  assert.deepEqual(state.filters, { repo_id: ['r1'] });
  assert.deepEqual(state.unknown, { future: ['x'] });
  const encoded = encodeUrlState(state, '?tenant=tenant-b&win=7d&repo_id=r1&future=x').toString();
  assert.equal(new URLSearchParams(encoded).get('tenant'), 'tenant-b');
  assert.deepEqual(decodeUrlState(encoded), state);
});

test('collector precedence: URL, then remembered, then first active; foreign URL refuses', () => {
  const previous = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value))
  };
  try {
    store.set('yakka-analytics-tenant', 'tenant-b');
    assert.deepEqual(authorizedTenant({ me: ME, urlTenant: 'tenant-a' }), { tenant: 'tenant-a', unavailable: false, source: 'url' });
    assert.deepEqual(authorizedTenant({ me: ME, urlTenant: '' }), { tenant: 'tenant-b', unavailable: false, source: 'remembered' });
    store.delete('yakka-analytics-tenant');
    assert.deepEqual(authorizedTenant({ me: ME, urlTenant: '' }), { tenant: 'tenant-a', unavailable: false, source: 'first' });
    assert.deepEqual(authorizedTenant({ me: ME, urlTenant: 'foreign' }), { tenant: '', unavailable: true, source: 'url' });
    assert.deepEqual(authorizedTenant({ me: ME, urlTenant: 'tenant-c' }), { tenant: '', unavailable: true, source: 'url' });
    assert.deepEqual(activeTenants(ME).map(tenant => tenant.id), ['tenant-a', 'tenant-b']);
  } finally {
    globalThis.localStorage = previous;
  }
});

test('custom wall times refuse nonexistent and ambiguous DST hours', () => {
  assert.equal(wallTimeToIso('not-a-time', 'UTC').error, CUSTOM_TIME_ERROR);
  assert.equal(wallTimeToIso('2026-03-08T02:30', 'America/New_York').error, CUSTOM_TIME_ERROR);
  assert.equal(wallTimeToIso('2026-11-01T01:30', 'America/New_York').error, CUSTOM_TIME_ERROR);
  const ok = wallTimeToIso('2026-06-01T09:15', 'Australia/Brisbane');
  assert.equal(ok.iso, '2026-05-31T23:15:00.000Z');
  assert.equal(customTimeError({ win: 'custom', from: '', to: '2026-06-01T10:00', tz: 'UTC' }), 'Enter a start before the end.');
  assert.equal(customTimeError({ win: 'custom', from: '2026-06-01T10:00', to: '2026-06-01T09:00', tz: 'UTC' }), 'Enter a start before the end.');
  assert.equal(customTimeError({ win: 'custom', from: '2026-06-01T09:00', to: '2026-06-01T10:00', tz: 'UTC' }), '');
});

test('the draft commits only C2-C5 fields and leaves advanced predicates intact', () => {
  const state = {
    tenant: 'tenant-a', win: '30d', from: '', to: '', tz: 'UTC',
    filters: { repo_id: ['old'], harness: ['orca'], kind: ['design'] },
    exclude: ['model:x'], cohorts: { ca: 'cohort-a', cb: '' }, pick: 'pick', sel: 'sel'
  };
  const frozen = structuredClone(state);
  const result = commitDraft(state, { win: '7d', from: '', to: '', tz: 'UTC', repo: ['new'], kind: [] });
  assert.equal(result.state.win, '7d');
  assert.deepEqual(result.state.filters, { harness: ['orca'], repo_id: ['new'] });
  assert.deepEqual(result.state.exclude, ['model:x']);
  assert.deepEqual(result.state.cohorts, { ca: 'cohort-a', cb: '' });
  assert.equal(result.state.pick, '');
  assert.deepEqual(state, frozen, 'committed state is never mutated by a draft');
});

test('C11 rows remove exactly one repeated key and never reset the window', () => {
  const state = {
    win: '90d', from: '', to: '', tz: 'UTC',
    filters: { harness: ['orca', 'claude'] }, exclude: ['model:x'], cohorts: { ca: 'c1', cb: '', cc: '', cd: '' }
  };
  const rows = advancedScopeRows(state);
  assert.ok(rows.some(row => row.label === 'harness: orca'));
  const next = removeAdvancedRow(state, rows.find(row => row.value === 'orca'));
  assert.deepEqual(next.filters.harness, ['claude']);
  assert.equal(next.win, '90d');
  assert.equal(next.filters.harness.includes('orca'), false);
  const reset = resetScopeState(state);
  assert.equal(reset.win, '30d');
  assert.deepEqual(reset.filters, {});
  assert.deepEqual(reset.exclude, []);
  assert.equal(reset.tz, 'UTC');
});

test('panel overrides promote only when unambiguous and never shadow a global value', () => {
  const state = {
    win: '30d', filters: {}, panelSpecs: {
      p1: { grain: 'session', measures: [], split: '', chart: '', scope: { kind: 'brief' } },
      p2: { grain: 'session', measures: [], split: '', chart: '', scope: { kind: 'brief' } }
    }
  };
  const plan = panelOverridePlan(state);
  assert.deepEqual(plan.promotions, { kind: 'brief' });
  assert.deepEqual(plan.conflicts, []);
  const global = { ...state, filters: { kind: ['design'] } };
  assert.deepEqual(panelOverridePlan(global).promotions, {});
  const conflict = {
    ...state,
    panelSpecs: {
      p1: { ...state.panelSpecs.p1, scope: { kind: 'brief' } },
      p2: { ...state.panelSpecs.p2, scope: { kind: 'report' } }
    }
  };
  assert.deepEqual(panelOverridePlan(conflict).conflicts.sort(), ['p1', 'p2']);
  const reset = resetPanelScope(conflict, ['p1']);
  assert.deepEqual(reset.panelSpecs.p1.scope, {});
  assert.deepEqual(reset.panelSpecs.p2.scope, { kind: 'report' });
});

test('supersedeAll cancels in-flight and queued requests without changing the cap', async () => {
  const held = [];
  let calls = 0;
  const scheduler = createScheduler({ fetchImpl: async () => {
    calls += 1;
    await new Promise(resolve => held.push(resolve));
    return new Response('{}');
  } });
  const first = scheduler.request('/a');
  const second = scheduler.request('/b');
  scheduler.supersedeAll();
  for (const resolve of held) resolve();
  await Promise.allSettled([first, second]);
  assert.equal(calls, 2);
  assert.equal(scheduler.inFlight, 0);
});
