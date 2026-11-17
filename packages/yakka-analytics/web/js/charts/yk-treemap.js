// <yk-treemap> — a two-level squarified treemap on the shared Phase 8 SVG
// foundation. The measure is composed over two lenses: declared parent groups
// (repo) hold child cells (model). Child area is proportional to its value, the
// parent group area is the sum of its children, and the tail beyond the declared
// parents becomes one labelled `(other)` cell. Rectangles are coloured by the
// parent entity through the registry, so a group keeps one categorical style.
// There is no continuous time axis, so the element reports `brush: null` and
// emits no brush.

import {
  DEFAULT_HEIGHT, SvgChartElement, defineSvgChart, patternId, svgNode, textNode
} from './svg-base.js';
import { formatValue } from './formatters.js';

export const TREEMAP_LABEL_MIN = { width: 34, height: 16 };

function numeric(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
}

function keyLabel(key) {
  const text = String(key);
  const at = text.indexOf(':');
  return at > 0 ? text.slice(at + 1) : text;
}

function sum(values) {
  return values.reduce((total, value) => total + (numeric(value) ?? 0), 0);
}

function worstRatio(areas, side) {
  if (!areas.length || !(side > 0)) return Infinity;
  const total = sum(areas);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  if (!(total > 0) || !(min > 0)) return Infinity;
  return Math.max((side * side * max) / (total * total), (total * total) / (side * side * min));
}

/**
 * Lay values out in a rectangle with the squarified algorithm. The result is
 * aligned to the input order; the last cell in each row fills the remaining
 * band so the rectangles tile the area exactly and never overlap.
 */
export function squarify(values, { x = 0, y = 0, width = 0, height = 0 } = {}) {
  const list = (values || []).map(value => Math.max(0, numeric(value) ?? 0));
  const rects = list.map(() => ({ x, y, width: 0, height: 0 }));
  const total = sum(list);
  if (!(total > 0) || !(width > 0) || !(height > 0)) return rects;
  const scale = (width * height) / total;
  const items = list
    .map((value, index) => ({ index, area: value * scale }))
    .filter(item => item.area > 0)
    .sort((a, b) => b.area - a.area || a.index - b.index);

  let rx = x;
  let ry = y;
  let rw = width;
  let rh = height;
  let start = 0;
  while (start < items.length && rw > 0 && rh > 0) {
    const side = Math.min(rw, rh);
    let end = start + 1;
    let areas = [items[start].area];
    while (end < items.length) {
      const next = [...areas, items[end].area];
      if (worstRatio(areas, side) < worstRatio(next, side)) break;
      areas = next;
      end += 1;
    }
    const areaSum = sum(areas);
    if (rw >= rh) {
      const columnWidth = Math.min(rw, areaSum / rh);
      let cy = ry;
      for (let index = start; index < end; index += 1) {
        const last = index === end - 1;
        const cellHeight = last ? ry + rh - cy : items[index].area / columnWidth;
        rects[items[index].index] = { x: rx, y: cy, width: columnWidth, height: Math.max(0, cellHeight) };
        cy += cellHeight;
      }
      rx += columnWidth;
      rw -= columnWidth;
    } else {
      const rowHeight = Math.min(rh, areaSum / rw);
      let cx = rx;
      for (let index = start; index < end; index += 1) {
        const last = index === end - 1;
        const cellWidth = last ? rx + rw - cx : items[index].area / rowHeight;
        rects[items[index].index] = { x: cx, y: ry, width: Math.max(0, cellWidth), height: rowHeight };
        cx += cellWidth;
      }
      ry += rowHeight;
      rh -= rowHeight;
    }
    start = end;
  }
  return rects;
}

/** Lay parent groups into the plot and each group's children inside it. */
export function layoutTreemap(groups = [], width = 0, height = 0) {
  const parentRects = squarify(groups.map(group => group.total), { x: 0, y: 0, width, height });
  return groups.map((group, index) => {
    const rect = parentRects[index];
    const childRects = squarify(group.children.map(child => child.value), rect);
    return {
      ...group,
      rect,
      children: group.children.map((child, childIndex) => ({ ...child, rect: childRects[childIndex] }))
    };
  });
}

