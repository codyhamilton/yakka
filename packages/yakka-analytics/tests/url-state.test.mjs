import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeUrlState, encodeUrlState } from '../web/contract/url-state.js';

test('URL state round-trips contract keys, repeats, panel overrides, and unknown keys', () => {
  const query = '?win=all&tz=Australia%2FBrisbane&repo_id=r1&exclude=repo_id%3Ar2&exclude=model%3Ax&ca=%7B%22grain%22%3A%22session%22%7D&pick=sel&sel=1%2C2&hide=a&hide=b&cmp=period&v=trends&p2=chart%3Dline&future=x&future=y';
  const state = decodeUrlState(query);
  const encoded = encodeUrlState(state, query).toString();
  const decoded = decodeUrlState(encoded);
  assert.deepEqual(decoded, state);
  assert.deepEqual(decoded.exclude, ['repo_id:r2', 'model:x']);
  assert.deepEqual(decoded.unknown.future, ['x', 'y']);
});

test('from and to take precedence over a window; invalid windows use 30d', () => {
  assert.equal(decodeUrlState('?win=all&from=2026-01-01T00%3A00%3A00Z').win, '');
  assert.equal(decodeUrlState('?win=not-a-window').win, '30d');
});

test('all and long finite windows are preserved without a client reporting cap', () => {
  assert.equal(decodeUrlState('?win=all').win, 'all');
  assert.equal(decodeUrlState('?win=120y').win, '120y');
});
