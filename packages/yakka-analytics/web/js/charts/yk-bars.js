// <yk-bars> — ranked, stacked, 100 percent, lollipop and slope bars on the
// shared Phase 8 SVG foundation. Data rows are categories, each with a values
// map keyed by series. Every mark carries its entity key through the registry.

import { DEFAULT_HEIGHT, MIN_TOUCH_PX, SvgChartElement, createShape, defineSvgChart, patternId, svgNode, textNode } from './svg-base.js';
import { formatValue } from './formatters.js';

export const BAR_TYPES = ['ranked', 'stacked', 'percent', 'lollipop', 'slope'];

function numeric(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
}

function labelOf(key) {
  const text = String(key);
  const at = text.indexOf(':');
  return at > 0 ? text.slice(at + 1) : text;
}

export function normaliseBarsType(type) {
  return BAR_TYPES.includes(type) ? type : 'ranked';
}

export function sortRanked(rows, seriesKey) {
  return [...rows].sort((a, b) => {
    const av = numeric(a.values?.[seriesKey]);
    const bv = numeric(b.values?.[seriesKey]);
    if (av === null && bv === null) return String(a.key).localeCompare(String(b.key));
    if (av === null) return 1;
    if (bv === null) return -1;
    if (bv !== av) return bv - av;
    return String(a.key).localeCompare(String(b.key));
  });
}

export function applyOther(sorted, top = sorted.length, seriesKeys = [], existing = null) {
  const limit = Math.max(0, Number(top));
  if (limit >= sorted.length) return { rows: [...sorted], other: null };
  const kept = sorted.slice(0, limit);
  const tail = sorted.slice(limit);
  const values = { ...(existing?.values || {}) };
  let n = numeric(existing?.n) ?? 0;
  for (const key of seriesKeys) {
    let sum = numeric(existing?.values?.[key]) ?? 0;
    for (const row of tail) {
      const value = numeric(row.values?.[key]);
      if (value !== null) sum += value;
    }
    values[key] = sum;
  }
  for (const row of tail) {
    const count = numeric(row.n);
    if (count !== null) n += count;
  }
  const other = {
    key: '(other)',
    label: '(other)',
    values,
    n: n || undefined,
    generated: true
  };
  return { rows: [...kept, other], other };
}

export function stackSegments(rows, series) {
  return rows.map(row => {
    const segments = [];
    let total = 0;
    for (const item of series) {
      const value = numeric(row.values?.[item.key]);
      if (value === null) continue;
      const from = total;
      total += value;
      segments.push({ key: item.key, from, to: total, value });
    }
    return { key: row.key, total, segments };
  });
}

export function percentRows(rows, series) {
  return rows.map(row => {
    let total = 0;
    for (const item of series) {
      const value = numeric(row.values?.[item.key]);
      if (value !== null) total += value;
    }
    const values = {};
    for (const item of series) {
      const value = numeric(row.values?.[item.key]);
      values[item.key] = value === null ? null : total > 0 ? value / total : 0;
    }
    return { ...row, values, total };
  });
}

export function lollipopModel(rows, seriesKey) {
  return rows.map(row => ({ ...row, base: 0, tip: numeric(row.values?.[seriesKey]) }));
}

export function slopePairs(rows, series) {
  if (!Array.isArray(series) || series.length !== 2) return [];
  const [startSeries, endSeries] = series;
  return rows
    .map(row => {
      const start = numeric(row.values?.[startSeries.key]);
      const end = numeric(row.values?.[endSeries.key]);
      return {
        ...row,
        start,
        end,
        change: start === null || end === null ? null : end - start
      };
    })
    .sort((a, b) => {
      if (a.change === null && b.change === null) return String(a.key).localeCompare(String(b.key));
      if (a.change === null) return 1;
      if (b.change === null) return -1;
      if (b.change !== a.change) return b.change - a.change;
      return String(a.key).localeCompare(String(b.key));
    });
}

