// Panel engine barrel. Later phase units import the registry and the frame from
// here; no panel modules are registered by this unit.

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
