// Phase 30 unit U10: Artifact and Operations contracts that can be checked
// without a browser. Literal captions, exact columns, source mapping, byte and
// page vocabulary are fixed here, not in the renderers.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTIFACT_VERSION_COLUMNS, COMPLETE_BYTES_HINT, OUTSIDE_NOTICE, SCORE_CAPTION, SCORE_COLUMNS,
  VERSION_EMPTY_TEXT, VERSION_ERROR_TEXT, VERSION_LOADING_TEXT, VERSION_MORE_TEXT,
  artifactVersionRows, compareDefaults, completeBytes, contentStateLabel, contentStateText,
  defaultScorer, outsideNotice, parseReaderIdentity, readerUrl, scoreHistory, scoreScorers, shortHash, sortVersions
} from '../../web/js/explorers/artifact.js';
import { diffLines, diffWithinCeiling } from '../../web/js/explorers/artifact-diff.js';
import { captionFor, hasCaption } from '../../web/js/panels/captions.js';
import {
  ADMIN_ONLY_TEXT, FOOTPRINT_CAPTION, FOOTPRINT_ERROR_TEXT, FOOTPRINT_LOADING_TEXT, OPS_PANEL,
  footprintRows, formatBytes, mapStatusResponse
} from '../../web/js/panels/ops-footprint.js';
import {
  HEALTH_ERROR_TEXT, HEALTH_LOADING_TEXT, METADATA_NOTICE, RECORDS_CAPTION, RECORDS_EMPTY_TEXT,
  RECORDS_ERROR_TEXT, RECORDS_LOADING_MORE_TEXT, RECORDS_LOADING_TEXT, RECORDS_MORE_TEXT,
  RECORD_COLUMNS, healthRows, recordCells, recordsPagingText
} from '../../web/js/ops.js';
import { validatePanelEntry } from '../../web/js/panels/registry.js';

const H = {
  v1: 'a1'.repeat(32), v2: 'a2'.repeat(32), v3: 'a3'.repeat(32), v4: 'a4'.repeat(32)
};

function version(hash, received, scores = {}) {
  return { content_hash: hash, received_at: received, ts: received, scores };
}

test('both chart captions are the literal DESIGN.md sentences and are registered', () => {
  assert.equal(SCORE_CAPTION, 'Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.');
  assert.equal(FOOTPRINT_CAPTION, 'Each bar shows retained bytes for one storage category in this tenant; longer bars mean more space used.');
  assert.equal(hasCaption('artifact-score-history'), true);
  assert.equal(captionFor({ id: 'artifact-score-history' }), SCORE_CAPTION);
  assert.equal(hasCaption('ops-footprint'), true);
  assert.equal(captionFor({ id: 'ops-footprint' }), FOOTPRINT_CAPTION);
});

test('artifact version history columns, widths and order are the screen contract', () => {
  assert.deepEqual(ARTIFACT_VERSION_COLUMNS.map(column => [column.label, column.width]), [
    ['Observed', 150], ['Hash', 180], ['Kind', 80], ['Score/scorer', 180],
    ['Content state', 110], ['Screen verdict', 110], ['Writing session', null]
  ]);
  const rows = artifactVersionRows([
    version(H.v1, '2026-10-01T00:00:00Z', { clarity: { score: 0.4, scorer: 's1' } })
  ], { defaultKind: 'design' });
  assert.deepEqual(rows[0], {
    observed: '2026-10-01T00:00:00Z', hash: shortHash(H.v1), fullHash: H.v1, kind: 'design',
    score: '0.40 / s1', content: '—', verdict: 'unscreened', session: '—'
  });
});