export function buildTreemapModel({ spec = {}, data = [] } = {}) {
  const declaredSeries = Array.isArray(spec.series) ? spec.series : [];
  if (!declaredSeries.length) {
    return { state: 'unsupported', reason: 'treemap needs a measure series spec', rows: [], series: [], tableRows: [] };
  }
  const measure = declaredSeries[0];
  const measureKey = String(measure.key);

  const declared = Array.isArray(spec.parents) && spec.parents.length
    ? spec.parents.map(parent => ({ key: String(parent.key), label: parent.label ?? keyLabel(parent.key) }))
    : null;
  const declaredIndex = new Map((declared || []).map(parent => [parent.key, parent]));
  const groups = new Map();
  const order = [];

  const ensure = (key, label) => {
    let group = groups.get(key);
    if (!group) {
      group = { key, label: label ?? keyLabel(key), children: [], total: 0 };
      groups.set(key, group);
      order.push(key);
    } else if (label && group.label === keyLabel(key)) {
      group.label = label;
    }
    return group;
  };

  if (declared) for (const parent of declared) ensure(parent.key, parent.label);

  const tail = { children: [], total: 0 };
  for (const input of data || []) {
    const key = input?.key === undefined || input?.key === null ? null : String(input.key);
    if (key === null) continue;
    const parentKey = input.parent === undefined || input.parent === null || input.parent === ''
      ? key
      : String(input.parent);
    const value = numeric(input.value ?? input.values?.[measureKey]);
    if (value === null || value <= 0) continue;
    const child = {
      key,
      label: input.label ?? keyLabel(key),
      value,
      values: { ...(input.values || {}), [measureKey]: value },
      n: input.n,
      coverage: input.coverage
    };
    if (declared) {
      const parent = declaredIndex.get(parentKey);
      if (parent) {
        const group = ensure(parent.key, parent.label);
        group.children.push(child);
        group.total += value;
      } else {
        tail.children.push(child);
        tail.total += value;
      }
    } else {
      const group = ensure(parentKey, input.parentLabel ?? keyLabel(parentKey));
      group.children.push(child);
      group.total += value;
    }
  }

  if (tail.total > 0) {
    const group = ensure('(other)', '(other)');
    group.children.push({
      key: '(other)',
      label: '(other)',
      value: tail.total,
      values: { [measureKey]: tail.total },
      n: tail.children.reduce((total, child) => total + (numeric(child.n) ?? 0), 0) || undefined
    });
    group.total = tail.total;
  }

  const kept = order
    .map(key => groups.get(key))
    .filter(group => group.total > 0 && group.children.length > 0);
  if (!kept.length) {
    return { state: 'empty', reason: 'no positive values in the current window', rows: [], series: [], tableRows: [] };
  }

  const rows = [];
  const parents = kept.map(group => {
    const children = group.children.map(child => {
      const row = {
        key: child.key,
        index: rows.length,
        parentKey: group.key,
        parentLabel: group.label,
        label: child.label,
        value: child.value,
        values: { ...child.values, [group.key]: child.value },
        n: child.n,
        coverage: child.coverage
      };
      rows.push(row);
      return { ...row };
    });
    return { key: group.key, label: group.label, total: group.total, children };
  });

  const series = parents.map(group => ({
    key: group.key,
    label: group.label,
    unit: measure.unit ?? spec.units ?? '',
    kind: measure.kind ?? 'number'
  }));

  return {
    state: 'ready',
    type: 'treemap',
    series,
    groups: parents,
    rows,
    entityKeys: parents.map(group => group.key),
    tableRows: rows.map(row => ({
      key: row.key,
      x: row.parentLabel,
      values: { child: row.label, value: row.value },
      n: row.n,
      coverage: row.coverage
    })),
    tableSeries: [
      { key: 'child', label: 'Child', kind: 'text' },
      { key: 'value', label: measure.label || measureKey, unit: measure.unit ?? spec.units ?? '', kind: measure.kind ?? 'number' }
    ],
    x: { label: 'Parent', kind: 'text' },
    window: null,
    height: Math.max(DEFAULT_HEIGHT, spec.height || 480),
    spec: { chart: spec.chart || 'treemap', type: 'treemap' }
  };
}

export class YkTreemap extends SvgChartElement {
  buildModel({ spec, data }) {
    return buildTreemapModel({ spec, data });
  }

  chartType(spec) {
    return spec?.chart || 'treemap';
  }

  supportsBrush() {
    return false;
  }

