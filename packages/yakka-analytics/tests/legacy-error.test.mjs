import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyErrorMessage, retryHint } from '../web/js/core/legacy-error.js';

test('old server limits remain verbatim and do not become automatic retry hints', () => {
  const oldServer = { error: 'range too wide' };
  assert.equal(legacyErrorMessage(oldServer), 'range too wide');
  assert.equal(retryHint(oldServer), '');
});

test('only a server-provided retry hint is exposed as a possible explicit action', () => {
  assert.equal(retryHint({ error: 'busy', retry: 'after 2 seconds' }), 'after 2 seconds');
});
