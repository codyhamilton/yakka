// First-party, bounded line diff for complete artifact bodies. This module has
// no DOM parsing and never renders artifact text as markup.
import { fetchArtifactText } from './artifact-content.js';

export const DIFF_CEILING = Object.freeze({ bytes: 262144, lines: 2000 });
const CEILING_TEXT = '262,144 bytes and 2,000 lines per side';

function bodyLines(value) {
  const text = String(value ?? '');
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  return normalized === '' ? [] : normalized.split('\n');
}

function myers(before, after) {
  const n = before.length, m = after.length, max = n + m;
  let v = new Map([[1, 0]]);
  const trace = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) x = v.get(k + 1) ?? 0;
      else x = (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && before[x] === after[y]) { x += 1; y += 1; }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, before, after, d);
    }
  }
  return [];
}

function backtrack(trace, before, after, distance) {
  let x = before.length, y = after.length;
  const reversed = [];
  for (let d = distance; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({ kind: 'context', text: before[x - 1] }); x -= 1; y -= 1;
    }
    if (x === prevX) { reversed.push({ kind: 'add', text: after[y - 1] }); y -= 1; }
    else { reversed.push({ kind: 'remove', text: before[x - 1] }); x -= 1; }
  }
  while (x > 0 && y > 0) { reversed.push({ kind: 'context', text: before[--x] }); y -= 1; }
  while (x > 0) reversed.push({ kind: 'remove', text: before[--x] });
  while (y > 0) reversed.push({ kind: 'add', text: after[--y] });
  return reversed.reverse();
}

function makeHunks(ops, context = 3) {
  let oldLine = 1, newLine = 1;
  const annotated = ops.map(op => {
    const item = { ...op, oldLine: op.kind === 'add' ? null : oldLine, newLine: op.kind === 'remove' ? null : newLine };
    if (op.kind !== 'add') oldLine += 1;
    if (op.kind !== 'remove') newLine += 1;
    return item;
  });
  const changes = [];
  annotated.forEach((op, index) => { if (op.kind !== 'context') changes.push(index); });
  if (!changes.length) return [];
  const ranges = [];
  for (const index of changes) {
    const start = Math.max(0, index - context), end = Math.min(annotated.length, index + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  }
  return ranges.map(({ start, end }) => {
    const lines = annotated.slice(start, end);
    const first = lines[0];
    return {
      oldStart: first.oldLine ?? (lines.find(line => line.oldLine !== null)?.oldLine ?? 1),
      oldLines: lines.filter(line => line.kind !== 'add').length,
      newStart: first.newLine ?? (lines.find(line => line.newLine !== null)?.newLine ?? 1),
      newLines: lines.filter(line => line.kind !== 'remove').length,
      lines
    };
  });
}

export function diffLines(before, after) {
  const oldLines = bodyLines(before), newLines = bodyLines(after);
  const ops = myers(oldLines, newLines);
  const added = ops.filter(line => line.kind === 'add').length;
  const removed = ops.filter(line => line.kind === 'remove').length;
  const unchanged = ops.filter(line => line.kind === 'context').length;
  return { hunks: makeHunks(ops), added, removed, unchanged, truncated: false };
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text ?? '')).length;
  return Buffer.byteLength(String(text ?? ''), 'utf8');
}

export function diffWithinCeiling(beforeText, afterText) {
  for (const [side, value] of [['left', beforeText], ['right', afterText]]) {
    const bytes = utf8Bytes(value);
    const lines = bodyLines(value).length;
    if (bytes > DIFF_CEILING.bytes || lines > DIFF_CEILING.lines) {
      return { ok: false, side, bytes, lines, reason: `Diff declined: ${side} is ${bytes} bytes / ${lines} lines; the ceiling is ${CEILING_TEXT}.` };
    }
  }
  return { ok: true };
}

export function renderDiff(doc, result) {
  const section = doc.createElement('section');
  section.className = 'artifact-diff';
  section.setAttribute('aria-label', 'Artifact line diff');
  const summary = doc.createElement('p');
  summary.className = 'artifact-diff-summary';
  summary.textContent = `${result.added} added, ${result.removed} removed; ceiling ${CEILING_TEXT}.`;
  section.append(summary);
  for (const [index, hunk] of result.hunks.entries()) {
    const details = doc.createElement('details');
    details.className = 'artifact-diff-hunk';
    details.open = result.hunks.length <= 3;
    const heading = doc.createElement('summary');
    heading.textContent = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    details.append(heading);
    const pre = doc.createElement('pre');
    pre.className = 'artifact-diff-lines';
    pre.setAttribute('aria-label', `Diff hunk ${index + 1}`);
    for (const line of hunk.lines) {
      const row = doc.createElement('span');
      row.dataset.kind = line.kind;
      row.textContent = `${line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '} ${line.text}\n`;
      pre.append(row);
    }
    details.append(pre);
    section.append(details);
  }
  return section;
}

function fetchFailure(result) {
  const code = result.code || String(result.status || 'content_error');
  const reason = result.reason ? ` (${result.reason})` : '';
  return `${code}${reason}${result.message ? `: ${result.message}` : ''}`;
}

// Sequential fetch means a failure on side A never starts a request for B.
export async function loadDiff({ scheduler, repo, path, a, b, tenant = '', signal } = {}) {
  for (const [side, hash] of [['left', a], ['right', b]]) {
    const response = await fetchArtifactText({ scheduler, repo, path, hash, tenant, signal, stateKey: `artifact-diff-${side}` });
    if (!response.ok) return { ok: false, reason: `Diff declined: ${side} version unavailable: ${fetchFailure(response)}` };
    if (side === 'left') var beforeText = response.text;
    else {
      const ceiling = diffWithinCeiling(beforeText, response.text);
      if (!ceiling.ok) return ceiling;
      return { ok: true, result: diffLines(beforeText, response.text) };
    }
  }
  return { ok: false, reason: 'Diff declined: both versions are required.' };
}
