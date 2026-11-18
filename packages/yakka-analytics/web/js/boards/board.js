// A board is an ordered list of at most 12 panels over one scope. Panels come
// from the registry and their view specs from the URL. A missing preset or an
// unknown panel yields a named reason, never a crash.

import { lookupPanel } from '../panels/registry.js';
import { lookupPreset, presetDestination } from './presets.js';
import { panelSpecFromState, mergePanelSpec, effectiveScope, canonicalPanelSpec } from '../core/view-spec.js';

export const MAX_BOARD_PANELS = 12;

export function boardScope(state = {}) {
  const scope = {};
  for (const key of ['win', 'from', 'to', 'tz']) if (state[key]) scope[key] = state[key];
  if (state.filters) for (const [key, values] of Object.entries(state.filters)) if (values?.length) scope[key] = values;
  if (state.exclude?.length) scope.exclude = state.exclude;
  if (state.cohorts) {
    const cohorts = Object.fromEntries(Object.entries(state.cohorts).filter(([, value]) => value));
    if (Object.keys(cohorts).length) scope.cohorts = cohorts;
  }
  return scope;
}

export function assembleBoard({ presetId, state = {} } = {}) {
  const preset = lookupPreset(presetId);
  const destination = presetDestination(presetId);
  if (destination?.kind === 'named') {
    return { kind: 'named', presetId, title: destination.title, phase: destination.phase, label: destination.label };
  }
  if (!preset) {
    return { kind: 'missing', presetId, reason: `No board preset named ${presetId}.` };
  }
  if (preset.panels.length > MAX_BOARD_PANELS) {
    return { kind: 'invalid', presetId, reason: `A board holds at most ${MAX_BOARD_PANELS} panels; ${presetId} has ${preset.panels.length}.` };
  }
  const scope = boardScope(state);
  const panels = [];
  const reasons = [];
  preset.panels.forEach((panelId, index) => {
    const key = `p${index + 1}`;
    const panel = lookupPanel(panelId);
    if (!panel) {
      reasons.push({ key, panelId, reason: `Panel ${panelId} is not registered.` });
      panels.push({ key, panelId, panel: null, spec: null, scope, reason: `Panel ${panelId} is not registered.` });
      return;
    }
    const presetSpec = preset.specs?.[panelId] ? canonicalPanelSpec(preset.specs[panelId]) : null;
    const override = panelSpecFromState(state, key);
    const spec = mergePanelSpec(presetSpec, override);
    panels.push({ key, panelId, panel, spec, scope: effectiveScope(scope, spec?.scope), reason: null });
  });
  return { kind: 'board', presetId, title: preset.title, scope, panels, reasons };
}
