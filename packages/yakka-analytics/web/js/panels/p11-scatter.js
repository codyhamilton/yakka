// Phase 11 scatter registration. It registers only the panel ids that exist at
// this commit and does not register a `scatter` preset: `/b/scatter` stays the
// named Phase 11 destination until 11-03 delivers the four-panel board.

import { hasPanel, registerPanel } from './registry.js';
import { SCATTER_SESSION_PANEL } from './scatter-session.js';
import { SCATTER_ARTIFACT_PANEL } from './scatter-artifact.js';
import { SCATTER_PLAN_PANEL } from './scatter-plan.js';

export const P11_SCATTER_PANELS = [SCATTER_SESSION_PANEL, SCATTER_ARTIFACT_PANEL, SCATTER_PLAN_PANEL];

export function registerScatterPanels() {
  for (const panel of P11_SCATTER_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  return true;
}
