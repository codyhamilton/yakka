// Resolution, sample and coverage badges. The vocabulary is the panel-state
// vocabulary from DESIGN.md: non-exclusive partial, sampled, coarsened,
// clipped and lower-bound flags beside the panel state itself.

import { formatNumber, formatSample, NULL_TEXT } from './formatters.js';

export const COVERAGE_LABELS = {
  partial: { label: 'partial', title: 'Some rows in scope were not available for this panel.' },
  sampled: { label: 'sampled', title: 'A sample was read; marginals describe the whole population.' },
  coarsened: { label: 'coarsened', title: 'The server answered at a coarser bucket or grain than asked.' },
  clipped: { label: 'clipped', title: 'A row, bucket or value limit truncated the response.' },
  lowerBound: { label: 'lower-bound', title: 'The value is a lower bound because some events are unpriced.' }
};

export const RESOLUTION_LABELS = {
  minute: 'minute',
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month'
};

export function coverageFlags(coverage = {}) {
  if (Array.isArray(coverage)) {
    return coverage.filter(flag => COVERAGE_LABELS[flag]).map(flag => ({ kind: flag, ...COVERAGE_LABELS[flag] }));
  }
  return Object.entries(COVERAGE_LABELS)
    .filter(([key]) => coverage?.[key])
    .map(([kind, value]) => ({ kind, ...value }));
}

function resolutionText(resolution) {
  if (!resolution) return '';
  if (typeof resolution === 'string') return RESOLUTION_LABELS[resolution] ?? resolution;
  const grain = resolution.grain ?? 'time';
  const bucket = resolution.bucket ?? resolution.resolution;
  return bucket ? `${grain} · ${RESOLUTION_LABELS[bucket] ?? bucket}` : String(grain);
}

/**
 * Build the badge model from spec metadata. Nothing here is inferred from the
 * data; every badge names the thing it qualifies.
 */
export function badgeModel(meta = {}) {
  const badges = [];
  const resolution = resolutionText(meta.resolution);
  if (resolution) badges.push({ kind: 'resolution', label: `resolution: ${resolution}`, title: 'The grain and bucket the server answered at.' });
  if (meta.sample) {
    const n = meta.sample.n;
    const total = meta.sample.total;
    badges.push({ kind: 'sample', label: formatSample(n, total), title: 'Sample size and the population it was drawn from.' });
  }
  for (const flag of coverageFlags(meta.coverage)) badges.push({ kind: flag.kind, ...flag });
  for (const value of meta.badges || []) {
    const known = COVERAGE_LABELS[value];
    badges.push(known ? { kind: value, ...known } : { kind: value, label: String(value), title: '' });
  }
  if (meta.unpriced !== undefined) {
    const count = Number(meta.unpriced) || 0;
    badges.push({ kind: 'unpriced', label: `${formatNumber(count)} unpriced`, title: 'Events without a price are never counted as zero.' });
  }
  if (meta.values) {
    for (const value of meta.values) badges.push({ kind: 'value', label: String(value), title: 'Named value kept distinct from (other).' });
  }
  if (meta.basis) badges.push({ kind: 'basis', label: `basis: ${meta.basis}`, title: 'The clock and derivation this frame uses.' });
  return badges;
}

export function createBadges(doc, model = []) {
  const element = doc.createElement('ul');
  element.className = 'yk-badges';
  element.setAttribute('aria-label', 'Resolution, sample and coverage');
  render();
  return { element, update(next = model) { model = next; render(); } };

  function render() {
    element.replaceChildren();
    for (const badge of model) {
      const item = doc.createElement('li');
      item.className = 'yk-badge';
      item.dataset.kind = badge.kind;
      item.textContent = badge.label || NULL_TEXT;
      if (badge.title) item.title = badge.title;
      element.append(item);
    }
  }
}
