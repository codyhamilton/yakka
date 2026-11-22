// `/artifact` explorer: the read-only artifact reader. One artifact identity is
// `(repo_id, path)`; versions come from `/entity?grain=artifact`, the selected
// version's complete bytes from `/v1/analytics/content`, and the score history
// from the served version rows only. Text renders as text nodes, never markup.

import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { rememberedTenant } from '../../contract/session-gate.js';
import { unsupportedState, unsupportedText } from '../core/panel-state.js';
import { facetsParameters } from '../core/scope-controls.js';
import { formatNumber } from '../charts/formatters.js';
import { registerCaption } from '../panels/captions.js';
import { mountPanelViews } from '../panels/p10-shared.js';
import {
  artifactKind, completeBytes, COMPLETE_BYTES_HINT, fetchArtifactText, mapContentError
} from './artifact-content.js';
import { DIFF_CEILING, loadDiff, renderDiff } from './artifact-diff.js';

export { completeBytes, COMPLETE_BYTES_HINT };

export const title = 'Artifact';
export const phase = 12;

export const SCORE_CAPTION = 'Each point shows this file version’s clarity score at its observation time; higher points mean a higher score under the selected scorer.';
export const VERSION_LOADING_TEXT = 'Loading Version history…';
export const VERSION_EMPTY_TEXT = 'No records match these filters.';
export const VERSION_ERROR_TEXT = 'Could not load Version history.';
export const VERSION_MORE_TEXT = 'Load more versions';
export const OUTSIDE_NOTICE = 'This record is outside the current filters';

export const ARTIFACT_VERSION_COLUMNS = Object.freeze([
  { key: 'observed', label: 'Observed', width: 150 },
  { key: 'hash', label: 'Hash', width: 180 },
  { key: 'kind', label: 'Kind', width: 80 },
  { key: 'score', label: 'Score/scorer', width: 180 },
  { key: 'content', label: 'Content state', width: 110 },
  { key: 'verdict', label: 'Screen verdict', width: 110 },
  { key: 'session', label: 'Writing session', width: null }
]);

export const SCORE_COLUMNS = Object.freeze([
  { key: 'observed', label: 'Observed' },
  { key: 'hash', label: 'Version hash' },
  { key: 'check', label: 'Check' },
  { key: 'scorer', label: 'Scorer' },
  { key: 'score', label: 'Score' }
]);

registerCaption('artifact-score-history', SCORE_CAPTION);

const scheduler = createScheduler();
const transport = createTransport(scheduler);
let stylesLoaded = false;

