// Panel registry: the required module shape, lookup, and the validation a
// preset or a later phase is checked against. A panel is data plus a load()
// function; this module never renders anything.

import { publishedNames } from '../core/schema-adapter.js';

// Chart names derive from the chart kit's published elements and modes
// (CONTRACTS.md 17.5), so a panel cannot name a chart the kit does not draw.
// A table-only panel has no chart: it declares `charts: []` plus `table: true`.
// That is the least invasive representation: no fake chart name is invented and
// the chart kit's name list stays honest. `table` is optional; any non-empty
// `charts` array must name real kit charts.
export const CHART_NAMES = new Set([
  'lines', 'area', 'columns', 'cumulative', 'share', 'scatter', 'ecdf',
  'bars', 'stacked', 'rank', 'lollipop', 'slope',
  'ranges', 'histogram', 'strip', 'dot', 'heatmap', 'calendar',
  'lanes', 'gantt', 'treemap'
]);

export const REQUIRED_PANEL_FIELDS = ['id', 'grain', 'measures', 'lenses', 'charts', 'requires', 'caveats'];

const registry = new Map();

function fail(message) {
  throw new Error(message);
}

export function validatePanelEntry(entry) {
  if (!entry || typeof entry !== 'object') fail('panel entry must be an object');
  for (const field of REQUIRED_PANEL_FIELDS) if (!(field in entry)) fail(`panel ${entry.id || '(no id)'} is missing ${field}`);
  if (typeof entry.id !== 'string' || !entry.id.trim()) fail('panel id must be a non-empty string');
  if (typeof entry.grain !== 'string' || !entry.grain.trim()) fail(`panel ${entry.id} needs a grain`);
  if (!Array.isArray(entry.measures)) fail(`panel ${entry.id} measures must be an array`);
  if (!Array.isArray(entry.lenses)) fail(`panel ${entry.id} lenses must be an array`);
  if (!Array.isArray(entry.requires)) fail(`panel ${entry.id} requires must be an array`);
  if (typeof entry.caveats !== 'string') fail(`panel ${entry.id} caveats must be a string`);
  if (!Array.isArray(entry.charts)) fail(`panel ${entry.id} charts must be an array`);
  if (entry.charts.length === 0 && entry.table !== true) fail(`panel ${entry.id} has no charts and is not marked table: true`);
  for (const chart of entry.charts) {
    if (!CHART_NAMES.has(chart)) fail(`panel ${entry.id} names unknown chart ${chart}`);
  }
  if (entry.load !== undefined && typeof entry.load !== 'function') fail(`panel ${entry.id} load must be a function`);
  return entry;
}

export function registerPanel(entry) {
  validatePanelEntry(entry);
  if (registry.has(entry.id)) fail(`duplicate panel id ${entry.id}`);
  registry.set(entry.id, entry);
  return entry;
}

export function lookupPanel(id) {
  return registry.get(id) || null;
}

export function hasPanel(id) {
  return registry.has(id);
}

export function listPanels() {
  return [...registry.values()];
}

export function clearPanels() {
  registry.clear();
}

// The chooser offers only combinations /schema lists for the grain. Anything
// the panel accepts but the server does not publish is returned as unsupported
// with the panel's own source, so the capability inspector can name it.
export function chooserOptions(panel, schema) {
  const grain = schema?.grains?.[panel.grain];
  const measures = new Set(publishedNames(grain?.measures));
  const lenses = new Set(publishedNames(grain?.lenses));
  const offered = { measures: [], lenses: [], charts: [], unsupported: [] };
  for (const measure of panel.measures) {
    if (grain && measures.has(measure)) offered.measures.push(measure);
    else offered.unsupported.push({ kind: 'measure', name: measure, reason: grain ? 'not listed for grain' : 'grain not published', source: panel.requires?.[0] || 'server schema' });
  }
  for (const lens of panel.lenses) {
    if (grain && lenses.has(lens)) offered.lenses.push(lens);
    else offered.unsupported.push({ kind: 'lens', name: lens, reason: grain ? 'not listed for grain' : 'grain not published', source: panel.requires?.[0] || 'server schema' });
  }
  for (const chart of panel.charts) {
    if (CHART_NAMES.has(chart)) offered.charts.push(chart);
    else offered.unsupported.push({ kind: 'chart', name: chart, source: 'chart kit' });
  }
  return offered;
}

// Validate the registry and any preset list together. Duplicate ids and
// unknown chart names fail at registration; this catches a preset that names a
// panel the registry does not have.
export function validateRegistry({ presets = [] } = {}) {
  const seen = new Set();
  for (const entry of registry.values()) {
    if (seen.has(entry.id)) fail(`duplicate panel id ${entry.id}`);
    seen.add(entry.id);
    validatePanelEntry(entry);
  }
  for (const preset of presets) {
    for (const panelId of preset.panels || []) {
      if (!registry.has(panelId)) fail(`preset ${preset.id} names missing panel ${panelId}`);
    }
  }
  return true;
}
