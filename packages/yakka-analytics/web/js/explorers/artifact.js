// `/artifact` explorer: the read-only artifact reader. One artifact identity is
// `(repo_id, path)`; its versions come from `/entity?grain=artifact` and the
// selected version's complete bytes from `/v1/analytics/content`. Text renders
// as text nodes only (no HTML, no markdown dependency, no anchors or images from
// the body), long bodies are chunked display windows, and a missing body shows
// the server's exact reason. It adds no route, grain, join or dependency.

import { createScheduler } from '../core/request-scheduler.js';
import { createTransport } from '../../contract/transport.js';
import { rememberedTenant } from '../../contract/session-gate.js';
import { unsupportedState, unsupportedText } from '../core/panel-state.js';
import { formatNumber } from '../charts/formatters.js';
import {
  artifactKind, bandFor, chunkText, createBaselineCache, fetchArtifactText, mapContentError, parseOutline
} from './artifact-content.js';

export const title = 'Artifact';
export const phase = 12;

const scheduler = createScheduler();
const transport = createTransport(scheduler);

const CHUNK_LINES = 400;

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
  const hash = /^[0-9a-f]{64}$/.test(rawHash) ? rawHash : '';
  return {
    repo_id: (params.get('repo_id') || '').trim(),
    path: (params.get('path') || '').trim(),
    hash,
    invalidHash: rawHash !== '' && hash === ''
  };
}

