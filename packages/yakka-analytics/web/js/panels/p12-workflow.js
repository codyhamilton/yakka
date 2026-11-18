// Phase 12 workflow registration. It registers the two panels the `workflow`
// preset needs and nothing else: 12-02 completes the preset once plan-cost rank
// exists. Registration is idempotent so a module reload never duplicates an id.

import { hasPanel, registerPanel } from './registry.js';
import { SHAPE_BARS_PANEL } from './shape-bars.js';
import { PLAN_TIMELINE_PANEL } from './plan-timeline.js';

export { ensureWorkflowStyles } from './shape-bars.js';

export const P12_WORKFLOW_PANEL_IDS = [SHAPE_BARS_PANEL.id, PLAN_TIMELINE_PANEL.id];

export const P12_WORKFLOW_PANELS = [SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL];

export function registerP12WorkflowPanels() {
  for (const panel of P12_WORKFLOW_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  return true;
}

registerP12WorkflowPanels();

export { SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL };

export default registerP12WorkflowPanels;
