// Plan 30 phase 2 Scatter unit check: the four scatter panels register the
// literal G captions selected by `scope.captionKey`, use the exact P6 defaults
// (X/Y/Size/Colour) and numeric-only axes, keep whole-population marginals and
// the P10 table order, expose the artifact P5 Check/Scorer path, carry the score
// as a normalized 0–1 unit, and refuse an unsupported filter with no marks and
// the exact F sentence before any entity read.

import test from 'node:test';
import assert from 'node:assert/strict';

import '../../web/js/panels/index.js';
import { lookupPanel } from '../../web/js/panels/registry.js';
import { captionFor } from '../../web/js/panels/captions.js';
import { SCATTER_SPECS } from '../../web/js/panels/p11-scatter.js';
import {
  SESSION_CAPTION, SCATTER_SESSION_PANEL, load as loadSession
} from '../../web/js/panels/scatter-session.js';
import {
  ARTIFACT_CAPTION, SCATTER_ARTIFACT_PANEL, artifactAxes, load as loadArtifact
} from '../../web/js/panels/scatter-artifact.js';
import {
  PLAN_CAPTION, SCATTER_PLAN_PANEL, planAxes, load as loadPlan
} from '../../web/js/panels/scatter-plan.js';
import { DAY_CAPTION, SCATTER_DAY_PANEL, load as loadDay } from '../../web/js/panels/scatter-day.js';
import {
  SCATTER_DEFAULTS, formatScatterCell, marginalModel, marginalTableColumns, marginalTableRows,
  resolveScatterFields, scatterAxes, scatterColours, scatterTableColumns, scatterUnit
} from '../../web/js/panels/scatter-shared.js';
import {
  defaultCheck, resolveScorer, scorerNames
} from '../../web/js/panels/score-ranges.js';
import {
  p11ArtifactScatter, p11PlanScatter, p11Scatter, p11Schema, p11TimeScatter
} from '../workspace/fixture.mjs';

const schema = p11Schema();
const CATALOGUE = { kind: 'design', checks: [{ name: 'structure' }, { name: 'clarity' }] };
const BASELINES = {
  kind: 'design',
  population: 'content',
  scorers: {
    zeta: { clarity: { n: 9, p25: 0.4, median: 0.6, p75: 0.8 } },
    alpha: { clarity: { n: 0, p25: null, median: null, p75: null } },
    beta: { clarity: { n: 5, p25: 0.45, median: 0.65, p75: 0.85 } }
  }
};

function fakeDoc() {
  const node = () => ({
    nodeType: 1,
    style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {} },
    append() {}, prepend() {}, replaceChildren() {}, remove() {},
    setAttribute() {}, removeAttribute() {}, insertBefore() {},
    addEventListener() {}, dispatchEvent() {}
  });
  return {
    documentElement: { dataset: {} },
    head: { append() {} },
    defaultView: null,
    querySelector() { return null; },
    createElement() { return node(); },
    createTextNode() { return { nodeType: 3 }; }
  };
}

function transport() {
  const calls = [];
  return {
    calls,
    async schema() { return { response: { ok: true, status: 200 }, body: schema }; },
    async request(name, { params } = {}) {
      calls.push({ name, params });
      if (name === 'baselines') return { response: { ok: true, status: 200 }, body: BASELINES };
      return { response: { ok: true, status: 200 }, body: {} };
    },
    async get(name, params) {
      calls.push({ name, params });
      if (name === 'scores') return { response: { ok: true, status: 200 }, body: CATALOGUE };
      if (name === 'entities') {
        const grain = params.get('grain');
        if (grain === 'artifact') return { response: { ok: true, status: 200 }, body: p11ArtifactScatter({ fields: (params.get('fields') || '').split(',') }) };
        if (grain === 'plan') return { response: { ok: true, status: 200 }, body: p11PlanScatter({ fields: (params.get('fields') || '').split(',') }) };
        if (grain === 'time') return { response: { ok: true, status: 200 }, body: p11TimeScatter({ fields: (params.get('fields') || '').split(',') }) };
        return { response: { ok: true, status: 200 }, body: p11Scatter({ fields: (params.get('fields') || '').split(',') }) };
      }
      return { response: { ok: true, status: 200 }, body: {} };
    }
  };
}

