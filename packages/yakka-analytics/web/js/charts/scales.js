// Scale configuration and pixel/data conversions for <yk-chart>. One x scale
// (time or numeric), exactly one y scale, and an optional cursor-synced scale
// group keyed by a spec string. Column modes pin the y scale to zero.

export function scaleGroupKey(spec = {}) {
  const key = spec.scaleGroup ?? spec.sync ?? null;
  return key === null || key === undefined || key === '' || key === false ? null : String(key);
}

export function xIsNumeric(spec = {}) {
  return spec.x?.kind === 'number' || spec.x?.time === false;
}

export function normaliseYRange(range) {
  if (!range) return null;
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return { min, max };
}

export function buildScales(spec = {}, { zeroBased = false } = {}) {
  const scales = {
    x: xIsNumeric(spec)
      ? { time: false, auto: true, distr: 1 }
      : { time: true, auto: true, distr: 1 }
  };
  const y = { auto: true, distr: 1 };
  const explicit = normaliseYRange(spec.yRange);
  if (explicit) {
    y.range = () => [explicit.min, explicit.max];
  } else if (zeroBased) {
    y.range = (u, dataMin, dataMax) => [Math.min(0, dataMin ?? 0), dataMax ?? 0];
  }
  scales.y = y;
  return scales;
}

// A series dash accepts the contract words or an explicit array. Only a real
// dash reaches uPlot; solid and absent both leave the line unbroken.
export function normaliseDash(dash) {
  if (Array.isArray(dash)) return dash.length ? dash.map(Number).filter(Number.isFinite) : null;
  if (typeof dash !== 'string') return null;
  const key = dash.toLowerCase();
  if (key === 'dashed' || key === 'dash') return [6, 4];
  if (key === 'dotted' || key === 'dot') return [2, 3];
  return null;
}

// Grouped columns need two series to share one category band. Without an
// explicit align every series keeps the full stacked width; with aligns the
// band is split evenly and each series sits at its own edge.
export function columnBarLayout(series = []) {
  const items = Array.isArray(series) ? series : [];
  const grouped = items.some(item => Number.isFinite(Number(item?.align)));
  if (!grouped) {
    return { grouped: false, size: [0.72, Infinity, 1], aligns: items.map(() => 0) };
  }
  const width = Math.min(0.9, 1 / Math.max(1, items.length));
  return {
    grouped: true,
    size: [width, Infinity, 1],
    aligns: items.map(item => (Number.isFinite(Number(item?.align)) ? Number(item.align) : 0))
  };
}

export function clampPct(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function dataToPx(value, { min, max, size, invert = false } = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(size)) return NaN;
  const span = max - min;
  const pct = span === 0 ? 0 : clampPct((value - min) / span);
  return invert ? size * (1 - pct) : size * pct;
}

export function pxToData(position, { min, max, size, invert = false } = {}) {
  if (!Number.isFinite(position) || !Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(size) || size === 0) return NaN;
  const pct = clampPct(invert ? 1 - position / size : position / size);
  return min + pct * (max - min);
}

export function xToPx(value, range = {}) {
  return dataToPx(value, { min: range.min, max: range.max, size: range.width, invert: false });
}

export function yToPx(value, range = {}) {
  return dataToPx(value, { min: range.min, max: range.max, size: range.height, invert: true });
}

export function xPxToData(position, range = {}) {
  return pxToData(position, { min: range.min, max: range.max, size: range.width, invert: false });
}

export function yPxToData(position, range = {}) {
  return pxToData(position, { min: range.min, max: range.max, size: range.height, invert: true });
}

export function scaleRange(scale) {
  if (!scale) return { min: null, max: null };
  return { min: scale.min ?? null, max: scale.max ?? null };
}