test('versions order observed DESC then hash ASC and the score table ascends', () => {
  const rows = [
    version(H.v1, '2026-10-01T00:00:00Z', { clarity: { score: 0.1, scorer: 's1' } }),
    version(H.v2, '2026-10-03T00:00:00Z', { clarity: { score: 0.9, scorer: 's1' } }),
    version(H.v3, '2026-10-02T00:00:00Z', { clarity: { score: 0.5, scorer: 's2' } }),
    version(H.v4, '2026-10-04T00:00:00Z')
  ];
  assert.deepEqual(sortVersions(rows).map(row => row.content_hash), [H.v4, H.v2, H.v3, H.v1]);
  assert.deepEqual(scoreScorers(rows, 'clarity'), ['s1', 's2']);
  assert.equal(defaultScorer(rows, 'clarity'), 's1');
  const history = scoreHistory(rows, { check: 'clarity', scorer: 's1' });
  assert.deepEqual(history.map(point => point.hash), [H.v1, H.v3, H.v2, H.v4]);
  assert.deepEqual(history.map(point => point.score), [0.1, null, 0.9, null]);
  assert.deepEqual(history.map(point => point.scorer), ['s1', 's2', 's1', '']);
  assert.deepEqual(SCORE_COLUMNS.map(column => column.label), ['Observed', 'Version hash', 'Check', 'Scorer', 'Score']);
});

test('compare defaults are previous and latest and the reader URL encodes identity once', () => {
  const rows = sortVersions([
    version(H.v1, '2026-10-01T00:00:00Z'), version(H.v2, '2026-10-02T00:00:00Z'), version(H.v3, '2026-10-03T00:00:00Z')
  ]);
  assert.deepEqual(compareDefaults(rows, H.v3), { from: H.v2, to: H.v3 });
  assert.deepEqual(compareDefaults(rows, H.v1), { from: H.v1, to: H.v1 });
  const url = readerUrl({ repo_id: 'codyhamilton/yakka', path: 'docs/plans/30/DESIGN.md', hash: H.v1, compare: H.v2 });
  const parsed = new URL(url, 'http://example.invalid');
  assert.equal(parsed.pathname, '/artifact');
  assert.equal(parsed.searchParams.get('repo_id'), 'codyhamilton/yakka');
  assert.equal(parsed.searchParams.get('path'), 'docs/plans/30/DESIGN.md');
  assert.equal(parsed.searchParams.get('hash'), H.v1);
  assert.equal(parsed.searchParams.get('compare'), H.v2);
  assert.deepEqual([...parsed.searchParams.keys()].sort(), ['compare', 'hash', 'path', 'repo_id']);
  assert.equal(parseReaderIdentity(`?repo_id=r&path=${encodeURIComponent('docs/plans/30/DESIGN.md')}&hash=abc`).invalidHash, true);
});

test('the F5 outside-filter notice fires on repo, kind or time and keeps identity', () => {
  const row = version(H.v1, '2026-10-01T00:00:00Z');
  assert.equal(outsideNotice({ repo_id: 'r', kind: 'design', row, scope: {}, window: null }), '');
  assert.equal(outsideNotice({ repo_id: 'r', kind: 'design', row, scope: { filters: { repo_id: ['other'] } } }), OUTSIDE_NOTICE);
  assert.equal(outsideNotice({ repo_id: 'r', kind: 'design', row, scope: { filters: { kind: ['brief'] } } }), OUTSIDE_NOTICE);
  assert.equal(outsideNotice({
    repo_id: 'r', kind: 'design', row,
    window: { from: '2026-10-02T00:00:00Z', to: '2026-10-03T00:00:00Z', all: false }
  }), OUTSIDE_NOTICE);
  assert.equal(outsideNotice({
    repo_id: 'r', kind: 'design', row,
    window: { from: '2026-09-01T00:00:00Z', to: '2026-10-02T00:00:00Z', all: false }
  }), '');
});

test('content copy and download are offered only for complete available bytes', () => {
  assert.equal(completeBytes({ ok: true, text: '' }), true);
  assert.equal(completeBytes({ ok: true, text: '# full body' }), true);
  assert.equal(completeBytes({ ok: false, status: 413, code: 'content_too_large', text: 'prefix' }), false);
  assert.equal(completeBytes({ ok: false, status: 404, code: 'content_unavailable', reason: 'pending' }), false);
  assert.equal(COMPLETE_BYTES_HINT, 'Exact version; analytics time filter does not alter these bytes');
  assert.equal(contentStateLabel({ ok: true }), 'Stored');
  assert.equal(contentStateLabel({ ok: false, code: 'content_unavailable', reason: 'not_stored' }), 'Not stored');
  assert.equal(contentStateLabel({ ok: false, code: 'content_too_large' }), 'Too large');
  assert.match(contentStateText({ ok: false, status: 413, code: 'content_too_large', size_bytes: 20, limit_bytes: 10 }).message, /no prefix is shown/);
});

