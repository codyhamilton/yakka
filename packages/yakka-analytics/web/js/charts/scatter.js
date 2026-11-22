// Numeric-x scatter model and drawing primitives.
//
// uPlot-hook attempt (recorded before choosing the fallback): uPlot 1.6.32 is
// vendored as published. Its cursor is one-dimensional — `setCursor` resolves
// `cursor.idx` from the x scale alone (uPlot.esm.js setCursor/`idx` path), so
// it cannot answer a two-dimensional nearest-point query. Its series marks are
// configured per series, not per point: `points.size`, `points.fill` and
// `points.stroke` are single values (uPlot.esm.js `series.points` defaults), so
// a 5,000-point mark set with per-point colour, shape and size is not
// expressible. Its built-in drag/select is an x (or y) range, and 7-03 already
// owns the overlay pointer grammar. The hooks therefore cannot carry the 2-D
// work; the declared first-party Canvas 2D fallback is used behind the same
// element contract, with no second library.

export const SCATTER_PADDING = { left: 52, right: 14, top: 14, bottom: 34 };

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function fieldValue(point, key) {
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(point, key)) return point[key];
  const parts = String(key).split('.');
  let value = point;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[part];
  }
  return value;
}

export function normaliseScatterSpec(spec = {}) {
  const series = (spec.series || []).map((item, order) => ({
    ...item,
    key: String(item.key),
    label: item.label || String(item.key),
    order
  }));
  return {
    ...spec,
    chart: 'scatter',
    type: 'scatter',
    x: { label: 'X', kind: 'number', ...(spec.x || {}) },
    y: { label: 'Y', kind: 'number', ...(spec.y || {}) },
    series,
    colour: spec.colour && spec.colour.key ? { ...spec.colour } : null,
    shape: spec.shape && spec.shape.key ? { ...spec.shape } : null,
    size: spec.size && spec.size.key ? { min: 2.5, max: 9, ...spec.size } : null
  };
}

function scaledSize(value, size) {
  if (!size) return 3.5;
  if (!finite(value)) return size.min;
  const span = Number.isFinite(size.domain?.[0]) && Number.isFinite(size.domain?.[1])
    ? size.domain[1] - size.domain[0]
    : null;
  if (span && span > 0) {
    const pct = Math.min(1, Math.max(0, (value - size.domain[0]) / span));
    return size.min + pct * (size.max - size.min);
  }
  const magnitude = Math.max(1, Math.abs(value));
  return size.min + Math.min(1, Math.log10(magnitude + 1) / 2) * (size.max - size.min);
}

/**
 * Normalise scatter rows. Each point keeps its entity key, the two numeric
 * axes, an optional colour key, shape, numeric size field and sampled flag.
 * Marks are never deduplicated: duplicate entity keys stay distinct points.
 */
export function scatterModel({ spec = {}, data = [] } = {}) {
  const normal = normaliseScatterSpec(spec);
  const rows = Array.isArray(data) ? data : [];
  const points = rows.map((row, index) => {
    const colourKey = normal.colour ? fieldValue(row, normal.colour.key) : (row.group ?? null);
    const shape = normal.shape ? fieldValue(row, normal.shape.key) : null;
    const sizeValue = normal.size ? fieldValue(row, normal.size.key) : null;
    return {
      key: row.key == null ? `point:${index}` : String(row.key),
      index,
      x: row.x,
      y: finite(row.y) ? row.y : fieldValue(row, normal.y.key || 'y'),
      group: colourKey == null ? null : String(colourKey),
      shape: shape ? String(shape) : null,
      size: scaledSize(sizeValue, normal.size),
      sampled: Boolean(row.sampled),
      values: { ...(row.values || {}), y: finite(row.y) ? row.y : row.values?.y }
    };
  });
  return { spec: normal, points };
}

export function scatterExtent(points, axis, { integer = false } = {}) {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    const value = point[axis];
    if (!finite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (integer) {
    min = Math.min(0, Math.floor(min));
    max = Math.ceil(max);
    if (min === max) max = min + 1;
    return { min, max };
  }
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.04;
  return { min: min - pad, max: max + pad };
}

export function scatterLayout(points, { width = 640, height = 240, padding = SCATTER_PADDING, xInteger = false, yInteger = false } = {}) {
  const plot = {
    left: padding.left,
    top: padding.top,
    width: Math.max(1, width - padding.left - padding.right),
    height: Math.max(1, height - padding.top - padding.bottom)
  };
  const x = scatterExtent(points, 'x', { integer: xInteger });
  const y = scatterExtent(points, 'y', { integer: yInteger });
  return {
    width,
    height,
    plot,
    xScale: { min: x.min, max: x.max, width: plot.width },
    yScale: { min: y.min, max: y.max, height: plot.height }
  };
}

export function projectScatter(points, layout) {
  const { plot, xScale, yScale } = layout;
  return points.map(point => ({
    ...point,
    px: Number.isFinite(point.x) && xScale.max > xScale.min
      ? plot.left + ((point.x - xScale.min) / (xScale.max - xScale.min)) * plot.width
      : NaN,
    py: Number.isFinite(point.y) && yScale.max > yScale.min
      ? plot.top + (1 - (point.y - yScale.min) / (yScale.max - yScale.min)) * plot.height
      : NaN
  }));
}

export function scatterPxToData(px, py, layout) {
  const { plot, xScale, yScale } = layout;
  const x = xScale.min + ((px - plot.left) / plot.width) * (xScale.max - xScale.min);
  const y = yScale.min + (1 - (py - plot.top) / plot.height) * (yScale.max - yScale.min);
  return { x, y };
}

/** Draw one mark in a named shape; size is a radius in pixels. */
export function drawMark(ctx, shape, x, y, size, { fill, stroke, hollow = false, alpha = 1 } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size <= 0) return;
  const radius = Math.max(1, size);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = fill || stroke || '#1d4ed8';
  ctx.strokeStyle = stroke || fill || '#1d4ed8';
  ctx.lineWidth = hollow ? 1.5 : 1;
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      break;
    case 'triangle':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + radius, y);
      ctx.lineTo(x, y + radius);
      ctx.lineTo(x - radius, y);
      ctx.closePath();
      break;
    case 'cross':
      ctx.moveTo(x - radius, y);
      ctx.lineTo(x + radius, y);
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x, y + radius);
      break;
    case 'hexagon': {
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = x + radius * Math.cos(angle);
        const py = y + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'star': {
      for (let i = 0; i < 10; i += 1) {
        const length = i % 2 === 0 ? radius : radius * 0.45;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const px = x + length * Math.cos(angle);
        const py = y + length * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'ring':
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'transparent';
      break;
    case 'circle':
    default:
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      break;
  }
  if (shape === 'cross' || hollow || shape === 'ring') ctx.stroke();
  else ctx.fill();
  ctx.restore();
}
