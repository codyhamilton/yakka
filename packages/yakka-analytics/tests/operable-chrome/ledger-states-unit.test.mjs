import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEDGER_EMPTY_TEXT, LEDGER_ERROR_TEXT, LEDGER_LOADING_TEXT, LEDGER_RETRY_NEXT_TEXT,
  appendPage, filterToParameters, ledgerPageLimit, ledgerPopulationText, ledgerStateModel,
  pageParameters, renderLedgerState, retryNextPage, rowKey
} from '../../web/js/panels/ledger-table.js';
import { resetScopeState } from '../../web/js/core/chips.js';

function node(tag, doc) {
  const item = {
    tagName: tag,
    children: [],
    childNodes: [],
    dataset: {},
    attributes: {},
    handlers: {},
    className: '',
    textContent: '',
    nodeType: 1,
    append(...nodes) { for (const child of nodes) { this.children.push(child); this.childNodes.push(child); } },
    replaceChildren(...nodes) { this.children = []; this.childNodes = []; this.append(...nodes); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key] ?? null; },
    addEventListener(key, handler) { this.handlers[key] = handler; },
    click() { this.handlers.click?.({ target: this }); },
    querySelector() { return null; }
  };
  return item;
}

function fakeDoc() {
  return {
    createElement(tag) { return node(tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; }
  };
}

function textOf(item) {
  if (!item) return '';
  if (item.nodeType === 3) return item.textContent;
  const own = item.children?.length ? '' : (item.textContent || '');
  return `${own}${(item.children || []).map(textOf).join('')}`;
}

function buttonWith(container, label) {
  const stack = [container];
  while (stack.length) {
    const item = stack.shift();
    if (item.tagName === 'button' && item.textContent === label) return item;
    stack.push(...(item.children || []));
  }
  return null;
}

function row(tag, index) {
  return { type: 'hook_event', ts: `2026-11-18T10:${String(index).padStart(2, '0')}:00Z`, repo_id: 'repo-a', conversation_id: `conv-${index}` };
}

test('denominator text: ready, loading, error, legacy and stale never turn a page into a total', () => {
  const counts = { matched: { rows: 8410 } };
  assert.equal(ledgerPopulationText({ loaded: 100, counts }), '100 rows displayed of 8,410 matching records');
  assert.equal(ledgerPopulationText({ loaded: 200, counts, state: 'loading' }), '200 rows displayed; counting matching records…');
  assert.equal(ledgerPopulationText({ loaded: 100, counts: null, state: 'error' }), '100 rows displayed; matching record total unavailable.');
  assert.equal(ledgerPopulationText({ loaded: 100, counts: null, state: 'legacy' }), '100 rows displayed; matching record total unavailable.');
  assert.equal(ledgerPopulationText({ loaded: 200, counts: { matched: { rows: 150 } } }), '200 rows displayed; counts may have changed — Refresh.');
  assert.equal(ledgerPopulationText({ loaded: 0, counts: null }), '0 rows displayed; matching record total unavailable.');
  assert.doesNotMatch(ledgerPopulationText({ loaded: 16, counts: null }), /of 0/);
});

test('the initial page is 100 rows unless the schema publishes a lower explore budget', () => {
  assert.equal(ledgerPageLimit(undefined), 100);
  assert.equal(ledgerPageLimit(500), 100);
  assert.equal(ledgerPageLimit(50), 50);
});

test('T1 keeps the caption and headers, one full-span busy row, and no prior rows', () => {
  const doc = fakeDoc();
  const container = node('div');
  const rendered = renderLedgerState(container, 'loading', { doc });
  assert.equal(rendered.body.getAttribute('aria-busy'), 'true');
  assert.equal(rendered.body.children.length, 1);
  assert.equal(rendered.body.children[0].className, 'ledger-state-row');
  assert.equal(rendered.body.children[0].children[0].colSpan, rendered.head.children[0].children.length);
  assert.match(textOf(rendered.body), /^Loading Event ledger…$/);
  assert.ok(rendered.caption.startsWith('Each row is a retained event or rejection'));
  assert.equal(LEDGER_LOADING_TEXT, 'Loading Event ledger…');
});

test('T2 empty row text and both C7/C8 actions are present and wired', () => {
  const doc = fakeDoc();
  const calls = [];
  const container = node('div');
  const rendered = renderLedgerState(container, 'empty', {
    doc,
    handlers: { 'all-history': () => calls.push('all'), 'reset-filters': () => calls.push('reset') }
  });
  assert.match(textOf(rendered.body), /No records match these filters\./);
  assert.equal(LEDGER_EMPTY_TEXT, 'No records match these filters.');
  const all = buttonWith(rendered.body, 'All history');
  const reset = buttonWith(rendered.body, 'Reset filters');
  assert.ok(all && reset);
  all.click();
  reset.click();
  assert.deepEqual(calls, ['all', 'reset']);
});

test('T3 error row names the status family, sanitizes the code and keeps recovery focusable', () => {
  const doc = fakeDoc();
  const model = ledgerStateModel('error', { status: 403, code: '<b>forbidden</b>' });
  assert.equal(model.text, LEDGER_ERROR_TEXT);
  assert.match(model.detail, /You do not have access to this tenant/);
  assert.equal(model.code, 'forbidden');

  const unauthorized = ledgerStateModel('error', { status: 401, code: 'unauthorized' });
  assert.equal(unauthorized.actions[0].label, 'Sign in');
  assert.equal(unauthorized.actions[0].href, '/login');

  const busy = ledgerStateModel('error', { status: 503, code: 'busy', retry: () => {} });
  assert.match(busy.detail, /server is busy/);
  assert.equal(busy.actions[0].label, 'Retry');

  const timeout = ledgerStateModel('timeout', { code: 'query_timeout', retry: () => {} });
  assert.match(timeout.detail, /timed out/);

  const container = node('div');
  const rendered = renderLedgerState(container, 'error', { doc, status: 503, code: 'busy', retry: () => {} });
  assert.ok(buttonWith(rendered.body, 'Retry'));
  assert.doesNotMatch(textOf(rendered.body), /<b>/);
});

test('T4 appends 100 then 200 then 237 identities exactly once and retries in place', () => {
  const first = Array.from({ length: 100 }, (_, index) => row('hook_event', index));
  const second = Array.from({ length: 100 }, (_, index) => row('hook_event', index + 100));
  const third = Array.from({ length: 37 }, (_, index) => row('hook_event', index + 200));
  let merged = appendPage([], first);
  assert.equal(merged.rows.length, 100);
  merged = appendPage(merged.rows, second);
  assert.equal(merged.rows.length, 200);
  merged = appendPage(merged.rows, third);
  assert.equal(merged.rows.length, 237);
  assert.equal(new Set(merged.rows.map(rowKey)).size, 237);

  const base = filterToParameters({ win: '30d', filters: { repo_id: ['repo-a'] } }, { now: Date.parse('2026-11-18T12:00:00Z') });
  const next = pageParameters(base, { cursor: 'cursor-200', limit: 100 });
  assert.equal(next.get('cursor'), 'cursor-200');
  assert.equal(next.get('limit'), '100');
  assert.equal(next.get('repo_id'), 'repo-a');
  assert.equal(base.has('cursor'), false);

  assert.deepEqual(retryNextPage({ page: 'next', result: { state: 'error' } }), { retryNextPage: true, label: LEDGER_RETRY_NEXT_TEXT });
  assert.equal(retryNextPage({ page: 'first', result: { state: 'error' } }).retryNextPage, false);
  assert.equal(retryNextPage({ page: 'next', result: { state: 'ready' } }).retryNextPage, false);
});

test('All history uses all=1, never win, and Reset filters clears the committed filters', () => {
  const all = filterToParameters({ win: 'all', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', filters: { repo_id: ['repo-a'] } }, { now: Date.parse('2026-11-18T12:00:00Z') });
  assert.equal(all.get('all'), '1');
  assert.equal(all.has('win'), false);
  assert.equal(all.get('repo_id'), 'repo-a');
  assert.equal(all.has('cursor'), false);

  const reset = resetScopeState({ win: '90d', filters: { repo_id: ['repo-a'], kind: ['design'] }, exclude: ['model:x'], pick: 'abc', tenant: 'tenant-a' });
  assert.equal(reset.win, '30d');
  assert.deepEqual(reset.filters, {});
  assert.deepEqual(reset.exclude, []);
  assert.equal(reset.pick, '');
  assert.equal(reset.tenant, 'tenant-a', 'reset keeps the selected tenant');
});