test('a declined diff renders no prefix body and the ceiling is declared per side', () => {
  assert.equal(diffWithinCeiling('x'.repeat(10), 'y'.repeat(10)).ok, true);
  const over = diffWithinCeiling('x'.repeat(262145), '');
  assert.equal(over.ok, false);
  assert.match(over.reason, /262,144 bytes and 2,000 lines per side/);
  assert.deepEqual(diffLines('a\nb', 'a\nc'), {
    hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [
      { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'remove', text: 'b', oldLine: 2, newLine: null },
      { kind: 'add', text: 'c', oldLine: null, newLine: 2 }
    ] }], added: 1, removed: 1, unchanged: 1, truncated: false
  });
});

test('the four health rows use the exact sources and metadata notices', () => {
  const rows = healthRows({
    summary: { unpriced_calls: 12 },
    eventCounts: { matched: { rejections: 4 } },
    schema: { coverage: { scored_content_by_kind: { design: { total: 10, scored: 8 } }, sessions: { without_session_repo: 6 } } },
    kind: 'design'
  });
  assert.deepEqual(rows.map(row => row.measure), [
    'Unpriced calls',
    'Unscored design content versions (all history)',
    'Rejected submissions',
    'Sessions without repository attribution (all history)'
  ]);
  assert.deepEqual(rows.map(row => row.count), [12, 2, 4, 6]);
  assert.equal(rows[0].meaning, 'Calls with no usable price');
  assert.equal(rows[2].meaning, 'Submissions rejected at precheck or screen');
  assert.match(rows[1].meaning, new RegExp(METADATA_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(rows[3].meaning, METADATA_NOTICE);
  const selected = healthRows({ kind: 'brief', schema: { coverage: { scored_content_by_kind: { brief: { total: 9, scored: 4 }, design: { total: 10, scored: 8 } } } } });
  assert.equal(selected[1].measure, 'Unscored brief content versions (all history)');
  assert.equal(selected[1].count, 5);
});

test('missing health sources are unavailable, never a fabricated zero', () => {
  const rows = healthRows({ kind: 'design' });
  assert.deepEqual(rows.map(row => row.count), [null, null, null, null]);
  const partial = healthRows({ summary: { unpriced_calls: 0 } });
  assert.equal(partial[0].count, 0);
  assert.equal(partial[1].count, null);
});

test('footprint bytes sort desc then category asc, null last, and display binary units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1 KiB');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(1073741824), '1 GiB');
  assert.equal(formatBytes(null), '—');
  const rows = footprintRows({ footprint: {
    ledger_bytes: 1000, wal_bytes: 0, archive_bytes: 2048, blob_bytes: 3072,
    pending_bytes: null, other_bytes: 0
  } });
  assert.deepEqual(rows.map(row => [row.label, row.bytes]), [
    ['Blobs', 3072], ['Archive', 2048], ['Ledger', 1000], ['Other', 0], ['WAL', 0], ['Pending', null]
  ]);
  assert.deepEqual(rows.map(row => formatBytes(row.bytes)), ['3 KiB', '2 KiB', '1000 B', '0 B', '0 B', '—']);
});

test('a 403 is the exact administrator-only text and exposes no tenant values', () => {
  const refused = mapStatusResponse({ status: 403, body: { error: 'forbidden' }, tenant: 'alpha' });
  assert.equal(refused.state, 'unsupported');
  assert.equal(refused.message, ADMIN_ONLY_TEXT);
  assert.equal(ADMIN_ONLY_TEXT, 'Storage information is available to server administrators only.');
  assert.ok(!('tenants' in refused));
  assert.equal(mapStatusResponse({ status: 401, body: {} }).state, 'error');
});