export function buildBarsModel({ spec = {}, data = [] } = {}) {
  const type = normaliseBarsType(spec.type);
  const declared = (spec.series || []).map(item => ({ ...item }));
  if (!declared.length) return { state: 'unsupported', reason: 'bars needs a series spec', rows: [], series: [], tableRows: [] };
  const rows = data.map(row => ({
    key: String(row.key),
    label: row.label ?? labelOf(row.key),
    values: { ...(row.values || {}) },
    n: row.n,
    coverage: row.coverage
  }));
  if (!rows.length) return { state: 'empty', reason: 'no categories in the current window', rows: [], series: [], tableRows: [] };

  let series = declared;
  let modelRows = rows;
  let sorted = false;

  if (type === 'ranked' || type === 'lollipop') {
    series = declared.slice(0, 1);
    if (type === 'ranked') {
      const existing = rows.find(row => row.key === '(other)') || null;
      const input = existing ? rows.filter(row => row !== existing) : rows;
      const ranked = sortRanked(input, series[0].key);
      const result = applyOther(ranked, spec.top ?? ranked.length, [series[0].key], existing);
      modelRows = result.rows;
      sorted = true;
    } else {
      modelRows = lollipopModel(rows, series[0].key);
    }
  } else if (type === 'percent') {
    modelRows = percentRows(rows, series);
    series = series.map(item => ({ ...item, kind: 'percent' }));
  } else if (type === 'slope') {
    if (series.length !== 2) {
      return { state: 'unsupported', reason: 'slope needs exactly two series (start and end)', rows: [], series, tableRows: [] };
    }
    modelRows = slopePairs(rows, series);
  }

  modelRows = modelRows.map(row => ({ ...row, label: row.label ?? labelOf(row.key) }));
  const height = type === 'ranked' || type === 'lollipop'
    ? Math.max(DEFAULT_HEIGHT, modelRows.length * 44 + 56)
    : DEFAULT_HEIGHT;
  const x = { label: spec.x?.label || 'Entity', kind: 'text' };
  return {
    state: 'ready',
    type,
    series,
    rows: modelRows,
    entityKeys: modelRows.map(row => row.key),
    tableRows: modelRows.map(row => ({ key: row.key, x: row.label, values: row.values, n: row.n, coverage: row.coverage })),
    tableSeries: series,
    x,
    window: null,
    height,
    sorted,
    spec: { chart: spec.chart || 'bars', type }
  };
}

function tickValues(max, count = 4) {
  return Array.from({ length: count + 1 }, (_, index) => (max / count) * index);
}

export class YkBars extends SvgChartElement {
  buildModel({ spec, data }) {
    return buildBarsModel({ spec, data });
  }

  chartType(spec) {
    return spec?.chart || 'bars';
  }

  renderPlot({ svg, doc, model, spec, plot, margin, styleFor, hidden }) {
    const group = svgNode(doc, 'g', { class: 'yk-plot', transform: `translate(${margin.left} ${margin.top})` });
    svg.append(group);
    if (model.type === 'ranked' || model.type === 'lollipop') {
      return this.#horizontal({ doc, group, model, spec, plot, styleFor, hidden });
    }
    if (model.type === 'stacked' || model.type === 'percent') {
      return this.#columns({ doc, group, model, spec, plot, styleFor, hidden });
    }
    return this.#slope({ doc, group, model, spec, plot, styleFor, hidden });
  }

  #horizontal({ doc, group, model, spec, plot, styleFor, hidden }) {
    const rows = model.rows;
    const series = model.series[0];
    const values = rows.map(row => numeric(row.values?.[series.key]));
    const max = Math.max(1, ...values.map(value => (value === null ? 0 : Math.abs(value))));
    const rowHeight = plot.height / rows.length;
    const center = index => (index + 0.5) * rowHeight;
    const xToPx = value => (Math.max(0, Number(value) || 0) / max) * plot.width;
    const xToData = px => (px / plot.width) * max;
    const yToPx = index => center(index);
    const yToData = px => Math.max(0, Math.min(rows.length - 1, Math.floor(px / rowHeight)));
    const marks = [];

