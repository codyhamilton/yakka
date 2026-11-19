// Gallery index for the Phase 7 and Phase 8 case pages. External modules only;
// it links the four Phase 7 pages and the five Phase 8 pages, shows the
// deterministic fixture sizes, and displays the current theme and case name for
// the acceptance suite. No charts, so it settles at once.

import { readTheme } from '/js/charts/styles.js';
import {
  ENTITY_KEYS, SCATTER_BUDGET, SERIES, timeSeries
} from '/gallery/fixture.js';

export const PHASE8_CASES = ['bars', 'ranges', 'matrix', 'lanes', 'treemap'];

const params = new URLSearchParams(window.location.search);
const caseName = params.get('case') || 'gallery-index';
const rows = timeSeries({ points: 12 });

document.documentElement.dataset.case = caseName;
document.getElementById('gallery-theme').textContent = `theme: ${readTheme(document)}`;
document.getElementById('gallery-case').textContent = `case: ${caseName}`;
document.getElementById('gallery-fixture').textContent = `fixture: ${SERIES.length} series, ${ENTITY_KEYS.length} entity keys, ${SCATTER_BUDGET} scatter points, ${rows.length} buckets, ${PHASE8_CASES.length} Phase 8 cases`;

document.documentElement.dataset.idle = 'true';
