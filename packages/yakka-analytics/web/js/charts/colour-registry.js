// Deterministic categorical colour registry for every chart in the kit.
// Pure data and slot assignment in this module: it never fetches and never
// touches a chart or the DOM. Colours are exposed as CSS custom property
// names; the values themselves live in web/css/charts.css.

export const STORAGE_KEY = 'yakka-analytics-entity-colours';

export const SURFACE = {
  light: '#ffffff',
  dark: '#1b2734'
};

// Eight categorical hue slots in their fixed order. Light and dark values are
// two steps of the same hue so both themes keep non-text contrast.
export const HUES = [
  { slot: 'h1', name: 'blue', label: 'Blue', light: '#1d4ed8', dark: '#60a5fa', cssVar: '--yk-cat-1', shape: 'circle' },
  { slot: 'h2', name: 'orange', label: 'Orange', light: '#b45309', dark: '#fb923c', cssVar: '--yk-cat-2', shape: 'square' },
  { slot: 'h3', name: 'green', label: 'Green', light: '#15803d', dark: '#4ade80', cssVar: '--yk-cat-3', shape: 'triangle' },
  { slot: 'h4', name: 'pink', label: 'Pink', light: '#be185d', dark: '#f472b6', cssVar: '--yk-cat-4', shape: 'diamond' },
  { slot: 'h5', name: 'vermillion', label: 'Vermillion', light: '#c2410c', dark: '#fb7185', cssVar: '--yk-cat-5', shape: 'cross' },
  { slot: 'h6', name: 'sky', label: 'Sky', light: '#0369a1', dark: '#38bdf8', cssVar: '--yk-cat-6', shape: 'hexagon' },
  { slot: 'h7', name: 'purple', label: 'Purple', light: '#6d28d9', dark: '#a78bfa', cssVar: '--yk-cat-7', shape: 'star' },
  { slot: 'h8', name: 'teal', label: 'Teal', light: '#0f766e', dark: '#2dd4bf', cssVar: '--yk-cat-8', shape: 'ring' }
];

// Five named values plus (other) keep fixed neutral styles of their own. They
// are distinguished by label and pattern as well as tone, so none can be
// mistaken for grey (other).
export const FIXED_NEUTRALS = {
  '(other)': { key: '(other)', slot: 'n-other', category: 'fixed', label: 'other', light: '#475569', dark: '#cbd5e1', cssVar: '--yk-neutral-other', shape: 'diamond', pattern: 'diagonal' },
  '(mixed)': { key: '(mixed)', slot: 'n-mixed', category: 'fixed', label: 'mixed', light: '#6b7280', dark: '#9ca3af', cssVar: '--yk-neutral-mixed', shape: 'cross', pattern: 'crosshatch' },
  '(none)': { key: '(none)', slot: 'n-none', category: 'fixed', label: 'none', light: '#78716c', dark: '#d6d3d1', cssVar: '--yk-neutral-none', shape: 'ring', pattern: 'hollow' },
  '(multi)': { key: '(multi)', slot: 'n-multi', category: 'fixed', label: 'multi', light: '#4d7c6f', dark: '#a7c4b5', cssVar: '--yk-neutral-multi', shape: 'hexagon', pattern: 'dots' },
  unknown: { key: 'unknown', slot: 'n-unknown', category: 'fixed', label: 'unknown', light: '#5b6470', dark: '#b9c2cc', cssVar: '--yk-neutral-unknown', shape: 'triangle', pattern: 'dashes' },
  unscored: { key: 'unscored', slot: 'n-unscored', category: 'fixed', label: 'unscored', light: '#7a6a58', dark: '#d8c9b6', cssVar: '--yk-neutral-unscored', shape: 'star', pattern: 'grid' }
};

export const FIXED_KEYS = Object.keys(FIXED_NEUTRALS);

