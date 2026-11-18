import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { decodeUrlState, encodeUrlState } from '../../web/contract/url-state.js';
import {
  canonicalPanelSpec, encodePanelSpec, decodePanelSpec, mergePanelSpec, effectiveScope, writePanelSpec, panelSpecFromState
} from '../../web/js/core/view-spec.js';
import { registerPanel, chooserOptions, clearPanels as resetPanels, validateRegistry } from '../../web/js/panels/registry.js';
const addPanel = registerPanel;
import { registerPreset, clearPresets, presetDestination, validatePresets } from '../../web/js/boards/presets.js';
import { assembleBoard } from '../../web/js/boards/board.js';
import {
  canTransition, assertTransition, emptyCauses, cancelledState, unsupportedState, unsupportedText, classifyResult
} from '../../web/js/core/panel-state.js';
import { saveBoard, readBoards, renameBoard, deleteBoard, lookupBoard, openBoard } from '../../web/js/core/saved-boards.js';
import { createFollow } from '../../web/js/core/follow.js';
import { parseRoute } from '../../web/js/core/router.js';
import { makeSchema } from './fixture.mjs';

const memoryStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    map
  };
};

const validPanel = (id = 'p') => ({
  id, grain: 'session', measures: ['cost_usd'], lenses: ['harness'], charts: ['lines'], requires: ['entities_session'], caveats: '', load: async () => ({ state: 'ready' })
});

beforeEach(() => { resetPanels(); clearPresets(); });

test('view specs round-trip canonically through p<n> and url state keeps raw panels', () => {
  const spec = { chart: 'lines', measures: ['commits', 'cost_usd'], grain: 'session', split: 'harness', scope: { win: '30d', repo_id: ['r1'] } };
  const encoded = encodePanelSpec(spec);
  assert.equal(encoded, encodePanelSpec({ ...spec, measures: ['cost_usd', 'commits'] }));
  assert.deepEqual(decodePanelSpec(encoded), canonicalPanelSpec(spec));
  const state = decodeUrlState(`?p1=${encodeURIComponent(encoded)}&future=x`);
  assert.equal(state.panels.p1, encoded);
  assert.deepEqual(state.panelSpecs.p1, canonicalPanelSpec(spec));
  const round = decodeUrlState(encodeUrlState(state, `?p1=${encodeURIComponent(encoded)}`).toString());
  assert.deepEqual(round, state);
  assert.deepEqual(round.unknown.future, ['x']);
});

test('scope overrides: panel beats board, and merge keeps preset defaults', () => {
  const scope = effectiveScope({ win: '7d', repo_id: ['a'], harness: ['h1'] }, { win: '30d' });
  assert.equal(scope.win, '30d');
  assert.deepEqual(scope.repo_id, ['a']);
  const merged = mergePanelSpec({ grain: 'session', measures: ['cost_usd'], chart: 'lines', scope: { win: '7d' } }, { measures: ['commits'], scope: { win: '90d' } });
  assert.equal(merged.grain, 'session');
  assert.deepEqual(merged.measures, ['commits']);
  assert.equal(merged.scope.win, '90d');
  const state = { panels: {}, panelSpecs: {} };
  writePanelSpec(state, 'p2', merged);
  assert.deepEqual(panelSpecFromState(state, 'p2'), merged);
});

test('registry rejects duplicates and unknown charts, and a preset naming a missing panel', () => {
  registerPanel(validPanel('a'));
  assert.throws(() => registerPanel(validPanel('a')), /duplicate panel id/);
  assert.throws(() => registerPanel({ ...validPanel('b'), charts: ['hologram'] }), /unknown chart/);
  registerPreset({ id: 'broken', title: 'Broken', panels: ['ghost'] });
  assert.throws(() => validatePresets(), /missing panel ghost/);
  assert.throws(() => validateRegistry({ presets: [{ id: 'x', panels: ['ghost'] }] }), /missing panel ghost/);
});

test('chooser offers only schema-listed combinations and names the rest', () => {
  const schema = makeSchema();
  const offered = chooserOptions({ grain: 'session', measures: ['cost_usd', 'nope'], lenses: ['harness', 'nope'], charts: ['lines', 'bars'], requires: ['entities_session'] }, schema);
  assert.deepEqual(offered.measures, ['cost_usd']);
  assert.deepEqual(offered.lenses, ['harness']);
  assert.deepEqual(offered.charts, ['lines', 'bars']);
  assert.deepEqual(offered.unsupported.map(item => item.name), ['nope', 'nope']);
});

