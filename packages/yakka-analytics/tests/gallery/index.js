// Gallery index for the Phase 7 case pages. External modules only; it links
// the 7-01 foundations, 7-02 time series, 7-03 gestures and 7-04 scatter
// pages, shows the deterministic fixture sizes, and displays the current theme
// and case name for the acceptance suite. No charts, so it settles at once.

import { readTheme } from '/js/charts/styles.js';
import {
  ENTITY_KEYS, SCATTER_BUDGET, SERIES, timeSeries
} from '/gallery/fixture.js';

const params = new URLSearchParams(window.location.search);
const caseName = params.get('case') || 'gallery-index';
const rows = timeSeries({ points: 12 });

document.documentElement.dataset.case = caseName;
document.getElementById('gallery-theme').textContent = `theme: ${readTheme(document)}`;
document.getElementById('gallery-case').textContent = `case: ${caseName}`;
document.getElementById('gallery-fixture').textContent = `fixture: ${SERIES.length} series, ${ENTITY_KEYS.length} entity keys, ${SCATTER_BUDGET} scatter points, ${rows.length} buckets`;

document.documentElement.dataset.idle = 'true';
