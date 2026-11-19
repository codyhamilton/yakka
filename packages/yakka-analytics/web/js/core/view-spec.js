// Panel view specs. A panel is registry data plus a view spec
// {grain, measures, split, chart, scope overrides} carried in the URL as
// p<n>=<canonical JSON>. Pure functions only: no DOM, no fetch, no state.

export const PANEL_SPEC_FIELDS = ['grain', 'measures', 'split', 'chart', 'scope'];

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanMeasures(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter(Boolean))].sort();
}

// The scope subset a panel may override. A board scope has the same shape plus
// the shared filter collections; unknown fields are dropped from the spec so
// the canonical encoding is stable.
export function cleanPanelScope(value) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const key of ['win', 'from', 'to', 'tz']) {
    const text = cleanString(value[key]);
    if (text) out[key] = text;
  }
  for (const key of Object.keys(value).sort()) {
    if (['win', 'from', 'to', 'tz'].includes(key)) continue;
    const raw = value[key];
    if (key === 'cohorts') {
      if (!isPlainObject(raw)) continue;
      const cohorts = {};
      for (const slot of ['ca', 'cb', 'cc', 'cd']) {
        const text = cleanString(raw[slot]);
        if (text) cohorts[slot] = text;
      }
      if (Object.keys(cohorts).length) out.cohorts = cohorts;
      continue;
    }
    if (Array.isArray(raw)) {
      const values = [...new Set(raw.map(cleanString).filter(Boolean))];
      if (values.length) out[key] = values;
    } else if (typeof raw === 'boolean') {
      out[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = raw;
    } else {
      const text = cleanString(raw);
      if (text) out[key] = text;
    }
  }
  return out;
}

export function cleanPanelSpec(value) {
  if (!isPlainObject(value)) return null;
  const spec = {
    grain: cleanString(value.grain),
    measures: cleanMeasures(value.measures),
    split: cleanString(value.split),
    chart: cleanString(value.chart),
    scope: cleanPanelScope(value.scope)
  };
  if (!spec.grain && !spec.measures.length && !spec.chart) return null;
  return spec;
}

// Canonical form: fixed key order, sorted measures and sorted scope keys, and
// no empty members. Two equal specs therefore serialise to the same URL text.
export function canonicalPanelSpec(value) {
  const spec = cleanPanelSpec(value);
  if (!spec) return null;
  const out = { grain: spec.grain, measures: spec.measures };
  if (spec.split) out.split = spec.split;
  if (spec.chart) out.chart = spec.chart;
  if (Object.keys(spec.scope).length) {
    out.scope = {};
    for (const key of Object.keys(spec.scope).sort()) out.scope[key] = spec.scope[key];
  }
  return out;
}

// The value that belongs in p<n>. URLSearchParams percent-encodes it when the
// URL is written, so this returns compact canonical JSON text.
export function encodePanelSpec(value) {
  const canonical = canonicalPanelSpec(value);
  return canonical ? JSON.stringify(canonical) : '';
}

export function decodePanelSpec(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  return canonicalPanelSpec(parsed);
}

// A per-panel override beats the board/preset specification field by field;
// nested scope overrides beat the board scope key by key.
export function mergePanelSpec(base, override) {
  const a = cleanPanelSpec(base) || { grain: '', measures: [], split: '', chart: '', scope: {} };
  const b = cleanPanelSpec(override) || { grain: '', measures: [], split: '', chart: '', scope: {} };
  return canonicalPanelSpec({
    grain: b.grain || a.grain,
    measures: b.measures.length ? b.measures : a.measures,
    split: b.split || a.split,
    chart: b.chart || a.chart,
    scope: { ...a.scope, ...b.scope }
  });
}

// The scope a panel actually queries: a panel override beats the board scope
// field by field. A board-level `cmp` (an explicit URL compare mode) wins over a
// preset's default compare so /b/compare?cmp=cohorts still compares cohorts;
// without a board `cmp` the panel/preset default applies.
export function effectiveScope(boardScope = {}, panelScope = {}) {
  const board = cleanPanelScope(boardScope);
  const panel = cleanPanelScope(panelScope);
  const out = { ...board };
  for (const [key, value] of Object.entries(panel)) {
    if (key === 'cmp' && board.cmp) continue;
    out[key] = value;
  }
  return out;
}

// Read the decoded specs from a url-state object. url-state keeps raw strings
// in `panels`; `panelSpecs` carries the decoded forms beside it.
export function panelSpecFromState(state, key) {
  if (!state) return null;
  const decoded = state.panelSpecs?.[key];
  if (decoded) return canonicalPanelSpec(decoded);
  return decodePanelSpec(state.panels?.[key]);
}

export function writePanelSpec(state, key, spec) {
  const encoded = encodePanelSpec(spec);
  if (!encoded) {
    delete state.panels?.[key];
    delete state.panelSpecs?.[key];
    return state;
  }
  state.panels ??= {};
  state.panelSpecs ??= {};
  state.panels[key] = encoded;
  state.panelSpecs[key] = decodePanelSpec(encoded);
  return state;
}
