import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startStaticHarness } from './static-harness.mjs';

test('fixture summary and legacy server responses exist only in the test harness', async t => {
  const manifest = JSON.parse(await readFile(new URL('../../../yakka/internal/analyticsfixture/manifest.json', import.meta.url), 'utf8'));
  const fixtureSummary = { manifest, counts: { ...manifest.populations } };
  const harness = await startStaticHarness({ fixtureSummary });
  t.after(harness.close);
  const summary = await fetch(`${harness.origin}/__test/fixture-summary`).then(response => response.json());
  assert.deepEqual(summary, fixtureSummary);
  const unknownSchema = await fetch(`${harness.origin}/v1/analytics/schema`);
  assert.equal(unknownSchema.status, 404);
  const legacyLimit = await fetch(`${harness.origin}/v1/analytics/query`).then(response => response.json());
  assert.equal(legacyLimit.error, 'range too wide');
  const probe = await fetch(`${harness.origin}/__test/fixture-summary-probe`).then(response => response.text());
  assert.match(probe, /fixture-summary-probe\.js/);
  const legacyProbe = await fetch(`${harness.origin}/__test/legacy-limit-probe`).then(response => response.text());
  assert.match(legacyProbe, /legacy-limit-probe\.js/);
  const productSource = await (await import('node:fs/promises')).readFile(new URL('../../web/js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(productSource, /__test\/fixture-summary/);
});
