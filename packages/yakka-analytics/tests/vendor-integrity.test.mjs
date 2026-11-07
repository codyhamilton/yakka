import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('uPlot 1.6.32 vendor files match the published contract hashes', async () => {
  const dir = new URL('../web/vendor/uplot-1.6.32/', import.meta.url);
  const expected = new Map([
    ['uPlot.esm.js', '5dd9b3281aa64b461b42d9945f6adb2649d346502b12281a9ae0d46599a80eba'],
    ['uPlot.min.css', 'df630c6a8d6f8eeaff264b50f73ce5b114f646ffd9a0bb74f049b0a00135fa04']
  ]);
  for (const [file, hash] of expected) assert.equal(createHash('sha256').update(await readFile(new URL(file, dir))).digest('hex'), hash);
  assert.match(await readFile(new URL('NOTICE', dir), 'utf8'), /Version: 1\.6\.32/);
});