const NEUTRAL_PATTERNS = ['vertical', 'horizontal', 'diagonal', 'crosshatch', 'dots', 'dashes', 'grid', 'hollow'];
const NEUTRAL_SHAPES = ['diamond', 'cross', 'ring', 'hexagon', 'triangle', 'star', 'circle', 'square'];
const EXTRA_NEUTRAL_TONES = [
  { light: '#3f4a5a', dark: '#b0bcc9' },
  { light: '#5a6472', dark: '#c2ccd8' },
  { light: '#6f7a88', dark: '#9aa8b6' },
  { light: '#4a5a52', dark: '#a9c2b5' }
];

// Cohorts A-D carry fixed colours in compare mode (DESIGN.md Compare).
export const COHORTS = {
  A: { key: 'cohort:A', slot: 'cohort-a', category: 'cohort', label: 'Cohort A', light: '#1d4ed8', dark: '#60a5fa', cssVar: '--yk-cohort-a', shape: 'square' },
  B: { key: 'cohort:B', slot: 'cohort-b', category: 'cohort', label: 'Cohort B', light: '#b45309', dark: '#fb923c', cssVar: '--yk-cohort-b', shape: 'triangle' },
  C: { key: 'cohort:C', slot: 'cohort-c', category: 'cohort', label: 'Cohort C', light: '#15803d', dark: '#4ade80', cssVar: '--yk-cohort-c', shape: 'diamond' },
  D: { key: 'cohort:D', slot: 'cohort-d', category: 'cohort', label: 'Cohort D', light: '#be185d', dark: '#f472b6', cssVar: '--yk-cohort-d', shape: 'cross' }
};

export const STATUS = {
  good: { key: 'status:good', label: 'Good', light: '#15803d', dark: '#4ade80', cssVar: '--yk-status-good' },
  warn: { key: 'status:warn', label: 'Warning', light: '#b45309', dark: '#fbbf24', cssVar: '--yk-status-warn' },
  bad: { key: 'status:bad', label: 'Bad', light: '#b91c1c', dark: '#f87171', cssVar: '--yk-status-bad' },
  info: { key: 'status:info', label: 'Info', light: '#0369a1', dark: '#38bdf8', cssVar: '--yk-status-info' }
};

export const SEQUENTIAL = {
  light: ['#eff6ff', '#bfdbfe', '#60a5fa', '#1d4ed8', '#1e3a8a'],
  dark: ['#0b1220', '#0c4a6e', '#0369a1', '#38bdf8', '#bae6fd']
};

export const DIVERGING = {
  light: ['#b91c1c', '#fca5a5', '#f1f5f9', '#93c5fd', '#1d4ed8'],
  dark: ['#f87171', '#7f1d1d', '#334155', '#1e3a8a', '#60a5fa']
};

// Committed first-party palette thresholds. Both themes must pass them; the
// values are the acceptance proof (CONTRACTS.md 17.5 "Colour registry").
export const THRESHOLDS = {
  surfaceContrast: 3,
  adjacentDeltaE: 20,
  neutralContrast: 3,
  neutralAdjacentDeltaE: 10,
  statusContrast: 3,
  statusAdjacentDeltaE: 20,
  cohortAdjacentDeltaE: 20
};

const HUE_BY_SLOT = new Map(HUES.map(hue => [hue.slot, hue]));

export function entityKey(namespace, name) {
  return `${namespace}:${name}`;
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    clear() { data.clear(); },
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; }
  };
}

function defaultStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {}
  return memoryStorage();
}

function extraNeutralStyle(index) {
  const tone = EXTRA_NEUTRAL_TONES[index % EXTRA_NEUTRAL_TONES.length];
  return {
    slot: `n${index}`,
    category: 'neutral',
    label: `series ${index + 1}`,
    light: tone.light,
    dark: tone.dark,
    cssVar: `--yk-neutral-extra-${(index % EXTRA_NEUTRAL_TONES.length) + 1}`,
    shape: NEUTRAL_SHAPES[index % NEUTRAL_SHAPES.length],
    pattern: NEUTRAL_PATTERNS[index % NEUTRAL_PATTERNS.length]
  };
}

