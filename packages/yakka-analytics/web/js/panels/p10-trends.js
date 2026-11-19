// The Trends preset: five registered panels over one scope, with canonical
// starting specs. It names only panels that exist (calendar is Phase 9's).

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { CALENDAR_PANEL } from './calendar.js';
import { TREND_COLUMNS_PANEL } from './trend-columns.js';
import { TREND_LINES_PANEL } from './trend-lines.js';
import { TREND_MULTIPLES_PANEL } from './trend-multiples.js';
import { RHYTHM_PANEL } from './rhythm.js';

export const TRENDS_PANELS = [TREND_COLUMNS_PANEL, TREND_LINES_PANEL, TREND_MULTIPLES_PANEL, CALENDAR_PANEL, RHYTHM_PANEL];
export const TRENDS_PRESET_ID = 'trends';

export const TRENDS_SPECS = {
  'trend-columns': { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'columns' },
  'trend-lines': { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'lines' },
  'trend-multiples': { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'lines' },
  calendar: { grain: 'time', measures: ['cost_usd'], chart: 'calendar' },
  rhythm: { grain: 'time', measures: ['hook_events'], chart: 'heatmap' }
};

export function registerTrendsPanels() {
  for (const panel of TRENDS_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(TRENDS_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: TRENDS_PRESET_ID,
      title: 'Trends',
      panels: TRENDS_PANELS.map(panel => panel.id),
      specs: TRENDS_SPECS
    });
  }
  return true;
}

export default registerTrendsPanels;
