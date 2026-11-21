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
// shared scope, in the DOM order S-pulse fixes: metrics first and full width,
// then activity, movers, calendar and coverage. Registration is idempotent so a
// module reload never duplicates a panel id.
export const PULSE_PANELS = [PULSE_STRIPS_PANEL, RIVER_PANEL, MOVERS_PANEL, CALENDAR_PANEL, COVERAGE_PANEL];
export const PULSE_PRESET_ID = 'pulse';

// The literal caption keys are selected by the panel unit; this preset carries
// only the key and the G-item defaults. `captionKey` lives in the panel scope
// and is never copied onto a request.
export const PULSE_SPECS = {
  'pulse-strips': { grain: 'time', measures: ['cost_usd'], chart: 'metrics', scope: { captionKey: 'G-metrics' } },
  river: { grain: 'activity observation', measures: ['observation'], chart: 'lanes', scope: { captionKey: 'G-activity' } },
  movers: { grain: 'time', measures: ['cost_usd'], chart: 'bars', scope: { captionKey: 'G-movers' } },
  calendar: { grain: 'time', measures: ['cost_usd'], chart: 'calendar', scope: { captionKey: 'G-calendar' } },
  coverage: { grain: 'typed populations', measures: [], chart: 'table', scope: { captionKey: 'G-coverage' } }
};

export function registerPulse() {
  for (const panel of PULSE_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(PULSE_PRESET_ID)) {
    registerPreset({
      id: PULSE_PRESET_ID,
      title: 'Pulse',
      panels: PULSE_PANELS.map(panel => panel.id),
      specs: PULSE_SPECS,
      fullWidth: ['pulse-strips']
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