function slotStyle(slotId) {
  if (HUE_BY_SLOT.has(slotId)) return { ...HUE_BY_SLOT.get(slotId), category: 'hue' };
  const match = /^n(\d+)$/.exec(slotId);
  if (match) return { ...extraNeutralStyle(Number(match[1])), slot: slotId };
  return null;
}

function nextFreeSlot(used) {
  for (const hue of HUES) if (!used.has(hue.slot)) return hue.slot;
  for (let i = 0; ; i += 1) if (!used.has(`n${i}`)) return `n${i}`;
}

function normalise(existing) {
  const map = {};
  if (!existing || typeof existing !== 'object') return map;
  for (const [key, slot] of Object.entries(existing)) {
    if (typeof slot === 'string' && slotStyle(slot)) map[key] = slot;
  }
  return map;
}

/**
 * Assign a slot to every key, preserving existing assignments. Keys are
 * sorted before first assignment so the result does not depend on the order a
 * caller happens to register them in.
 */
export function planAssignments(existing = {}, keys = []) {
  const map = normalise(existing);
  const used = new Set(Object.values(map));
  const seen = new Set();
  for (const key of [...keys].sort()) {
    if (seen.has(key) || FIXED_KEYS.includes(key)) continue;
    seen.add(key);
    if (map[key]) continue;
    map[key] = nextFreeSlot(used);
    used.add(map[key]);
  }
  return map;
}

export function styleForKey(key, assignments = {}) {
  if (FIXED_NEUTRALS[key]) return { ...FIXED_NEUTRALS[key] };
  const slotId = assignments[key];
  const style = slotStyle(slotId);
  if (style) return { key, ...style };
  return {
    key,
    slot: 'n-other',
    category: 'fixed',
    label: 'other',
    light: FIXED_NEUTRALS['(other)'].light,
    dark: FIXED_NEUTRALS['(other)'].dark,
    cssVar: '--yk-neutral-other',
    shape: 'diamond',
    pattern: 'diagonal'
  };
}

export function cohortStyle(letter) {
  const style = COHORTS[String(letter).toUpperCase()];
  return style ? { ...style } : null;
}

export class ColourRegistry {
  constructor({ storage = defaultStorage(), namespace = '' } = {}) {
    this.storage = storage;
    this.namespace = namespace;
    this.assignments = this.#load();
  }

  #load() {
    try {
      return normalise(JSON.parse(this.storage.getItem(STORAGE_KEY) || '{}'));
    } catch {
      return {};
    }
  }

  register(keys) {
    const list = keys.map(key => (this.namespace && !String(key).includes(':') ? entityKey(this.namespace, key) : String(key)));
    const next = planAssignments(this.assignments, list);
    if (JSON.stringify(next) !== JSON.stringify(this.assignments)) {
      this.assignments = next;
      this.save();
    }
    return this;
  }

  save() {
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify(this.assignments)); } catch {}
    return this;
  }

  style(key) {
    return styleForKey(this.namespace && !String(key).includes(':') ? entityKey(this.namespace, key) : String(key), this.assignments);
  }

  assignment(key) {
    return this.assignments[String(key)] ?? null;
  }

  cohort(letter) {
    return cohortStyle(letter);
  }

  toJSON() {
    return { ...this.assignments };
  }

  clear() {
    this.assignments = {};
    try { this.storage.removeItem(STORAGE_KEY); } catch {}
    return this;
  }
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
  return [0, 2, 4].map(offset => parseInt(full.slice(offset, offset + 2), 16));
}

