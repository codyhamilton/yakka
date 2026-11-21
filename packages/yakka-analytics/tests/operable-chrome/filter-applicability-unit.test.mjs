// Plan 30 phase 2 shared applicability and panel-view unit check: the F refusal
// names sorted dictionary labels and yields no data state, the local
// chart/table toggle never fetches, and the generic table accepts an explicit
// column model without changing its default callers.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNSUPPORTED_FILTER_MESSAGE, applicability, applicabilityState, filterLabel
} from '../../web/js/core/filter-applicability.js';
import { mountPanelViews, panelViewsEnabled } from '../../web/js/panels/p10-shared.js';
import { tableModel } from '../../web/js/charts/table.js';

const schema = {
  measures: [
    { name: 'cost_usd', unit: 'USD', dims: ['model', 'harness', 'session_repo', 'repo_id'] },
    { name: 'hook_events', unit: 'events', dims: ['harness', 'repo_id', 'tool', 'tool_kind'] }
  ],
  grains: {
    session: { measures: ['cost_usd', 'hook_events'], lenses: ['harness', 'session_repo', 'model'], filters: ['repo_id', 'harness', 'session_repo', 'model'] }
  }
};

const panel = {
  id: 'synthetic', grain: 'session', measures: ['cost_usd'], applies: ['repo_id', 'harness', 'session_repo', 'model']
};

function node(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    childNodes: [],
    dataset: {},
    attributes: {},
    listeners: {},
    className: '',
    textContent: '',
    nodeType: 1,
    append(...nodes) { for (const child of nodes) { this.children.push(child); this.childNodes.push(child); } },
    replaceChildren(...nodes) { this.children = []; this.childNodes = []; this.append(...nodes); },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return this.attributes[key] ?? null; },
    addEventListener(key, handler) { this.listeners[key] = handler; },
    click() { this.listeners.click?.({ target: this }); },
    querySelector() { return null; }
  };
}