export function ensureArtifactStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/artifact.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/artifact.css';
  doc.head?.append(link);
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function cellText(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

export function parseReaderIdentity(search = '') {
  const params = new URLSearchParams(search);
  const rawHash = (params.get('hash') || '').trim();
  const rawCompare = (params.get('compare') || '').trim();
  const hashOk = /^[0-9a-f]{64}$/.test(rawHash);
  const compareOk = /^[0-9a-f]{64}$/.test(rawCompare);
  return {
    repo_id: (params.get('repo_id') || '').trim(),
    path: (params.get('path') || '').trim(),
    hash: hashOk ? rawHash : '',
    compare: compareOk ? rawCompare : '',
    invalidCompare: params.has('compare') && !compareOk,
    invalidHash: rawHash !== '' && !hashOk
  };
}

// Identity appears exactly once in the encoded URL; unknown parameters drop.
export function readerUrl({ repo_id = '', path = '', hash = '', compare = '' } = {}) {
  const params = new URLSearchParams();
  if (repo_id) params.set('repo_id', repo_id);
  if (path) params.set('path', path);
  if (hash) params.set('hash', hash);
  if (compare) params.set('compare', compare);
  return `/artifact?${params.toString()}`;
}

export function planOfPath(path) {
  const match = /^docs\/plans\/([^/]+)\//.exec(String(path || ''));
  return match ? match[1] : '';
}

export function shortHash(hash) {
  const text = String(hash || '');
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

export function kindLabel(kind) {
  if (!kind) return '—';
  return kind === 'other' ? 'other (not stored)' : kind;
}

function observation(row = {}) {
  return row.received_at || row.ts || '';
}

export function versionLabel(row = {}) {
  return `${cellText(observation(row))} · ${shortHash(row.content_hash)}`;
}

export function sortVersions(rows = []) {
  return [...rows].sort((left, right) => {
    const byTime = String(observation(right)).localeCompare(String(observation(left)));
    if (byTime) return byTime;
    return String(left?.content_hash || '').localeCompare(String(right?.content_hash || ''));
  });
}

export function checkChoices(rows = [], catalogue = []) {
  const names = new Set();
  for (const row of rows) for (const check of Object.keys(row?.scores || {})) names.add(check);
  for (const item of catalogue) {
    const name = typeof item === 'string' ? item : item?.name;
    if (name) names.add(String(name));
  }
  return [...names].sort();
}

export function scoreCheckNames(rows = []) {
  return checkChoices(rows);
}

export function defaultScoreCheck(rows = []) {
  const names = scoreCheckNames(rows);
  return names.includes('clarity') ? 'clarity' : (names[0] || 'clarity');
}

export function defaultCheck(rows = [], choices = []) {
  const latest = rows[0] || null;
  const own = latest ? Object.keys(latest.scores || {}).sort() : [];
  if (own.length) return own[0];
  return choices[0] || '';
}

export function versionScore(row = {}, check = '') {
  const entry = row?.scores?.[check];
  if (!entry || entry.score === null || entry.score === undefined) return null;
  const score = Number(entry.score);
  if (!Number.isFinite(score)) return null;
  return { score, scorer: entry.scorer || '' };
}

export function scoreScorers(rows = [], check = '') {
  const names = new Set();
  for (const row of rows) {
    const entry = row?.scores?.[check];
    const score = Number(entry?.score);
    if (entry && Number.isFinite(score)) names.add(String(entry.scorer || '—'));
  }
  return [...names].sort();
}

export function defaultScorer(rows = [], check = '') {
  const scorers = scoreScorers(rows, check);
  return scorers[0] || '—';
}

// Observation time ascending, hash ascending. Only the selected scorer's points
// carry a score; a missing or differently-scored version stays an explicit gap.
export function scoreHistory(rows = [], { check = '', scorer = '' } = {}) {
  const ordered = sortVersions(rows).reverse();
  return ordered.map(row => {
    const entry = row?.scores?.[check];
    const value = Number(entry?.score);
    const plotted = Boolean(entry) && Number.isFinite(value) && String(entry.scorer || '—') === scorer;
    return {
      hash: String(row?.content_hash || ''),
      observed: observation(row),
      scorer: entry?.scorer ? String(entry.scorer) : '',
      score: plotted ? value : null
    };
  });
}

export function contentStateLabel(result = {}) {
  if (result.ok) return 'Stored';
  if (result.code === 'content_unavailable') {
    if (result.reason === 'not_stored') return 'Not stored';
    if (result.reason === 'pending') return 'Pending';
    if (result.reason === 'removed_by_screen') return 'Removed';
    return 'Unavailable';
  }
  if (result.code === 'content_too_large') return 'Too large';
  if (result.code === 'content_integrity') return 'Integrity error';
  if (result.status === 404) return 'Not found';
  return 'Unavailable';
}

function scoreCell(row = {}) {
  const names = Object.keys(row?.scores || {}).sort();
  if (!names.length) return '—';
  const name = names.includes('clarity') ? 'clarity' : names[0];
  const entry = row.scores[name] || {};
  const value = Number(entry.score);
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(2)} / ${cellText(entry.scorer)}`;
}

export function artifactVersionRows(rows = [], { contentStates = new Map(), defaultKind = '' } = {}) {
  return sortVersions(rows).map(row => ({
    observed: cellText(observation(row)),
    hash: shortHash(row.content_hash),
    fullHash: String(row.content_hash || ''),
    kind: kindLabel(row.kind || defaultKind || ''),
    score: scoreCell(row),
    content: contentStates.get(row.content_hash) || '—',
    verdict: cellText(row.screen?.verdict || 'unscreened'),
    session: cellText(row.writing_session)
  }));
}

export function compareDefaults(rows = [], selectedHash = '') {
  const ordered = sortVersions(rows);
  if (!ordered.length) return { from: '', to: '' };
  const to = ordered.some(row => row.content_hash === selectedHash) ? selectedHash : ordered[0].content_hash;
  const index = ordered.findIndex(row => row.content_hash === to);
  const from = ordered[index + 1]?.content_hash || ordered[ordered.length - 1]?.content_hash || '';
  return { from, to };
}

function scopeValues(scope, key) {
  const nested = scope?.filters?.[key];
  const direct = scope?.[key];
  return [...new Set([...(Array.isArray(nested) ? nested : nested ? [nested] : []), ...(Array.isArray(direct) ? direct : direct ? [direct] : [])])].filter(Boolean);
}

// F5: an exact identity outside the committed filters keeps its metadata and
// bytes, and says so rather than blanking the record.
export function outsideNotice({ repo_id = '', kind = '', row = null, scope = {}, window = null } = {}) {
  const repos = scopeValues(scope, 'repo_id');
  if (repos.length && !repos.includes(repo_id)) return OUTSIDE_NOTICE;
  const kinds = scopeValues(scope, 'kind');
  if (kinds.length && !kinds.includes(kind)) return OUTSIDE_NOTICE;
  if (row && window && window.all !== true) {
    const at = Date.parse(observation(row));
    const from = window.from ? Date.parse(window.from) : NaN;
    const to = window.to ? Date.parse(window.to) : NaN;
    if (Number.isFinite(at) && ((Number.isFinite(from) && at < from) || (Number.isFinite(to) && at > to))) return OUTSIDE_NOTICE;
  }
  return '';
}

export function contentStateText(result = {}) {
  const status = result.status ?? 0;
  const code = result.code || '';
  if (result.ok) return { kind: 'ready', status, code, message: '', detail: '' };
  if (code === 'content_unavailable') {
    const reason = result.reason || '';
    if (reason === 'not_stored') return { kind: 'not_stored', status, code, reason, message: 'not stored: this ledger has no blob for this version' };
    if (reason === 'pending') return { kind: 'pending', status, code, reason, message: 'pending: not served until ingest completes' };
    if (reason === 'removed_by_screen') return { kind: 'removed', status, code, reason, message: 'removed by screen' };
    return { kind: 'unavailable', status, code, reason, message: `content unavailable: ${reason || 'no reason given'}` };
  }
  if (code === 'content_too_large') {
    const size = result.size_bytes === null || result.size_bytes === undefined ? 'unknown' : formatNumber(Number(result.size_bytes));
    const limit = result.limit_bytes === null || result.limit_bytes === undefined ? 'unknown' : formatNumber(Number(result.limit_bytes));
    return { kind: 'too_large', status, code, message: `content too large: ${size} bytes exceeds the ${limit}-byte limit; no prefix is shown` };
  }
  if (code === 'content_integrity') return { kind: 'integrity', status, code, message: 'content integrity check failed' };
  if (status === 404) return { kind: 'not_found', status, code: 'not_found', message: 'not found for this repo and path' };
  if (status === 400) return { kind: 'identity', status, code, message: result.message || 'repo_id, path and a 64-hex hash are required' };
  return { kind: 'error', status, code, message: result.message || 'The content request failed.' };
}

function catalogueChecks(body) {
  const checks = Array.isArray(body?.checks) ? body.checks : [];
  return checks.map(item => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
}

function tableHead(doc, columns) {
  const head = doc.createElement('thead');
  const row = doc.createElement('tr');
  for (const column of columns) {
    const cell = el(doc, 'th', '', column.label);
    cell.scope = 'col';
    if (column.width) cell.setAttribute('width', String(column.width));
    row.append(cell);
  }
  head.append(row);
  return head;
}

function tableCols(doc, columns) {
  const group = doc.createElement('colgroup');
  for (const column of columns) {
    const col = doc.createElement('col');
    if (column.width) col.setAttribute('width', String(column.width));
    group.append(col);
  }
  return group;
}

function versionTable(doc, rows, { state, message = '', code = '', onRetry = null, onAll = null, onReset = null, contentStates = new Map(), defaultKind = '' } = {}) {
  const table = el(doc, 'table', 'artifact-table artifact-version-table');
  table.append(el(doc, 'caption', '', 'Version history'), tableCols(doc, ARTIFACT_VERSION_COLUMNS), tableHead(doc, ARTIFACT_VERSION_COLUMNS));
  const body = doc.createElement('tbody');
  if (state === 'loading') {
    const row = doc.createElement('tr');
    row.dataset.state = 'loading';
    row.setAttribute('aria-busy', 'true');
    const cell = el(doc, 'td', '', message || VERSION_LOADING_TEXT);
    cell.colSpan = ARTIFACT_VERSION_COLUMNS.length;
    row.append(cell);
    body.append(row);
  } else if (state === 'error') {
    const row = doc.createElement('tr');
    row.dataset.state = 'error';
    const cell = el(doc, 'td', '', `${message || VERSION_ERROR_TEXT}${code ? ` (${code})` : ''}`);
    cell.colSpan = ARTIFACT_VERSION_COLUMNS.length;
    row.append(cell);
    if (onRetry) {
      const retry = el(doc, 'button', 'artifact-retry', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', onRetry);
      cell.append(' ', retry);
    }
    body.append(row);
  } else if (state === 'empty') {
    const row = doc.createElement('tr');
    row.dataset.state = 'empty';
    const cell = el(doc, 'td', '', VERSION_EMPTY_TEXT);
    cell.colSpan = ARTIFACT_VERSION_COLUMNS.length;
    row.append(cell);
    if (onAll) {
      const all = el(doc, 'button', '', 'All history');
      all.type = 'button';
      all.addEventListener('click', onAll);
      cell.append(' ', all);
    }
    if (onReset) {
      const reset = el(doc, 'button', '', 'Reset filters');
      reset.type = 'button';
      reset.addEventListener('click', onReset);
      cell.append(' ', reset);
    }
    body.append(row);
  } else {
    for (const item of artifactVersionRows(rows, { contentStates, defaultKind })) {
      const row = doc.createElement('tr');
      row.dataset.hash = item.fullHash;
      const cells = [
        [item.observed, item.observed],
        [item.hash, item.fullHash],
        [item.kind, item.kind],
        [item.score, item.score],
        [item.content, item.content],
        [item.verdict, item.verdict],
        [item.session, item.session]
      ];
      for (const [text, title] of cells) {
        const cell = el(doc, 'td', '', text);
        cell.title = title;
        row.append(cell);
      }
      body.append(row);
    }
  }
  table.append(body);
  return table;
}

function axisLabel(doc, svg, x, y, text, anchor = 'start') {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', 'text');
  node.setAttribute('x', String(x));
  node.setAttribute('y', String(y));
  node.setAttribute('text-anchor', anchor);
  node.setAttribute('class', 'artifact-chart-label');
  node.textContent = text;
  svg.append(node);
}

function scoreChart(doc, history, { check, scorer } = {}) {
  const host = el(doc, 'div', 'artifact-score-chart');
  const points = history.map((point, index) => ({ ...point, index }));
  const scored = points.filter(point => point.score !== null);
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 640 160');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', SCORE_CAPTION);
  host.append(svg);
  if (!scored.length) {
    host.append(el(doc, 'p', 'artifact-score-empty', `No ${check || 'score'} history for this scorer.`));
    return host;
  }
  const left = 48;
  const right = 624;
  const top = 12;
  const bottom = 132;
  const span = Math.max(1, points.length - 1);
  const xAt = index => left + (points.length === 1 ? (right - left) / 2 : (right - left) * (index / span));
  const yAt = score => bottom - (bottom - top) * Math.max(0, Math.min(1, score));
  for (const value of [0, 0.5, 1]) {
    const line = doc.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(left));
    line.setAttribute('x2', String(right));
    line.setAttribute('y1', String(yAt(value)));
    line.setAttribute('y2', String(yAt(value)));
    line.setAttribute('class', 'artifact-chart-grid');
    svg.append(line);
    axisLabel(doc, svg, left - 6, yAt(value) + 4, value.toFixed(1), 'end');
  }
  let segment = [];
  const flush = () => {
    if (segment.length > 1) {
      const line = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', segment.map(point => `${xAt(point.index)},${yAt(point.score)}`).join(' '));
      line.setAttribute('class', 'artifact-chart-line');
      svg.append(line);
    }
    segment = [];
  };
  for (const point of points) {
    if (point.score === null) { flush(); continue; }
    segment.push(point);
    const mark = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
    mark.setAttribute('cx', String(xAt(point.index)));
    mark.setAttribute('cy', String(yAt(point.score)));
    mark.setAttribute('r', '3');
    mark.setAttribute('class', 'artifact-chart-mark');
    const title = doc.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${point.observed} · ${shortHash(point.hash)} · ${point.score.toFixed(2)} (${scorer})`;
    mark.append(title);
    svg.append(mark);
  }
  flush();
  axisLabel(doc, svg, left, 150, 'Observation time');
  axisLabel(doc, svg, right, 150, 'Clarity score (0–1)', 'end');
  return host;
}

