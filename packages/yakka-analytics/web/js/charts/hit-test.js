// Two-dimensional hit-testing for the scatter chart. Pure functions over
// projected points: the caller supplies a data-to-plot projection so the same
// code serves a uPlot hook path or the first-party canvas fallback. There is
// no test-only branch and no DOM here.

function projectX(point, toX) {
  if (typeof toX === 'function') return toX(point);
  if (Number.isFinite(point.px)) return point.px;
  return Number.isFinite(point.x) ? point.x : NaN;
}

function projectY(point, toY) {
  if (typeof toY === 'function') return toY(point);
  if (Number.isFinite(point.py)) return point.py;
  return Number.isFinite(point.y) ? point.y : NaN;
}

/**
 * Nearest point in plot-pixel space. `points` are `{key,x,y}`; `query` is
 * `{x,y}` in the same pixel space. Ties are broken by the entity key, then by
 * input order, so the result never depends on draw order.
 */
export function nearestPoint(points, query, { xToPx = null, yToPx = null } = {}) {
  if (!Array.isArray(points) || !query) return null;
  const qx = Number(query.x);
  const qy = Number(query.y);
  if (!Number.isFinite(qx) || !Number.isFinite(qy)) return null;
  let best = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const px = projectX(point, xToPx);
    const py = projectY(point, yToPx);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const distance = Math.hypot(px - qx, py - qy);
    const candidate = { point, index, px, py, distance };
    if (best === null) { best = candidate; continue; }
    if (distance < best.distance - 1e-9) { best = candidate; continue; }
    if (Math.abs(distance - best.distance) <= 1e-9) {
      const left = String(point.key ?? '');
      const right = String(best.point.key ?? '');
      if (left < right) best = candidate;
    }
  }
  if (!best) return null;
  return {
    key: best.point.key ?? null,
    index: best.index,
    point: best.point,
    px: best.px,
    py: best.py,
    distance: best.distance
  };
}

function rectBounds(rect = {}) {
  const left = Number(rect.left ?? Math.min(rect.x0, rect.x1));
  const right = Number(rect.right ?? Math.max(rect.x0, rect.x1));
  const top = Number(rect.top ?? Math.min(rect.y0, rect.y1));
  const bottom = Number(rect.bottom ?? Math.max(rect.y0, rect.y1));
  return {
    left: Math.min(left, right),
    right: Math.max(left, right),
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom)
  };
}

/**
 * Keys whose projected points fall inside an axis-aligned plot-pixel
 * rectangle. Membership is inclusive of the edges, deduplicated and returned
 * in stable key order. Sampled and unsampled marks are both members; the
 * caller labels the sample separately.
 */
export function pointsInRect(points, rect, { xToPx = null, yToPx = null } = {}) {
  if (!Array.isArray(points) || !rect) return [];
  const bounds = rectBounds(rect);
  const keys = new Set();
  for (const point of points) {
    const px = projectX(point, xToPx);
    const py = projectY(point, yToPx);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < bounds.left || px > bounds.right || py < bounds.top || py > bounds.bottom) continue;
    keys.add(String(point.key));
  }
  return [...keys].sort();
}

/** Rectangle membership as data-space ranges, for the entity predicate. */
export function rectToData(rect, { xToData = null, yToData = null } = {}) {
  if (!rect) return null;
  const bounds = rectBounds(rect);
  const x0 = typeof xToData === 'function' ? xToData(bounds.left) : bounds.left;
  const x1 = typeof xToData === 'function' ? xToData(bounds.right) : bounds.right;
  const y0 = typeof yToData === 'function' ? yToData(bounds.bottom) : bounds.bottom;
  const y1 = typeof yToData === 'function' ? yToData(bounds.top) : bounds.top;
  if (![x0, x1, y0, y1].every(Number.isFinite)) return null;
  return {
    x: { min: Math.min(x0, x1), max: Math.max(x0, x1) },
    y: { min: Math.min(y0, y1), max: Math.max(y0, y1) }
  };
}