function fakeDoc() {
  return {
    createElement(tag) { return node(tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; }
  };
}

function all(root, predicate, out = []) {
  if (predicate(root)) out.push(root);
  for (const child of root.children || []) all(child, predicate, out);
  return out;
}

function button(root, label) {
  return all(root, item => item.tagName === 'BUTTON' && item.textContent === label)[0] || null;
}

test('filter labels use the controlled dictionary, sorted alphabetically', () => {
  assert.equal(filterLabel('repo_id'), 'repository');
  assert.equal(filterLabel('session_repo'), 'repository');
  assert.equal(filterLabel('kind'), 'document kind');
  assert.equal(applicability({
    panel, spec: { measures: ['cost_usd'] }, scope: { repo_id: ['repo-a'] }, schema
  }).applicable, true);
  const refused = applicability({
    panel,
    spec: { measures: ['cost_usd'] },
    scope: { repo_id: ['repo-a'], kind: 'brief', source: 'worktree' },
    schema
  });
  assert.equal(refused.applicable, false);
  assert.deepEqual(refused.labels, ['document kind', 'source']);
  assert.equal(refused.message, 'This chart cannot apply document kind, source. Change the filters to view it.');
  assert.deepEqual(refused.supportedFilters.sort(), ['harness', 'model', 'repo_id', 'session_repo']);
  assert.deepEqual(refused.unsupportedFilters.sort(), ['kind', 'source']);
});

test('the exact F refusal sentence uses the exported template and response ignored filters', () => {
  assert.equal(UNSUPPORTED_FILTER_MESSAGE, 'This chart cannot apply {labels}. Change the filters to view it.');
  const refused = applicability({
    panel,
    spec: { measures: ['cost_usd'] },
    scope: { repo_id: ['repo-a'] },
    schema,
    ignoredFilters: ['tool_kind', 'kind']
  });
  assert.equal(refused.applicable, false);
  assert.deepEqual(refused.labels, ['document kind', 'tool category']);
  assert.equal(refused.message, 'This chart cannot apply document kind, tool category. Change the filters to view it.');
  const state = applicabilityState(refused);
  assert.equal(state.state, 'unsupported');
  assert.equal(state.applicability, true);
  assert.equal(state.message, refused.message);
  assert.equal(applicabilityState({ applicable: true }), null);
});

test('an unsupported measure falls back to its published dims, not a guessed one', () => {
  const hook = applicability({
    panel: { id: 'hooks', grain: 'session', measures: ['hook_events'], applies: ['repo_id', 'harness', 'tool_kind'] },
    spec: { measures: ['hook_events'] },
    scope: { kind: 'brief' },
    schema
  });
  assert.equal(hook.applicable, false);
  assert.deepEqual(hook.labels, ['document kind']);
});

test('chart view is the default and Show table/Show chart switch locally without a fetch', () => {
  const doc = fakeDoc();
  let fetches = 0;
  const transport = { get() { fetches += 1; return Promise.resolve({}); } };
  const chart = node('div');
  const table = node('div');
  const host = mountPanelViews({ panelId: 'synthetic', chart, table, doc, transport });
  assert.equal(host.element.dataset.view, 'chart');
  assert.equal(button(host.element, 'Show table').tagName, 'BUTTON');
  button(host.element, 'Show table').click();
  assert.equal(host.element.dataset.view, 'table');
  button(host.element, 'Show chart').click();
  assert.equal(host.element.dataset.view, 'chart');
  assert.equal(fetches, 0, 'the view toggle made no request');
});

test('panelViewsEnabled omits the toggle only for a table-only panel', () => {
  assert.equal(panelViewsEnabled({ charts: ['lines'], table: true }), true);
  assert.equal(panelViewsEnabled({ charts: ['lines'] }), true);
  assert.equal(panelViewsEnabled({ charts: [], table: true }), false);
});

test('tableModel accepts an explicit column model and preserves the default model', () => {
  const explicit = tableModel({
    spec: { title: 'Spend by day' },
    columns: [
      { key: 'bucket', label: 'Bucket' },
      { key: 'value', label: 'Value', unit: 'USD', numeric: true }
    ],
    data: [
      { key: '2026-09-01', bucket: '2026-09-01', value: 12.5 }
    ]
  });
  assert.equal(explicit.caption, 'Spend by day');
  assert.deepEqual(explicit.columns.map(column => column.label), ['Bucket', 'Value']);
  assert.equal(explicit.columns[1].unit, 'USD');
  assert.equal(explicit.rows[0].key, '2026-09-01');
  assert.deepEqual(explicit.rows[0].cells.map(cell => cell.value), ['2026-09-01', 12.5]);

  const fallback = tableModel({ spec: { series: [{ key: 'a', label: 'A', unit: 'USD' }] }, data: [{ key: 'k', x: 't', values: { a: 1 } }] });
  assert.equal(fallback.columns[0].key, '__entity');
  assert.equal(fallback.rows[0].key, 'k');
  assert.equal(fallback.rows[0].values[0], '1');
});

test('the frame keeps the caption visible and clears the body on an applicability refusal', async () => {
  const { createPanelFrame } = await import('../../web/js/panels/panel-frame.js');
  const doc = fakeDoc();
  let loads = 0;
  const frame = createPanelFrame({
    panel: {
      id: 'frame-refuse', grain: 'session', measures: ['cost_usd'], lenses: [], charts: ['columns'],
      requires: [], caveats: '', applies: ['repo_id'], caption: 'Each bar shows priced spend.',
      load: async () => { loads += 1; return { state: 'ready' }; }
    },
    spec: { measures: ['cost_usd'] },
    scope: { repo_id: ['repo-a'], kind: 'brief' },
    schema,
    doc
  });
  await frame.load();
  assert.equal(loads, 0, 'an unsupported active filter is refused before fetching');
  assert.equal(frame.element.dataset.state, 'unsupported');
  assert.equal(frame.caption.textContent, 'Each bar shows priced spend.');
  const body = all(frame.element, item => item.className === 'workspace-panel-body')[0];
  assert.equal(body.children.length, 0, 'no body marks survive a refusal');
  const status = all(frame.element, item => item.className === 'workspace-panel-status')[0];
  assert.equal(status.textContent, 'This chart cannot apply document kind. Change the filters to view it.');
});

test('an unregistered caption is an explicit refusal in the frame', async () => {
  const { createPanelFrame } = await import('../../web/js/panels/panel-frame.js');
  const frame = createPanelFrame({
    panel: { id: 'no-caption', grain: 'session', measures: ['cost_usd'], lenses: [], charts: ['columns'], requires: [], caveats: '', load: async () => ({ state: 'ready' }) },
    spec: { measures: ['cost_usd'] },
    doc: fakeDoc()
  });
  assert.equal(frame.caption.textContent, 'No plain-language caption is registered for no-caption.');
});