test('presets resolve to named destinations until delivered, and boards cap at 12', () => {
  assert.equal(presetDestination('trends').kind, 'named');
  assert.equal(presetDestination('trends').phase, 10);
  assert.equal(presetDestination('scatter').phase, 11);
  assert.equal(presetDestination('workflow').phase, 12);
  assert.equal(presetDestination('pulse').kind, 'named');
  assert.equal(presetDestination('pulse').phase, 9);
  addPanel(validPanel('real'));
  registerPreset({ id: 'delivered', title: 'Delivered', panels: ['real'] });
  assert.equal(presetDestination('delivered').kind, 'board');
  addPanel(validPanel('ok'));
  registerPreset({ id: 'missing', title: 'Missing', panels: ['absent'] });
  const board = assembleBoard({ presetId: 'missing', state: { win: '30d' } });
  assert.equal(board.panels[0].reason, 'Panel absent is not registered.');
  const tooMany = assembleBoard({ presetId: 'delivered', state: {} });
  assert.equal(tooMany.kind, 'board');
  assert.equal(tooMany.panels.length, 1);
  assert.throws(() => registerPreset({ id: 'huge', title: 'Huge', panels: Array.from({ length: 13 }, (_, i) => `p${i}`) }), /more than 12 panels/);
});

test('panel states have one vocabulary and cancelled is never an error', () => {
  assert.equal(canTransition('loading', 'cancelled'), true);
  assert.equal(canTransition('cancelled', 'ready'), true);
  assert.throws(() => assertTransition('ready', 'exploded'), /cannot move/);
  const cancelled = cancelledState({ retry: () => {} });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal('code' in cancelled, false);
  const causes = emptyCauses({ filters: [{ key: 'harness', value: 'orca' }], cohort: { slot: 'A' } });
  assert.deepEqual(causes.map(c => c.kind), ['filter', 'cohort']);
  const text = unsupportedText(unsupportedState({ feature: 'activity', reason: 'not advertised', source: 'Phase 6', nearest: 'Pulse' }));
  assert.match(text, /activity is not supported/);
  assert.match(text, /Nearest supported choice: Pulse/);
  assert.equal(classifyResult(null).state, 'error');
});

test('saved boards store and reopen named URLs without becoming the source of truth', () => {
  const storage = memoryStorage();
  saveBoard('Weekly', '/b/pulse?win=7d', storage);
  saveBoard('Long', '/b/trends?win=120y', storage);
  assert.deepEqual(readBoards(storage).map(b => b.name), ['Long', 'Weekly']);
  assert.equal(lookupBoard('weekly', storage).url, '/b/pulse?win=7d');
  renameBoard('Weekly', 'Daily', storage);
  assert.equal(lookupBoard('Daily', storage).url, '/b/pulse?win=7d');
  let navigated = '';
  openBoard('Daily', { storage, navigate: url => { navigated = url; } });
  assert.equal(navigated, '/b/pulse?win=7d');
  deleteBoard('Long', storage);
  assert.deepEqual(readBoards(storage).map(b => b.name), ['Daily']);
});

test('Follow probes after the acknowledged watermark and never advances on failure or hidden', async () => {
  const documentRef = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  const calls = [];
  let mode = 'ok';
  const transport = {
    async get(_path, params) {
      calls.push(params.get('after'));
      if (mode === 'error') return { response: { ok: false, status: 500 }, body: { error: 'probe failed' } };
      if (mode === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return { response: { ok: true, status: 200 }, body: { counts: { session_start: 2, artifact_version: 1, execution: 0, rejection: 0 }, watermark: 'w1' } };
    }
  };
  const follow = createFollow({ transport, documentRef, setTimer: () => 1, clearTimer: () => {}, intervalSeconds: 30 });
  follow.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [null]);
  assert.equal(follow.watermark, '');
  assert.equal(follow.counts.session_start, 2);
  follow.acknowledge();
  assert.equal(follow.watermark, 'w1');
  await follow.probeNow();
  assert.deepEqual(calls, [null, 'w1']);
  mode = 'error';
  await follow.probeNow();
  assert.equal(follow.watermark, 'w1');
  assert.equal(calls.at(-1), 'w1');
  mode = 'abort';
  await follow.probeNow();
  assert.equal(follow.watermark, 'w1');
  documentRef.visibilityState = 'hidden';
  const before = calls.length;
  await follow.probeNow();
  assert.equal(calls.length, before);
  follow.destroy();
});

test('router names later destinations and keeps unknown paths in the not-found view', () => {
  assert.equal(parseRoute('/').kind, 'start');
  assert.equal(parseRoute('/b/trends').kind, 'named');
  assert.equal(parseRoute('/b/trends').phase, 10);
  assert.equal(parseRoute('/b/pulse').kind, 'named');
  assert.equal(parseRoute('/ledger').kind, 'explorer');
  assert.equal(parseRoute('/ops').kind, 'explorer');
  assert.equal(parseRoute('/plans/acme/20-analytics-reset').phase, 12);
  assert.equal(parseRoute('/sessions').kind, 'explorer');
  assert.equal(parseRoute('/sessions').explorer, 'sessions');
  assert.equal(parseRoute('/sessions/abc').kind, 'explorer');
  assert.equal(parseRoute('/sessions/abc').explorer, 'sessions');
  assert.equal(parseRoute('/sessions/abc').sessionId, 'abc');
  assert.equal(parseRoute('/artifact').phase, 12);
  assert.equal(parseRoute('/nope').kind, 'not-found');
});
