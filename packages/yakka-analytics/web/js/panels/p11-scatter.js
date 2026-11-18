// Phase 11 scatter registration. It registers the four delivered panels and
// the `scatter` preset with canonical starting specs: session, artifact, plan
// and time scatters plus population marginals. The preset names only panel ids
// that exist and never exceeds the board's twelve-panel bound.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { SCATTER_SESSION_PANEL } from './scatter-session.js';
import { SCATTER_ARTIFACT_PANEL } from './scatter-artifact.js';
import { SCATTER_PLAN_PANEL } from './scatter-plan.js';
import { SCATTER_DAY_PANEL } from './scatter-day.js';

export const P11_SCATTER_PANELS = [SCATTER_SESSION_PANEL, SCATTER_ARTIFACT_PANEL, SCATTER_PLAN_PANEL, SCATTER_DAY_PANEL];
export const SCATTER_PRESET_ID = 'scatter';

export const SCATTER_SPECS = {
  'scatter-session': {
    grain: 'session', measures: ['cost_usd', 'commits', 'unpriced_calls'], split: 'session_model', chart: 'scatter',
    scope: { x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: 'session_model' }
  },
  'scatter-artifact': {
    grain: 'artifact', measures: ['writing_session_cost_usd', 'score:clarity'], split: 'session_model', chart: 'scatter',
    scope: { x: 'writing_session_cost_usd', y: 'score:clarity', colour: 'session_model' }
  },
  'scatter-plan': {
    grain: 'plan', measures: ['associated_cost_usd', 'artifacts'], split: 'repo_id', chart: 'scatter',
    scope: { x: 'associated_cost_usd', y: 'artifacts', colour: 'repo_id' }
  },
  'scatter-day': {
    grain: 'time', measures: ['cost_usd', 'commits'], chart: 'scatter',
    scope: { x: 'cost_usd', y: 'commits' }
  }
};

export function registerScatterPanels() {
  for (const panel of P11_SCATTER_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(SCATTER_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: SCATTER_PRESET_ID,
      title: 'Scatter',
      panels: P11_SCATTER_PANELS.map(panel => panel.id),
      specs: SCATTER_SPECS
    });
  }
  return true;
}

export default registerScatterPanels;
