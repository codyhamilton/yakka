// Plan 29 phase1-03: one schema-adapter boundary. The real-Go harness returns
// the heterogeneous /schema wire shape; the adapter turns every grain's
// measures and lenses into name arrays while retaining metadata. A failed
// schema read is never cached as a successful capability result.

import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlan29Harness } from './harness.mjs';
import { adaptSchema } from '../../web/js/core/schema-adapter.js';
import { createTransport } from '../../web/contract/transport.js';

test('plan29 schema adapter normalizes real time measures and artifact lenses', async t => {
  const harness = await startPlan29Harness();
  t.after(async () => { await harness.close(); });
  const tenant = harness.tenantId('plan29-a');
  const session = await harness.cookie('plan29-a');
  const response = await fetch(`${harness.origin}/v1/analytics/schema?tenant=${encodeURIComponent(tenant)}`, {
    headers: { Accept: 'application/json', Cookie: `${session.name}=${session.value}` }
  });
  assert.equal(response.status, 200, 'the real tenant schema answers');
  const raw = await response.json();

  const { schema, warnings } = adaptSchema(raw);
  assert.ok(Array.isArray(warnings), 'adapter reports warnings as a list');

  // time measures were `{name,unit,dims}` objects on the wire.
  assert.ok(Array.isArray(schema.grains.time.measures), 'time measures become an array');
  assert.ok(schema.grains.time.measures.every(name => typeof name === 'string'), 'time measures are names');
  assert.ok(schema.grains.time.measures.includes('cost_usd'), 'cost_usd survives normalization');
  assert.ok(Array.isArray(schema.grains.time.measure_metadata.cost_usd.dims), 'per-measure dims survive');
  assert.ok(schema.grains.time.measure_metadata.cost_usd.dims.length > 0, 'cost_usd keeps its dimensions');
  assert.equal(schema.grains.time.measure_metadata.cost_usd.unit, 'usd');

  // artifact lenses were a keyed metadata object on the wire.
  assert.ok(Array.isArray(schema.grains.artifact.lenses), 'artifact lenses become an array');
  assert.ok(schema.grains.artifact.lenses.includes('kind'), 'kind lens survives normalization');
  assert.equal(schema.grains.artifact.lens_metadata.kind.grain, 'artifact', 'lens metadata is retained');
  assert.ok(Object.keys(schema.grains.artifact.measure_metadata).length > 0, 'existing measure metadata is merged, not discarded');

  // mode-specific fields are preserved verbatim.
  assert.deepEqual(schema.grains.session.scatter_fields, raw.grains.session.scatter_fields, 'scatter_fields survive');
  assert.deepEqual(schema.grains.session.aggregate_fields, raw.grains.session.aggregate_fields, 'aggregate_fields survive');
  assert.deepEqual(schema.grains.time.modes, raw.grains.time.modes, 'modes survive');
  assert.equal(schema.grains.time.time_basis, raw.grains.time.time_basis, 'time_basis survives');

  // top-level measures stay the existing object list, with a metadata map.
  assert.ok(Array.isArray(schema.measures), 'top-level measures stay a list');
  assert.ok(schema.measures.every(item => item && typeof item === 'object' && typeof item.name === 'string'), 'top-level measures keep name/unit/dims objects');
  assert.equal(schema.measure_metadata.cost_usd.unit, 'usd');

  // resolutions and checks_by_kind are preserved untouched.
  assert.deepEqual(schema.grains.artifact.checks_by_kind, raw.grains.artifact.checks_by_kind, 'checks_by_kind survives');

  // idempotent: adapting an adapted schema changes nothing observable.
  const twice = adaptSchema(schema).schema;
  assert.deepEqual(twice.grains.time.measures, schema.grains.time.measures);
  assert.deepEqual(twice.grains.artifact.lenses, schema.grains.artifact.lenses);
  assert.deepEqual(twice.grains.artifact.lens_metadata, schema.grains.artifact.lens_metadata);
});

test('a failed schema response is not cached and a success is', async t => {
  const saved = { localStorage: globalThis.localStorage, location: globalThis.location };
  globalThis.localStorage = { getItem: () => '', setItem: () => {}, removeItem: () => {} };
  globalThis.location = { hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
  t.after(() => {
    globalThis.localStorage = saved.localStorage;
    globalThis.location = saved.location;
  });

  const body = {
    features: {},
    measures: [{ name: 'cost_usd', unit: 'USD', dims: ['model'] }],
    grains: {
      time: { modes: ['aggregate'], measures: [{ name: 'cost_usd', unit: 'USD', dims: ['model'] }], lenses: ['id'] },
      artifact: { lenses: { kind: { grain: 'artifact', cardinality: 'single-valued' } } },
      session: { measures: ['cost_usd'], scatter_fields: ['cost_usd'], lenses: ['harness'] }
    }
  };
  let calls = 0;
  const scheduler = {
    supersede: () => {},
    request: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'schema read failed', code: 'read_failed' }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  };
  const transport = createTransport(scheduler);

  const failed = await transport.schema('tenant-a');
  assert.equal(failed.response.ok, false, 'the first schema read fails');
  assert.equal(calls, 1);

  const fresh = await transport.schema('tenant-a');
  assert.equal(fresh.response.ok, true, 'a later call performs a fresh read');
  assert.equal(calls, 2, 'the failure was not cached');
  assert.ok(Array.isArray(fresh.body.grains.time.measures), 'the success is adapted');
  assert.ok(fresh.body.grains.time.measures.includes('cost_usd'));
  assert.ok(Array.isArray(fresh.body.grains.artifact.lenses));
  assert.ok(fresh.body.grains.artifact.lenses.includes('kind'));

  await transport.schema('tenant-a');
  assert.equal(calls, 2, 'a success is cached');

  transport.invalidateSchema('tenant-a');
  await transport.schema('tenant-a');
  assert.equal(calls, 3, 'invalidateSchema forces a fresh read');
});
