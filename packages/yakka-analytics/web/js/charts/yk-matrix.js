// <yk-matrix> — a categorical heatmap and a day-by-week calendar on the shared
// Phase 8 SVG foundation. The heatmap has no continuous axis and reports
// `brush: null`; the calendar brushes its day time axis through the base
// element's brush wiring. Cell fill comes from a named ramp, never from an
// entity slot, so a value change cannot repaint an entity's categorical style.

import { DEFAULT_HEIGHT, MIN_TOUCH_PX, SvgChartElement, defineSvgChart, patternId, svgNode, textNode } from './svg-base.js';
import { formatValue } from './formatters.js';
import { readToken } from './styles.js';

export const DAY = 24 * 60 * 60 * 1000;
export const WEEK = 7 * DAY;
export const RAMP_STEPS = 5;
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const RAMP_TOKENS = {
  sequential: ['--yk-seq-1', '--yk-seq-2', '--yk-seq-3', '--yk-seq-4', '--yk-seq-5'],
  diverging: ['--yk-div-neg-2', '--yk-div-neg-1', '--yk-div-zero', '--yk-div-pos-1', '--yk-div-pos-2']
};

function numeric(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
}

function isoDay(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function dayStart(time) {
  const date = new Date(Number(time));
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function weekdayIndex(time) {
  return (new Date(Number(time)).getUTCDay() + 6) % 7;
}

export function weekStart(time) {
  return dayStart(time) - weekdayIndex(time) * DAY;
}

export function rampStops(ramp = 'sequential') {
  return RAMP_TOKENS[ramp === 'diverging' ? 'diverging' : 'sequential'];
}

export function rampStopValues({ min = 0, max = 0 } = {}, steps = RAMP_STEPS) {
  if (!(steps > 1)) return [Number(min) || 0];
  const low = Number.isFinite(Number(min)) ? Number(min) : 0;
  const high = Number.isFinite(Number(max)) ? Number(max) : 0;
  return Array.from({ length: steps }, (_, index) => low + ((high - low) / (steps - 1)) * index);
}

export function rampIndex(value, { min = 0, max = 0 } = {}, steps = RAMP_STEPS) {
  const number = numeric(value);
  if (number === null) return null;
  if (!(steps > 1)) return 0;
  const low = Number(min) || 0;
  const high = Number(max) || 0;
  if (high === low) return low === 0 ? 0 : Math.floor((steps - 1) / 2);
  const ratio = Math.max(0, Math.min(1, (number - low) / (high - low)));
  return Math.round(ratio * (steps - 1));
}

export function valueRange(cells = [], ramp = 'sequential') {
  const values = cells.map(cell => numeric(cell.value)).filter(value => value !== null);
  if (!values.length) return { min: 0, max: 0 };
  if (ramp === 'diverging') {
    const bound = Math.max(...values.map(value => Math.abs(value)));
    return { min: -bound, max: bound };
  }
  return { min: 0, max: Math.max(0, ...values) };
}

export function snapBrush(a, b) {
  const first = numeric(a);
  const second = numeric(b);
  if (first === null || second === null) return null;
  const from = dayStart(Math.min(first, second));
  const to = dayStart(Math.max(first, second)) + DAY;
  return { from, to };
}

export function moveBrushEdge(brush, edge, direction, { min = -Infinity, max = Infinity } = {}) {
  if (!brush || !Number.isFinite(Number(brush.from)) || !Number.isFinite(Number(brush.to))) return null;
  const delta = (Number(direction) || 0) * DAY;
  let from = Number(brush.from);
  let to = Number(brush.to);
  if (edge === 'from') from = Math.max(min, Math.min(to - DAY, from + delta));
  else to = Math.min(max, Math.max(from + DAY, to + delta));
  return { from, to };
}

export function calendarLayout(rows = []) {
  const cells = rows
    .filter(row => numeric(row.x) !== null)
    .map(row => {
      const time = dayStart(row.x);
      const start = weekStart(time);
      return {
        key: String(row.key),
        time,
        weekStart: start,
        weekday: weekdayIndex(time),
        data: row
      };
    })
    .sort((a, b) => a.time - b.time || a.key.localeCompare(b.key));
  const weeks = [...new Set(cells.map(cell => cell.weekStart))].sort((a, b) => a - b);
  const index = new Map(weeks.map((start, position) => [start, position]));
  return cells.map(cell => ({ ...cell, weekIndex: index.get(cell.weekStart) }));
}

export function buildMatrixModel({ spec = {}, data = [] } = {}) {
  const type = spec.type === 'calendar' ? 'calendar' : 'heatmap';
  const series = (spec.series || []).map(item => ({ ...item }));
  if (!series.length) return { state: 'unsupported', reason: 'matrix needs a series spec', rows: [], series: [], tableRows: [] };
  const measure = series[0];
  const ramp = spec.ramp === 'diverging' ? 'diverging' : 'sequential';
  const cells = data.map((row, index) => ({
    key: String(row.key),
    row: row.row === undefined || row.row === null ? '' : String(row.row),
    column: row.column === undefined || row.column === null ? '' : String(row.column),
    x: numeric(row.x),
    value: numeric(row.values?.[measure.key]),
    values: { ...(row.values || {}) },
    n: row.n,
    coverage: row.coverage,
    source: index
  }));
  if (!cells.length) return { state: 'empty', reason: 'no cells in the current window', rows: [], series, tableRows: [] };

  const range = valueRange(cells, ramp);
  if (type === 'calendar') {
    const laid = calendarLayout(cells.map(cell => ({ ...cell, x: cell.x })));
    if (!laid.length) return { state: 'unsupported', reason: 'calendar cells need an x date', rows: [], series, tableRows: [] };
    const weeks = [...new Set(laid.map(cell => cell.weekStart))].sort((a, b) => a - b);
    const rowLabel = new Map(weeks.map(start => [start, isoDay(start)]));
    const rows = laid.map(cell => {
      const column = WEEKDAY_LABELS[cell.weekday] || String(cell.weekday);
      return {
        key: cell.key,
        label: `${isoDay(cell.time)} · ${column}`,
        values: { [measure.key]: cell.data.value },
        n: cell.data.n,
        coverage: cell.data.coverage,
        x: cell.time,
        rowIndex: cell.weekIndex,
        columnIndex: cell.weekday,
        rowKey: rowLabel.get(cell.weekStart),
        columnKey: column,
        value: cell.data.value
      };
    });
    return {
      state: 'ready',
      type,
      series,
      rows,
      entityKeys: rows.map(row => row.key),
      tableRows: rows.map(row => ({ key: row.key, x: row.rowKey, values: { column: row.columnKey, value: row.value }, n: row.n, coverage: row.coverage })),
      tableSeries: [
        { key: 'column', label: 'Column', kind: 'text' },
        { key: 'value', label: measure.label || measure.key, unit: measure.unit || '', kind: measure.kind || 'number' }
      ],
      x: { label: 'Week', kind: 'text' },
      window: { from: weeks[0], to: weeks[weeks.length - 1] + WEEK },
      weeks,
      range,
      ramp,
      height: DEFAULT_HEIGHT,
      spec: { chart: 'matrix', type, ramp }
    };
  }

  const declaredRows = (spec.rows || []).map(item => ({ key: String(item.key), label: item.label ?? String(item.key) }));
  const declaredColumns = (spec.columns || []).map(item => ({ key: String(item.key), label: item.label ?? String(item.key) }));
  const rowKeys = declaredRows.length ? declaredRows.map(item => item.key) : [...new Set(cells.map(cell => cell.row))];
  const columnKeys = declaredColumns.length ? declaredColumns.map(item => item.key) : [...new Set(cells.map(cell => cell.column))];
  const rowLabels = new Map(declaredRows.map(item => [item.key, item.label]));
  const columnLabels = new Map(declaredColumns.map(item => [item.key, item.label]));
  const rowIndex = new Map(rowKeys.map((key, index) => [key, index]));
  const columnIndex = new Map(columnKeys.map((key, index) => [key, index]));
  const rows = cells
    .filter(cell => rowIndex.has(cell.row) && columnIndex.has(cell.column))
    .sort((a, b) => rowIndex.get(a.row) - rowIndex.get(b.row) || columnIndex.get(a.column) - columnIndex.get(b.column))
    .map(cell => {
      const rowLabel = rowLabels.get(cell.row) ?? cell.row;
      const columnLabel = columnLabels.get(cell.column) ?? cell.column;
      return {
        key: cell.key,
        label: `${rowLabel} · ${columnLabel}`,
        values: { [measure.key]: cell.value },
        n: cell.n,
        coverage: cell.coverage,
        rowIndex: rowIndex.get(cell.row),
        columnIndex: columnIndex.get(cell.column),
        rowKey: rowLabel,
        columnKey: columnLabel,
        value: cell.value
      };
    });
  if (!rows.length) return { state: 'empty', reason: 'no cells match the declared rows and columns', rows: [], series, tableRows: [] };
  return {
    state: 'ready',
    type,
    series,
    rows,
    entityKeys: rows.map(row => row.key),
    tableRows: rows.map(row => ({ key: row.key, x: row.rowKey, values: { column: row.columnKey, value: row.value }, n: row.n, coverage: row.coverage })),
    tableSeries: [
      { key: 'column', label: 'Column', kind: 'text' },
      { key: 'value', label: measure.label || measure.key, unit: measure.unit || '', kind: measure.kind || 'number' }
    ],
    x: { label: 'Row', kind: 'text' },
    window: null,
    rowKeys: declaredRows.length ? declaredRows : rowKeys.map(key => ({ key, label: rowLabels.get(key) ?? key })),
    columnKeys: declaredColumns.length ? declaredColumns : columnKeys.map(key => ({ key, label: columnLabels.get(key) ?? key })),
    range,
    ramp,
    height: DEFAULT_HEIGHT,
    spec: { chart: 'matrix', type, ramp }
  };
}

function rampColours(host, ramp) {
  return rampStops(ramp).map(token => readToken(host, token) || '');
}

export class YkMatrix extends SvgChartElement {
  #brush = null;
  #overlay = null;
  #geometryForOverlay = null;
  _matrixSpec = null;
  _matrixModel = null;

  constructor() {
    super();
    this.addEventListener('keydown', event => this.#onMatrixKey(event), true);
    this.addEventListener('brush', event => {
      const detail = event.detail;
      this.#brush = detail && Number.isFinite(detail.from) ? { from: detail.from, to: detail.to } : null;
      this.#drawOverlay();
    });
  }

  buildModel({ spec, data }) {
    return buildMatrixModel({ spec, data });
  }

  chartType(spec) {
    return spec?.chart || 'matrix';
  }

  supportsBrush() {
    return (this.spec || this._matrixSpec)?.type === 'calendar';
  }

  #onMatrixKey(event) {
    const path = event.composedPath?.() || [];
    const row = path.find(node => node?.matches?.('.yk-table tbody tr'));
    if (row) {
      const rowKeys = [...this.shadowRoot.querySelectorAll('.yk-table tbody tr')];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const next = rowKeys[rowKeys.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === ' ' || event.key === 'Spacebar') {
        const box = row.querySelector('input.yk-table-select');
        if (box) {
          box.checked = !box.checked;
          box.dispatchEvent(new Event('change', { bubbles: true }));
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
    if (!this.supportsBrush()) return;
    if (event.key !== '[' && event.key !== ']') return;
    const range = this._matrixModel?.window || null;
    let next;
    if (!this.#brush) {
      const anchor = this._matrixModel?.rows?.[0]?.x ?? range?.from ?? 0;
      const snapped = snapBrush(anchor, anchor);
      next = event.key === '[' ? snapBrush(anchor - DAY, anchor) : snapped;
    } else {
      next = moveBrushEdge(this.#brush, event.key === '[' ? 'from' : 'to', event.key === '[' ? -1 : 1, range || {});
    }
    if (!next) return;
    this.#brush = next;
    this.setBrush({ from: next.from, to: next.to, aligned: true });
    this.#drawOverlay();
    event.preventDefault();
    event.stopPropagation();
  }

  #drawOverlay() {
    const overlay = this.#overlay;
    const geometry = this.#geometryForOverlay?.();
    if (!overlay || !geometry) return;
    if (!this.#brush) {
      overlay.setAttribute('hidden', '');
      overlay.setAttribute('width', '0');
      return;
    }
    const left = Math.max(0, Math.min(geometry.plot.width, geometry.xToPx(this.#brush.from)));
    const right = Math.max(0, Math.min(geometry.plot.width, geometry.xToPx(this.#brush.to)));
    overlay.removeAttribute('hidden');
    overlay.setAttribute('x', String(Math.min(left, right)));
    overlay.setAttribute('width', String(Math.max(1, Math.abs(right - left))));
    overlay.setAttribute('height', String(geometry.plot.height));
    overlay.setAttribute('fill', readToken(this, '--yk-chart-focus') || 'currentColor');
    overlay.setAttribute('fill-opacity', '0.18');
  }

  renderPlot({ svg, doc, model, spec, plot, margin, styleFor }) {
    this._matrixSpec = spec;
    this._matrixModel = model;
    this.#overlay = null;
    this.#geometryForOverlay = null;
    const colours = rampColours(this, model.ramp);
    const stops = rampStopValues(model.range);
    const missing = readToken(this, '--yk-chart-surface') || 'none';
    const fillFor = value => {
      const index = rampIndex(value, model.range);
      return index === null ? missing : (colours[index] || missing);
    };
    const markStyle = key => styleFor(key);
    const group = svgNode(doc, 'g', { class: 'yk-plot', transform: `translate(${margin.left} ${margin.top})` });
    svg.append(group);
    const marks = [];

    if (model.type === 'calendar') {
      const weeks = model.weeks || [];
      const columnWidth = plot.width / Math.max(1, weeks.length);
      const rowHeight = plot.height / 7;
      const xToPx = time => ((Number(time) - (model.window?.from ?? 0)) / Math.max(1, (model.window?.to ?? 0) - (model.window?.from ?? 0))) * plot.width;
      const xToData = px => (model.window?.from ?? 0) + (Math.max(0, Math.min(plot.width, px)) / plot.width) * ((model.window?.to ?? 0) - (model.window?.from ?? 0));
      const yToPx = index => (index + 0.5) * rowHeight;
      const yToData = px => Math.max(0, Math.min(6, Math.floor(px / rowHeight)));

      weeks.forEach((start, index) => {
        const x = xToPx(start) + columnWidth / 2;
        group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: index * columnWidth, y1: 0, x2: index * columnWidth, y2: plot.height }));
        group.append(textNode(doc, isoDay(start).slice(5), { class: 'yk-cat-tick', x, y: plot.height + 18, 'text-anchor': 'middle' }));
      });
      for (let weekday = 0; weekday < 7; weekday += 1) {
        group.append(textNode(doc, WEEKDAY_LABELS[weekday], { class: 'yk-cat-label', x: -8, y: yToPx(weekday) + 4, 'text-anchor': 'end' }));
      }

      model.rows.forEach((row, index) => {
        const x = (row.rowIndex + 0.5) * columnWidth;
        const y = yToPx(row.columnIndex);
        const width = Math.max(8, columnWidth - 3);
        const height = Math.max(8, rowHeight - 3);
        const style = markStyle(row.key);
        const groupMark = svgNode(doc, 'g', { class: 'yk-mark' });
        groupMark.append(svgNode(doc, 'rect', {
          class: 'yk-matrix-cell', x: x - width / 2, y: y - height / 2, width, height, rx: 2,
          fill: fillFor(row.value), 'data-shape': style.shape, 'data-pattern': style.pattern || ''
        }));
        const pattern = patternId(style.pattern);
        if (pattern) {
          groupMark.append(svgNode(doc, 'rect', {
            x: x - width / 2, y: y - height / 2, width, height, rx: 2,
            fill: `url(#${pattern})`, 'pointer-events': 'none', 'fill-opacity': 0.25
          }));
        }
        groupMark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-hit', 'data-hit': 'true', x: x - Math.max(width, MIN_TOUCH_PX) / 2, y: y - Math.max(height, MIN_TOUCH_PX) / 2,
          width: Math.max(width, MIN_TOUCH_PX), height: Math.max(height, MIN_TOUCH_PX)
        }));
        groupMark.append(textNode(doc, formatValue(row.value, { kind: model.series[0].kind || 'number', compact: true }), {
          class: 'yk-cat-value', x, y: y + 4, 'text-anchor': 'middle'
        }));
        group.append(groupMark);
        marks.push({ key: row.key, index, x: row.x, y: row.value, values: row.values, px: x, py: y, style, label: row.label, element: groupMark });
      });

      const overlay = svgNode(doc, 'rect', { class: 'yk-matrix-brush', hidden: '', x: 0, y: 0, width: 0, height: plot.height, 'pointer-events': 'none' });
      group.append(overlay);
      this.#overlay = overlay;
      this.#geometryForOverlay = () => ({ plot, xToPx });
      this.#wireCalendarDrag({ svg, doc, model, plot, margin, xToData, frame: svg.parentElement });
      this.#appendRampLegend(svg.parentElement, doc, model, colours, stops);
      this.#drawOverlay();
      return {
        marks,
        xToPx, xToData, yToPx, yToData,
        xScale: { key: 'x', min: model.window?.from ?? 0, max: model.window?.to ?? 0, width: plot.width },
        yScale: { key: 'y', min: 0, max: 7, height: plot.height }
      };
    }

    const rowKeys = model.rowKeys || [];
    const columnKeys = model.columnKeys || [];
    const cellWidth = plot.width / Math.max(1, columnKeys.length);
    const cellHeight = plot.height / Math.max(1, rowKeys.length);
    const xToPx = index => (index + 0.5) * cellWidth;
    const xToData = px => Math.max(0, Math.min(columnKeys.length - 1, Math.floor(px / cellWidth)));
    const yToPx = index => (index + 0.5) * cellHeight;
    const yToData = px => Math.max(0, Math.min(rowKeys.length - 1, Math.floor(px / cellHeight)));

    columnKeys.forEach((column, index) => {
      group.append(textNode(doc, column.label, { class: 'yk-cat-label', x: xToPx(index), y: -6, 'text-anchor': 'middle' }));
    });
    rowKeys.forEach((row, index) => {
      group.append(textNode(doc, row.label, { class: 'yk-cat-label', x: -8, y: yToPx(index) + 4, 'text-anchor': 'end' }));
    });

    model.rows.forEach((row, index) => {
      const x = xToPx(row.columnIndex);
      const y = yToPx(row.rowIndex);
      const width = Math.max(8, cellWidth - 4);
      const height = Math.max(8, cellHeight - 4);
      const style = markStyle(row.key);
      const groupMark = svgNode(doc, 'g', { class: 'yk-mark' });
      groupMark.append(svgNode(doc, 'rect', {
        class: 'yk-matrix-cell', x: x - width / 2, y: y - height / 2, width, height, rx: 2,
        fill: fillFor(row.value), 'data-shape': style.shape, 'data-pattern': style.pattern || ''
      }));
      const pattern = patternId(style.pattern);
      if (pattern) {
        groupMark.append(svgNode(doc, 'rect', {
          x: x - width / 2, y: y - height / 2, width, height, rx: 2,
          fill: `url(#${pattern})`, 'pointer-events': 'none', 'fill-opacity': 0.25
        }));
      }
      groupMark.append(svgNode(doc, 'rect', {
        class: 'yk-mark-hit', 'data-hit': 'true', x: x - Math.max(width, MIN_TOUCH_PX) / 2, y: y - Math.max(height, MIN_TOUCH_PX) / 2,
        width: Math.max(width, MIN_TOUCH_PX), height: Math.max(height, MIN_TOUCH_PX)
      }));
      groupMark.append(textNode(doc, formatValue(row.value, { kind: model.series[0].kind || 'number', compact: true }), {
        class: 'yk-cat-value', x, y: y + 4, 'text-anchor': 'middle'
      }));
      group.append(groupMark);
      marks.push({ key: row.key, index, x: row.columnKey, y: row.value, values: row.values, px: x, py: y, style, label: row.label, element: groupMark });
    });

    this.#appendRampLegend(svg.parentElement, doc, model, colours, stops);
    return {
      marks,
      xToPx, xToData, yToPx, yToData,
      xScale: { key: 'column', min: 0, max: columnKeys.length - 1, width: plot.width },
      yScale: { key: 'row', min: 0, max: rowKeys.length - 1, height: plot.height }
    };
  }

  #appendRampLegend(frame, doc, model, colours, stops) {
    if (!frame) return;
    const legend = doc.createElement('div');
    legend.className = 'yk-matrix-ramp';
    legend.setAttribute('role', 'img');
    const measure = model.series[0];
    const labels = stops.map(value => formatValue(value, { kind: measure.kind || 'number', compact: true }));
    legend.setAttribute('aria-label', `${measure.label || measure.key} ${measure.unit || ''} ramp from ${labels[0]} to ${labels.at(-1)}`.trim());
    const caption = doc.createElement('p');
    caption.className = 'yk-matrix-ramp-caption';
    caption.textContent = `${measure.label || measure.key}${measure.unit ? ` (${measure.unit})` : ''}`;
    const list = doc.createElement('ol');
    list.className = 'yk-matrix-ramp-stops';
    stops.forEach((value, index) => {
      const item = doc.createElement('li');
      item.className = 'yk-matrix-ramp-stop';
      item.dataset.stop = String(index);
      const swatch = doc.createElement('span');
      swatch.className = 'yk-matrix-ramp-swatch';
      swatch.style.background = colours[index] || '';
      const text = doc.createElement('span');
      text.className = 'yk-matrix-ramp-value';
      text.textContent = labels[index];
      item.append(swatch, text);
      list.append(item);
    });
    legend.append(caption, list);
    frame.append(legend);
  }

  #wireCalendarDrag({ svg, plot, margin, xToData, frame }) {
    svg.style.touchAction = 'pan-y';
    const width = plot.width + margin.left + margin.right;
    const controls = frame.ownerDocument.createElement('div');
    controls.className = 'yk-matrix-controls';
    const button = frame.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'yk-matrix-select-mode';
    button.textContent = 'Select';
    button.setAttribute('aria-pressed', this.dataset.selectMode === 'true' ? 'true' : 'false');
    button.addEventListener('click', () => {
      const next = this.dataset.selectMode !== 'true';
      this.dataset.selectMode = String(next);
      button.setAttribute('aria-pressed', next ? 'true' : 'false');
      button.dataset.active = next ? 'true' : 'false';
    });
    controls.append(button);
    frame.append(controls);

    const pointerX = event => {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width ? rect.width / width : 1;
      return (event.clientX - rect.left) / scale - margin.left;
    };
    let drag = null;
    let suppressClick = false;
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, startX: pointerX(event), touch: event.pointerType === 'touch', moved: false };
      try { svg.setPointerCapture(event.pointerId); } catch {}
    });
    svg.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const x = pointerX(event);
      if (Math.abs(x - drag.startX) >= 4) drag.moved = true;
      if (!drag.moved) return;
      if (drag.touch && this.dataset.selectMode !== 'true') return;
      const next = snapBrush(xToData(drag.startX), xToData(x));
      if (!next) return;
      this.#brush = next;
      this.#drawOverlay();
    });
    svg.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const finished = drag;
      drag = null;
      try { svg.releasePointerCapture(event.pointerId); } catch {}
      if (!finished.moved) return;
      suppressClick = true;
      if (finished.touch && this.dataset.selectMode !== 'true') {
        this.#drawOverlay();
        return;
      }
      const next = snapBrush(xToData(finished.startX), xToData(pointerX(event)));
      if (!next) return;
      this.#brush = next;
      this.setBrush({ from: next.from, to: next.to, aligned: true });
      this.#drawOverlay();
    });
    svg.addEventListener('click', event => {
      if (!suppressClick) return;
      suppressClick = false;
      event.stopPropagation();
      event.preventDefault();
    }, true);
  }
}

export function defineMatrix(tag = 'yk-matrix') {
  return defineSvgChart(tag, YkMatrix);
}

defineMatrix();