const LOADERS = [
  ['scatter-session', loadSession, SCATTER_SESSION_PANEL],
  ['scatter-artifact', loadArtifact, SCATTER_ARTIFACT_PANEL],
  ['scatter-plan', loadPlan, SCATTER_PLAN_PANEL],
  ['scatter-day', loadDay, SCATTER_DAY_PANEL]
];

test('the four Scatter captions are the literal G sentences selected by captionKey', () => {
  const cases = [
    ['scatter-session', 'G-sessionxy', SESSION_CAPTION],
    ['scatter-artifact', 'G-artifactxy', ARTIFACT_CAPTION],
    ['scatter-plan', 'G-planxy', PLAN_CAPTION],
    ['scatter-day', 'G-dayxy', DAY_CAPTION]
  ];
  for (const [id, key, literal] of cases) {
    const panel = lookupPanel(id);
    assert.ok(panel, `${id} is registered`);
    const spec = SCATTER_SPECS[id];
    assert.equal(spec.scope.captionKey, key, `${id} names ${key}`);
    assert.equal(captionFor(panel, spec, { scope: { win: '30d' }, schema }), literal, `${id} literal`);
  }
  assert.equal(SESSION_CAPTION, 'Each dot is a session, with priced spend across and commit count up; larger dots mean more calls without prices.');
  assert.equal(ARTIFACT_CAPTION, 'Each dot is a file, with its writing session’s spend across and its clarity score up; this association does not prove that spending improves quality.');
  assert.equal(PLAN_CAPTION, 'Each dot is a plan, with associated session spend across and file count up; plans can share the same session costs.');
  assert.equal(DAY_CAPTION, 'Each dot is a time bucket, with priced spend across and commits up; buckets without prices remain marked as incomplete.');

  const session = lookupPanel('scatter-session');
  const alternate = { ...SCATTER_SPECS['scatter-session'], scope: { ...SCATTER_SPECS['scatter-session'].scope, x: 'commits', y: 'cost_usd' } };
  const text = captionFor(session, alternate, { scope: { win: '30d' }, schema });
  assert.match(text, /^Each dot is a session, with commits across and priced spend up/);
  assert.notEqual(text, SESSION_CAPTION);

  const artifact = lookupPanel('scatter-artifact');
  const structure = { ...SCATTER_SPECS['scatter-artifact'], scope: { ...SCATTER_SPECS['scatter-artifact'].scope, check: 'structure', y: 'score:structure' } };
  const artText = captionFor(artifact, structure, { scope: { win: '30d' }, schema });
  assert.match(artText, /structure score/);
  assert.doesNotMatch(artText, /does not prove that spending improves quality/, 'the non-causation literal belongs to the clarity default only');
});

test('each panel resolves the exact G defaults for X, Y, Size and Colour', () => {
  assert.deepEqual(SCATTER_DEFAULTS['scatter-session'], { x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: '' });
  assert.deepEqual(SCATTER_DEFAULTS['scatter-artifact'], { x: 'writing_session_cost_usd', y: 'score:clarity', size: '', colour: '' });
  assert.deepEqual(SCATTER_DEFAULTS['scatter-plan'], { x: 'associated_cost_usd', y: 'artifacts', size: '', colour: 'repo_id' });
  assert.deepEqual(SCATTER_DEFAULTS['scatter-day'], { x: 'cost_usd', y: 'commits', size: '', colour: '' });

  for (const [id, , panel] of LOADERS) {
    const fields = resolveScatterFields({ spec: { scope: { captionKey: SCATTER_SPECS[id].scope.captionKey } }, schema, panel });
    const want = SCATTER_DEFAULTS[id];
    assert.equal(fields.x, want.x, `${id} X`);
    assert.equal(fields.y, want.y, `${id} Y`);
    assert.equal(fields.size, want.size, `${id} Size`);
    assert.equal(fields.colour, want.colour, `${id} Colour`);
  }

  const cleared = resolveScatterFields({ spec: { scope: { size: '', colour: '' } }, schema, panel: SCATTER_SESSION_PANEL });
  assert.equal(cleared.size, '', 'an explicit None stays None');
  assert.equal(cleared.colour, '');
});

