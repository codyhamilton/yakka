// The Tools preset: four registered panels over one scope, all at the
// `hook_events` time measure. The panels themselves come from 10-01 (rank,
// rhythm) and 10-03 (mix, treemap); this module only registers them, supplies
// the canonical Tools specs and names the tool-specific limits.
//
// A tool view must not invent a repo split (hook facts carry no repo_id) and
// must not join hook events to cost (there is no such measure pair). Those
// refusals are pure functions here so a chooser or a test can report the
// reason and the nearest supported choice without querying the server.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { chooserModel, measureMeta, offeredMeasures, offeredSplit, schemaGrain } from './p10-shared.js';
import { MIX_PANEL } from './mix.js';
import { TREEMAP_PANEL } from './treemap.js';
import { RANK_PANEL } from './rank.js';
import { RHYTHM_PANEL } from './rhythm.js';

export const TOOLS_PANELS = [MIX_PANEL, TREEMAP_PANEL, RANK_PANEL, RHYTHM_PANEL];
export const TOOLS_PRESET_ID = 'tools';

export const COST_TOOL_REASON = 'hook_events and cost_usd are different measures; use hook_events by tool or cost by model/harness';
export const COST_TOOL_TRY = 'hook_events by tool';
export const REPO_TOOL_REASON = 'hook facts carry no repo_id';
export const REPO_TOOL_TRY = 'harness';

const REPO_LENSES = new Set(['repo_id', 'session_repo']);

// Only hook_events is a tool-use measure. cost_usd is named rather than
// offered; a tool with no kind stays the server's `unknown`/empty group.
export const TOOLS_MEASURES = ['hook_events'];

export const TOOLS_SPECS = {
  mix: { grain: 'time', measures: ['hook_events'], split: 'tool_kind', chart: 'bars', scope: { second: 'harness', mode: 'stacked' } },
  treemap: { grain: 'time', measures: ['hook_events'], split: 'tool', chart: 'treemap', scope: { parent: 'harness' } },
  rank: { grain: 'time', measures: ['hook_events'], split: 'tool', chart: 'rank' },
  rhythm: { grain: 'time', measures: ['hook_events'], chart: 'heatmap' }
};

// The capability notes the Tools preset adds beside the shared panels' own
// caveats. They are preset data because this unit may not edit the shared
// panel modules.
export const TOOLS_NOTES = {
  mix: 'Tools composition: hook_events by tool_kind × harness. A tool the server returns with no kind stays its own unknown/empty group and is never folded into another; no cost measure is joined here.',
  treemap: 'Hook event counts by harness then tool (tool_kind when the schema publishes no tool). A repo split is unsupported (hook facts carry no repo_id; use harness). Cost by tool is unsupported (hook_events and cost_usd are different measures).',
  rank: 'Hook event counts ranked by tool. tool and tool_kind are separate lenses; no cost measure is joined.',
  rhythm: 'Weekday by hour heat map of hook events only. Cells share their keys with the table; no cost measure is joined.'
};

export function toolsToolPublished(schema = null) {
  const grain = schemaGrain(schema, 'time');
  const measure = measureMeta(schema, 'hook_events');
  const lenses = new Set([...(grain?.lenses || []), ...(measure.dims || [])]);
  return lenses.has('tool');
}

// `tool` is the child when /schema publishes it; otherwise tool_kind. The
// registered preset names `tool`; this helper is what a schema-aware caller
// uses to keep a stale server from naming a lens it does not have.
export function toolsTreemapChild(schema = null) {
  return toolsToolPublished(schema) ? 'tool' : 'tool_kind';
}

export function toolsMixSplits(schema = null) {
  const offered = offeredSplit(MIX_PANEL, 'hook_events', schema);
  return offered.filter(lens => lens === 'tool_kind' || (lens === 'tool' && toolsToolPublished(schema)));
}

export function toolsTreemapSpec(schema = null) {
  return canonicalPanelSpec({ ...TOOLS_SPECS.treemap, split: toolsTreemapChild(schema) });
}

// The one refusal helper. A cost measure and a repo lens in a tool view are
// named with the reason and the nearest supported combination; nothing is
// coerced to zero or joined in the browser.
export function toolsJoinGuard(measure, dims = []) {
  const picked = (Array.isArray(dims) ? dims : [dims]).filter(Boolean);
  if (measure === 'cost_usd') {
    return {
      missing: picked.length ? `cost by ${picked.join(' × ')}` : 'cost in a tool view',
      reason: COST_TOOL_REASON,
      try: COST_TOOL_TRY
    };
  }
  const repo = picked.find(dim => REPO_LENSES.has(dim));
  if (repo) {
    return {
      missing: `${measure || 'hook_events'} by ${repo}`,
      reason: REPO_TOOL_REASON,
      try: REPO_TOOL_TRY
    };
  }
  return null;
}

// A Tools chooser offers only the tool-use measure and tool lenses. Requested
// cost and repo choices are returned as unsupported with their `try`, never
// silently dropped.
export function toolsChooserModel(panel, spec = {}, schema = null) {
  const base = chooserModel(panel, spec, schema);
  const published = new Set(offeredMeasures(panel, schema));
  const measures = TOOLS_MEASURES.filter(name => published.has(name) && base.measures.includes(name));
  const splits = base.splits.filter(lens => !REPO_LENSES.has(lens));
  const unsupported = [...base.unsupported];

  const requestedMeasure = (spec?.measures || [])[0] || '';
  if (requestedMeasure === 'cost_usd' || base.measures.includes('cost_usd')) {
    unsupported.push({
      kind: 'measure',
      name: 'cost_usd',
      reason: COST_TOOL_REASON,
      try: COST_TOOL_TRY,
      source: 'contract 17.3'
    });
  }
  const requestedSplit = spec?.split || '';
  if (requestedSplit && REPO_LENSES.has(requestedSplit)) {
    unsupported.push({
      kind: 'split',
      name: requestedSplit,
      reason: REPO_TOOL_REASON,
      try: REPO_TOOL_TRY,
      source: 'contract 17.3'
    });
  }
  const split = requestedSplit && REPO_LENSES.has(requestedSplit)
    ? ''
    : (splits.includes(base.split) ? base.split : '');
  return {
    ...base,
    measures,
    measure: measures.includes(base.measure) ? base.measure : (measures[0] || ''),
    splits,
    split,
    unsupported
  };
}

function linkToolsStyles(doc = globalThis.document) {
  if (!doc?.head || doc.querySelector('link[href="/css/tools.css"]')) return;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/tools.css';
  doc.head.append(link);
}

export function assertToolsRegistered(panels = TOOLS_PANELS, lookup = hasPanel) {
  const missing = panels.map(panel => panel?.id).filter(id => !id || !lookup(id));
  if (missing.length) throw new Error(`Tools preset needs registered panels: ${missing.join(', ')}`);
  return true;
}

export function registerToolsPanels() {
  for (const panel of TOOLS_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  assertToolsRegistered();
  linkToolsStyles();
  if (!lookupPreset(TOOLS_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: TOOLS_PRESET_ID,
      title: 'Tools',
      panels: TOOLS_PANELS.map(panel => panel.id),
      specs: TOOLS_SPECS,
      notes: TOOLS_NOTES
    });
  }
  return true;
}

export default registerToolsPanels;