function scoreTable(doc, history, { check } = {}) {
  const table = el(doc, 'table', 'artifact-table artifact-score-table');
  table.append(el(doc, 'caption', '', 'Clarity across file versions'), tableCols(doc, SCORE_COLUMNS), tableHead(doc, SCORE_COLUMNS));
  const body = doc.createElement('tbody');
  for (const point of history) {
    const row = doc.createElement('tr');
    const values = [
      [cellText(point.observed), cellText(point.observed)],
      [shortHash(point.hash), point.hash],
      [check || '—', check || '—'],
      [point.scorer || '—', point.scorer || '—'],
      [point.score === null ? '—' : point.score.toFixed(2), point.score === null ? '—' : point.score.toFixed(2)]
    ];
    for (const [text, title] of values) {
      const cell = el(doc, 'td', '', text);
      cell.title = title;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  return table;
}

function reroute(url) {
  globalThis.history.pushState(null, '', url);
  globalThis.dispatchEvent(new PopStateEvent('popstate'));
}

export function render(root, doc = globalThis.document, { signal, tenant = '', readContext = null } = {}) {
  ensureArtifactStyles(doc);
  const identity = parseReaderIdentity(globalThis.location?.search || '');
  root.replaceChildren();
  root.append(el(doc, 'h1', '', title));

  const section = doc.createElement('section');
  section.className = 'artifact-reader';
  section.dataset.panel = 'artifact-reader';
  section.dataset.state = 'loading';
  section.dataset.idle = 'false';
  root.append(section);

  const statusSlot = el(doc, 'p', 'artifact-reader-status');
  statusSlot.setAttribute('aria-live', 'polite');
  section.append(statusSlot);

  let disposed = false;
  let tenantValue = tenant;
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  function finish(state, message = '') {
    section.dataset.state = state;
    section.dataset.idle = state === 'loading' ? 'false' : 'true';
    statusSlot.textContent = message;
  }

  if (!identity.repo_id || !identity.path) {
    renderIdentityForm();
    return () => { disposed = true; controller.abort(); };
  }
  if (identity.invalidHash) {
    finish('identity-required', 'identity required: hash must be a 64-hex content hash.');
    return () => { disposed = true; controller.abort(); };
  }

  const { repo_id: repo, path } = identity;
  const kind = artifactKind(path);
  let rows = [];
  let next = null;
  let selectedHash = identity.hash;
  let compareHash = identity.compare;
  let versionState = 'loading';
  let versionMessage = VERSION_LOADING_TEXT;
  let versionCode = '';
  let check = '';
  let scorer = '';
  let checks = [];
  let scorers = [];
  let catalogue = [];
  let contentStates = new Map();
  let contentText = '';
  let contentHash = '';
  let contentFailure = null;
  let viewerMode = 'content';
  let pageMax = null;
  let outside = '';
  let compareController = null;
  let contentRun = 0;
  let diffRun = 0;
  let explicitPair = Boolean(identity.hash && identity.compare && identity.hash !== identity.compare);
  let scoreSlot = null;
  let viewerSlot = null;
  let contentPane = null;
  let diffPane = null;
  let contentTab = null;
  let diffTab = null;

  function currentRow() {
    return rows.find(row => row.content_hash === selectedHash) || null;
  }

  function updateOutside() {
    const row = currentRow();
    outside = outsideNotice({ repo_id: repo, kind, row, scope: readContext?.scope || {}, window: readContext?.window || null });
    identitySlot.textContent = `${repo} · ${path}`;
    identitySlot.title = `${repo} · ${path}`;
    if (outside) {
      outsideSlot.hidden = false;
      outsideSlot.textContent = outside;
    } else {
      outsideSlot.hidden = true;
      outsideSlot.textContent = '';
    }
  }

  function buildVersionsSlot() {
    const wrapper = el(doc, 'section', 'workspace-panel artifact-versions');
    wrapper.append(el(doc, 'h2', 'workspace-panel-title', 'Versions'));
    const controls = el(doc, 'div', 'artifact-version-controls');
    wrapper.append(controls);
    const slot = el(doc, 'div', 'artifact-version-slot');
    wrapper.append(slot);
    return { wrapper, controls, slot };
  }

  function paintVersionControls() {
    versionControls.replaceChildren();
    if (!rows.length) return;
    const versionLabelNode = el(doc, 'label', 'artifact-version-select');
    versionLabelNode.append(doc.createTextNode('Version '));
    const select = doc.createElement('select');
    select.className = 'artifact-version-chooser';
    select.setAttribute('aria-label', 'Version');
    for (const row of sortVersions(rows)) {
      const option = doc.createElement('option');
      option.value = row.content_hash;
      option.textContent = versionLabel(row);
      option.selected = row.content_hash === selectedHash;
      select.append(option);
    }
    select.addEventListener('change', () => selectVersion(select.value));
    versionLabelNode.append(select);
    versionControls.append(versionLabelNode);

    const defaults = compareDefaults(rows, selectedHash);
    compareHash = rows.some(row => row.content_hash === compareHash) ? compareHash : defaults.to;
    const pair = explicitPair && rows.some(row => row.content_hash === selectedHash)
      && rows.some(row => row.content_hash === compareHash) && selectedHash !== compareHash;
    const from = compareSelect('Compare from', 'from', pair ? selectedHash : defaults.from);
    const to = compareSelect('Compare to', 'to', pair ? compareHash : (compareHash || defaults.to));
    const show = el(doc, 'button', 'artifact-show-diff', 'Show diff');
    show.type = 'button';
    show.disabled = rows.length < 2;
    show.addEventListener('click', () => runDiff(from.select.value, to.select.value));
    versionControls.append(from.label, to.label, show);
  }

  function compareSelect(label, side, value) {
    const node = el(doc, 'label', 'artifact-compare-select');
    node.append(doc.createTextNode(`${label} `));
    const select = doc.createElement('select');
    select.className = `artifact-compare-${side}`;
    select.setAttribute('aria-label', label);
    for (const row of sortVersions(rows)) {
      const option = doc.createElement('option');
      option.value = row.content_hash;
      option.textContent = shortHash(row.content_hash);
      option.selected = row.content_hash === value;
      select.append(option);
    }
    node.append(select);
    return { label: node, select };
  }

  function paintVersionSlot() {
    const table = versionTable(doc, rows, {
      state: versionState,
      message: versionMessage,
      code: versionCode,
      contentStates,
      defaultKind: kind,
      onRetry: loadVersions,
      onAll: () => reroute(`${readerUrl({ repo_id: repo, path, hash: selectedHash, compare: compareHash })}&win=all`),
      onReset: () => reroute(readerUrl({ repo_id: repo, path, hash: selectedHash }))
    });
    const footer = el(doc, 'div', 'artifact-version-footer');
    footer.append(el(doc, 'p', 'artifact-versions-population', versionState === 'ready' ? `${formatNumber(rows.length)} versions shown${next ? '; more versions remain.' : '.'}` : ''));
    if (next && versionState === 'ready') {
      const more = el(doc, 'button', 'artifact-versions-more', VERSION_MORE_TEXT);
      more.type = 'button';
      more.addEventListener('click', loadMore);
      footer.append(more);
    }
    versionSlot.replaceChildren(table, footer);
  }

  function paintScorePanel() {
    const panel = el(doc, 'section', 'workspace-panel artifact-score');
    panel.dataset.panel = 'artifact-score-history';
    panel.append(el(doc, 'h2', 'workspace-panel-title', 'Clarity across file versions'));
    panel.append(el(doc, 'p', 'workspace-panel-caption', SCORE_CAPTION));
    const controls = el(doc, 'div', 'artifact-score-controls');
    const checkLabel = el(doc, 'label', 'artifact-score-check-label', 'Check ');
    const checkSelect = doc.createElement('select');
    checkSelect.className = 'artifact-score-check';
    checkSelect.setAttribute('aria-label', 'Check');
    for (const name of checks) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === check;
      checkSelect.append(option);
    }
    checkSelect.addEventListener('change', () => {
      check = checkSelect.value;
      scorers = scoreScorers(rows, check);
      scorer = scorers.includes(scorer) ? scorer : defaultScorer(rows, check);
      paintScorePanel();
    });
    checkLabel.append(checkSelect);
    const scorerLabel = el(doc, 'label', 'artifact-score-scorer-label', 'Scorer ');
    const scorerSelect = doc.createElement('select');
    scorerSelect.className = 'artifact-score-scorer';
    scorerSelect.setAttribute('aria-label', 'Scorer');
    for (const name of scorers) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === scorer;
      scorerSelect.append(option);
    }
    scorerSelect.addEventListener('change', () => { scorer = scorerSelect.value; paintScorePanel(); });
    scorerLabel.append(scorerSelect);
    controls.append(checkLabel, scorerLabel);
    panel.append(controls);

    const history = scoreHistory(rows, { check, scorer });
    const chart = scoreChart(doc, history, { check, scorer });
    const table = scoreTable(doc, history, { check, scorer });
    const views = mountPanelViews({ panelId: 'artifact-score-history', chart, table, doc, defaultView: 'chart', label: 'Score history view' });
    panel.append(views.element);
    scoreSlot.replaceChildren(panel);
  }

  function paintViewer() {
    const panel = el(doc, 'section', 'workspace-panel artifact-viewer');
    panel.append(el(doc, 'h2', 'workspace-panel-title', 'Version text — plain text'));
    const tabs = el(doc, 'div', 'artifact-view-tabs');
    tabs.setAttribute('role', 'tablist');
    contentTab = el(doc, 'button', 'artifact-tab', 'Content');
    contentTab.type = 'button';
    contentTab.setAttribute('role', 'tab');
    diffTab = el(doc, 'button', 'artifact-tab', 'Diff');
    diffTab.type = 'button';
    diffTab.setAttribute('role', 'tab');
    contentTab.addEventListener('click', () => { viewerMode = 'content'; paintViewerMode(); if (contentHash !== selectedHash) loadContent(selectedHash); });
    diffTab.addEventListener('click', () => { viewerMode = 'diff'; paintViewerMode(); });
    tabs.append(contentTab, diffTab);
    contentPane = el(doc, 'div', 'artifact-content-pane');
    diffPane = el(doc, 'div', 'artifact-diff-pane');
    panel.append(tabs, contentPane, diffPane);
    viewerSlot.replaceChildren(panel);
    paintViewerMode();
    paintContent();
    paintDiff();
  }

  function paintViewerMode() {
    if (!contentTab) return;
    const onContent = viewerMode === 'content';
    contentTab.setAttribute('aria-selected', String(onContent));
    diffTab.setAttribute('aria-selected', String(!onContent));
    contentPane.hidden = !onContent;
    diffPane.hidden = onContent;
  }

  function paintContent() {
    if (!contentPane) return;
    contentPane.replaceChildren();
    const row = currentRow();
    if (!row) {
      contentPane.append(el(doc, 'p', 'artifact-version-missing', 'version not found for this artifact'));
      return;
    }
    if (contentFailure) {
      const state = contentStateText(contentFailure);
      const block = el(doc, 'div', 'artifact-content-status');
      block.dataset.state = state.kind;
      block.append(el(doc, 'p', 'artifact-content-message', state.message));
      block.append(el(doc, 'p', 'artifact-content-code', `${state.status} ${state.code}${state.reason ? ` (${state.reason})` : ''}`.trim()));
      if (!['not_stored', 'pending', 'removed', 'not_found'].includes(state.kind)) {
        const retry = el(doc, 'button', 'artifact-content-retry', 'Retry');
        retry.type = 'button';
        retry.addEventListener('click', () => loadContent(selectedHash));
        block.append(retry);
      }
      contentPane.append(block);
      return;
    }
    if (contentHash !== selectedHash) {
      contentPane.append(el(doc, 'p', 'artifact-content-status', 'Loading content…'));
      return;
    }
    const pre = el(doc, 'pre', 'artifact-content');
    pre.textContent = contentText;
    const footer = el(doc, 'div', 'artifact-viewer-actions');
    const copy = el(doc, 'button', 'artifact-copy-text', 'Copy text');
    copy.type = 'button';
    copy.addEventListener('click', () => copyText(contentText));
    const download = el(doc, 'a', 'artifact-download-text', 'Download text');
    download.download = path.split('/').pop() || 'artifact.txt';
    download.href = downloadUrl(contentText);
    footer.append(copy, download, el(doc, 'span', 'artifact-exact-bytes', COMPLETE_BYTES_HINT));
    contentPane.append(pre, footer);
  }

  function paintDiff() {
    if (!diffPane) return;
    if (viewerMode !== 'diff') return;
    if (!diffPane.dataset.result) {
      diffPane.replaceChildren(el(doc, 'p', 'artifact-diff-message', 'Choose two versions and Show diff to compare complete text.'));
    }
  }

  function downloadUrl(text) {
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      return URL.createObjectURL(blob);
    } catch { return ''; }
  }

  async function copyText(value) {
    try {
      if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(value); return; }
    } catch {}
    const area = doc.createElement('textarea');
    area.value = value;
    area.setAttribute('aria-hidden', 'true');
    doc.body.append(area);
    area.select?.();
    try { doc.execCommand?.('copy'); } catch {}
    area.remove();
  }

  async function loadContent(hash) {
    const row = rows.find(item => item.content_hash === hash) || null;
    if (!row) { paintContent(); return; }
    const run = ++contentRun;
    contentFailure = null;
    contentHash = '';
    paintContent();
    const result = await fetchArtifactText({
      scheduler, repo, path, hash, tenant: tenantValue, signal: controller.signal, stateKey: 'artifact-content'
    }).catch(error => {
      if (error?.name === 'AbortError') return null;
      return mapContentError(0, { error: error?.message || 'The content request failed.' });
    });
    if (disposed || run !== contentRun || !result) return;
    if (!completeBytes(result)) {
      contentFailure = result;
      contentStates.set(hash, contentStateLabel(result));
      paintVersionSlot();
      paintContent();
      return;
    }
    contentStates.set(hash, 'Stored');
    contentText = result.text;
    contentHash = hash;
    paintVersionSlot();
    paintContent();
  }

  async function runDiff(from, to) {
    if (kind === 'other') {
      viewerMode = 'diff';
      paintViewerMode();
      diffPane.dataset.result = '1';
      diffPane.replaceChildren(el(doc, 'p', 'artifact-diff-message', 'Diff unavailable: this artifact kind is not stored.'));
      return;
    }
    if (!from || !to || from === to) {
      viewerMode = 'diff';
      paintViewerMode();
      diffPane.dataset.result = '1';
      diffPane.replaceChildren(el(doc, 'p', 'artifact-diff-message', 'Diff declined: select two different stored versions.'));
      return;
    }
    compareController?.abort();
    compareController = new AbortController();
    if (controller.signal.aborted) compareController.abort();
    const run = ++diffRun;
    selectedHash = from;
    compareHash = to;
    globalThis.history.pushState(null, '', readerUrl({ repo_id: repo, path, hash: from, compare: to }));
    viewerMode = 'diff';
    paintViewerMode();
    diffPane.dataset.result = '1';
    diffPane.replaceChildren(el(doc, 'p', 'artifact-diff-message', 'Loading complete version text…'));
    const result = await loadDiff({ scheduler, repo, path, a: from, b: to, tenant: tenantValue, signal: compareController.signal }).catch(error => {
      if (error?.name === 'AbortError') return null;
      return { ok: false, reason: `Diff declined: ${error?.message || 'content request failed'}` };
    });
    if (disposed || run !== diffRun || !result) return;
    diffPane.replaceChildren(result.ok ? renderDiff(doc, result.result) : el(doc, 'p', 'artifact-diff-message', result.reason));
  }

  async function selectVersion(hash) {
    explicitPair = false;
    selectedHash = hash;
    compareHash = compareDefaults(rows, hash).from;
    globalThis.history.pushState(null, '', readerUrl({ repo_id: repo, path, hash }));
    updateOutside();
    paintVersionControls();
    paintVersionSlot();
    if (viewerMode === 'content') await loadContent(hash);
    else paintContent();
  }

  async function loadMore() {
    if (!next) return;
    const params = new URLSearchParams({ grain: 'artifact', repo_id: repo, path, cursor: next });
    if (pageMax) params.set('limit', String(pageMax));
    const { response, body } = await transport.get('entity', params, { tenant: tenantValue, signal: controller.signal, stateKey: 'artifact-versions-more' });
    if (disposed) return;
    if (!response.ok) {
      versionMessage = VERSION_ERROR_TEXT;
      versionCode = body?.code || String(response.status);
      paintVersionSlot();
      return;
    }
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    rows = sortVersions([...rows, ...incoming]);
    next = body.next || null;
    paintVersionControls();
    paintVersionSlot();
    paintScorePanel();
  }

  let identitySlot;
  let outsideSlot;
  let versionControls;
  let versionSlot;

  async function loadVersions() {
    versionState = 'loading';
    versionMessage = VERSION_LOADING_TEXT;
    paintVersionSlot();
    const params = new URLSearchParams({ grain: 'artifact', repo_id: repo, path });
    if (pageMax) params.set('limit', String(pageMax));
    try {
      const result = await transport.get('entity', params, { tenant: tenantValue, signal: controller.signal, stateKey: 'artifact-versions' });
      if (disposed) return;
      if (!result.response.ok) {
        versionState = result.response.status === 404 ? 'empty' : 'error';
        versionMessage = result.response.status === 404 ? VERSION_EMPTY_TEXT : VERSION_ERROR_TEXT;
        versionCode = result.body?.code || String(result.response.status);
        paintVersionSlot();
        finish('error', result.body?.error || `The server returned ${result.response.status}.`);
        return;
      }
      rows = sortVersions(Array.isArray(result.body.rows) ? result.body.rows : []);
      next = typeof result.body.next === 'string' && result.body.next ? result.body.next : null;
      if (!rows.length) {
        versionState = 'empty';
        versionMessage = VERSION_EMPTY_TEXT;
        paintVersionSlot();
        finish('empty', 'no versions for this artifact');
        return;
      }
      versionState = 'ready';
      versionMessage = '';
      checks = checkChoices(rows, catalogue);
      check = defaultScoreCheck(rows) || checks[0] || 'clarity';
      scorers = scoreScorers(rows, check);
      scorer = scorers.includes(scorer) ? scorer : defaultScorer(rows, check);
      if (!selectedHash) selectedHash = result.body.latest?.content_hash || rows[0].content_hash;
      paintVersionControls();
      paintVersionSlot();
      paintScorePanel();
      paintViewer();
      updateOutside();
      finish('ready', '');
      await loadContent(selectedHash);
    } catch (error) {
      if (disposed || error?.name === 'AbortError') return;
      versionState = 'error';
      versionMessage = VERSION_ERROR_TEXT;
      versionCode = error?.code || '';
      paintVersionSlot();
      finish('error', error?.message || 'The artifact request failed.');
    }
  }

  async function start() {
    finish('loading', 'Loading artifact…');
    if (!tenantValue) {
      try {
        const me = await transport.request('me', { signal: controller.signal, stateKey: 'artifact-me' });
        tenantValue = rememberedTenant(me?.body || {});
      } catch { tenantValue = ''; }
    }
    if (disposed) return;
    let schema = null;
    try {
      const result = await transport.schema(tenantValue);
      if (result.response.ok) schema = result.body;
    } catch { schema = null; }
    if (disposed) return;
    if (schema?.features && schema.features.entities_artifact === false) {
      finish('unsupported', unsupportedText(unsupportedState({
        feature: 'entities_artifact', reason: 'not advertised by this server', source: 'Plan 20 Phase 6 (entities_artifact)'
      })));
      return;
    }
    const max = Number(schema?.budgets?.page_max);
    pageMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : null;
    if (kind !== 'other') {
      try {
        const result = await transport.get('scores', new URLSearchParams({ kind }), { tenant: tenantValue, signal: controller.signal, stateKey: 'artifact-catalogue' });
        if (result.response.ok) catalogue = catalogueChecks(result.body);
      } catch { catalogue = []; }
    }
    await loadVersions();
  }

  function renderIdentityForm() {
    finish('identity-required', 'identity required: choose a repository and enter a path.');
    const form = el(doc, 'form', 'artifact-identity-form');
    form.append(el(doc, 'h2', 'workspace-panel-title', 'Exact file'));
    const repoLabel = el(doc, 'label', 'artifact-identity-repo', 'Repository ');
    const repoSelect = doc.createElement('select');
    repoSelect.className = 'artifact-identity-repository';
    repoSelect.setAttribute('aria-label', 'Repository');
    repoSelect.append(el(doc, 'option', '', 'Choose a repository'));
    repoSelect.options[0].value = '';
    repoLabel.append(repoSelect);
    const pathLabel = el(doc, 'label', 'artifact-identity-path', 'Path ');
    const pathInput = doc.createElement('input');
    pathInput.className = 'artifact-identity-path-input';
    pathInput.type = 'text';
    pathInput.required = true;
    pathInput.placeholder = 'docs/plans/…/DESIGN.md';
    pathInput.setAttribute('aria-label', 'Path');
    pathLabel.append(pathInput);
    const submit = el(doc, 'button', 'artifact-open', 'Open artifact');
    submit.type = 'submit';
    submit.disabled = true;
    form.append(repoLabel, pathLabel, submit);
    section.append(form);
    const checkReady = () => { submit.disabled = !(repoSelect.value && pathInput.value.trim()); };
    repoSelect.addEventListener('change', checkReady);
    pathInput.addEventListener('input', checkReady);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!repoSelect.value || !pathInput.value.trim()) return;
      reroute(readerUrl({ repo_id: repoSelect.value, path: pathInput.value.trim() }));
    });
    if (!tenantValue) {
      transport.request('me', { signal: controller.signal, stateKey: 'artifact-me' }).then(result => {
        tenantValue = rememberedTenant(result?.body || {});
        loadFacets();
      }).catch(() => loadFacets());
    } else {
      loadFacets();
    }
    async function loadFacets() {
      const schema = await transport.schema(tenantValue).catch(() => null);
      if (disposed || !schema?.features?.facets) return;
      const params = facetsParameters(readContext || {});
      transport.get('facets', params, { tenant: tenantValue, signal: controller.signal, stateKey: 'artifact-facets' }).then(({ response, body }) => {
        if (disposed || !response.ok) return;
        const repos = (body?.repos || []).map(value => typeof value === 'string' ? value : String(value?.name ?? value?.value ?? '')).filter(Boolean);
        repoSelect.replaceChildren();
        const blank = el(doc, 'option', '', 'Choose a repository');
        blank.value = '';
        repoSelect.append(blank);
        for (const name of [...new Set(repos)].sort()) {
          const option = el(doc, 'option', '', name);
          option.value = name;
          repoSelect.append(option);
        }
        checkReady();
      }).catch(() => {});
    }
  }

  identitySlot = el(doc, 'p', 'artifact-identity');
  outsideSlot = el(doc, 'p', 'artifact-outside');
  outsideSlot.hidden = true;
  section.append(identitySlot, outsideSlot);
  const versions = buildVersionsSlot();
  versionControls = versions.controls;
  versionSlot = versions.slot;
  section.append(versions.wrapper);
  const scoreSection = el(doc, 'div', 'artifact-score-slot');
  scoreSlot = scoreSection;
  section.append(scoreSection);
  const viewerSection = el(doc, 'div', 'artifact-viewer-slot');
  viewerSlot = viewerSection;
  section.append(viewerSection);

  start();

  return () => { disposed = true; controller.abort(); compareController?.abort(); };
}

export default { title, phase, render };
