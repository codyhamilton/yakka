import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advancedScopeRows, chipModel, removeAdvancedRow, resetScopeState
} from '../../web/js/core/chips.js';
import {
  absoluteScope, scopeTimezone
} from '../../web/js/core/selection-tray.js';
import {
  createScopeControls, facetsParameters
} from '../../web/js/core/scope-controls.js';
import { resolveReadContext } from '../../web/js/core/read-context.js';

function fakeNode(tag) {
  return {
    tagName: tag,
    nodeType: 1,
    children: [],
    dataset: {},
    attributes: {},
    handlers: {},
    className: '',
    textContent: '',
    hidden: false,
    disabled: false,
    multiple: false,
    value: '',
    selected: false,
    append(...nodes) { for (const child of nodes) this.children.push(child); },
    prepend(...nodes) { this.children.unshift(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    remove() {},
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key] ?? null; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, handler) { this.handlers[key] = handler; },
    querySelector() { return null; }
  };
}

function fakeDoc() {
  return {
    createElement(tag) { return fakeNode(tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; }
  };
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

test('default scope chips name the window and tz but are never removable', () => {
  const plain = chipModel({ state: { win: '30d' } });
  const window = plain.filter(chip => chip.kind === 'scope');
  assert.equal(window.length, 1);
  assert.equal(window[0].key, 'window');
  assert.equal(window[0].removable, false);
  assert.equal(window.filter(chip => chip.removable).length, 0, 'a default state has no removable chip');

  const zoned = chipModel({ state: { win: '30d', tz: 'UTC', filters: { tool: ['Read'] } } });
  const scopes = zoned.filter(chip => chip.kind === 'scope');
  assert.deepEqual(scopes.map(chip => chip.key).sort(), ['tz', 'window']);
  assert.deepEqual(scopes.map(chip => chip.removable), [false, false]);
  assert.equal(zoned.find(chip => chip.kind === 'filter').removable, true);
});

test('every advanced-row removal clears the derived pick and selection', () => {
  const state = {
    win: '30d', from: '', to: '', tz: 'UTC',
    filters: { tool: ['Read'], harness: ['orca'] },
    exclude: ['stage:screen'],
    cohorts: { ca: 'cohort-a', cb: '', cc: '', cd: '' },
    cmp: 'period',
    pick: 's3|',
    sel: 'range'
  };
  const rows = advancedScopeRows(state);
  assert.deepEqual(rows.map(row => row.kind).sort(), ['cmp', 'cohort', 'exclude', 'filter', 'filter', 'pick']);
  for (const row of rows) {
    const next = removeAdvancedRow(state, row);
    assert.equal(next.pick, '', `pick survived ${row.kind} removal`);
    assert.equal(next.sel, '', `sel survived ${row.kind} removal`);
    assert.equal(next.win, '30d');
    assert.equal(next.tz, 'UTC');
  }
  const filterRow = rows.find(row => row.kind === 'filter' && row.key === 'tool');
  const kept = removeAdvancedRow(state, filterRow);
  assert.deepEqual(kept.filters.harness, ['orca'], 'unrelated include survives');
  assert.deepEqual(kept.exclude, ['stage:screen'], 'unrelated exclude survives');
  assert.equal(kept.cohorts.ca, 'cohort-a', 'unrelated cohort survives');
  assert.equal(kept.cmp, 'period', 'unrelated compare survives');
  assert.equal(state.pick, 's3|', 'the committed state is never mutated');
  assert.equal(state.sel, 'range');
});

test('a cohort scope always carries a non-empty IANA timezone', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const sansTz = [
    { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
    { win: 'all' },
    { win: '7d' },
    { win: 'nonsense' }
  ];
  for (const state of sansTz) {
    const scope = absoluteScope(state, now);
    assert.equal(scope.tz, fallback);
    assert.ok(scope.tz && scope.tz.length > 0, 'a cohort tz is never null or empty');
  }
  assert.equal(absoluteScope({ win: '7d', tz: 'Australia/Brisbane' }, now).tz, 'Australia/Brisbane');
  assert.equal(scopeTimezone({ tz: 'Europe/London' }), 'Europe/London');
});

test('facets send only the frozen window and tz, never filters, excludes, cohorts, pick or sel', () => {
  const previousLocation = globalThis.location;
  globalThis.location = { hostname: 'localhost' };
  try {
    const now = Date.parse('2026-10-01T00:00:00Z');
    const context = resolveReadContext({
      me: null,
      tenant: 'tenant-a',
      now,
      state: {
        win: '30d', tz: 'UTC',
        filters: { repo_id: ['repo-a'], kind: ['brief'] },
        exclude: ['stage:screen'],
        cohorts: { ca: 'cohort-a' },
        pick: 's3|',
        sel: 'range'
      }
    });
    const params = facetsParameters(context);
    assert.equal(params.has('all'), false);
    assert.equal(params.get('from'), '2026-09-01T00:00:00.000Z');
    assert.equal(params.get('to'), '2026-10-01T00:00:00.000Z');
    assert.equal(params.get('tz'), 'UTC');
    for (const key of ['win', 'repo_id', 'kind', 'exclude', 'cohort', 'pick', 'sel', 'tenant']) {
      assert.equal(params.has(key), false, `facets must not send ${key}`);
    }

    const all = facetsParameters(resolveReadContext({ tenant: 'tenant-a', now, state: { win: 'all', tz: 'UTC' } }));
    assert.equal(all.get('all'), '1');
    assert.equal(all.has('from'), false);
    assert.equal(all.get('to'), '2026-10-01T00:00:00.000Z');
    assert.equal(all.get('tz'), 'UTC');
  } finally {
    globalThis.location = previousLocation;
  }
});

test('Reset keeps canonical defaults and applies the route compare default', () => {
  const state = {
    tenant: 'tenant-a', win: '90d', from: '', to: '', tz: 'UTC',
    filters: { repo_id: ['repo-a'], kind: ['brief'] },
    exclude: ['stage:screen'], cohorts: { ca: 'cohort-a' }, cmp: 'cohorts', pick: 's3|', sel: 'range'
  };
  const committed = [];
  const doc = fakeDoc();
  const controls = createScopeControls({
    doc,
    state,
    facetsFetch: false,
    allowRefresh: false,
    resetCmp: 'period',
    onCommit: next => committed.push(next)
  });
  const reset = find(controls.element, node => node.className === 'scope-reset');
  assert.ok(reset, 'reset control is mounted');
  reset.handlers.click();
  assert.equal(committed.length, 1);
  const next = committed[0];
  assert.equal(next.cmp, 'period');
  assert.equal(next.tenant, 'tenant-a');
  assert.equal(next.tz, 'UTC');
  assert.equal(next.win, '30d');
  assert.deepEqual(next.filters, {});
  assert.deepEqual(next.exclude, []);
  assert.equal(next.pick, '');
  assert.equal(next.sel, '');
  assert.deepEqual(resetScopeState({ cmp: 'period' }).cmp, 'off', 'the canonical reset itself is unchanged');
});
