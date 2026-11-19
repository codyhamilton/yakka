// Board presets as data. Each preset is either delivered (it has a panel list)
// or a named destination carrying the phase that delivers it. `pulse` is
// reserved for 9-03, which registers the five panel ids when its modules load;
// this module deliberately does not register it, so no preset names a panel
// that does not yet exist.

import { validateRegistry } from '../panels/registry.js';

export const PRESET_IDS = ['pulse', 'trends', 'compare', 'scatter', 'quality', 'cost', 'tools', 'workflow'];

// The seven non-Pulse presets are rows with a delivering phase and no panel
// list. They resolve to named destinations until their phase registers them.
export const NAMED_PRESETS = [
  { id: 'trends', title: 'Trends', phase: 10, panels: [] },
  { id: 'compare', title: 'Compare', phase: 10, panels: [] },
  { id: 'quality', title: 'Quality', phase: 10, panels: [] },
  { id: 'cost', title: 'Cost', phase: 10, panels: [] },
  { id: 'tools', title: 'Tools', phase: 10, panels: [] },
  { id: 'scatter', title: 'Scatter', phase: 11, panels: [] },
  { id: 'workflow', title: 'Workflow', phase: 12, panels: [] }
];

export const RESERVED_PRESETS = new Set(['pulse']);

const presets = new Map(NAMED_PRESETS.map(preset => [preset.id, preset]));

export function isPresetId(id) {
  return PRESET_IDS.includes(id);
}

export function registerPreset(preset) {
  if (!preset || typeof preset.id !== 'string' || !preset.id) throw new Error('preset needs an id');
  if (!Array.isArray(preset.panels)) throw new Error(`preset ${preset.id} panels must be an array`);
  if (preset.panels.length > 12) throw new Error(`preset ${preset.id} has more than 12 panels`);
  presets.set(preset.id, { ...preset, phase: preset.phase ?? null });
  return presets.get(preset.id);
}

export function lookupPreset(id) {
  return presets.get(id) || null;
}

export function listPresets() {
  return [...presets.values()];
}

// A named destination is a preset with no delivered panel list yet. The label
// and phase are data, never a not-found and never an empty board.
export function presetDestination(id) {
  const preset = presets.get(id);
  if (!preset && RESERVED_PRESETS.has(id)) {
    return { id, kind: 'named', title: 'Pulse', phase: 9, label: 'Delivered in Phase 9: Pulse' };
  }
  if (!preset) return null;
  if (preset.panels.length || preset.delivered) return { id, kind: 'board', title: preset.title };
  return {
    id,
    kind: 'named',
    title: preset.title,
    phase: preset.phase,
    label: `Delivered in Phase ${preset.phase}: ${preset.title}`
  };
}

export function namedDestinationMessage(id) {
  const destination = presetDestination(id);
  if (!destination) return null;
  return destination.kind === 'named' ? destination.label : null;
}

// A test fails when a registered preset names a panel id with no registry
// entry. Delivered presets are the only ones with a panel list to check.
export function validatePresets() {
  return validateRegistry({ presets: [...presets.values()].filter(preset => preset.panels.length) });
}

export function clearPresets() {
  presets.clear();
  for (const preset of NAMED_PRESETS) presets.set(preset.id, preset);
}
