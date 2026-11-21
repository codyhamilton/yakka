// The Cost preset: the six cost panels over one scope, with canonical starting
// specs. Five panels are already registered by 10-01 (trend-columns, rank,
// dist-ranges, dist-hist, dist-ecdf); this unit registers only the shared
// treemap and the Cost preset. A spec names only ids that exist once 10-01 and
// this module have loaded.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { TREND_COLUMNS_PANEL } from './trend-columns.js';
import { RANK_PANEL } from './rank.js';
import { TREEMAP_PANEL } from './treemap.js';
import { DIST_RANGES_PANEL } from './dist-ranges.js';
import { DIST_HIST_PANEL } from './dist-hist.js';
import { DIST_ECDF_PANEL } from './dist-ecdf.js';

export const COST_PANELS = [
  TREND_COLUMNS_PANEL, RANK_PANEL, TREEMAP_PANEL, DIST_RANGES_PANEL, DIST_HIST_PANEL, DIST_ECDF_PANEL
];

export const COST_PRESET_ID = 'cost';

export const COST_SPECS = {
  'trend-columns': { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'columns', scope: { captionKey: 'G-columns' } },
  rank: { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'rank', scope: { captionKey: 'G-rank' } },
  treemap: { grain: 'time', measures: ['cost_usd'], split: 'model', chart: 'treemap', scope: { parent: 'harness', captionKey: 'G-costmap' } },
  // Model, harness and repo are three real cost investigations: the model view
  // stays on trend-columns/rank, while the three distribution panels mount the
  // conversation repo lens, the call harness lens and the conversation model
  // lens. No repo total is formed from /query.
  'dist-ranges': { grain: 'session', measures: ['cost_usd'], split: 'session_repo', chart: 'ranges', scope: { grain: 'conversation', dim: 'session_repo', captionKey: 'G-ranges' } },
  'dist-hist': { grain: 'session', measures: ['cost_usd'], split: 'harness', chart: 'histogram', scope: { grain: 'call', dim: 'harness', captionKey: 'G-hist' } },
  'dist-ecdf': { grain: 'session', measures: ['cost_usd'], split: 'model', chart: 'ecdf', scope: { grain: 'conversation', dim: 'model', captionKey: 'G-ecdf' } }
};

export function registerCostPanels() {
  if (!hasPanel(TREEMAP_PANEL.id)) registerPanel(TREEMAP_PANEL);
  if (!lookupPreset(COST_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: COST_PRESET_ID,
      title: 'Cost',
      panels: COST_PANELS.map(panel => panel.id),
      specs: COST_SPECS,
      fullWidth: []
    });
  }
  return true;
}

export default registerCostPanels;
