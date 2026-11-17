// <yk-lanes> — timeline and gantt lanes on the shared Phase 8 SVG foundation.
// Markers are never sized by a value; colour and shape come from the registry
// by `kind`. The time axis is real: a drag on it brushes through the base's
// `setBrush()` wiring, `[` and `]` move an edge, and Esc clears the brush after
// the selection. Unpriced marks are hollow and named, never formatted as $0.

import {
  DEFAULT_HEIGHT, MIN_TOUCH_PX, SvgChartElement, createShape, defineSvgChart,
  patternId, svgNode, textNode
} from './svg-base.js';
import { formatValue, NULL_TEXT } from './formatters.js';

export const LANE_TYPES = ['timeline', 'gantt'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DRAG_THRESHOLD_PX = 4;

function labelOf(key) {
  const text = String(key ?? '');
  const at = text.indexOf(':');
  return at > 0 ? text.slice(at + 1) : text;
}

export function normaliseLanesType(type) {
  return LANE_TYPES.includes(type) ? type : 'timeline';
}

export function toTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function numeric(value) {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number;
}

export function formatLaneTime(value) {
  const time = toTime(value);
  if (time === null) return NULL_TEXT;
  const date = new Date(time);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatTick(value) {
  const time = toTime(value);
  if (time === null) return '';
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function createTimeScale(window = {}, width = 0) {
  const min = numeric(window.min) ?? 0;
  const max = numeric(window.max) ?? min;
  const span = max - min > 0 ? max - min : 1;
  const size = Math.max(0, numeric(width) ?? 0);
  const xToPx = value => {
    const time = toTime(value);
    return time === null ? 0 : ((time - min) / span) * size;
  };
  const xToData = px => min + (Math.max(0, Math.min(size, Number(px) || 0)) / size) * span;
  return { key: 'x', min, max, width: size, span, xToPx, xToData };
}

function normaliseLanes(declared = [], rows = []) {
  const given = (Array.isArray(declared) ? declared : [])
    .map(lane => ({ key: String(lane.key), label: lane.label ?? labelOf(lane.key) }));
  if (given.length > 0) return given;
  const seen = [];
  for (const row of rows) if (!seen.includes(row.lane)) seen.push(row.lane);
  return seen.map(key => ({ key, label: labelOf(key) }));
}

function measureOf(item) {
  const direct = numeric(item.value);
  if (direct !== null) return direct;
  const values = item.values && typeof item.values === 'object' ? item.values : {};
  for (const value of Object.values(values)) {
    const number = numeric(value);
    if (number !== null) return number;
  }
  return null;
}

function buildSeries(spec, rows) {
  const declared = new Map((spec.series || []).map(item => [String(item.key), { ...item, key: String(item.key) }]));
  const kinds = [];
  for (const row of rows) if (!kinds.includes(row.kind)) kinds.push(row.kind);
  return kinds.map(key => declared.get(key) || { key, label: labelOf(key), kind: 'count', unit: '' });
}

export function buildLanesModel({ spec = {}, data = [] } = {}) {
  const type = normaliseLanesType(spec.type);
  const input = Array.isArray(data) ? data : [];
  const prepared = [];

  for (const item of input) {
    const key = item?.key === undefined || item?.key === null ? null : String(item.key);
    if (!key) continue;
    const kind = String(item.kind ?? 'unknown');
    const lane = String(item.lane ?? item.laneKey ?? key);
    let at = toTime(item.at);
    const start = toTime(item.start);
    const end = toTime(item.end);
    const span = type === 'gantt' && start !== null && end !== null && end >= start;
    if (!span && at === null) at = start;
    if (!span && at === null) continue;
    prepared.push({ item, key, kind, lane, at, start, end, span });
  }

  if (prepared.length === 0) {
    return { state: 'empty', reason: spec.empty || 'no markers or spans in the current window', rows: [], series: [], tableRows: [] };
  }

  const lanes = normaliseLanes(spec.lanes || spec.data?.lanes, prepared);
  const laneIndex = new Map(lanes.map((lane, index) => [lane.key, index]));
  const unknown = prepared.find(row => !laneIndex.has(row.lane));
  if (lanes.length === 0 || unknown) {
    return {
      state: 'unsupported',
      reason: unknown ? `lane ${unknown.lane} is not declared` : 'lanes needs at least one lane',
      rows: [],
      series: [],
      tableRows: []
    };
  }

  // Vertical packing within a lane keeps overlapping spans distinguishable.
  const packing = new Map();
  for (const [index, row] of prepared.entries()) {
    if (!row.span) continue;
    const list = packing.get(row.lane) || [];
    if (!packing.has(row.lane)) packing.set(row.lane, list);
    let slot = list.findIndex(lastEnd => lastEnd <= row.start);
    if (slot === -1) {
      slot = list.length;
      list.push(row.end);
    } else {
      list[slot] = row.end;
    }
    row.laneRow = slot;
  }
  for (const row of prepared) {
    if (row.span) row.laneRows = packing.get(row.lane).length;
  }

  const times = [];
  for (const row of prepared) {
    if (row.span) times.push(row.start, row.end);
    else times.push(row.at);
  }
  const min = Math.min(...times);
  let max = Math.max(...times);
  if (max <= min) max = min + 1;

  const series = buildSeries(spec, prepared);
  const seriesByKind = new Map(series.map(item => [item.key, item]));
  const rows = prepared.map((row, index) => {
    const priced = row.item.priced !== false;
    const measure = row.span ? measureOf(row.item) : measureOf(row.item);
    const values = { [row.kind]: priced ? measure : null };
    return {
      key: row.key,
      index,
      label: row.item.label ?? labelOf(row.key),
      kind: row.kind,
      lane: row.lane,
      laneIndex: laneIndex.get(row.lane),
      laneRow: row.laneRow ?? 0,
      laneRows: row.laneRows ?? 1,
      span: row.span,
      at: row.span ? null : row.at,
      start: row.span ? row.start : null,
      end: row.span ? row.end : null,
      values,
      n: row.item.n,
      coverage: row.item.coverage,
      priced,
      hollow: !priced
    };
  });

  const tableSeries = [
    ...(type === 'gantt' ? [{ key: 'end', label: 'End', kind: 'text' }] : []),
    { key: 'lane', label: 'Lane', kind: 'text' },
    { key: 'kind', label: 'Kind', kind: 'text' },
    { key: 'value', label: 'Value', kind: 'text' }
  ];

  const tableRows = rows.map(row => {
    const seriesItem = seriesByKind.get(row.kind) || { kind: 'number', unit: '', label: labelOf(row.kind) };
    const value = row.priced === false
      ? 'unpriced'
      : measureOf(prepared[row.index].item) === null
        ? NULL_TEXT
        : formatValue(measureOf(prepared[row.index].item), { kind: seriesItem.kind || 'number', unit: seriesItem.unit });
    const values = {
      lane: lanes[row.laneIndex].label,
      kind: seriesItem.label || labelOf(row.kind),
      value
    };
    if (type === 'gantt') values.end = row.span ? formatLaneTime(row.end) : NULL_TEXT;
    return {
      key: row.key,
      x: formatLaneTime(row.span ? row.start : row.at),
      values,
      n: row.n,
      coverage: row.coverage
    };
  });

  return {
    state: 'ready',
    type,
    rows,
    series,
    kinds: series.map(item => item.key),
    lanes,
    laneIndex,
    window: { min, max },
    entityKeys: rows.map(row => row.key),
    tableRows,
    tableSeries,
    x: { label: type === 'gantt' ? 'Start' : 'Time', kind: 'text' },
    height: Math.max(DEFAULT_HEIGHT, 72 + lanes.length * 48),
    spec: { chart: spec.chart || 'lanes', type }
  };
}

export class YkLanes extends SvgChartElement {
  #keyHandler = null;
  #brushListener = null;
  #selectMode = false;
  #brushValue = null;
  #brushRect = null;
  #plotHit = null;
  #scale = null;
  #window = null;

  buildModel({ spec, data }) {
    return buildLanesModel({ spec, data });
  }

  chartType(spec) {
    return spec?.chart || 'lanes';
  }

  supportsBrush() {
    return true;
  }

  whenSettled() {
    return super.whenSettled().then(() => {
      this.#guardTable();
      return undefined;
    });
  }

  // The shared base listens for its keyboard grammar on the chart root while
  // the shared table listens on the focused row; without this guard a table
  // key would act twice. Stop only those keys after the table has handled them.
  #guardTable() {
    const table = this._table?.table;
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr')) {
      if (row.dataset.lanesGuarded === 'true') continue;
      row.dataset.lanesGuarded = 'true';
      row.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Spacebar' || event.key === 'Enter' ||
            event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.stopPropagation();
        }
      });
    }
  }

  connectedCallback() {
    if (!this.#keyHandler) {
      this.#keyHandler = event => this.#onLanesKey(event);
      this.shadowRoot.addEventListener('keydown', this.#keyHandler);
    }
    if (!this.#brushListener) {
      this.#brushListener = event => {
        this.#brushValue = event.detail;
        this.#paintBrush();
      };
      this.addEventListener('brush', this.#brushListener);
    }
    super.connectedCallback();
  }

  disconnectedCallback() {
    if (this.#keyHandler) {
      this.shadowRoot.removeEventListener('keydown', this.#keyHandler);
      this.#keyHandler = null;
    }
    if (this.#brushListener) {
      this.removeEventListener('brush', this.#brushListener);
      this.#brushListener = null;
    }
    super.disconnectedCallback();
  }

  #onLanesKey(event) {
    if (event.key !== '[' && event.key !== ']') return;
    if (!this.#brushValue || !this.#window) return;
    const from = numeric(this.#brushValue.from);
    const to = numeric(this.#brushValue.to);
    if (from === null || to === null) return;
    const step = Math.max(1, Math.round((this.#window.max - this.#window.min) * 0.02));
    let nextFrom = from;
    let nextTo = to;
    if (event.key === '[') nextFrom = Math.max(this.#window.min, from - step);
    else nextTo = Math.min(this.#window.max, to + step);
    if (nextFrom >= nextTo) return;
    this.setBrush({ from: nextFrom, to: nextTo, aligned: true });
    event.preventDefault();
    event.stopPropagation();
  }

  #paintBrush() {
    const rect = this.#brushRect;
    if (!rect) return;
    const from = numeric(this.#brushValue?.from);
    const to = numeric(this.#brushValue?.to);
    if (from === null || to === null || !this.#scale) {
      rect.setAttribute('width', '0');
      rect.setAttribute('visibility', 'hidden');
      return;
    }
    const x = this.#scale.xToPx(Math.min(from, to));
    const width = Math.max(1, this.#scale.xToPx(Math.max(from, to)) - x);
    rect.setAttribute('x', String(x));
    rect.setAttribute('width', String(width));
    rect.setAttribute('visibility', 'visible');
  }

  #wireBrush({ svg, group, plot, scale, margin }) {
    let drag = null;
    const fromEvent = event => {
      const rect = svg.getBoundingClientRect();
      return scale.xToData(event.clientX - rect.left - margin.left);
    };
    svg.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') return;
      const target = event.target;
      const axis = Boolean(target?.closest?.('[data-lane-axis]'));
      if (!axis && !this.#selectMode) return;
      drag = { id: event.pointerId, startX: event.clientX, moved: false };
      try { svg.setPointerCapture(event.pointerId); } catch {}
      event.preventDefault();
    });
    svg.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch') return;
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      const from = fromEvent({ clientX: drag.startX });
      const to = fromEvent(event);
      this.#brushValue = { from: Math.min(from, to), to: Math.max(from, to), aligned: true };
      this.#paintBrush();
    });
    const finish = event => {
      if (event.pointerType === 'touch') return;
      if (!drag || drag.id !== event.pointerId) return;
      const finished = drag;
      drag = null;
      try { svg.releasePointerCapture(event.pointerId); } catch {}
      if (!finished.moved) return;
      const from = fromEvent({ clientX: finished.startX });
      const to = fromEvent(event);
      this.setBrush({
        from: Math.round(Math.min(from, to)),
        to: Math.round(Math.max(from, to)),
        aligned: true
      });
    };
    svg.addEventListener('pointerup', finish);
    svg.addEventListener('pointercancel', () => { drag = null; });

    // Chromium delivers touch drags as touch events (with one pointermove);
    // handle them directly so Select mode brushes on a real touch drag.
    let touchDrag = null;
    const touchFrom = touch => {
      const rect = svg.getBoundingClientRect();
      return scale.xToData(touch.clientX - rect.left - margin.left);
    };
    svg.addEventListener('touchstart', event => {
      const target = event.target;
      const axis = Boolean(target?.closest?.('[data-lane-axis]'));
      if (!axis && !this.#selectMode) return;
      const touch = event.touches[0];
      if (!touch) return;
      touchDrag = { startX: touch.clientX, moved: false };
      event.preventDefault();
    }, { passive: false });
    svg.addEventListener('touchmove', event => {
      if (!touchDrag) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (!touchDrag.moved && Math.abs(touch.clientX - touchDrag.startX) < DRAG_THRESHOLD_PX) return;
      touchDrag.moved = true;
      const from = touchFrom({ clientX: touchDrag.startX });
      const to = touchFrom(touch);
      this.#brushValue = { from: Math.min(from, to), to: Math.max(from, to), aligned: true };
      this.#paintBrush();
      event.preventDefault();
    }, { passive: false });
    svg.addEventListener('touchend', event => {
      if (!touchDrag) return;
      const finished = touchDrag;
      touchDrag = null;
      const touch = event.changedTouches[0];
      if (!finished.moved || !touch) return;
      const from = touchFrom({ clientX: finished.startX });
      const to = touchFrom(touch);
      this.setBrush({
        from: Math.round(Math.min(from, to)),
        to: Math.round(Math.max(from, to)),
        aligned: true
      });
      event.preventDefault();
    }, { passive: false });
    svg.addEventListener('touchcancel', () => { touchDrag = null; });

    const button = svg.parentElement?.ownerDocument.createElement('button');
    if (button) {
      button.type = 'button';
      button.className = 'yk-lane-select-mode';
      button.textContent = 'Select';
      button.setAttribute('aria-pressed', String(this.#selectMode));
      button.style.minHeight = '44px';
      button.style.minWidth = `${MIN_TOUCH_PX}px`;
      button.addEventListener('click', () => {
        this.#selectMode = !this.#selectMode;
        button.setAttribute('aria-pressed', String(this.#selectMode));
        this.#plotHit?.setAttribute('pointer-events', this.#selectMode ? 'all' : 'none');
      });
      svg.parentElement.append(button);
    }
    this.#plotHit?.setAttribute('pointer-events', this.#selectMode ? 'all' : 'none');
    this.#paintBrush();
  }

  renderPlot({ svg, doc, model, spec, plot, margin, styleFor, hidden }) {
    const group = svgNode(doc, 'g', { class: 'yk-plot', transform: `translate(${margin.left} ${margin.top})` });
    svg.append(group);
    const lanes = model.lanes || [];
    const laneHeight = plot.height / Math.max(1, lanes.length);
    const scale = createTimeScale(model.window, plot.width);
    this.#scale = scale;
    this.#window = model.window;
    const marks = [];

    for (let index = 0; index < 5; index += 1) {
      const time = model.window.min + ((model.window.max - model.window.min) * index) / 4;
      const x = scale.xToPx(time);
      group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: x, y1: 0, x2: x, y2: plot.height }));
      group.append(textNode(doc, formatTick(time), {
        class: 'yk-cat-tick', x, y: plot.height + 18, 'text-anchor': index === 0 ? 'start' : index === 4 ? 'end' : 'middle'
      }));
    }
    for (const [index, lane] of lanes.entries()) {
      const y = (index + 0.5) * laneHeight;
      if (index > 0) {
        group.append(svgNode(doc, 'line', { class: 'yk-cat-grid', x1: 0, y1: index * laneHeight, x2: plot.width, y2: index * laneHeight }));
      }
      group.append(textNode(doc, lane.label, { class: 'yk-cat-label', x: -8, y: y + 4, 'text-anchor': 'end' }));
    }
    group.append(svgNode(doc, 'line', { class: 'yk-cat-axis', x1: 0, y1: plot.height, x2: plot.width, y2: plot.height }));

    for (const row of model.rows) {
      if (hidden.has(row.kind)) continue;
      const style = styleFor(row.kind);
      const laneY = (row.laneIndex + 0.5) * laneHeight;
      const mark = svgNode(doc, 'g', { class: 'yk-mark', 'data-shape': style.shape, 'data-pattern': style.pattern || '' });
      // The shared swatch CSS rotates/clips any [data-shape] node; a lane span
      // or marker must keep its plotted geometry, so opt out locally.
      mark.style.transform = 'none';
      mark.style.clipPath = 'none';
      let px = 0;
      let py = laneY;
      let values = { ...row.values, kind: row.kind, lane: row.lane };

      if (row.span) {
        const startPx = scale.xToPx(row.start);
        const endPx = scale.xToPx(row.end);
        const slot = row.laneRow || 0;
        const slots = Math.max(1, row.laneRows || 1);
        const rowHeight = laneHeight / slots;
        const thickness = Math.max(6, Math.min(16, rowHeight - 4));
        py = laneY - (slots * rowHeight) / 2 + slot * rowHeight + rowHeight / 2;
        const width = Math.max(2, endPx - startPx);
        const top = py - thickness / 2;
        mark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-shape yk-lane-span', x: startPx, y: top, width, height: thickness,
          fill: style.colour, rx: 2, 'data-start': row.start, 'data-end': row.end
        }));
        const pattern = patternId(style.pattern);
        if (pattern) {
          mark.append(svgNode(doc, 'rect', {
            x: startPx, y: top, width, height: thickness, fill: `url(#${pattern})`, 'pointer-events': 'none'
          }));
        }
        mark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-hit', 'data-hit': 'true', x: startPx, y: py - Math.max(thickness, MIN_TOUCH_PX) / 2,
          width: Math.max(width, MIN_TOUCH_PX), height: Math.max(thickness, MIN_TOUCH_PX)
        }));
        px = startPx;
        values = { ...values, start: row.start, end: row.end, laneRow: slot };
      } else {
        px = scale.xToPx(row.at);
        const shape = createShape(doc, style.shape, { x: px, y: py, size: 12, fill: row.hollow ? 'none' : style.colour });
        shape.setAttribute('class', 'yk-mark-shape yk-lane-marker');
        shape.setAttribute('data-priced', String(row.priced));
        if (row.hollow) {
          shape.setAttribute('fill', 'none');
          shape.setAttribute('stroke', style.colour);
          shape.setAttribute('stroke-width', '2');
        } else {
          const pattern = patternId(style.pattern);
          if (pattern) {
            const overlay = createShape(doc, style.shape, { x: px, y: py, size: 12, fill: `url(#${pattern})` });
            overlay.setAttribute('pointer-events', 'none');
            mark.append(overlay);
          }
        }
        mark.append(shape);
        mark.append(svgNode(doc, 'rect', {
          class: 'yk-mark-hit', 'data-hit': 'true', x: px - MIN_TOUCH_PX / 2, y: py - MIN_TOUCH_PX / 2,
          width: MIN_TOUCH_PX, height: MIN_TOUCH_PX
        }));
        values = { ...values, at: row.at, priced: row.priced };
      }

      const label = `${row.label} · ${style.label || row.kind} · ${formatLaneTime(row.span ? row.start : row.at)}${row.hollow ? ' · unpriced' : ''}`;
      mark.setAttribute('aria-label', label);
      group.append(mark);
      marks.push({
        key: row.key,
        index: row.index,
        x: row.span ? row.start : row.at,
        y: row.laneIndex,
        values,
        px,
        py,
        style,
        label,
        element: mark
      });
    }

    const axisHit = svgNode(doc, 'rect', {
      class: 'yk-lane-axis-hit', 'data-lane-axis': 'true', x: 0, y: plot.height,
      width: plot.width, height: Math.max(16, margin.bottom), fill: 'transparent', 'pointer-events': 'all'
    });
    group.append(axisHit);

    const brushRect = svgNode(doc, 'rect', {
      class: 'yk-lane-brush', x: 0, y: 0, width: 0, height: plot.height,
      fill: 'var(--yk-chart-focus)', 'fill-opacity': '0.15', 'pointer-events': 'none', visibility: 'hidden'
    });
    group.append(brushRect);
    this.#brushRect = brushRect;

    this.#plotHit = svgNode(doc, 'rect', {
      class: 'yk-lane-plot-hit', x: 0, y: 0, width: plot.width, height: plot.height,
      fill: 'transparent', 'pointer-events': 'none'
    });
    group.append(this.#plotHit);

    this.#wireBrush({ svg, group, plot, scale, margin });
    queueMicrotask(() => this.#guardTable());

    const yToPx = laneIndex => (laneIndex + 0.5) * laneHeight;
    const yToData = px => Math.max(0, Math.min(lanes.length - 1, Math.floor(px / laneHeight)));
    return {
      marks,
      xToPx: scale.xToPx,
      xToData: scale.xToData,
      yToPx,
      yToData,
      xScale: { key: 'x', min: model.window.min, max: model.window.max, width: plot.width },
      yScale: { key: 'y', min: 0, max: lanes.length, height: plot.height }
    };
  }
}

export function defineLanes(tag = 'yk-lanes') {
  return defineSvgChart(tag, YkLanes);
}

defineLanes();
