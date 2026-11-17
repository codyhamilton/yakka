import { DEFAULT_HEIGHT, MIN_TOUCH_PX, SvgChartElement, createShape, defineSvgChart, patternId, svgNode, textNode } from './svg-base.js';
import { formatSample, formatValue } from './formatters.js';

export const RANGE_TYPES = ['box', 'histogram', 'strip', 'dots'];

export const SUMMARY_FIELDS = [
  { key: 'min', label: 'Min' },
  { key: 'q1', label: 'Q1' },
  { key: 'median', label: 'Median' },
  { key: 'q3', label: 'Q3' },
  { key: 'max', label: 'Max' },
  { key: 'p95', label: 'p95' }
];

function numeric(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
}

function labelOf(key) {
  const text = String(key);
  const at = text.indexOf(':');
  return at > 0 ? text.slice(at + 1) : text;
}

export function normaliseRangesType(type) {
  return RANGE_TYPES.includes(type) ? type : 'box';
}

export function percentile(values, fraction) {
  const sorted = (values || []).map(numeric).filter(value => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const p = Math.max(0, Math.min(1, Number(fraction) || 0));
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

export function fiveNumberSummary(values) {
  return {
    min: percentile(values, 0),
    q1: percentile(values, 0.25),
    median: percentile(values, 0.5),
    q3: percentile(values, 0.75),
    max: percentile(values, 1),
    p95: percentile(values, 0.95)
  };
}

export function sampleLabel(sample) {
  if (!sample) return '';
  if (sample.n === null || sample.n === undefined || sample.total === null || sample.total === undefined) return 'sample';
  return formatSample(sample.n, sample.total);
}

export function binLabel(bin, unit = '') {
  if (!bin) return '';
  const range = `${formatValue(bin.from, { kind: 'number' })}–${formatValue(bin.to, { kind: 'number' })}`;
  return unit ? `${range} ${unit}` : range;
}

export function aggregateDots(rows = [], measureKey) {
  const order = [];
  const grouped = new Map();
  for (const row of rows || []) {
    const key = String(row.key);
    if (!grouped.has(key)) {
      grouped.set(key, { key, label: row.label ?? labelOf(key), values: {}, n: undefined });
      order.push(key);
    }
    const target = grouped.get(key);
    if (target.label === undefined) target.label = row.label ?? labelOf(key);
    const value = numeric(row.values?.[measureKey]);
    if (value !== null) target.values[measureKey] = (numeric(target.values[measureKey]) ?? 0) + value;
    else if (target.values[measureKey] === undefined) target.values[measureKey] = null;
    const count = numeric(row.n);
    if (count !== null) target.n = (numeric(target.n) ?? 0) + count;
  }
  return order.map(key => grouped.get(key));
}

function buildBox({ spec, data }) {
  const declared = Array.isArray(spec.series) ? spec.series : [];
  const measure = declared[0] || { key: 'value', label: 'Value', unit: spec.units || '', kind: 'number' };
  const rows = (data || []).map(row => {
    const summary = {};
    for (const field of SUMMARY_FIELDS) summary[field.key] = numeric(row.values?.[field.key]);
    const values = { ...summary };
    if (row.n !== undefined) values.n = row.n;
    if (row.unpriced !== undefined) values.unpriced = row.unpriced;
    return {
      key: String(row.key),
      label: row.label ?? labelOf(row.key),
      values,
      summary,
      n: row.n,
      unpriced: row.unpriced,
      coverage: row.coverage
    };
  });
  if (!rows.length) return { state: 'empty', reason: 'no distributions in the current window', rows: [], series: [], tableRows: [] };
  const unit = measure.unit || spec.units || '';
  const kind = measure.kind || 'number';
  const summaries = SUMMARY_FIELDS.map(field => ({ key: field.key, label: field.label, unit, kind }));
  const hasUnpriced = rows.some(row => row.unpriced !== undefined && row.unpriced !== null);
  const extras = hasUnpriced ? [{ key: 'unpriced', label: 'Unpriced', unit: 'calls', kind: 'count' }] : [];
  const tableSeries = [...summaries, { key: 'n', label: 'n', unit: '', kind: 'count' }, ...extras];
  return {
    state: 'ready',
    type: 'box',
    series: [...summaries, ...extras],
    rows,
    entityKeys: rows.map(row => row.key),
    tableRows: rows.map(row => ({ key: row.key, x: row.label, values: row.values, n: row.n, coverage: row.coverage })),
    tableSeries,
    x: { label: spec.x?.label || 'Entity', kind: 'text' },
    baseline: spec.baseline ? { ...spec.baseline } : null,
    window: null,
    height: DEFAULT_HEIGHT,
    spec: { chart: spec.chart || 'ranges', type: 'box' }
  };
}

function buildHistogram({ spec, data }) {
  const declared = Array.isArray(spec.series) ? spec.series : [];
  const measure = declared[0] || { key: 'count', label: 'Count', unit: spec.units || '', kind: 'count' };
  const measureKey = measure.key;
  const bins = Array.isArray(spec.bins) ? spec.bins : [];
  if (!bins.length) return { state: 'unsupported', reason: 'histogram needs fixed spec.bins', rows: [], series: [], tableRows: [] };
  const rows = bins.map(bin => {
    const match = (data || []).find(row => row.bin && Number(row.bin.from) === Number(bin.from) && Number(row.bin.to) === Number(bin.to));
    const count = numeric(match?.values?.[measureKey]) ?? numeric(match?.values?.count) ?? 0;
    const values = { ...(match?.values || {}), [measureKey]: count, binFrom: bin.from, binTo: bin.to };
    return {
      key: String(match?.key ?? `bin:${bin.from}-${bin.to}`),
      label: match?.label ?? binLabel(bin, measure.unit || spec.units || ''),
      bin: { from: bin.from, to: bin.to },
      values,
      n: count
    };
  });
  return {
    state: 'ready',
    type: 'histogram',
    series: [{ ...measure }],
    rows,
    entityKeys: rows.map(row => row.key),
    tableRows: rows.map(row => ({ key: row.key, x: row.label, values: { [measureKey]: row.values[measureKey] }, n: row.n })),
    tableSeries: [{ ...measure }],
    x: { label: spec.x?.label || 'Bin', kind: 'text' },
    bins: bins.map(bin => ({ ...bin })),
    window: null,
    height: DEFAULT_HEIGHT,
    spec: { chart: spec.chart || 'ranges', type: 'histogram' }
  };
}

function buildStrip({ spec, data }) {
  const declared = Array.isArray(spec.series) ? spec.series : [];
  if (!declared.length) return { state: 'unsupported', reason: 'strip needs a measure series', rows: [], series: [], tableRows: [] };
  const measure = declared[0];
  const rows = (data || []).map(row => ({
    key: String(row.key),
    group: String(row.group ?? row.key),
    label: row.label ?? labelOf(row.key),
    values: { ...(row.values || {}), sampled: row.sampled === true, ...(row.n !== undefined ? { n: row.n } : {}) },
    sampled: row.sampled === true,
    n: row.n
  }));
  if (!rows.length) return { state: 'empty', reason: 'no observations in the current window', rows: [], series: [], tableRows: [] };
  const groups = [...new Set(rows.map(row => row.group))];
  const tableSeries = [{ ...measure }, { key: 'sampled', label: 'Sample', unit: '', kind: 'text' }, { key: 'n', label: 'n', unit: '', kind: 'count' }];
  return {
    state: 'ready',
    type: 'strip',
    series: [{ ...measure }],
    rows,
    groups,
    entityKeys: rows.map(row => row.key),
    tableRows: rows.map(row => ({
      key: row.key,
      x: row.group,
      values: { [measure.key]: row.values[measure.key], sampled: row.sampled ? 'sampled' : 'full', n: row.n },
      n: row.n
    })),
    tableSeries,
    x: { label: spec.x?.label || 'Group', kind: 'text' },
    window: null,
    height: DEFAULT_HEIGHT,
    spec: { chart: spec.chart || 'ranges', type: 'strip' }
  };
}

function buildDots({ spec, data }) {
  const declared = Array.isArray(spec.series) ? spec.series : [];
  if (!declared.length) return { state: 'unsupported', reason: 'dots needs a measure series', rows: [], series: [], tableRows: [] };
  const measure = declared[0];
  const rows = aggregateDots(data, measure.key);
  if (!rows.length) return { state: 'empty', reason: 'no categories in the current window', rows: [], series: [], tableRows: [] };
  return {
    state: 'ready',
    type: 'dots',
    series: [{ ...measure }],
    rows,
    entityKeys: rows.map(row => row.key),
    tableRows: rows.map(row => ({ key: row.key, x: row.label, values: { [measure.key]: row.values[measure.key], n: row.n }, n: row.n })),
    tableSeries: [{ ...measure }, { key: 'n', label: 'n', unit: '', kind: 'count' }],
    x: { label: spec.x?.label || measure.label || 'Value', kind: 'number', unit: measure.unit || '' },
    window: null,
    height: DEFAULT_HEIGHT,
    spec: { chart: spec.chart || 'ranges', type: 'dots' }
  };
}

export function buildRangesModel({ spec = {}, data = [] } = {}) {
  if (spec.type && !RANGE_TYPES.includes(spec.type)) return { state: 'unsupported', reason: `unknown ranges type ${spec.type}`, rows: [], series: [], tableRows: [] };
  const type = normaliseRangesType(spec.type);
  if (type === 'histogram') return buildHistogram({ spec, data });
  if (type === 'strip') return buildStrip({ spec, data });
  if (type === 'dots') return buildDots({ spec, data });
  return buildBox({ spec, data });
}

function bounds(values, extra = []) {
  const finite = [...values, ...extra].map(numeric).filter(value => value !== null);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 1;
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

function ticks(lo, hi, count = 4) {
  return Array.from({ length: count + 1 }, (_, index) => lo + ((hi - lo) * index) / count);
}

export class YkRanges extends SvgChartElement {
  buildModel({ spec, data }) {
    return buildRangesModel({ spec, data });
  }

  chartType(spec) {
    return spec?.chart || 'ranges';
  }

  renderPlot({ svg, doc, model, spec, plot, margin, styleFor, hidden }) {
    const group = svgNode(doc, 'g', { class: 'yk-plot', transform: `translate(${margin.left} ${margin.top})` });
    svg.append(group);
    if (model.type === 'histogram') return this.#histogram({ doc, group, model, plot, styleFor, hidden });
    if (model.type === 'strip') return this.#strip({ doc, group, model, spec, plot, styleFor, hidden });
    if (model.type === 'dots') return this.#dots({ doc, group, model, plot, styleFor, hidden });
    return this.#box({ doc, group, model, plot, styleFor, hidden });
  }

  #box({ doc, group, model, plot, styleFor, hidden }) {
    const rows = model.rows;
    const measure = model.series[0] || { kind: 'number', unit: '' };
    const summaryValues = rows.flatMap(row => SUMMARY_FIELDS.map(field => row.summary[field.key]));
    const { lo, hi } = bounds(summaryValues, model.baseline ? [model.baseline.from, model.baseline.to] : []);
    const yToPx = value => plot.height - ((Number(value) - lo) / (hi - lo)) * plot.height;
    const yToData = px => lo + ((plot.height - px) / plot.height) * (hi - lo);
    const colWidth = plot.width / rows.length;
    const xToPx = index => (index + 0.5) * colWidth;
    const xToData = px => Math.max(0, Math.min(rows.length - 1, Math.floor(px / colWidth)));
    const marks = [];

    for (const tick of ticks(lo, hi)) {
      const y = yToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: y, x2: plot.width, y2: y }));
      group.append(textNode(doc, formatValue(tick, { kind: measure.kind || 'number', unit: measure.unit, compact: true }), {
        class: 'yk-cat-tick', x: -8, y: y + 4, 'text-anchor': 'end'
      }));
    }

    if (model.baseline) {
      const top = yToPx(Math.max(model.baseline.from, model.baseline.to));
      const bottom = yToPx(Math.min(model.baseline.from, model.baseline.to));
      group.append(svgNode(doc, 'rect', {
        class: 'yk-range-baseline', 'data-baseline': 'true', x: 0, y: top, width: plot.width, height: Math.max(1, bottom - top),
        fill: 'var(--yk-chart-grid)', 'fill-opacity': '0.35', 'pointer-events': 'none'
      }));
      group.append(textNode(doc, `baseline: ${model.baseline.label || ''}`, {
        class: 'yk-range-baseline-label', 'data-baseline-label': model.baseline.label || '', x: 6, y: Math.max(12, top - 6), 'text-anchor': 'start',
        'pointer-events': 'none'
      }));
    }

    const boxWidth = Math.min(36, colWidth * 0.55);
    const capWidth = Math.min(18, colWidth * 0.28);
    const p95Labels = [];
    rows.forEach((row, index) => {
      const style = styleFor(row.key);
      const centre = xToPx(index);
      const { min, q1, median, q3, max, p95 } = row.summary;
      const element = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });

      if (!hidden.has('min') && !hidden.has('max') && min !== null && max !== null) {
        element.append(svgNode(doc, 'line', {
          class: 'yk-range-whisker', x1: centre, y1: yToPx(min), x2: centre, y2: yToPx(max), stroke: style.colour, 'stroke-width': 1.5
        }));
        element.append(svgNode(doc, 'line', {
          class: 'yk-range-cap', x1: centre - capWidth, y1: yToPx(min), x2: centre + capWidth, y2: yToPx(min), stroke: style.colour, 'stroke-width': 1.5
        }));
        element.append(svgNode(doc, 'line', {
          class: 'yk-range-cap', x1: centre - capWidth, y1: yToPx(max), x2: centre + capWidth, y2: yToPx(max), stroke: style.colour, 'stroke-width': 1.5
        }));
      }

      if (!hidden.has('q1') && !hidden.has('q3') && q1 !== null && q3 !== null) {
        const top = yToPx(q3);
        const height = Math.max(1, yToPx(q1) - top);
        element.append(svgNode(doc, 'rect', {
          class: 'yk-mark-shape yk-range-box', x: centre - boxWidth / 2, y: top, width: boxWidth, height,
          fill: style.colour, 'fill-opacity': '0.35', stroke: style.colour, 'stroke-width': 1.5
        }));
        const pattern = patternId(style.pattern);
        if (pattern) {
          element.append(svgNode(doc, 'rect', {
            x: centre - boxWidth / 2, y: top, width: boxWidth, height, fill: `url(#${pattern})`, 'pointer-events': 'none'
          }));
        }
      }

      if (!hidden.has('median') && median !== null) {
        element.append(svgNode(doc, 'line', {
          class: 'yk-range-median', x1: centre - boxWidth / 2, y1: yToPx(median), x2: centre + boxWidth / 2, y2: yToPx(median),
          stroke: style.colour, 'stroke-width': 3
        }));
      }

      if (!hidden.has('p95') && p95 !== null) {
        element.append(createShape(doc, style.shape, { x: centre, y: yToPx(p95), size: 12, fill: style.colour }));
        p95Labels.push({ x: centre + boxWidth / 2 + 4, y: yToPx(p95) + 4 });
      }

      element.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: centre - MIN_TOUCH_PX / 2, y: yToPx(median ?? q3 ?? max ?? 0) - MIN_TOUCH_PX / 2,
        width: MIN_TOUCH_PX, height: MIN_TOUCH_PX
      }));
      group.append(element);
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: centre, y: plot.height + 18, 'text-anchor': 'middle' }));
      marks.push({
        key: row.key, index, x: row.key, y: median, values: row.values,
        px: centre, py: yToPx(median ?? q3 ?? 0), style, label: row.label, element
      });
    });
    for (const label of p95Labels) {
      group.append(textNode(doc, 'p95', {
        class: 'yk-range-p95-label', x: label.x, y: label.y, 'text-anchor': 'start', 'pointer-events': 'none'
      }));
    }

    return {
      marks, xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max: rows.length, width: plot.width },
      yScale: { key: 'y', min: lo, max: hi, height: plot.height }
    };
  }

  #histogram({ doc, group, model, plot, styleFor, hidden }) {
    const rows = model.rows;
    const measure = model.series[0] || { key: 'count', kind: 'count', unit: '' };
    const max = Math.max(1, ...rows.map(row => numeric(row.values[measure.key]) ?? 0));
    const yToPx = value => plot.height - ((Math.max(0, Number(value) || 0)) / max) * plot.height;
    const yToData = px => (1 - px / plot.height) * max;
    const colWidth = plot.width / rows.length;
    const xToPx = index => (index + 0.5) * colWidth;
    const xToData = px => Math.max(0, Math.min(rows.length - 1, Math.floor(px / colWidth)));
    const barWidth = Math.min(64, colWidth * 0.72);
    const marks = [];

    for (const tick of ticks(0, max)) {
      const y = yToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: y, x2: plot.width, y2: y }));
      group.append(textNode(doc, formatValue(tick, { kind: 'count', compact: true }), {
        class: 'yk-cat-tick', x: -8, y: y + 4, 'text-anchor': 'end'
      }));
    }

    rows.forEach((row, index) => {
      const count = numeric(row.values[measure.key]) ?? 0;
      const style = styleFor(row.key);
      const element = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      const top = yToPx(count);
      const height = Math.max(0, plot.height - top);
      element.append(svgNode(doc, 'rect', {
        class: 'yk-mark-shape yk-range-bar', x: xToPx(index) - barWidth / 2, y: top, width: barWidth, height,
        fill: style.colour, 'fill-opacity': '0.75'
      }));
      const pattern = patternId(style.pattern);
      if (pattern && height > 0) {
        element.append(svgNode(doc, 'rect', {
          x: xToPx(index) - barWidth / 2, y: top, width: barWidth, height, fill: `url(#${pattern})`, 'pointer-events': 'none'
        }));
      }
      element.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: xToPx(index) - Math.max(barWidth, MIN_TOUCH_PX) / 2, y: 0,
        width: Math.max(barWidth, MIN_TOUCH_PX), height: plot.height
      }));
      group.append(element);
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: xToPx(index), y: plot.height + 18, 'text-anchor': 'middle' }));
      group.append(textNode(doc, formatValue(count, { kind: 'count' }), {
        class: 'yk-cat-value', x: xToPx(index), y: Math.max(12, top - 6), 'text-anchor': 'middle'
      }));
      marks.push({
        key: row.key, index, x: row.label, y: count, values: row.values,
        px: xToPx(index), py: top, style, label: row.label, element
      });
    });

    return {
      marks, xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max: rows.length, width: plot.width },
      yScale: { key: 'y', min: 0, max, height: plot.height }
    };
  }

  #strip({ doc, group, model, spec, plot, styleFor, hidden }) {
    const rows = model.rows;
    const measure = model.series[0] || { kind: 'number', unit: '' };
    const groups = model.groups;
    const { lo, hi } = bounds(rows.map(row => row.values[measure.key]));
    const yToPx = value => plot.height - ((Number(value) - lo) / (hi - lo)) * plot.height;
    const yToData = px => lo + ((plot.height - px) / plot.height) * (hi - lo);
    const colWidth = plot.width / Math.max(1, groups.length);
    const xToPx = index => (index + 0.5) * colWidth;
    const xToData = px => Math.max(0, Math.min(groups.length - 1, Math.floor(px / colWidth)));
    const indexOf = new Map(groups.map((name, index) => [name, index]));
    const counters = groups.map(() => 0);
    const marks = [];

    for (const tick of ticks(lo, hi)) {
      const y = yToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: y, x2: plot.width, y2: y }));
      group.append(textNode(doc, formatValue(tick, { kind: measure.kind || 'number', unit: measure.unit, compact: true }), {
        class: 'yk-cat-tick', x: -8, y: y + 4, 'text-anchor': 'end'
      }));
    }
    groups.forEach((name, index) => {
      group.append(textNode(doc, labelOf(name), { class: 'yk-cat-label', x: xToPx(index), y: plot.height + 18, 'text-anchor': 'middle' }));
    });

    rows.forEach((row, index) => {
      const groupIndex = indexOf.get(row.group) ?? 0;
      const within = counters[groupIndex];
      counters[groupIndex] += 1;
      const lane = (within % 5) - 2;
      const offset = lane * Math.min(10, colWidth * 0.08);
      const px = xToPx(groupIndex) + offset;
      const value = numeric(row.values[measure.key]);
      if (hidden.has(measure.key) || value === null) return;
      const py = yToPx(value);
      const style = styleFor(row.key);
      const label = row.sampled ? `${row.label || labelOf(row.key)} — ${sampleLabel(spec.sample) || 'sample'}` : (row.label || labelOf(row.key));
      const element = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      element.append(createShape(doc, style.shape, { x: px, y: py, size: row.sampled ? 9 : 11, fill: style.colour }));
      if (row.sampled) {
        element.append(svgNode(doc, 'circle', { cx: px, cy: py, r: 8, fill: 'none', stroke: style.colour, 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      }
      element.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: px - MIN_TOUCH_PX / 2, y: py - MIN_TOUCH_PX / 2,
        width: MIN_TOUCH_PX, height: MIN_TOUCH_PX
      }));
      group.append(element);
      marks.push({
        key: row.key, index, x: row.group, y: value, values: row.values,
        px, py, style, label, element
      });
    });

    return {
      marks, xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max: groups.length, width: plot.width },
      yScale: { key: 'y', min: lo, max: hi, height: plot.height }
    };
  }

  #dots({ doc, group, model, plot, styleFor, hidden }) {
    const rows = model.rows;
    const measure = model.series[0] || { key: 'value', kind: 'number', unit: '' };
    const max = Math.max(1, ...rows.map(row => numeric(row.values[measure.key]) ?? 0));
    const xToPx = value => (Math.max(0, Number(value) || 0) / max) * plot.width;
    const xToData = px => (px / plot.width) * max;
    const rowHeight = plot.height / rows.length;
    const yToPx = index => (index + 0.5) * rowHeight;
    const yToData = px => Math.max(0, Math.min(rows.length - 1, Math.floor(px / rowHeight)));
    const marks = [];

    for (const tick of ticks(0, max)) {
      const x = xToPx(tick);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: x, y1: 0, x2: x, y2: plot.height }));
      group.append(textNode(doc, formatValue(tick, { kind: measure.kind || 'number', unit: measure.unit, compact: true }), {
        class: 'yk-cat-tick', x, y: plot.height + 18, 'text-anchor': 'middle'
      }));
    }

    rows.forEach((row, index) => {
      const value = numeric(row.values[measure.key]);
      if (hidden.has(measure.key) || value === null) return;
      const style = styleFor(row.key);
      const px = xToPx(value);
      const py = yToPx(index);
      const element = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      element.append(createShape(doc, style.shape, { x: px, y: py, size: 12, fill: style.colour }));
      element.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: px - MIN_TOUCH_PX / 2, y: py - MIN_TOUCH_PX / 2,
        width: MIN_TOUCH_PX, height: MIN_TOUCH_PX
      }));
      group.append(element);
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: -8, y: py + 4, 'text-anchor': 'end' }));
      group.append(textNode(doc, formatValue(value, { kind: measure.kind || 'number', unit: measure.unit }), {
        class: 'yk-cat-value', x: px + 8, y: py + 4, 'text-anchor': 'start'
      }));
      marks.push({
        key: row.key, index, x: row.key, y: value, values: row.values,
        px, py, style, label: row.label, element
      });
    });

    return {
      marks, xToPx, xToData, yToPx, yToData,
      xScale: { key: 'x', min: 0, max, width: plot.width },
      yScale: { key: 'y', min: 0, max: rows.length, height: plot.height }
    };
  }
}

export function defineRanges(tag = 'yk-ranges') {
  return defineSvgChart(tag, YkRanges);
}

defineRanges();
