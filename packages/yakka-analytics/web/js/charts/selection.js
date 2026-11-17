// Boolean entity selection for the chart kit. A selection is two disjoint
// key sets: the positive part (include) and the exclusion part (exclude). It
// is built from gestures and the table checkbox only; identities are never
// inferred from plotted samples. Operations are pure and ordered so the same
// set always serialises to the same `pick` value.

export function emptySelection() {
  return { include: [], exclude: [] };
}

function uniqueSorted(values) {
  return [...new Set((values || []).map(value => String(value)))].sort();
}

export function normaliseSelection(value = {}) {
  const include = uniqueSorted(value.include);
  const exclude = uniqueSorted(value.exclude).filter(key => !include.includes(key));
  return { include, exclude };
}

export function selectionIsEmpty(selection) {
  const normal = normaliseSelection(selection);
  return normal.include.length === 0 && normal.exclude.length === 0;
}

export function isSelected(selection, key) {
  return normaliseSelection(selection).include.includes(String(key));
}

export function isExcluded(selection, key) {
  return normaliseSelection(selection).exclude.includes(String(key));
}

export function selectedKeys(selection) {
  const normal = normaliseSelection(selection);
  return [...normal.include, ...normal.exclude];
}

/**
 * Toggle a key in the positive or exclusion part. Adding to one part removes
 * it from the other so the predicate stays Boolean.
 */
export function toggleSelection(selection, key, { exclude = false } = {}) {
  const normal = normaliseSelection(selection);
  const value = String(key);
  if (exclude) {
    if (normal.exclude.includes(value)) normal.exclude = normal.exclude.filter(item => item !== value);
    else {
      normal.include = normal.include.filter(item => item !== value);
      normal.exclude = [...normal.exclude, value];
    }
  } else if (normal.include.includes(value)) {
    normal.include = normal.include.filter(item => item !== value);
  } else {
    normal.exclude = normal.exclude.filter(item => item !== value);
    normal.include = [...normal.include, value];
  }
  return normaliseSelection(normal);
}

export function addSelection(selection, key) {
  const normal = normaliseSelection(selection);
  const value = String(key);
  normal.exclude = normal.exclude.filter(item => item !== value);
  if (!normal.include.includes(value)) normal.include = [...normal.include, value];
  return normaliseSelection(normal);
}

export function removeSelection(selection, key) {
  const normal = normaliseSelection(selection);
  const value = String(key);
  normal.include = normal.include.filter(item => item !== value);
  normal.exclude = normal.exclude.filter(item => item !== value);
  return normal;
}

export function mergeSelection(a, b) {
  const left = normaliseSelection(a);
  const right = normaliseSelection(b);
  return normaliseSelection({
    include: [...left.include, ...right.include],
    exclude: [...left.exclude, ...right.exclude]
  });
}

/** The serialisable predicate that `inspect()`, `select` and the tray share. */
export function selectionPredicate(selection) {
  const normal = normaliseSelection(selection);
  if (normal.include.length === 0 && normal.exclude.length === 0) return null;
  return { kind: 'entity', include: [...normal.include], exclude: [...normal.exclude] };
}

/** Compact `pick` value: `include,keys|exclude,keys` in stable order. */
export function encodeSelection(selection) {
  const normal = normaliseSelection(selection);
  if (normal.include.length === 0 && normal.exclude.length === 0) return '';
  return `${normal.include.join(',')}|${normal.exclude.join(',')}`;
}

export function decodeSelection(value = '') {
  const text = String(value || '');
  if (!text) return emptySelection();
  const [include, exclude] = text.split('|');
  return normaliseSelection({
    include: include ? include.split(',') : [],
    exclude: exclude ? exclude.split(',') : []
  });
}