test('the G defaults reach the wire and P5 resolves the artifact check and scorer', async () => {
  const cases = [
    ['scatter-session', loadSession, SCATTER_SESSION_PANEL, 'cost_usd,commits,unpriced_calls', 'scatter'],
    ['scatter-plan', loadPlan, SCATTER_PLAN_PANEL, 'associated_cost_usd,artifacts', 'scatter'],
    ['scatter-day', loadDay, SCATTER_DAY_PANEL, 'cost_usd,commits', 'aggregate']
  ];
  for (const [id, loader, panel, fields, mode] of cases) {
    const server = transport();
    const result = await loader({
      scope: { win: '30d', tz: 'UTC' }, spec: { scope: { captionKey: SCATTER_SPECS[id].scope.captionKey } },
      schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel
    });
    assert.equal(result.state, 'ready', `${id} settled (${result.state})`);
    const call = server.calls.find(item => item.name === 'entities');
    assert.ok(call, `${id} read entities`);
    assert.equal(call.params.get('fields'), fields, `${id} fields`);
    assert.equal(call.params.get('mode'), mode, `${id} mode`);
  }

  assert.deepEqual(scorerNames(BASELINES), ['alpha', 'beta', 'zeta']);
  assert.equal(defaultCheck(['structure', 'clarity']), 'clarity');
  assert.equal(resolveScorer(BASELINES, 'clarity', '').scorer, 'beta', 'the first lexical scorer with a positive baseline');
  assert.equal(resolveScorer(BASELINES, 'clarity', '').entry.n, 5);

  const server = transport();
  const result = await loadArtifact({
    scope: { win: '30d', tz: 'UTC' }, spec: { scope: { captionKey: 'G-artifactxy' } },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel: SCATTER_ARTIFACT_PANEL
  });
  assert.equal(result.state, 'ready', `artifact settled (${result.state})`);
  assert.equal(result.check, 'clarity');
  assert.equal(result.scorer, 'beta');
  const call = server.calls.find(item => item.name === 'entities');
  assert.equal(call.params.get('fields'), 'writing_session_cost_usd,score:clarity');
  assert.equal(call.params.get('check'), 'clarity');
  assert.equal(call.params.get('scorer'), 'beta');
});

test('the artifact P5 refuses a multi-kind scope before any read', async () => {
  const server = transport();
  const result = await loadArtifact({
    scope: { win: '30d', kind: ['design', 'brief'] }, spec: { scope: { captionKey: 'G-artifactxy' } },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel: SCATTER_ARTIFACT_PANEL
  });
  assert.equal(result.state, 'unsupported');
  assert.equal(result.message, 'Choose one document kind for this chart.');
  assert.deepEqual(result.labels, ['document kind']);
  assert.equal(server.calls.length, 0);
});

test('P6 offers numeric-only X/Y from the panel/schema intersection and Size then Colour', () => {
  const session = scatterAxes(SCATTER_SESSION_PANEL, schema);
  for (const name of ['cost_usd', 'commits', 'unpriced_calls']) assert.ok(session.axes.includes(name), name);
  assert.equal(session.axes.includes('id'), false);
  assert.equal(session.axes.includes('model'), false);
  assert.equal(scatterColours(SCATTER_SESSION_PANEL, schema).colours.includes('id'), false);

  const artifact = artifactAxes(schema, CATALOGUE);
  assert.ok(artifact.axes.includes('writing_session_cost_usd'));
  assert.ok(artifact.axes.includes('score:clarity'));
  assert.equal(artifact.axes.includes('model'), false);
  assert.equal(artifact.axes.includes('id'), false);

  const plan = planAxes(schema, CATALOGUE);
  assert.ok(plan.axes.includes('associated_cost_usd'));
  assert.ok(plan.axes.includes('artifacts'));
  assert.equal(plan.axes.includes('id'), false);

  const day = scatterAxes(SCATTER_DAY_PANEL, schema);
  assert.ok(day.axes.includes('cost_usd'));
  assert.ok(day.axes.includes('commits'));
  assert.equal(day.axes.includes('id'), false);
  assert.deepEqual(scatterColours(SCATTER_DAY_PANEL, schema).colours, [], 'the time grain has no categorical colour lens');

  const noSchema = resolveScatterFields({ spec: {}, schema: null, panel: { grain: 'session', measures: ['cost_usd', 'commits'], lenses: [] }, defaults: { x: 'cost_usd', y: 'commits', size: '', colour: '' } });
  assert.deepEqual({ x: noSchema.x, y: noSchema.y }, { x: 'cost_usd', y: 'commits' });
});