// The clean reader URL: exactly repo_id, path and an optional 64-hex hash.
// Unknown parameters are dropped.
export function readerUrl({ repo_id = '', path = '', hash = '' } = {}) {
  const params = new URLSearchParams();
  if (repo_id) params.set('repo_id', repo_id);
  if (path) params.set('path', path);
  if (hash) params.set('hash', hash);
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

export function checkChoices(rows = [], catalogue = []) {
  const names = new Set();
  for (const row of rows) for (const check of Object.keys(row?.scores || {})) names.add(check);
  for (const item of catalogue) {
    const name = typeof item === 'string' ? item : item?.name;
    if (name) names.add(String(name));
  }
  return [...names].sort();
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

// Every non-200 content state, named with the server's own reason/limits.
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

export function render(root, doc = globalThis.document, { signal } = {}) {
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
  const versionsSlot = el(doc, 'div', 'artifact-versions');
  const versionSlot = el(doc, 'section', 'artifact-version');
  versionSlot.dataset.state = 'idle';
  section.append(statusSlot, versionsSlot, versionSlot);

  let disposed = false;
  let controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  function setState(state, message = '') {
    section.dataset.state = state;
    section.dataset.idle = state === 'loading' ? 'false' : 'true';
    statusSlot.textContent = message;
  }

  if (!identity.repo_id || !identity.path) {
    setState('identity-required', 'identity required: repo_id and path are required.');
    return () => { disposed = true; controller.abort(); };
  }
  if (identity.invalidHash) {
    setState('identity-required', 'identity required: hash must be a 64-hex content hash.');
    return () => { disposed = true; controller.abort(); };
  }

  const { repo_id: repo, path } = identity;
  const kind = artifactKind(path);
  let rows = [];
  let next = null;
  let latestHash = '';
  let selectedHash = identity.hash;
  let check = '';
  let checks = [];
  let textCache = new Map();
  let bandByHash = new Map();
  let bodyModel = null;
  let bodyWrap = null;
  let contentRun = 0;
  let baselineCache = null;
  let tenant = '';

  function scopeText() {
    const returned = rows.length;
    const total = latestTotal();
    return `${formatNumber(returned)} of ${formatNumber(total)} versions shown`;
  }

  function latestTotal() {
    return Number(population?.scope_n ?? population?.eligible_n ?? rows.length);
  }

  let population = null;

  async function paintStrip() {
    versionsSlot.replaceChildren();
    bandByHash = new Map();
    if (checks.length > 1) paintCheckChooser();
    const strip = el(doc, 'div', 'artifact-version-strip');
    const promises = [];
    rows.forEach((row, index) => {
      const score = versionScore(row, check);
      const mark = el(doc, 'button', 'artifact-version-mark');
      mark.type = 'button';
      mark.dataset.hash = row.content_hash;
      mark.dataset.selected = row.content_hash === selectedHash ? 'true' : 'false';
      mark.append(el(doc, 'span', 'artifact-mark-pos', `#${index + 1}`));
      mark.append(el(doc, 'span', 'artifact-mark-hash', shortHash(row.content_hash)));
      mark.append(el(doc, 'span', 'artifact-mark-ts', cellText(row.received_at || row.ts)));
      mark.append(el(doc, 'span', 'artifact-mark-screen', row.screen?.verdict || 'unscreened'));
      const scoresBox = el(doc, 'span', 'artifact-mark-scores');
      const names = Object.keys(row.scores || {}).sort();
      if (names.length) {
        for (const name of names) {
          const entry = row.scores[name] || {};
          scoresBox.append(el(doc, 'span', 'artifact-mark-score', `${name} ${Number(entry.score).toFixed(2)} (${entry.scorer || '—'})`));
        }
      } else {
        scoresBox.append(el(doc, 'span', 'artifact-mark-score', 'no scores'));
      }
      mark.append(scoresBox);
      const band = el(doc, 'span', 'artifact-mark-band', score ? '…' : 'unscored');
      band.dataset.band = score ? '' : 'unscored';
      mark.append(band);
      mark.addEventListener('click', () => selectVersion(row.content_hash));
      strip.append(mark);
      if (score) {
        promises.push(bandForVersion(row, score).then(value => {
          band.textContent = value;
          band.dataset.band = value;
          bandByHash.set(row.content_hash, value);
        }));
      }
    });
    versionsSlot.append(strip);
    versionsSlot.append(el(doc, 'p', 'artifact-versions-population', rows.length ? `${scopeText()}${next ? '; more versions remain.' : '.'}` : 'No versions returned.'));
    if (next) {
      const more = el(doc, 'button', 'artifact-versions-more', 'Load more');
      more.type = 'button';
      more.addEventListener('click', async () => {
        more.disabled = true;
        await loadMore();
      });
      versionsSlot.append(more);
    }
    await Promise.all(promises);
  }

  async function bandForVersion(row, score) {
    try {
      const baseline = await baselineCache.get(kind, check, score.scorer);
      return bandFor(score.score, baseline);
    } catch (error) {
      if (error?.name === 'AbortError') return 'baseline_unavailable';
      return 'baseline_unavailable';
    }
  }

  function paintCheckChooser() {
    const bar = el(doc, 'div', 'artifact-check');
    bar.append(el(doc, 'span', 'artifact-check-label', 'Check'));
    const select = doc.createElement('select');
    select.className = 'artifact-check-chooser';
    select.setAttribute('aria-label', 'Band check');
    for (const name of checks) {
      const option = doc.createElement('option');
      option.value = name;
      option.textContent = name;
      option.selected = name === check;
      select.append(option);
    }
    select.addEventListener('change', async () => {
      check = select.value;
      await paintStrip();
      await renderSelected();
    });
    bar.append(select);
    versionsSlot.append(bar);
  }

  function renderHeader(row) {
    const head = el(doc, 'div', 'artifact-version-header');
    const dl = doc.createElement('dl');
    const push = (label, value) => dl.append(el(doc, 'dt', '', label), el(doc, 'dd', '', value));
    push('Path', path);
    push('Kind', kind === 'other' ? 'other (not stored)' : kind);
    const hashRow = el(doc, 'dd', 'artifact-hash-row');
    hashRow.append(el(doc, 'code', 'artifact-hash', shortHash(row.content_hash)));
    const copyHash = el(doc, 'button', 'artifact-copy-hash', 'Copy hash');
    copyHash.type = 'button';
    copyHash.addEventListener('click', () => copyText(row.content_hash));
    hashRow.append(copyHash);
    dl.append(el(doc, 'dt', '', 'Hash'), hashRow);
    push('Version ts', cellText(row.ts));
    push('Received', cellText(row.received_at));
    push('Source', cellText(row.source));
    push('SHA', cellText(row.sha));
    push('Screen', row.screen ? `${row.screen.verdict || '—'} · ${cellText(row.screen.scorer)}` : 'unscreened');
    push('Harness', cellText(row.harness));
    push('Session model', cellText(row.session_model));

    const sessionRow = el(doc, 'dd', 'artifact-session');
    if (row.writing_session) {
      const link = el(doc, 'a', 'artifact-session-link', row.writing_session);
      link.href = `/sessions/${encodeURIComponent(row.writing_session)}`;
      sessionRow.append(link);
      sessionRow.append(doc.createTextNode(' — earliest observed writing session for this version; captured provenance, not proven authorship'));
    } else {
      sessionRow.append(doc.createTextNode('—'));
    }
    dl.append(el(doc, 'dt', '', 'Writing session'), sessionRow);

    const plan = planOfPath(path);
    const planRow = el(doc, 'dd', 'artifact-plan');
    if (plan) {
      const link = el(doc, 'a', 'artifact-plan-link', plan);
      link.href = `/plans/${encodeURIComponent(repo)}/${encodeURIComponent(plan)}`;
      planRow.append(link);
    } else {
      planRow.append(doc.createTextNode('—'));
    }
    dl.append(el(doc, 'dt', '', 'Plan'), planRow);

    const scores = Object.keys(row.scores || {}).sort();
    for (const name of scores) {
      const entry = row.scores[name] || {};
      const band = name === check ? ` · band ${bandByHash.get(row.content_hash) || '…'}` : '';
      push(`${name} score`, `${Number(entry.score).toFixed(2)} · scorer ${cellText(entry.scorer)}${band}`);
    }
    if (!scores.includes(check)) push(`${check} score`, 'unscored');
    head.append(dl);

    const copyLink = el(doc, 'button', 'artifact-copy-link', 'Copy link');
    copyLink.type = 'button';
    copyLink.addEventListener('click', () => copyText(readerUrl({ repo_id: repo, path, hash: selectedHash })));
    head.append(copyLink);
    return head;
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

  function paintBody() {
    if (!bodyWrap) return;
    bodyWrap.replaceChildren();
    if (!bodyModel) return;
    if (bodyModel.outline.length) {
      const outline = el(doc, 'nav', 'artifact-outline');
      outline.append(el(doc, 'h2', 'artifact-outline-title', 'Outline'));
      const list = el(doc, 'ul', 'artifact-outline-list');
      bodyModel.outline.forEach((heading, index) => {
        const item = doc.createElement('li');
        const button = el(doc, 'button', 'artifact-outline-item', `${'·'.repeat(heading.level - 1)}${heading.level > 1 ? ' ' : ''}${heading.text}`);
        button.type = 'button';
        button.dataset.line = String(heading.line);
        button.addEventListener('click', () => {
          const target = Math.min(bodyModel.chunks.length - 1, Math.floor((heading.line - 1) / bodyModel.size));
          if (target + 1 > bodyModel.shown) {
            bodyModel.shown = target + 1;
            paintBody();
          }
          const chunks = bodyWrap.querySelectorAll('.artifact-chunk');
          chunks[target]?.scrollIntoView?.({ block: 'start' });
        });
        item.append(button);
        list.append(item);
      });
      outline.append(list);
      bodyWrap.append(outline);
    }
    const body = el(doc, 'div', 'artifact-body');
    for (let index = 0; index < bodyModel.shown && index < bodyModel.chunks.length; index += 1) {
      const chunk = bodyModel.chunks[index];
      const pre = el(doc, 'pre', 'artifact-chunk');
      pre.dataset.firstLine = String(chunk.start);
      pre.dataset.lastLine = String(chunk.end);
      pre.textContent = chunk.text;
      body.append(pre);
    }
    bodyWrap.append(body);

    const shownChunk = bodyModel.chunks[Math.min(bodyModel.shown, bodyModel.chunks.length) - 1];
    const lastLine = shownChunk ? shownChunk.end : 0;
    const footer = el(doc, 'p', 'artifact-more');
    footer.append(doc.createTextNode(`Showing lines 1–${formatNumber(lastLine)} of ${formatNumber(bodyModel.totalLines)}; `));
    if (bodyModel.shown < bodyModel.chunks.length) {
      const more = el(doc, 'button', 'artifact-show-more', 'Show more');
      more.type = 'button';
      more.addEventListener('click', () => { bodyModel.shown += 1; paintBody(); });
      footer.append(more);
    } else {
      footer.append(doc.createTextNode('all displayed.'));
    }
    bodyWrap.append(footer);
  }

  function renderContentState(result) {
    const state = contentStateText(result);
    versionSlot.dataset.contentState = state.kind;
    const block = el(doc, 'div', 'artifact-content-status');
    block.dataset.state = state.kind;
    block.append(el(doc, 'p', 'artifact-content-message', state.message));
    const code = `${state.status} ${state.code}${state.reason ? ` (${state.reason})` : ''}`.trim();
    block.append(el(doc, 'p', 'artifact-content-code', code));
    if (state.kind !== 'not_stored' && state.kind !== 'pending' && state.kind !== 'removed' && state.kind !== 'not_found') {
      const retry = el(doc, 'button', 'artifact-content-retry', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', loadSelected);
      block.append(retry);
    }
    versionSlot.replaceChildren(block);
  }

  async function renderSelected() {
    const row = rows.find(item => item.content_hash === selectedHash) || null;
    if (!row) {
      versionSlot.dataset.state = 'error';
      versionSlot.dataset.contentState = 'version_not_found';
      versionSlot.replaceChildren(el(doc, 'p', 'artifact-version-missing', 'version not found for this artifact'));
      return;
    }
    const head = renderHeader(row);
    const cached = textCache.get(row.content_hash);
    if (cached) {
      versionSlot.dataset.state = 'ready';
      versionSlot.dataset.contentState = 'ready';
      const model = chunkText(cached, { lines: CHUNK_LINES });
      bodyModel = { chunks: model.chunks, size: model.lines, totalLines: model.totalLines, outline: parseOutline(cached), shown: 1 };
      bodyWrap = el(doc, 'div', 'artifact-body-wrap');
      versionSlot.replaceChildren(head, bodyWrap);
      paintBody();
      return;
    }
    versionSlot.dataset.state = 'loading';
    versionSlot.dataset.contentState = 'loading';
    bodyWrap = el(doc, 'div', 'artifact-body-wrap');
    bodyWrap.append(el(doc, 'p', 'artifact-content-status', 'Loading content…'));
    versionSlot.replaceChildren(head, bodyWrap);
    await loadSelected();
  }

  async function loadSelected() {
    const row = rows.find(item => item.content_hash === selectedHash) || null;
    if (!row) { renderSelected(); return; }
    const run = ++contentRun;
    const result = await fetchArtifactText({
      scheduler, repo, path, hash: row.content_hash, tenant, signal: controller.signal, stateKey: 'artifact-content'
    }).catch(error => {
      if (error?.name === 'AbortError') return null;
      return mapContentError(0, { error: error?.message || 'The content request failed.' });
    });
    if (disposed || run !== contentRun || !result) return;
    if (!result.ok) { renderContentState(result); return; }
    textCache.set(row.content_hash, result.text);
    versionSlot.dataset.state = 'ready';
    versionSlot.dataset.contentState = 'ready';
    const model = chunkText(result.text, { lines: CHUNK_LINES });
    bodyModel = { chunks: model.chunks, size: model.lines, totalLines: model.totalLines, outline: parseOutline(result.text), shown: 1 };
    bodyWrap = el(doc, 'div', 'artifact-body-wrap');
    versionSlot.replaceChildren(renderHeader(row), bodyWrap);
    paintBody();
  }

  async function selectVersion(hash) {
    selectedHash = hash;
    const url = readerUrl({ repo_id: repo, path, hash });
    globalThis.history.pushState(null, '', url);
    for (const mark of versionsSlot.querySelectorAll('.artifact-version-mark')) {
      mark.dataset.selected = mark.dataset.hash === hash ? 'true' : 'false';
    }
    await renderSelected();
  }

  async function loadMore() {
    if (!next) return;
    const params = new URLSearchParams({ grain: 'artifact', repo_id: repo, path });
    if (pageMax) params.set('limit', String(pageMax));
    params.set('cursor', next);
    const { response, body } = await transport.get('entity', params, { tenant, signal: controller.signal, stateKey: 'artifact-versions-more' });
    if (disposed) return;
    if (!response.ok) return;
    const incoming = Array.isArray(body.rows) ? body.rows : [];
    rows = [...rows, ...incoming];
    next = body.next || null;
    population = body.population || population;
    await paintStrip();
    if (disposed) return;
    await renderSelected();
  }

  let pageMax = null;

  async function start() {
    setState('loading', 'Loading artifact…');
    try {
      const me = await transport.request('me', { signal: controller.signal, stateKey: 'artifact-me' });
      tenant = rememberedTenant(me?.body || {});
    } catch (error) {
      if (error?.name === 'AbortError') { setState('cancelled', 'Request cancelled.'); return; }
      tenant = '';
    }
    if (disposed) return;
    let schema = null;
    try {
      const result = await transport.schema(tenant);
      if (result.response.ok) schema = result.body;
    } catch { schema = null; }
    if (disposed) return;
    if (schema?.features && schema.features.entities_artifact === false) {
      setState('unsupported', unsupportedText(unsupportedState({
        feature: 'entities_artifact', reason: 'not advertised by this server', source: 'Plan 20 Phase 6 (entities_artifact)'
      })));
      return;
    }
    const max = Number(schema?.budgets?.page_max);
    pageMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : null;
    baselineCache = createBaselineCache({ transport, tenant, signal: controller.signal });

    const params = new URLSearchParams({ grain: 'artifact', repo_id: repo, path });
    if (pageMax) params.set('limit', String(pageMax));
    let response;
    let body = {};
    try {
      const result = await transport.get('entity', params, { tenant, signal: controller.signal, stateKey: 'artifact-versions' });
      response = result.response;
      body = result.body;
    } catch (error) {
      if (disposed) return;
      if (error?.name === 'AbortError') { setState('cancelled', 'Request cancelled.'); return; }
      setState('error', error?.message || 'The artifact request failed.');
      return;
    }
    if (disposed) return;
    if (response.status === 404) { setState('error', 'artifact not found for this repo and path'); return; }
    if (!response.ok) { setState('error', body?.error || `The server returned ${response.status}.`); return; }

    rows = Array.isArray(body.rows) ? body.rows : [];
    next = typeof body.next === 'string' && body.next ? body.next : null;
    population = body.population || null;
    latestHash = body.latest?.content_hash || rows[0]?.content_hash || '';
    if (!rows.length) { setState('empty', 'no versions for this artifact'); return; }

    let catalogue = [];
    if (kind !== 'other') {
      try {
        const result = await transport.get('scores', new URLSearchParams({ kind }), { tenant, signal: controller.signal, stateKey: 'artifact-catalogue' });
        if (result.response.ok) catalogue = catalogueChecks(result.body);
      } catch { catalogue = []; }
    }
    if (disposed) return;
    checks = checkChoices(rows, catalogue);
    check = defaultCheck(rows, checks);
    if (!selectedHash) selectedHash = latestHash;
    await paintStrip();
    if (disposed) return;
    await renderSelected();
    setState('ready', '');
  }

  start();

  return () => { disposed = true; controller.abort(); };
}

export default { title, phase, render };
