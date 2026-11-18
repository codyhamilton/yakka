// Panel engine barrel. It exports the registry and frame and, once the Pulse
// panel modules load, registers the five Pulse panels and the `pulse` preset.

export {
  CHART_NAMES,
  REQUIRED_PANEL_FIELDS,
  registerPanel,
  lookupPanel,
  hasPanel,
  listPanels,
  clearPanels,
  validatePanelEntry,
  validateRegistry
} from './registry.js';
export { createPanelFrame } from './panel-frame.js';

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { RIVER_PANEL } from './river.js';
import { PULSE_STRIPS_PANEL } from './pulse-strips.js';
import { MOVERS_PANEL } from './movers.js';
import { CALENDAR_PANEL } from './calendar.js';
import { COVERAGE_PANEL } from './coverage.js';
import { registerTrendsPanels } from './p10-trends.js';
import { registerComparePanels } from './p10-compare.js';
import { registerQualityPanels } from './p10-quality.js';
import { registerCostPanels } from './p10-cost.js';
import { registerToolsPanels } from './p10-tools.js';
import { registerScatterPanels } from './p11-scatter.js';
import { registerP12WorkflowPanels } from './p12-workflow.js';

export { RIVER_PANEL } from './river.js';
export { PULSE_STRIPS_PANEL } from './pulse-strips.js';
export { MOVERS_PANEL } from './movers.js';
export { CALENDAR_PANEL } from './calendar.js';
export { COVERAGE_PANEL } from './coverage.js';
export { P12_WORKFLOW_PANEL_IDS, SHAPE_BARS_PANEL, PLAN_TIMELINE_PANEL } from './p12-workflow.js';

// The Pulse preset is exactly the five ids in the design's preset table, one
// shared scope. Registration is idempotent so a module reload never duplicates
// a panel id.
export const PULSE_PANELS = [RIVER_PANEL, PULSE_STRIPS_PANEL, MOVERS_PANEL, CALENDAR_PANEL, COVERAGE_PANEL];
export const PULSE_PRESET_ID = 'pulse';

export function registerPulse() {
  for (const panel of PULSE_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(PULSE_PRESET_ID)) {
    registerPreset({
      id: PULSE_PRESET_ID,
      title: 'Pulse',
      panels: PULSE_PANELS.map(panel => panel.id)
    });
  }
  return true;
}

registerPulse();
registerTrendsPanels();
registerComparePanels();
registerQualityPanels();
registerCostPanels();
registerToolsPanels();
registerScatterPanels();
registerP12WorkflowPanels();