  whenSettled() {
    return super.whenSettled().then(() => {
      this.#guardTable();
      return undefined;
    });
  }

  // The shared base listens for its keyboard grammar on the chart root while
  // the shared table listens on the focused row; without this guard a table key
  // would act twice (Space would toggle the rows out of sync). Stop only those
  // keys after the table has handled them.
  #guardTable() {
    const table = this._table?.table;
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.dataset.treemapGuarded === 'true') continue;
      row.dataset.treemapGuarded = 'true';
      row.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter' ||
            event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.stopPropagation();
        }
      });
    }
  }

  renderPlot({ svg, doc, model, spec, plot, margin, styleFor, hidden }) {
    const group = svgNode(doc, 'g', { class: 'yk-plot', transform: `translate(${margin.left} ${margin.top})` });
    svg.append(group);
    const layout = layoutTreemap(model.groups, plot.width, plot.height);
    const measure = model.series[0] || { kind: 'number', unit: spec.units || '' };
    const marks = [];

    for (const parent of layout) {
      if (hidden.has(parent.key)) continue;
      const style = styleFor(parent.key);
      group.append(svgNode(doc, 'rect', {
        class: 'yk-treemap-group',
        'data-parent-key': parent.key,
        x: parent.rect.x,
        y: parent.rect.y,
        width: Math.max(0, parent.rect.width),
        height: Math.max(0, parent.rect.height),
        fill: 'none',
        stroke: style.colour,
        'stroke-width': 2,
        'pointer-events': 'none'
      }));
      if (parent.rect.width >= 48 && parent.rect.height >= 16) {
        group.append(textNode(doc, parent.label, {
          class: 'yk-cat-label',
          'data-parent-label': parent.key,
          x: parent.rect.x + 4,
          y: parent.rect.y + 12,
          'text-anchor': 'start',
          'pointer-events': 'none'
        }));
      }

      for (const child of parent.children) {
        const rect = child.rect;
        if (!(rect.width > 0 && rect.height > 0)) continue;
        const element = svgNode(doc, 'g', {
          class: 'yk-mark',
          'data-shape': style.shape,
          'data-pattern': style.pattern || ''
        });
        // The shared swatch CSS rotates/clips any [data-shape] node; a treemap
        // cell must keep its plotted rectangle, so opt out locally.
        element.style.transform = 'none';
        element.style.clipPath = 'none';
        element.append(svgNode(doc, 'rect', {
          class: 'yk-mark-shape yk-treemap-cell',
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fill: style.colour,
          stroke: 'var(--yk-chart-surface)',
          'stroke-width': 1
        }));
        const pattern = patternId(style.pattern);
        if (pattern) {
          element.append(svgNode(doc, 'rect', {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            fill: `url(#${pattern})`,
            'fill-opacity': '0.35',
            'pointer-events': 'none'
          }));
        }
        if (rect.width >= TREEMAP_LABEL_MIN.width && rect.height >= TREEMAP_LABEL_MIN.height) {
          element.append(textNode(doc, child.label, {
            class: 'yk-cat-value',
            x: rect.x + 4,
            y: rect.y + 14,
            'text-anchor': 'start',
            'pointer-events': 'none'
          }));
        }
        if (rect.width >= 64 && rect.height >= 34) {
          element.append(textNode(doc, formatValue(child.value, { kind: measure.kind || 'number', unit: measure.unit || spec.units || '' }), {
            class: 'yk-cat-value',
            x: rect.x + 4,
            y: rect.y + 30,
            'text-anchor': 'start',
            'pointer-events': 'none'
          }));
        }
        group.append(element);
        marks.push({
          key: child.key,
          index: child.index,
          x: child.key,
          y: parent.key,
          values: child.values,
          px: rect.x + rect.width / 2,
          py: rect.y + rect.height / 2,
          style,
          label: `${child.label} · ${parent.label}`,
          element
        });
      }
    }

    const identity = value => value;
    return {
      marks,
      xToPx: identity,
      xToData: identity,
      yToPx: identity,
      yToData: identity,
      xScale: { key: 'x', min: 0, max: plot.width, width: plot.width },
      yScale: { key: 'y', min: 0, max: plot.height, height: plot.height }
    };
  }
}

export function defineTreemap(tag = 'yk-treemap') {
  return defineSvgChart(tag, YkTreemap);
}

defineTreemap();
