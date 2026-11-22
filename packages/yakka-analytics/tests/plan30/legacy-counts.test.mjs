// Legacy-capability unit check: a schema without features.event_counts must
// render the named legacy state and a Ledger link, never a fabricated zero.
// This exercises the client state machine only; it is not a browser or API
// proof and it does not intercept any request.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTS_LEGACY_TEXT,
  classifyEventCounts,
  createEventCountStrip
} from '../../web/js/core/event-counts.js';

class FakeNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.listeners = {};
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { for (const node of nodes) this.children.push(node); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
}

function fakeDocument() {
  return { createElement: tag => new FakeNode(tag) };
}

test('plan30 legacy count strip names the missing capability', () => {
  const classified = classifyEventCounts({ capability: false });
  assert.equal(classified.state, 'legacy');
  assert.equal(classified.text, COUNTS_LEGACY_TEXT);
  assert.equal(classified.snapshot, null);
  assert.equal(COUNTS_LEGACY_TEXT, 'This server cannot report retained-event totals.');
});

test('plan30 legacy count strip links to Ledger without a zero', () => {
  const strip = createEventCountStrip({ doc: fakeDocument() });
  assert.equal(strip.state, 'legacy');
  const text = strip.element.children.find(node => node.className === 'event-counts-text');
  const link = strip.element.children.find(node => node.tagName === 'A');
  assert.equal(text?.textContent, COUNTS_LEGACY_TEXT);
  assert.equal(link?.textContent, 'Open Ledger');
  assert.equal(link?.href, '/ledger');
  assert.ok(!/\d/.test(text?.textContent || ''), 'legacy wording must not fabricate a count');
  assert.ok(!strip.element.children.some(node => /^\d/.test(node.textContent || '')), 'no zero total node');
});