    for (const tick of tickValues(max)) {
      const x = xToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: x, y1: 0, x2: x, y2: plot.height }));
      group.append(textNode(doc, formatValue(tick, { kind: series.kind || 'number', compact: true, unit: series.unit }), {
        class: 'yk-cat-tick', x, y: plot.height + 18, 'text-anchor': 'middle'
      }));
    }

    rows.forEach((row, index) => {
      const value = values[index];
      const length = value === null ? 0 : Math.max(0, xToPx(value));
      const barHeight = Math.min(28, rowHeight * 0.6);
      const style = styleFor(row.key);
      const groupMark = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      groupMark.append(svgNode(doc, 'rect', {
        class: 'yk-mark-shape', x: 0, y: center(index) - barHeight / 2, width: length, height: barHeight, fill: style.colour, rx: 2
      }));
      const pattern = patternId(style.pattern);
      if (pattern && length > 0) {
        groupMark.append(svgNode(doc, 'rect', {
          x: 0, y: center(index) - barHeight / 2, width: length, height: barHeight, fill: `url(#${pattern})`, 'pointer-events': 'none'
        }));
      }
      if (model.type === 'lollipop') {
        groupMark.append(svgNode(doc, 'line', { x1: 0, y1: center(index), x2: length, y2: center(index), stroke: style.colour, 'stroke-width': 2 }));
        groupMark.append(createShape(doc, style.shape, { x: length, y: center(index), size: 12, fill: style.colour }));
      }
      groupMark.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: 0, y: center(index) - Math.max(barHeight, MIN_TOUCH_PX) / 2,
        width: Math.max(length, MIN_TOUCH_PX), height: Math.max(barHeight, MIN_TOUCH_PX)
      }));
      group.append(groupMark);
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: -8, y: center(index) + 4, 'text-anchor': 'end' }));
      group.append(textNode(doc, value === null ? formatValue(null) : formatValue(value, { kind: series.kind || 'number', unit: series.unit }), {
        class: 'yk-cat-value', x: length + 6, y: center(index) + 4, 'text-anchor': 'start'
      }));
      marks.push({
        key: row.key, index, x: row.key, y: value, values: row.values,
        px: length, py: center(index), style, label: row.label, element: groupMark
      });
    });

    return {
      marks,
      xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max, width: plot.width },
      yScale: { key: 'y', min: 0, max: rows.length, height: plot.height }
    };
  }

  #columns({ doc, group, model, spec, plot, styleFor, hidden }) {
    const rows = model.rows;
    const visible = model.series.filter(item => !hidden.has(item.key));
    const totals = rows.map(row => visible.reduce((sum, item) => sum + (numeric(row.values?.[item.key]) ?? 0), 0));
    const max = model.type === 'percent' ? 1 : Math.max(1, ...totals);
    const categoryWidth = plot.width / rows.length;
    const xToPx = index => (index + 0.5) * categoryWidth;
    const xToData = px => Math.max(0, Math.min(rows.length - 1, Math.floor(px / categoryWidth)));
    const yToPx = value => plot.height - ((Number(value) || 0) / max) * plot.height;
    const yToData = px => (1 - px / plot.height) * max;
    const barWidth = Math.min(48, categoryWidth * 0.7);
    const marks = [];

    for (const tick of tickValues(max)) {
      const y = yToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: y, x2: plot.width, y2: y }));
      group.append(textNode(doc, formatValue(tick, { kind: model.type === 'percent' ? 'percent' : (visible[0]?.kind || 'number'), compact: true }), {
        class: 'yk-cat-tick', x: -8, y: y + 4, 'text-anchor': 'end'
      }));
    }

    const stacked = stackSegments(rows, model.series);
    rows.forEach((row, index) => {
      const style = styleFor(row.key);
      const groupMark = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      let acc = 0;
      for (const segment of stacked[index].segments) {
        if (hidden.has(segment.key)) continue;
        const seriesStyle = styleFor(segment.key);
        const top = yToPx(acc + segment.value);
        const height = Math.max(0, yToPx(acc) - top);
        groupMark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-shape', x: xToPx(index) - barWidth / 2, y: top, width: barWidth, height, fill: seriesStyle.colour
        }));
        const pattern = patternId(seriesStyle.pattern);
        if (pattern && height > 0) {
          groupMark.append(svgNode(doc, 'rect', {
            x: xToPx(index) - barWidth / 2, y: top, width: barWidth, height, fill: `url(#${pattern})`, 'pointer-events': 'none'
          }));
        }
        acc += segment.value;
      }
      groupMark.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: xToPx(index) - Math.max(barWidth, MIN_TOUCH_PX) / 2, y: 0,
        width: Math.max(barWidth, MIN_TOUCH_PX), height: plot.height
      }));
      group.append(groupMark);
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: xToPx(index), y: plot.height + 18, 'text-anchor': 'middle' }));
      marks.push({
        key: row.key, index, x: row.key, y: totals[index], values: row.values,
        px: xToPx(index), py: yToPx(totals[index]), style, label: row.label, element: groupMark
      });
    });

    return {
      marks,
      xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max: rows.length - 1, width: plot.width },
      yScale: { key: 'y', min: 0, max, height: plot.height }
    };
  }

  #slope({ doc, group, model, spec, plot, styleFor, hidden }) {
    const rows = model.rows;
    const [startSeries, endSeries] = model.series;
    const finite = rows.flatMap(row => [numeric(row.start), numeric(row.end)]).filter(value => value !== null);
    const max = Math.max(1, ...finite.map(value => Math.abs(value)));
    const inset = 24;
    const xToPx = index => (index === 0 ? inset : plot.width - inset);
    const xToData = px => (px < plot.width / 2 ? 0 : 1);
    const yToPx = value => plot.height - ((Number(value) || 0) / max) * plot.height;
    const yToData = px => (1 - px / plot.height) * max;
    const marks = [];

    for (const tick of tickValues(max)) {
      const y = yToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: y, x2: plot.width, y2: y }));
      group.append(textNode(doc, formatValue(tick, { kind: startSeries.kind || 'number', compact: true, unit: startSeries.unit }), {
        class: 'yk-cat-tick', x: -8, y: y + 4, 'text-anchor': 'end'
      }));
    }
    group.append(textNode(doc, startSeries.label, { class: 'yk-cat-label', x: inset, y: plot.height + 18, 'text-anchor': 'middle' }));
    group.append(textNode(doc, endSeries.label, { class: 'yk-cat-label', x: plot.width - inset, y: plot.height + 18, 'text-anchor': 'middle' }));

    rows.forEach((row, index) => {
      const style = styleFor(row.key);
      const start = numeric(row.start);
      const end = numeric(row.end);
      if (start === null && end === null) return;
      if (start !== null && end !== null && !hidden.has(startSeries.key) && !hidden.has(endSeries.key)) {
        group.append(svgNode(doc, 'line', {
          class: 'yk-slope-line', x1: xToPx(0), y1: yToPx(start), x2: xToPx(1), y2: yToPx(end),
          stroke: style.colour, 'stroke-width': 2
        }));
      }
      const endpoints = [
        { key: startSeries.key, value: start, x: 0 },
        { key: endSeries.key, value: end, x: 1 }
      ];
      for (const endpoint of endpoints) {
        if (endpoint.value === null || hidden.has(endpoint.key)) continue;
        const px = xToPx(endpoint.x);
        const py = yToPx(endpoint.value);
        const groupMark = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
        groupMark.append(createShape(doc, style.shape, { x: px, y: py, size: 12, fill: style.colour }));
        groupMark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-hit', 'data-hit': 'true', x: px - MIN_TOUCH_PX / 2, y: py - MIN_TOUCH_PX / 2,
          width: MIN_TOUCH_PX, height: MIN_TOUCH_PX
        }));
        group.append(groupMark);
        marks.push({
          key: row.key, index, x: endpoint.x, y: endpoint.value, values: row.values,
          px, py, style, label: row.label, element: groupMark
        });
      }
      if (end !== null && !hidden.has(endSeries.key)) {
        group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: xToPx(1) + 10, y: yToPx(end) + 4, 'text-anchor': 'start' }));
      }
    });

    return {
      marks,
      xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max: 1, width: plot.width },
      yScale: { key: 'y', min: 0, max, height: plot.height }
    };
  }
}

export function defineBars(tag = 'yk-bars') {
  return defineSvgChart(tag, YkBars);
}

defineBars();
