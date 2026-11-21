// The Compare preset: five registered panels over two equal finite periods.
// Each compare-sensitive panel carries `scope: { cmp: 'period' }` so /b/compare
// compares without a URL edit; a per-panel URL spec can override it. `cmp` is a
// scope input, never a board-level server parameter.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { DIST_RANGES_PANEL } from './dist-ranges.js';
import { DIST_HIST_PANEL } from './dist-hist.js';
import { DIST_ECDF_PANEL } from './dist-ecdf.js';
import { TREND_LINES_PANEL } from './trend-lines.js';
import { RANK_PANEL } from './rank.js';

export const COMPARE_PANELS = [DIST_RANGES_PANEL, DIST_HIST_PANEL, DIST_ECDF_PANEL, TREND_LINES_PANEL, RANK_PANEL];
export const COMPARE_PRESET_ID = 'compare';

export const COMPARE_SPECS = {
  'dist-ranges': { grain: 'call', measures: ['cost_usd'], split: 'model', chart: 'ranges', scope: { cmp: 'period', captionKey: 'G-compranges' } },
  'dist-hist': { grain: 'call', measures: ['cost_usd'], split: 'model', chart: 'histogram', scope: { cmp: 'period', captionKey: 'G-comphist' } },
  'dist-ecdf': { grain: 'call', measures: ['cost_usd'], split: 'model', chart: 'ecdf', scope: { cmp: 'period', captionKey: 'G-compecdf' } },
  'trend-lines': { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'lines', scope: { cmp: 'period', captionKey: 'G-complines' } },
  rank: { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'slope', scope: { cmp: 'period', captionKey: 'G-slope' } }
};

export function registerComparePanels() {
  for (const panel of COMPARE_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(COMPARE_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: COMPARE_PRESET_ID,
      title: 'Compare',
      panels: COMPARE_PANELS.map(panel => panel.id),
      specs: COMPARE_SPECS,
      fullWidth: ['rank']
    });
  }
  return true;
}

export default registerComparePanels;
