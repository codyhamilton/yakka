import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTING_TEXT, COUNTS_LEGACY_TEXT, COUNTS_UNAVAILABLE_TEXT,
  classifyEventCounts, createEventCountStrip, currentEventCounts, formatEventCountsText
} from '../../web/js/core/event-counts.js';

const BODY = {
  matched: { events: 8406, rejections: 4, rows: 8410 },
  tenant_total: { events: 12480, rejections: 9, rows: 12489 },
  checked_at: '2026-11-21T10:24:00Z',
  unit: 'retained_record'
};

test('success names all three denominators and the local checked time', () => {
  const state = classifyEventCounts({ capability: true, response: { ok: true, status: 200 }, body: BODY, locale: 'en-US' });
  assert.equal(state.state, 'success');
  assert.match(state.text, /^Events matching filters: 8,406 · Rejections: 4 · All retained events in tenant: 12,480$/);
  assert.match(state.checkedText, /^Counts checked /);
  assert.deepEqual(state.snapshot.matched, { events: 8406, rejections: 4, rows: 8410 });
  assert.deepEqual(state.snapshot.tenantTotal, { events: 12480, rejections: 9, rows: 12489 });
});

test('a legacy schema without event_counts is named, never a fabricated zero', () => {
  const state = classifyEventCounts({ capability: false, response: { ok: true, status: 200 }, body: {} });
  assert.equal(state.state, 'legacy');
  assert.equal(state.text, COUNTS_LEGACY_TEXT);
  assert.equal(state.snapshot, null);
  assert.doesNotMatch(state.text, /\b0\b/);
});

test('an error or a success body missing a total is unavailable, never zero', () => {
  assert.equal(classifyEventCounts({ capability: true, response: { ok: false, status: 503 } }).text, COUNTS_UNAVAILABLE_TEXT);
  assert.equal(classifyEventCounts({ capability: true, error: new Error('offline') }).text, COUNTS_UNAVAILABLE_TEXT);
  assert.equal(classifyEventCounts({ capability: true, response: { ok: true, status: 200 }, body: { matched: { events: 1 } } }).state, 'error');
  assert.equal(formatEventCountsText({ matched: { events: null }, tenant_total: { events: 1 } }), '');
});

test('a resolved strip discards the prior snapshot before loading a new generation', async () => {
  const doc = {
    createElement: tag => ({
      tagName: tag, className: '', dataset: {}, textContent: '', children: [],
      setAttribute() {},
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren() { this.children = []; },
      addEventListener() {}
    })
  };
  let release;
  const transport = { get: () => new Promise(resolve => { release = resolve; }) };
  const context = { tenant: 'tenant-a', generation: 1, window: { from: 'a', to: 'b' }, paramsFor: () => new URLSearchParams() };
  const strip = createEventCountStrip({ doc, transport, readContext: context });
  strip.update({ readContext: context, schema: { features: { event_counts: true } } });
  assert.equal(strip.state, 'loading');
  assert.equal(currentEventCounts(), null);
  release({ response: { ok: true, status: 200 }, body: BODY });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(strip.state, 'success');
  assert.equal(currentEventCounts().matched.events, 8406);
  const next = { ...context, generation: 2, window: { from: 'c', to: 'd' } };
  strip.update({ readContext: next, schema: { features: { event_counts: true } } });
  assert.equal(strip.state, 'loading');
  assert.equal(currentEventCounts(), null, 'the prior generation snapshot is discarded before the request');
  strip.destroy();
  assert.equal(COUNTING_TEXT, 'Counting retained events…');
});
