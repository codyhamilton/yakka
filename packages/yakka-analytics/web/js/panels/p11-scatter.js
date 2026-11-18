// Phase 11 scatter registration. It registers only the panel ids that exist
// at this commit and does not register a `scatter` preset yet: `/b/scatter`
// stays the named Phase 11 destination until 11-03 delivers the board. Units
// 11-02 and 11-03 append their panels to this same module.

import { hasPanel, registerPanel } from './registry.js';
import { SCATTER_SESSION_PANEL } from './scatter-session.js';

export const P11_SCATTER_PANELS = [SCATTER_SESSION_PANEL];

export function registerScatterPanels() {
  for (const panel of P11_SCATTER_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  return true;
}
