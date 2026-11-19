// Artifact text, outline, chunking, bands and baseline caching for the
// `/artifact` reader. Every helper here is contract-faithful to
// CONTRACTS.md 17.4 and 17.3: complete bytes only, no prefix body, exact
// server error codes/reasons, and a band computed from the content-population
// baseline for one kind/check/scorer. It adds no route, grain or dependency.

import { authInit, isCollectorMode, resolvedBase } from '../../contract/transport.js';

// Server `keys.Kind` normalises with path.Clean; reproduce that for a repo
// relative path so the reader shows the same kind the server stores.
export function artifactKind(path) {
  const parts = [];
  for (const segment of String(path ?? '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { parts.pop(); continue; }
    parts.push(segment);
  }
  const clean = parts.join('/');
  if (/^docs\/plans\/[^/]+\/DESIGN\.md$/.test(clean)) return 'design';
  if (/^docs\/plans\/[^/]+\/briefs\/[^/]+\.md$/.test(clean)) return 'brief';
  if (/^docs\/plans\/[^/]+\/reports\/[^/]+\.md$/.test(clean)) return 'report';
  return 'other';
}

export function contentParams({ repo = '', path = '', hash = '', tenant = '' } = {}) {
  const params = new URLSearchParams();
  if (repo) params.set('repo_id', repo);
  if (path) params.set('path', path);
  if (hash) params.set('hash', hash);
  if (isCollectorMode() && tenant) params.set('tenant', tenant);
  return params;
}

// The content route returns complete bytes, not JSON, so it goes through the
// scheduler directly. `transport.get` would consume the body as JSON.
export async function fetchArtifactText({ scheduler, repo, path, hash, tenant = '', signal, stateKey = 'artifact-content' } = {}) {
  const params = contentParams({ repo, path, hash, tenant });
  const url = `${resolvedBase()}/v1/analytics/content?${params.toString()}`;
  const auth = authInit('analytics/content');
  let response;
  try {
    response = await scheduler.request(url, { ...auth, credentials: auth.credentials, signal }, stateKey);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { ok: false, status: 0, code: 'network', message: error?.message || 'The content request failed.' };
  }
  if (response.status === 200) {
    const text = await response.text();
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { ok: true, text, status: 200, headers };
  }
  const body = await response.json().catch(() => ({}));
  return mapContentError(response.status, body);
}

// One mapping for every non-200. A 404 without `content_unavailable` is the
// deliberately indistinguishable "not found"; a 404 with it carries the
// server's reason verbatim. No failure path returns a body prefix.
export function mapContentError(status, body = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  const code = typeof payload.code === 'string' ? payload.code : '';
  const message = typeof payload.error === 'string' ? payload.error : '';
  if (status === 404 && code === 'content_unavailable') {
    return { ok: false, status, code: 'content_unavailable', reason: payload.reason || '', message: message || 'artifact content is unavailable' };
  }
  if (status === 404) return { ok: false, status, code: 'not_found', message: message || 'not found' };
  if (status === 413 && code === 'content_too_large') {
    return { ok: false, status, code: 'content_too_large', size_bytes: payload.size_bytes ?? null, limit_bytes: payload.limit_bytes ?? null, message: message || 'content exceeds the advertised byte budget' };
  }
  if (status === 500 && code === 'content_integrity') {
    return { ok: false, status, code: 'content_integrity', message: message || 'stored content hash does not match its identity' };
  }
  if (status === 400) {
    return { ok: false, status, code: code || 'content_identity_invalid', reason: payload.reason || '', message: message || 'repo_id, path and a 64-hex hash are required' };
  }
  return { ok: false, status, code: code || String(status), message: message || `The server returned ${status}.` };
}

// ATX headings only, outside fenced code blocks, 1-based line numbers. No HTML
// parsing and no markdown dependency.
export function parseOutline(text) {
  const lines = String(text ?? '').split('\n');
  const outline = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const stripped = line.replace(/^ {0,3}/, '');
    const open = /^(`{3,}|~{3,})/.exec(stripped);
    if (open) {
      const char = open[1][0];
      const length = open[1].length;
      if (!fence) fence = { char, length };
      else if (fence.char === char && length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(line);
    if (heading) outline.push({ level: heading[1].length, text: heading[2], line: index + 1 });
  }
  return outline;
}

// Display windows, not truncation: every line of the complete body is in some
// chunk.
export function chunkText(text, { lines = 400 } = {}) {
  const all = String(text ?? '').split('\n');
  const size = Math.max(1, Math.floor(Number(lines) || 400));
  const chunks = [];
  for (let start = 0; start < all.length; start += size) {
    const end = Math.min(all.length, start + size);
    chunks.push({ start: start + 1, end, text: all.slice(start, end).join('\n') });
  }
  return { lines: size, chunks, totalLines: all.length };
}

// Strict below p25 is low, strict above p75 is high, inclusive mid. A missing
// baseline is its own state, never `unscored`.
export function bandFor(score, baseline) {
  const row = baseline && typeof baseline === 'object' ? baseline : null;
  const n = Number(row?.n);
  if (!row || !Number.isFinite(n) || n <= 0 || row.p25 === null || row.p75 === null || row.p25 === undefined || row.p75 === undefined) {
    return 'baseline_unavailable';
  }
  const value = Number(score);
  if (!Number.isFinite(value)) return 'baseline_unavailable';
  if (value < Number(row.p25)) return 'low';
  if (value > Number(row.p75)) return 'high';
  return 'mid';
}

export function baselineKey(kind, check, scorer) {
  return `${kind}\u001f${check}\u001f${scorer}`;
}

// Repeated versions with the same kind/check/scorer share one `/baselines`
// request. Content-population baselines are the only source of a band.
export function createBaselineCache({ transport, tenant = '', signal } = {}) {
  const cache = new Map();
  async function get(kind, check, scorer) {
    const key = baselineKey(kind, check, scorer);
    if (cache.has(key)) return cache.get(key);
    const params = new URLSearchParams({ kind, check, scorer, population: 'content' });
    const promise = (async () => {
      try {
        const { response, body } = await transport.request('baselines', { params, signal, stateKey: 'artifact-baselines' });
        if (!response.ok) return null;
        return body?.scorers?.[scorer]?.[check] || null;
      } catch (error) {
        cache.delete(key);
        if (error?.name === 'AbortError') throw error;
        return null;
      }
    })();
    cache.set(key, promise);
    return promise;
  }
  return { get, get size() { return cache.size; } };
}