test('marginals are whole-population histograms with the fixed X-then-Y table', () => {
  const body = p11Scatter({ fields: ['cost_usd', 'commits', 'unpriced_calls'] });
  const model = marginalModel(body.marginals, ['cost_usd', 'commits', 'unpriced_calls']);
  assert.deepEqual(model.map(item => item.field), ['cost_usd', 'commits', 'unpriced_calls']);
  assert.equal(model[0].total, body.population.scope_n, 'cost marginal covers the whole scope population');
  assert.equal(model[1].total, body.population.eligible_n, 'commit marginal covers the whole eligible population');
  assert.equal(body.returned_n, 38);
  assert.notEqual(model[0].total, body.returned_n, 'marginals are not the sample');

  assert.deepEqual(marginalTableColumns().map(column => column.label), ['Axis', 'From', 'To', 'Count', 'Missing count']);
  const withMissing = marginalModel({ cost_usd: { bins: [{ lo: 0, hi: 1, n: 3 }, { lo: 1, hi: null, n: 2 }], missing: 4 } }, ['cost_usd']);
  const rows = marginalTableRows(withMissing);
  assert.deepEqual(rows[0], ['Priced spend', '0', '1', '3', '4']);
  assert.equal(rows[1][4], '—', 'the missing count is stated once per axis');
});

test('the scatter table is Identity then X/Y units, optional Size and Colour, identity ascending', async () => {
  assert.deepEqual(scatterTableColumns({ x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: '' }).map(column => column.label), [
    'Identity', 'X (USD)', 'Y (commits)', 'Size (calls)'
  ]);
  assert.deepEqual(scatterTableColumns({ x: 'associated_cost_usd', y: 'artifacts', size: '', colour: 'repo_id' }).map(column => column.label), [
    'Identity', 'X (USD)', 'Y (files)', 'Colour'
  ]);
  assert.equal(scatterTableColumns({ x: 'writing_session_cost_usd', y: 'score:clarity', size: '', colour: '' })[2].label, 'Y (normalized score 0–1)');

  assert.equal(scatterUnit('score:clarity'), 'normalized score 0–1');
  assert.equal(formatScatterCell(0.82, 'score:clarity'), '0.82');
  assert.doesNotMatch(formatScatterCell(0.82, 'score:clarity'), /82%/);

  const server = transport();
  const result = await loadPlan({
    scope: { win: '30d', tz: 'UTC' }, spec: { scope: { captionKey: 'G-planxy' } },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel: SCATTER_PLAN_PANEL
  });
  assert.equal(result.state, 'ready');
  const identities = result.tableRows.map(row => row[0]);
  assert.deepEqual(identities, [...identities].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(identities, ['repo-a/20', 'repo-b/21']);
  assert.equal(result.tableRows[0][1], '$5.50');
  assert.equal(result.tableRows[0][2], '4');
  assert.equal(result.tableRows[0][3], 'repo-a', 'plan defaults to repository colour');
});

test('an unsupported filter refuses verbatim with no marks and zero entity reads', async () => {
  const cases = [
    ['scatter-session', loadSession, SCATTER_SESSION_PANEL, 'kind', ['brief'], 'document kind'],
    ['scatter-artifact', loadArtifact, SCATTER_ARTIFACT_PANEL, 'tool', ['shell'], 'tool'],
    ['scatter-plan', loadPlan, SCATTER_PLAN_PANEL, 'kind', ['design'], 'document kind'],
    ['scatter-day', loadDay, SCATTER_DAY_PANEL, 'kind', ['design'], 'document kind']
  ];
  for (const [id, loader, panel, key, values, label] of cases) {
    const server = transport();
    const result = await loader({
      scope: { win: '30d', [key]: values }, spec: { scope: { captionKey: SCATTER_SPECS[id].scope.captionKey } },
      schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel
    });
    assert.equal(result.state, 'unsupported', `${id} refuses ${key}`);
    assert.equal(result.applicability, true, `${id} ${key} is an applicability refusal`);
    assert.equal(result.message, `This chart cannot apply ${label}. Change the filters to view it.`, `${id} ${key} exact sentence`);
    assert.equal(server.calls.length, 0, `${id} ${key} fetched nothing`);
  }

  const server = transport();
  const plural = await loadSession({
    scope: { win: '30d', tool: ['shell'], kind: ['brief'] }, spec: { scope: { captionKey: 'G-sessionxy' } },
    schema, transport: server, tenant: 'tenant-b', doc: fakeDoc(), panel: SCATTER_SESSION_PANEL
  });
  assert.equal(plural.message, 'This chart cannot apply document kind, tool. Change the filters to view it.');
  assert.equal(server.calls.length, 0);
});
