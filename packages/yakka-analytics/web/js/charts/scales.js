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

export function buildScales(spec = {}, { zeroBased = false } = {}) {
  const scales = {
    x: xIsNumeric(spec)
      ? { time: false, auto: true, distr: 1 }
      : { time: true, auto: true, distr: 1 }
  };
  const y = { auto: true, distr: 1 };
  if (zeroBased) {
    y.range = (u, dataMin, dataMax) => [Math.min(0, dataMin ?? 0), dataMax ?? 0];
  }
  scales.y = y;
  return scales;
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
