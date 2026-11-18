// Phase 12 workflow registration. It registers the five panels the `workflow`
// preset needs and overwrites the declared named preset with a delivered board
// once plan-grain rank exists. Registration is idempotent so a module reload
// never duplicates an id or a panel.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { SHAPE_BARS_PANEL } from './shape-bars.js';
import { PLAN_TIMELINE_PANEL } from './plan-timeline.js';
import { RANK_PANEL } from './rank.js';
import { SCATTER_PLAN_PANEL } from './scatter-plan.js';
import { RIVER_PANEL } from './river.js';

export { ensureWorkflowStyles } from './shape-bars.js';

export const P12_WORKFLOW_PANEL_IDS = [SHAPE_BARS_PANEL.id, PLAN_TIMELINE_PANEL.id];

export const P12_WORKFLOW_PANELS = [SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL];

export const WORKFLOW_PRESET_ID = 'workflow';

export const WORKFLOW_PANEL_IDS = [
  SHAPE_BARS_PANEL.id, PLAN_TIMELINE_PANEL.id, RANK_PANEL.id, SCATTER_PLAN_PANEL.id, RIVER_PANEL.id
];

export const WORKFLOW_PANELS = [SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL, RANK_PANEL, SCATTER_PLAN_PANEL, RIVER_PANEL];

// One canonical starting spec per panel. Rank is plan-grain associated cost;
// scatter-plan reuses the delivered cost/artifacts scatter; river is the
// default activity timeline.
export const WORKFLOW_SPECS = {
  'shape-bars': {
    grain: 'plan',
    measures: ['executions_complete', 'executions_unreported', 'executions_started', 'complete_share', 'last_ts'],
    chart: 'bars'
  },
  'plan-timeline': { grain: 'plan', measures: ['ts', 'session_cost_usd'], chart: 'lanes' },
  rank: { grain: 'plan', measures: ['associated_cost_usd'], chart: 'rank' },
  'scatter-plan': {
    grain: 'plan', measures: ['associated_cost_usd', 'artifacts'], split: 'repo_id', chart: 'scatter',
    scope: { x: 'associated_cost_usd', y: 'artifacts', colour: 'repo_id' }
  },
  river: { grain: 'activity observation', measures: ['observation'], chart: 'lanes' }
};

export function registerP12WorkflowPanels() {
  for (const panel of P12_WORKFLOW_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  for (const panel of WORKFLOW_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  // The declared preset is a named destination; this registration overwrites it
  // with the delivered board. Re-registering the same board is harmless.
  registerPreset({
    id: WORKFLOW_PRESET_ID,
    title: lookupPreset(WORKFLOW_PRESET_ID)?.title || 'Workflow',
    panels: WORKFLOW_PANEL_IDS.slice(),
    specs: WORKFLOW_SPECS
  });
  return true;
}

registerP12WorkflowPanels();

export { SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL, RANK_PANEL, SCATTER_PLAN_PANEL, RIVER_PANEL };

export default registerP12WorkflowPanels;
