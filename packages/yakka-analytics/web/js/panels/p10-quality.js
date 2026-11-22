// The Quality preset: four registered panels over content-hash and artifact
// populations. The two units are never pooled: score-ranges/score-trend are
// hash-weighted, score-strips/band-mix are file-weighted.

import { hasPanel, registerPanel } from './registry.js';
import { lookupPreset, registerPreset } from '../boards/presets.js';
import { SCORE_RANGES_PANEL } from './score-ranges.js';
import { SCORE_TREND_PANEL } from './score-trend.js';
import { SCORE_STRIPS_PANEL } from './score-strips.js';
import { BAND_MIX_PANEL } from './band-mix.js';

export const QUALITY_PANELS = [SCORE_RANGES_PANEL, SCORE_TREND_PANEL, SCORE_STRIPS_PANEL, BAND_MIX_PANEL];
export const QUALITY_PRESET_ID = 'quality';

// Canonical starting specs. The kind/check/scorer choices live in the panel
// scope, so they survive the URL and never become legacy `exclude` strings.
export const QUALITY_SPECS = {
  'score-ranges': { grain: 'content', measures: ['score'], split: 'harness', chart: 'ranges', scope: { captionKey: 'G-scores' } },
  'score-trend': { grain: 'content', measures: ['score'], split: 'session_model', chart: 'lines', scope: { captionKey: 'G-scoretrend' } },
  'score-strips': { grain: 'artifact', measures: ['score'], split: 'kind', chart: 'strip', scope: { captionKey: 'G-strips' } },
  'band-mix': { grain: 'artifact', measures: ['score'], split: 'kind', chart: 'stacked', scope: { captionKey: 'G-bands' } }
};

export function registerQualityPanels() {
  for (const panel of QUALITY_PANELS) if (!hasPanel(panel.id)) registerPanel(panel);
  if (!lookupPreset(QUALITY_PRESET_ID)?.panels?.length) {
    registerPreset({
      id: QUALITY_PRESET_ID,
      title: 'Quality',
      panels: QUALITY_PANELS.map(panel => panel.id),
      specs: QUALITY_SPECS,
      fullWidth: []
    });
  }
  return true;
}

export default registerQualityPanels;