function channel(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function xyz(hex) {
  const [r, g, b] = hexToRgb(hex).map(channel);
  return [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047,
    r * 0.2126 + g * 0.7152 + b * 0.0722,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  ];
}

function lab(hex) {
  const [x, y, z] = xyz(hex).map(value => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116));
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function adjacent(list, metric) {
  const pairs = [];
  for (let i = 0; i < list.length - 1; i += 1) {
    pairs.push({ from: list[i].name ?? list[i].slot, to: list[i + 1].name ?? list[i + 1].slot, value: metric(list[i], list[i + 1]) });
  }
  return pairs;
}

/**
 * First-party palette report: the committed acceptance proof for contrast and
 * adjacent-slot distance in both themes.
 */
export function paletteReport() {
  const themes = {};
  const failures = [];
  for (const theme of ['light', 'dark']) {
    const surface = SURFACE[theme];
    const hues = HUES.map(hue => ({ slot: hue.slot, name: hue.name, colour: hue[theme], contrast: contrastRatio(hue[theme], surface) }));
    const neutrals = Object.values(FIXED_NEUTRALS).map(style => ({ key: style.key, colour: style[theme], contrast: contrastRatio(style[theme], surface) }));
    const cohorts = Object.values(COHORTS).map(style => ({ letter: style.slot, colour: style[theme], contrast: contrastRatio(style[theme], surface) }));
    const status = Object.values(STATUS).map(style => ({ key: style.key, colour: style[theme], contrast: contrastRatio(style[theme], surface) }));
    const hueAdjacent = adjacent(hues, (a, b) => deltaE(a.colour, b.colour));
    const neutralAdjacent = adjacent(neutrals, (a, b) => deltaE(a.colour, b.colour));
    const statusAdjacent = adjacent(status, (a, b) => deltaE(a.colour, b.colour));
    const cohortAdjacent = adjacent(cohorts, (a, b) => deltaE(a.colour, b.colour));
    themes[theme] = { surface, hues, neutrals, cohorts, status, hueAdjacent, neutralAdjacent, statusAdjacent, cohortAdjacent };
    for (const hue of hues) if (hue.contrast < THRESHOLDS.surfaceContrast) failures.push(`${theme} hue ${hue.name} contrast ${hue.contrast.toFixed(2)}`);
    for (const pair of hueAdjacent) if (pair.value < THRESHOLDS.adjacentDeltaE) failures.push(`${theme} hue ${pair.from}/${pair.to} deltaE ${pair.value.toFixed(1)}`);
    for (const neutral of neutrals) if (neutral.contrast < THRESHOLDS.neutralContrast) failures.push(`${theme} neutral ${neutral.key} contrast ${neutral.contrast.toFixed(2)}`);
    for (const pair of neutralAdjacent) if (pair.value < THRESHOLDS.neutralAdjacentDeltaE) failures.push(`${theme} neutral ${pair.from}/${pair.to} deltaE ${pair.value.toFixed(1)}`);
    for (const statusColour of status) if (statusColour.contrast < THRESHOLDS.statusContrast) failures.push(`${theme} status ${statusColour.key} contrast ${statusColour.contrast.toFixed(2)}`);
    for (const pair of statusAdjacent) if (pair.value < THRESHOLDS.statusAdjacentDeltaE) failures.push(`${theme} status ${pair.from}/${pair.to} deltaE ${pair.value.toFixed(1)}`);
    for (const pair of cohortAdjacent) if (pair.value < THRESHOLDS.cohortAdjacentDeltaE) failures.push(`${theme} cohort ${pair.from}/${pair.to} deltaE ${pair.value.toFixed(1)}`);
  }
  return { thresholds: { ...THRESHOLDS }, themes, failures };
}

export function fixedNeutralDistinctness() {
  const seen = new Set();
  for (const style of Object.values(FIXED_NEUTRALS)) seen.add(`${style.cssVar}|${style.pattern}|${style.shape}|${style.label}`);
  return seen.size === Object.keys(FIXED_NEUTRALS).length;
}
