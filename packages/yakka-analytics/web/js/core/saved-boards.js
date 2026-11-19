// Named saved boards. yakka-analytics-boards is a list of {name, url} records;
// the URL stays the source of truth. Saving stores the current URL, opening
// navigates to the stored URL, and nothing is stored on a server.

import { encodeUrlState } from '../../contract/url-state.js';

export const BOARDS_KEY = 'yakka-analytics-boards';

function storageOf(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function parseBoards(raw) {
  if (!raw) return [];
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value
    .filter(entry => entry && typeof entry.name === 'string' && entry.name && typeof entry.url === 'string' && entry.url)
    .map(entry => ({ name: entry.name, url: entry.url }));
}

export function readBoards(storage) {
  const store = storageOf(storage);
  try { return parseBoards(store?.getItem(BOARDS_KEY)); } catch { return []; }
}

function writeBoards(list, storage) {
  const store = storageOf(storage);
  try { store?.setItem(BOARDS_KEY, JSON.stringify(list)); } catch {}
  return list;
}

export function currentBoardUrl(locationRef = globalThis.location) {
  if (!locationRef) return '';
  return `${locationRef.pathname}${locationRef.search}`;
}

function sameName(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

export function saveBoard(name, url, storage) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('a saved board needs a name');
  const list = readBoards(storage).filter(entry => !sameName(entry.name, clean));
  list.push({ name: clean, url: String(url || currentBoardUrl()) });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return writeBoards(list, storage);
}

export function renameBoard(from, to, storage) {
  const next = String(to || '').trim();
  if (!next) throw new Error('a saved board needs a name');
  const list = readBoards(storage);
  const index = list.findIndex(entry => sameName(entry.name, from));
  if (index === -1) return list;
  const [entry] = list.splice(index, 1);
  list[index] = { name: next, url: entry.url };
  list.sort((a, b) => a.name.localeCompare(b.name));
  return writeBoards(list, storage);
}

export function deleteBoard(name, storage) {
  return writeBoards(readBoards(storage).filter(entry => !sameName(entry.name, name)), storage);
}

export function lookupBoard(name, storage) {
  return readBoards(storage).find(entry => sameName(entry.name, name)) || null;
}

// Opening navigates to the stored URL. The URL remains authoritative; no state
// is reconstructed from storage.
export function openBoard(name, { storage, navigate = url => globalThis.location.assign(url) } = {}) {
  const entry = lookupBoard(name, storage);
  if (!entry) return null;
  navigate(entry.url);
  return entry;
}

// The shareable text for the current view, using the one URL codec.
export function currentBoardLink(state, search = '') {
  return `${globalThis.location?.pathname || '/'}?${encodeUrlState(state, search)}`;
}
