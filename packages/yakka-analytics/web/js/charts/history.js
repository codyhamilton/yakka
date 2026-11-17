// Settled-state history for <yk-chart>. The URL is the state: this module is
// the only writer, and it goes through web/contract/url-state.js so every key
// keeps the codec's names. Transient values (`sel`, `pick`) replace the
// current entry; window, filter, cohort and compare changes push. Hover and an
// in-progress drag never reach here. `popstate` re-decodes and hands the whole
// state back.

import { decodeUrlState, encodeUrlState } from '../../contract/url-state.js';
import { encodeSelection } from './selection.js';

export function encodeBrush(brush) {
  if (!brush || !Number.isFinite(brush.from) || !Number.isFinite(brush.to)) return '';
  return `${Math.round(brush.from)}~${Math.round(brush.to)}`;
}

export function decodeBrush(value = '') {
  const text = String(value || '');
  const [from, to] = text.split('~');
  const start = Number(from);
  const end = Number(to);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { from: Math.min(start, end), to: Math.max(start, end) };
}

function mergeState(base, patch = {}) {
  const next = { ...base, ...patch };
  for (const key of ['filters', 'cohorts', 'panels', 'unknown']) {
    if (patch[key]) next[key] = { ...(base[key] || {}), ...patch[key] };
  }
  return next;
}

export function createHistory({ win = globalThis.window, onChange = null } = {}) {
  let current = read();
  let listening = false;

  function read() {
    return decodeUrlState(win.location.search);
  }

  function urlFor(next) {
    const params = encodeUrlState(next, win.location.search);
    const query = params.toString();
    return `${win.location.pathname}${query ? `?${query}` : ''}${win.location.hash}`;
  }

  function write(next, mode) {
    const url = urlFor(next);
    win.history[`${mode}State`](win.history.state, '', url);
    current = next;
    return current;
  }

  function onPopState() {
    current = read();
    if (typeof onChange === 'function') onChange(current);
    return current;
  }

  return {
    get state() { return current; },
    read,
    start() {
      if (listening) return;
      win.addEventListener('popstate', onPopState);
      listening = true;
    },
    stop() {
      if (!listening) return;
      win.removeEventListener('popstate', onPopState);
      listening = false;
    },
    replace(patch) { return write(mergeState(current, patch), 'replace'); },
    push(patch) { return write(mergeState(current, patch), 'push'); },
    commitBrush(brush) {
      current = { ...current, sel: brush ? encodeBrush(brush) : '' };
      return write(current, 'replace');
    },
    commitSelection(selection) {
      current = { ...current, pick: selection ? encodeSelection(selection) : '' };
      return write(current, 'replace');
    },
    zoom(next) {
      current = { ...current, from: String(next.from), to: String(next.to), win: '', sel: '' };
      return write(current, 'push');
    },
    pan(next) {
      current = { ...current, from: String(next.from), to: String(next.to), win: '', sel: '' };
      return write(current, 'push');
    },
    filter(key, values) {
      return write(mergeState(current, { filters: { ...(current.filters || {}), [key]: values } }), 'push');
    },
    hide(values) {
      current = { ...current, hide: [...values] };
      return write(current, 'replace');
    }
  };
}