test('status selects the exact tenant by id and never sums tenants', () => {
  const result = mapStatusResponse({
    status: 200,
    tenant: 'beta',
    body: {
      tenants: [
        { id: 'alpha', name: 'Alpha', footprint: { ledger_bytes: 1000 } },
        { id: 'beta', name: 'Beta', footprint: { ledger_bytes: 2000 } }
      ]
    }
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.selected.id, 'beta');
  assert.equal(footprintRows(result.selected)[0].label, 'Ledger');
  assert.equal(footprintRows(result.selected)[0].bytes, 2000);
  assert.ok(!('footprint' in result));
  const absent = mapStatusResponse({ status: 200, tenant: 'gamma', body: { tenants: [{ id: 'alpha' }] } });
  assert.equal(absent.tenantFound, false);
});

test('recent-record columns, cells and paging vocabulary are exact', () => {
  assert.deepEqual(RECORD_COLUMNS.map(column => [column.label, column.width]), [
    ['Time', 150], ['Type', 120], ['Path/event', null], ['Stage', 100]
  ]);
  assert.equal(RECORDS_CAPTION, 'Recent retained records');
  const rejected = recordCells({ ts: '2026-10-01T00:00:00Z', type: 'rejection', path: '', event: '', rejection_stage: 'Precheck', repo_id: '', path: '' });
  assert.deepEqual(rejected, { time: '2026-10-01 00:00:00', type: 'Rejection', path: '—', stage: 'Precheck', link: '' });
  const stored = recordCells({ ts: '2026-10-01T00:00:00Z', type: 'rejection', repo_id: 'repo-a', path: 'docs/01.md', rejection_stage: 'screen' });
  assert.match(stored.link, /^\/artifact\?/);
  assert.equal(new URL(stored.link, 'http://x').searchParams.get('path'), 'docs/01.md');
  const fact = recordCells({ ts: '2026-10-01T00:00:00Z', type: 'hook_event', event: 'PostToolBatch' });
  assert.equal(fact.type, 'Hook event');
  assert.equal(fact.path, 'PostToolBatch');
  assert.equal(recordsPagingText({ shown: 100, hasNext: true }), '100 rows shown; more rows remain.');
  assert.equal(recordsPagingText({ shown: 237, hasNext: false }), '237 rows shown; end of the ledger.');
});

test('T1-T4 vocabulary for this unit is literal', () => {
  assert.equal(VERSION_LOADING_TEXT, 'Loading Version history…');
  assert.equal(VERSION_EMPTY_TEXT, 'No records match these filters.');
  assert.equal(VERSION_ERROR_TEXT, 'Could not load Version history.');
  assert.equal(VERSION_MORE_TEXT, 'Load more versions');
  assert.equal(HEALTH_LOADING_TEXT, 'Loading Tenant health…');
  assert.equal(HEALTH_ERROR_TEXT, 'Could not load Tenant health.');
  assert.equal(FOOTPRINT_LOADING_TEXT, 'Loading Retained storage…');
  assert.equal(FOOTPRINT_ERROR_TEXT, 'Could not load Retained storage.');
  assert.equal(RECORDS_LOADING_TEXT, 'Loading Recent retained records…');
  assert.equal(RECORDS_EMPTY_TEXT, 'No records match these filters.');
  assert.equal(RECORDS_ERROR_TEXT, 'Could not load Recent retained records.');
  assert.equal(RECORDS_MORE_TEXT, 'Load more events');
  assert.equal(RECORDS_LOADING_MORE_TEXT, 'Loading…');
});

test('the footprint panel remains a valid bars-or-table administrator entry', () => {
  assert.doesNotThrow(() => validatePanelEntry(OPS_PANEL));
  assert.equal(OPS_PANEL.grain, 'tenant');
  assert.deepEqual(OPS_PANEL.charts, ['bars']);
  assert.equal(OPS_PANEL.table, true);
  assert.deepEqual(OPS_PANEL.requests(), [{ route: '/v1/admin/status', method: 'GET', session: true }]);
  assert.equal(typeof OPS_PANEL.load, 'function');
});
