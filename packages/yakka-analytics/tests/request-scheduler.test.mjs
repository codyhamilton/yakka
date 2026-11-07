import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../web/js/core/request-scheduler.js';

const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

test('identical in-flight requests share one fetch and superseded requests abort', async () => {
  const hold = deferred(); let calls = 0; let seenSignal;
  const scheduler = createScheduler({ fetchImpl: (_url, init) => { calls++; seenSignal = init.signal; return hold.promise; } });
  const a = scheduler.request('/same', {}, 'state-a');
  const b = scheduler.request('/same', {}, 'state-a');
  assert.equal(calls, 1);
  scheduler.supersede('state-a');
  assert.equal(seenSignal.aborted, true);
  hold.resolve(new Response('{}'));
  await Promise.all([a, b]);
});

test('concurrent fetch count never exceeds four', async () => {
  const holds = []; let active = 0; let maximum = 0;
  const scheduler = createScheduler({ fetchImpl: async () => {
    active++; maximum = Math.max(maximum, active);
    const hold = deferred(); holds.push(hold);
    await hold.promise; active--;
    return new Response('{}');
  } });
  const requests = Array.from({ length: 9 }, (_, index) => scheduler.request(`/r${index}`));
  while (holds.length < 4) await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.inFlight, 4);
  while (holds.length) {
    const current = holds.splice(0);
    current.forEach(hold => hold.resolve());
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all(requests);
  assert.equal(maximum, 4);
});

test('a queued request aborted before a slot opens is removed cleanly', async () => {
  const first = deferred(); let calls = 0;
  const scheduler = createScheduler({ maxInFlight: 1, fetchImpl: async () => { calls++; if (calls === 1) await first.promise; return new Response('{}'); } });
  const a = scheduler.request('/first');
  const aborter = new AbortController();
  const b = scheduler.request('/second', { signal: aborter.signal });
  aborter.abort();
  first.resolve();
  await a;
  await assert.rejects(b, { name: 'AbortError' });
  assert.equal(calls, 1);
  await scheduler.request('/second');
  assert.equal(calls, 2);
});
