// <yk-chart> — the one uPlot-backed time-series element. It composes the 7-01
// foundations (colour registry, formatters, tooltip, legend, badges, table,
// cached stylesheet) with the mode transforms, scales and thresholds here.
// 7-03 adds the gesture engine, the Boolean entity selection and the settled
// state history; the element owns that state and the engine only emits intent.

import uPlot from '/vendor/uplot-1.6.32/uPlot.esm.js';
import { ColourRegistry } from './colour-registry.js';
import { badgeModel, createBadges } from './badges.js';
import { formatBasis } from './formatters.js';
import { createLegend } from './legend.js';
import { createTable } from './table.js';
import { createTooltip, tooltipModel } from './tooltip.js';
import { adoptChartStyles, readToken, watchTheme } from './styles.js';
import { transformSeriesData } from './series.js';
import {
  buildScales, columnBarLayout, normaliseDash, scaleGroupKey, scaleRange, xIsNumeric, xPxToData, xToPx, yPxToData, yToPx
} from './scales.js';
import { createThresholdPlugin, renderThresholdTable, thresholdModel } from './thresholds.js';
import { createGestureEngine, createHighlightPlugin } from './gestures.js';
import { createHistory, decodeBrush } from './history.js';
import { scatterModel } from './scatter.js';
import { createCanvasScatter } from './canvas-scatter.js';
import { ecdfModel } from './ecdf.js';
import {
  addSelection, decodeSelection, emptySelection, isExcluded, isSelected,
  normaliseSelection, removeSelection, selectedKeys, selectionIsEmpty, selectionPredicate,
  toggleSelection
} from './selection.js';

const TAG = 'yk-chart';
export const CHART_HEIGHT = 240;
const registry = new ColourRegistry();
const hostStyles = typeof CSSStyleSheet === 'undefined' ? null : new CSSStyleSheet();
if (hostStyles) {
  hostStyles.replaceSync(`
    :host { display: block; min-width: 0; }
    .yk-gesture-controls { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.4rem 0; }
    .yk-gesture-button {
      min-width: 44px; min-height: 44px; padding: 0.35rem 0.7rem;
      border: 1px solid var(--yk-chart-border); border-radius: 0.4rem;
      background: var(--yk-chart-surface); color: var(--yk-chart-text);
      font: inherit; cursor: pointer;
    }
    .yk-gesture-button[data-active='true'] { border-color: var(--yk-chart-focus); outline: 2px solid var(--yk-chart-focus); }
    .u-over { touch-action: none; }
    input.yk-table-select { min-width: 44px; min-height: 44px; }
    .yk-table tbody tr[data-selected='true'] { background: color-mix(in srgb, var(--yk-chart-focus) 12%, transparent); }
    .yk-table tbody tr[data-excluded='true'] { opacity: 0.6; text-decoration: line-through; }
    .yk-table tbody tr[data-highlighted='true'] { outline: 1px dashed var(--yk-chart-focus); outline-offset: -1px; }
    .yk-scatter-stack { position: relative; width: 100%; height: 240px; }
    .yk-scatter-canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
    .yk-scatter-overlay { z-index: 1; }
    .yk-scatter-overlay:focus-visible { outline: 2px solid var(--yk-chart-focus); outline-offset: 2px; }
  `);
}

function withAlpha(colour, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!match) return colour;
  const value = match[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function reasonText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.reason || value.message || JSON.stringify(value);
}

export class YkChart extends HTMLElement {
  #spec = null;
  #data = [];
  #hidden = new Set();
  #pending = Promise.resolve();
  #token = 0;
  #u = null;
  #transform = null;
  #brush = null;
  #selection = emptySelection();
  #thresholds = [];
  #observer = null;
  #stopTheme = null;
  #history = null;
  #engine = null;
  #inspectedKey = null;
  #inspectedIndex = 0;
  #inspectedSeries = 0;
  #highlight = null;
  #selectMode = false;
  #scatter = null;
  #selectionRegion = null;
  #legendState = { hidden: [], active: null, isolated: null };
  #highlightHandler = null;
  #baseWindow = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    if (hostStyles) this.shadowRoot.adoptedStyleSheets = [hostStyles];
  }

  get spec() { return this.#spec; }
  set spec(value) {
    this.#spec = value || null;
    this.#hidden = new Set();
    this.#schedule();
  }

  get data() { return this.#data; }
  set data(value) {
    this.#data = Array.isArray(value) ? value : [];
    this.#schedule();
  }

  connectedCallback() {
    if (this.#stopTheme) this.#stopTheme();
    this.#stopTheme = watchTheme(() => this.#schedule());
    if (!this.#history) {
      this.#history = createHistory({ onChange: state => this.#applyUrlState(state) });
      this.#history.start();
    }
    if (!this.#highlightHandler) {
      this.#highlightHandler = event => {
        const detail = event.detail || {};
        if (!detail.key || detail.chart === this.#chartId()) return;
        if (!(this.#transform?.rows || []).some(row => row.key === detail.key)) return;
        this.#setHighlight(detail.key, { propagate: false });
      };
      (this.ownerDocument || document).addEventListener('yk-highlight', this.#highlightHandler);
    }
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#engine?.destroy();
    this.#engine = null;
    this.#scatter?.destroy();
    this.#scatter = null;
    this.#u?.destroy();
    this.#u = null;
    this.#stopTheme?.();
    this.#stopTheme = null;
    this.#history?.stop();
    if (this.#highlightHandler) {
      (this.ownerDocument || document).removeEventListener('yk-highlight', this.#highlightHandler);
      this.#highlightHandler = null;
    }
  }

  #chartId() {
    return this.#spec?.chart || this.id || 'chart';
  }

  whenSettled() {
    return this.#pending;
  }

  inspect() {
    if (this.#scatter) return this.#inspectScatter();
    const spec = this.#spec || {};
    const u = this.#u;
    const transform = this.#transform;
    const rows = transform?.rows || [];
    const over = u?.over;
    const rect = over ? over.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    const xScale = scaleRange(u?.scales?.x);
    const yScale = scaleRange(u?.scales?.y);
    const plot = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    const xRange = { min: xScale.min, max: xScale.max, width: rect.width };
    const yRange = { min: yScale.min, max: yScale.max, height: rect.height };

    const toX = value => (u ? u.valToPos(value, 'x') : xToPx(value, xRange));
    const toY = value => (u ? u.valToPos(value, 'y') : yToPx(value, yRange));

    const cursor = u
      ? {
        left: u.cursor.left,
        top: u.cursor.top,
        idx: u.cursor.idx,
        x: u.cursor.idx == null ? null : rows[u.cursor.idx]?.x ?? null,
        values: u.cursor.idx == null ? null : rows[u.cursor.idx]?.values ?? null
      }
      : null;

    return {
      chart: this.dataset.chart || null,
      state: this.dataset.state || null,
      mode: transform?.mode || spec.mode || 'absolute',
      type: transform?.type || spec.type || 'line',
      stacked: Boolean(transform?.stacked),
      bucket: spec.bucket ?? spec.resolution ?? null,
      window: { from: xScale.min, to: xScale.max },
      selection: selectionPredicate(this.#selection),
      selectionKeys: selectedKeys(this.#selection),
      brush: this.#brush ? { ...this.#brush } : null,
      inspectedKey: this.#inspectedKey,
      inspectedIndex: this.#inspectedIndex,
      inspectedSeries: this.#inspectedSeries,
      highlight: this.#highlight,
      selectMode: this.#selectMode,
      urlState: this.#history ? this.#history.state : null,
      series: (transform?.spec?.series || []).map(item => ({
        key: item.key,
        label: item.label,
        visible: !this.#hidden.has(item.key)
      })),
      plot,
      xScale: { key: 'x', time: !xIsNumeric(spec), ...xScale },
      yScale: { key: 'y', ...yScale },
      yScales: ['y'],
      dualAxis: false,
      xToPx: toX,
      yToPx: toY,
      xToData: position => (u ? u.posToVal(position, 'x') : xPxToData(position, xRange)),
      yToData: position => (u ? u.posToVal(position, 'y') : yPxToData(position, yRange)),
      cursor,
      marks: rows.map((row, index) => ({
        key: row.key,
        index,
        x: row.x,
        px: toX(row.x),
        values: row.values
      })),
      thresholds: this.#thresholds.map(item => ({ ...item }))
    };
  }

  #schedule() {
    if (!this.isConnected) return this.#pending;
    this.#pending = this.#render();
    return this.#pending;
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  async #render() {
    const token = ++this.#token;
    this.dataset.state = 'loading';
    try {
      await adoptChartStyles(this.shadowRoot);
    } catch (error) {
      if (token !== this.#token) return;
      this.dataset.state = 'error';
      this.#renderMessage('error', `chart stylesheet failed: ${error.message}`);
      return;
    }
    if (token !== this.#token || !this.isConnected) return;
    this.#build();
  }

  #build() {
    const spec = this.#spec || {};
    const chartId = spec.chart || this.id || 'chart';
    this.dataset.chart = chartId;
    this.dataset.idle = 'false';
    this.#engine?.destroy();
    this.#engine = null;
    this.#scatter?.destroy();
    this.#scatter = null;
    this.#selectionRegion = null;
    this.#u?.destroy();
    this.#u = null;
    this.#transform = null;
    this.#thresholds = [];

    const unsupported = spec.unsupported;
    if (unsupported) {
      this.#setState('unsupported', reasonText(unsupported), 'unsupported');
      return;
    }
    if (!Array.isArray(this.#data) || this.#data.length === 0) {
      const reason = reasonText(spec.empty) || 'no buckets in the current window';
      this.#setState('empty', reason, 'empty');
      return;
    }

    const kind = spec.chart === 'scatter' || spec.type === 'scatter'
      ? 'scatter'
      : spec.chart === 'ecdf' || spec.type === 'ecdf' ? 'ecdf' : 'series';
    if (kind === 'scatter') {
      this.#buildScatter(spec, chartId);
      return;
    }
    const transform = kind === 'ecdf'
      ? ecdfModel({ spec, data: this.#data })
      : transformSeriesData({ spec, data: this.#data });
    this.#transform = transform;
    this.#thresholds = thresholdModel(spec);
    const effectiveSpec = transform.spec;
    registry.register(effectiveSpec.series.map(item => item.key));
    const seriesStyles = effectiveSpec.series.map(item => {
      const style = registry.style(item.key);
      const colour = readToken(this, style.cssVar) || style.light;
      return { ...style, ...item, colour };
    });
    const styledSpec = { ...effectiveSpec, series: seriesStyles };

    const root = this.#shell(chartId, 'ready');
    const frame = root.querySelector('.yk-chart-frame');
    const tooltip = createTooltip(this.shadowRoot.ownerDocument || document);
    this.shadowRoot.querySelector(':scope > .yk-tooltip')?.remove();
    this.shadowRoot.append(tooltip.element);

    const group = scaleGroupKey(styledSpec);
    const zeroBased = transform.type === 'columns';
    const scales = buildScales(styledSpec, { zeroBased });
    if (transform.type === 'ecdf') scales.y.range = () => [0, 1];
    const plotRows = transform.rows.map(row => row.values);
    const xs = transform.rows.map(row => row.x);
    const data = [xs, ...seriesStyles.map(item => plotRows.map(values => values[item.key] ?? null))];

    const hidden = new Set(this.#hidden);
    const columnLayout = transform.type === 'columns' ? columnBarLayout(seriesStyles) : null;
    const seriesOpts = [
      { label: styledSpec.x?.label || 'Time' },
      ...seriesStyles.map((item, index) => {
        const base = {
          key: item.key,
          label: item.label,
          stroke: item.colour,
          width: 2,
          spanGaps: false,
          show: !hidden.has(item.key),
          points: { show: false }
        };
        const dash = normaliseDash(item.dash);
        if (dash) base.dash = dash;
        if (transform.type === 'area') {
          base.fill = withAlpha(item.colour, 0.18);
        }
        if (transform.type === 'columns') {
          if (item.outline) {
            base.fill = withAlpha(item.colour, 0.12);
            base.stroke = item.colour;
            base.width = 1.5;
          } else {
            base.fill = item.colour;
            base.width = 0;
          }
          base.paths = uPlot.paths.bars({ size: columnLayout.size, align: columnLayout.aligns[index] });
          base.points = { show: false };
        }
        if (transform.type === 'ecdf') {
          base.width = 2;
          base.paths = uPlot.paths.stepped({ align: 1 });
          base.points = { show: false };
        }
        return base;
      })
    ];

    const axisStroke = readToken(this, '--yk-chart-muted');
    const gridStroke = readToken(this, '--yk-chart-grid');
    const units = styledSpec.units || seriesStyles[0]?.unit || '';

    const plugins = [];
    if (this.#thresholds.length > 0) plugins.push(createThresholdPlugin(this.#thresholds, { host: this }));
    plugins.push(createHighlightPlugin({
      getKey: () => this.#highlight,
      getRows: () => this.#transform?.rows || [],
      getColour: () => readToken(this, '--yk-chart-focus') || '#176b87'
    }));

    const opts = {
      width: Math.max(320, frame.clientWidth || 640),
      height: CHART_HEIGHT,
      padding: [12, 12, 0, 0],
      legend: { show: false },
      cursor: {
        points: { show: false },
        drag: { x: false, y: false, setScale: false, uni: 12 },
        ...(group ? { sync: { key: group, scales: ['x', null] } } : {})
      },
      scales,
      series: seriesOpts,
      bands: transform.bands,
      axes: [
        { stroke: axisStroke, grid: { stroke: gridStroke }, ticks: { stroke: gridStroke }, labelFont: '12px system-ui, sans-serif' },
        { stroke: axisStroke, grid: { stroke: gridStroke }, ticks: { stroke: gridStroke }, label: units, labelFont: '12px system-ui, sans-serif' }
      ],
      plugins,
      hooks: {
        setCursor: [u => this.#onCursor(u, tooltip)]
      }
    };

    this.#u = new uPlot(opts, data, frame);
    this._tooltipSpec = styledSpec;
    this._tooltip = tooltip;
    this.#baseWindow = xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: 0, max: 0 };

    this.#engine = createGestureEngine({
      element: this,
      handlers: {
        getRows: () => this.#transform?.rows || [],
        getSpec: () => this._tooltipSpec || this.#spec || {},
        getInspected: () => ({ key: this.#inspectedKey, index: this.#inspectedIndex, series: this.#inspectedSeries }),
        getBrush: () => this.#brush,
        getSelection: () => selectionPredicate(this.#selection),
        onHover: (key, index) => {
          this.#inspectedKey = key;
          this.#inspectedIndex = index;
          this.#setHighlight(key);
        },
        onNavigate: (key, index, series) => this.#inspectKey(key, { index, series, source: 'keyboard' }),
        onActivate: (key, { source } = {}) => this.#inspectKey(key, { source, open: true }),
        onSelection: detail => this.#onSelectionIntent(detail),
        onBrushPreview: brush => { this.#brush = brush; },
        onBrush: brush => this.#commitBrush(brush),
        onBrushCleared: () => this.#clearBrush(),
        onZoom: window => this.#zoomTo(window),
        onPan: window => this.#panTo(window),
        onFilter: key => this.#focusInspected(key),
        onOpen: key => this.#emit('open', { key, selection: selectionPredicate(this.#selection) }),
        onCohort: (slot, key) => this.#emit('cohort', { slot, key, selection: selectionPredicate(this.#selection) }),
        onSelectMode: value => { this.#selectMode = value; }
      }
    });
    this.#engine.attach(this.#u, root);

    this.#observer?.disconnect();
    this.#observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect?.width || 0);
      if (width > 0 && this.#u) this.#u.setSize({ width: Math.max(320, width), height: CHART_HEIGHT });
    });
    this.#observer.observe(frame);

    this.#composeLegend(root, styledSpec);
    this.#composeTable(root, styledSpec, transform);
    if (this.#history) this.#applyUrlState(this.#history.state);
    this.#applyState('ready');
  }

  #buildScatter(spec, chartId) {
    const model = scatterModel({ spec, data: this.#data });
    const groups = [...new Set(model.points.map(point => point.group).filter(value => value != null))].sort();
    registry.register(groups);
    const styleFor = point => {
      const style = registry.style(point.group || point.key);
      const colour = readToken(this, style.cssVar) || style.light;
      return { ...style, colour };
    };

    const root = this.#shell(chartId, 'ready');
    const frame = root.querySelector('.yk-chart-frame');
    const tooltip = createTooltip(this.shadowRoot.ownerDocument || document);
    this.shadowRoot.querySelector(':scope > .yk-tooltip')?.remove();
    this.shadowRoot.append(tooltip.element);
    this._tooltip = tooltip;
    this._tooltipSpec = {
      ...model.spec,
      series: [
        { key: 'y', label: model.spec.y.label, unit: model.spec.y.unit || '', kind: model.spec.y.kind || 'number' },
        ...(model.spec.values || []).map(item => ({ ...item }))
      ]
    };

    const tokens = {
      surface: readToken(this, '--yk-surface') || readToken(this, '--yk-chart-surface'),
      text: readToken(this, '--yk-text'),
      muted: readToken(this, '--yk-muted'),
      grid: readToken(this, '--yk-grid'),
      border: readToken(this, '--yk-border'),
      focus: readToken(this, '--yk-focus')
    };

    this.#scatter = createCanvasScatter({
      doc: this.shadowRoot.ownerDocument,
      frame,
      spec: model.spec,
      points: model.points,
      tokens,
      styleFor,
      onHover: (point, index, position) => {
        this.#inspectedKey = point.key;
        this.#inspectedIndex = index;
        this.#setHighlight(point.key);
        this.#showScatterTooltip(point, position);
      },
      onLeave: () => tooltip.hide(),
      onInspect: (point, index) => this.#inspectScatterPoint(point, index),
      onSelection: detail => this.#onScatterSelection(detail),
      onMarkSelection: detail => this.#onSelectionIntent(detail),
      onSelectMode: value => { this.#selectMode = value; }
    });

    this.#composeScatterLegend(root, groups);
    this.#composeScatterTable(root, model);
    if (this.#history) this.#applyUrlState(this.#history.state);
    this.#applyState('ready');
  }

  #composeScatterLegend(root, groups) {
    if (groups.length < 2) return;
    const doc = this.shadowRoot.ownerDocument;
    const host = doc.createElement('div');
    host.className = 'yk-chart-legend';
    const legend = createLegend(doc, {
      series: groups.map(key => ({ key, label: key, ...registry.style(key) })),
      state: { hidden: [...this.#hidden] },
      onIntent: detail => {
        this.#legendState = detail.state;
        if (detail.type === 'focus') {
          this.#focusLegend(detail.key);
          return;
        }
        if (detail.type === 'isolate') this.#applyHidden(new Set(groups.filter(key => key !== detail.key)));
        else this.#applyHidden(new Set(detail.state.hidden || []));
        legend.update({ hidden: [...this.#hidden], isolated: detail.key });
        this.#history?.hide([...this.#hidden]);
        this.#emit('legend', { type: detail.type, key: detail.key, hidden: [...this.#hidden] });
      }
    });
    host.append(legend.element);
    root.append(host);
    this._legend = legend;
  }

  #composeScatterTable(root, model) {
    const doc = this.shadowRoot.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'yk-chart-table';
    details.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Table';
    const extra = (model.spec.values || []).map(item => ({ ...item, key: String(item.key) }));
    const tableSpec = {
      title: model.spec.title,
      x: model.spec.x,
      series: [{ key: 'y', label: model.spec.y.label, unit: model.spec.y.unit || '', kind: model.spec.y.kind || 'number' }, ...extra]
    };
    const table = createTable(doc, {
      spec: tableSpec,
      data: model.points,
      onSelect: detail => this.#onSelectionIntent(detail),
      onInspect: detail => this.#inspectScatterKey(detail.key)
    });
    details.append(summary, table.element);
    root.append(details);
    this._table = table;
  }

  #inspectScatter() {
    const info = this.#scatter.inspect();
    const spec = this.#spec || {};
    return {
      chart: this.dataset.chart || null,
      state: this.dataset.state || null,
      mode: 'absolute',
      type: 'scatter',
      stacked: false,
      bucket: spec.bucket ?? null,
      window: { from: info.xScale.min, to: info.xScale.max },
      selection: this.#scatterPredicate(),
      selectionKeys: selectedKeys(this.#selection),
      region: this.#selectionRegion,
      brush: null,
      inspectedKey: this.#inspectedKey,
      inspectedIndex: this.#inspectedIndex,
      inspectedSeries: 0,
      highlight: this.#highlight,
      selectMode: this.#selectMode,
      urlState: this.#history ? this.#history.state : null,
      series: info.groups.map(key => ({ key, label: key, visible: !this.#hidden.has(key) })),
      plot: info.plot,
      xScale: info.xScale,
      yScale: info.yScale,
      yScales: ['y'],
      dualAxis: false,
      xToPx: info.xToPx,
      yToPx: info.yToPx,
      xToData: info.xToData,
      yToData: info.yToData,
      cursor: info.cursor,
      marks: info.marks,
      sampledMarkCount: info.sampledMarkCount,
      thresholds: []
    };
  }

  #scatterPredicate() {
    const base = selectionPredicate(this.#selection);
    if (!base) return null;
    return { ...base, where: this.#selectionRegion };
  }

  #showScatterTooltip(point, position) {
    const tooltip = this._tooltip;
    if (!tooltip || !position) return;
    const model = tooltipModel({
      spec: this._tooltipSpec,
      datum: {
        key: point.key,
        label: point.key,
        values: point.values,
        sample: this.#spec?.sample,
        hidden: [...this.#hidden]
      },
      key: point.key
    });
    tooltip.show(model, { x: position.x, y: position.y });
  }

  #inspectScatterPoint(point, index) {
    if (!point) return;
    this.#inspectedKey = point.key;
    this.#inspectedIndex = index;
    this.#setHighlight(point.key);
    const rect = this.#scatter?.inspect().plot;
    if (rect) this.#showScatterTooltip(point, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    this.#emit('inspect', {
      key: point.key,
      index,
      x: point.x,
      y: point.y,
      values: point.values,
      source: 'pointer',
      open: true
    });
  }

  #inspectScatterKey(key) {
    const layout = this.#scatter?.inspect();
    const index = layout?.marks.findIndex(mark => mark.key === key) ?? -1;
    if (index >= 0) this.#inspectScatterPoint(layout.marks[index], index);
  }

  #onScatterSelection({ keys = [], data = null, additive = false, exclude = false } = {}) {
    let next = this.#selection;
    if (exclude) {
      for (const key of keys) {
        next = removeSelection(next, key);
        if (!isExcluded(next, key)) next = toggleSelection(next, key, { exclude: true });
      }
    } else if (!additive) {
      next = emptySelection();
      for (const key of keys) next = addSelection(next, key);
      this.#selectionRegion = data;
    } else {
      for (const key of keys) next = addSelection(next, key);
      this.#selectionRegion = data;
    }
    this.#selection = normaliseSelection(next);
    this.#scatter?.setSelection(this.#selection);
    this.#history?.commitSelection(selectionIsEmpty(this.#selection) ? null : this.#selection);
    this.#syncSelectionUI();
    this.#emit('select', {
      key: null,
      selected: null,
      additive: Boolean(additive),
      exclude: Boolean(exclude),
      source: 'scatter-rectangle',
      selection: this.#scatterPredicate(),
      keys: selectedKeys(this.#selection),
      region: this.#selectionRegion
    });
  }

  #shell(chartId, state) {
    const doc = this.shadowRoot.ownerDocument;
    this.shadowRoot.replaceChildren();
    const root = doc.createElement('div');
    root.className = 'yk-chart';
    root.dataset.chart = chartId;
    root.dataset.state = state;
    root.tabIndex = 0;

    const spec = this.#spec || {};
    const title = doc.createElement('p');
    title.className = 'yk-chart-title';
    title.textContent = spec.title || chartId;
    root.append(title);

    const units = spec.units || spec.series?.[0]?.unit || '';
    const basis = formatBasis(spec.timeBasis);
    const basisLine = doc.createElement('p');
    basisLine.className = 'yk-chart-basis';
    basisLine.dataset.units = units;
    basisLine.textContent = `${units ? `${units} · ` : ''}${basis}`;
    root.append(basisLine);

    if (spec.badges || spec.coverage || spec.sample || spec.resolution) {
      const badges = createBadges(doc, badgeModel({
        resolution: spec.resolution,
        sample: spec.sample,
        coverage: spec.coverage,
        badges: spec.badges
      }));
      root.append(badges.element);
    }

    const frame = doc.createElement('div');
    frame.className = 'yk-chart-frame';
    root.append(frame);

    this.dataset.chart = chartId;
    this.dataset.state = state;
    this.shadowRoot.append(root);
    return root;
  }

  #setState(state, reason, kind) {
    const chartId = this.#spec?.chart || this.id || 'chart';
    const root = this.#shell(chartId, state);
    root.querySelector('.yk-chart-frame')?.remove();
    const doc = this.shadowRoot.ownerDocument;
    const message = doc.createElement('p');
    message.className = 'yk-chart-message';
    message.dataset.kind = kind;
    message.textContent = state === 'unsupported' ? `Unsupported: ${reason}` : `Empty: ${reason}`;
    root.append(message);
    this.#applyState(state);
  }

  #applyState(state) {
    this.dataset.state = state;
    this.dataset.idle = 'true';
    const root = this.shadowRoot.querySelector('.yk-chart');
    if (root) root.dataset.state = state;
  }

  #renderMessage(state, text) {
    const root = this.#shell(this.#spec?.chart || 'chart', state);
    const doc = this.shadowRoot.ownerDocument;
    const message = doc.createElement('p');
    message.className = 'yk-chart-message';
    message.textContent = text;
    root.append(message);
    this.#applyState(state);
  }

  #composeLegend(root, spec) {
    if ((spec.series || []).length < 2) return;
    const doc = this.shadowRoot.ownerDocument;
    const host = doc.createElement('div');
    host.className = 'yk-chart-legend';
    const legend = createLegend(doc, {
      series: spec.series.map(item => ({ key: item.key, label: item.label, shape: item.shape, pattern: item.pattern, cssVar: item.cssVar })),
      state: { hidden: [...this.#hidden] },
      onIntent: detail => {
        this.#legendState = detail.state;
        if (detail.type === 'focus') {
          this.#focusLegend(detail.key);
          return;
        }
        if (detail.type === 'isolate') {
          const keys = spec.series.map(item => item.key);
          this.#applyHidden(new Set(keys.filter(key => key !== detail.key)));
          legend.update({ hidden: [...this.#hidden], isolated: detail.key });
        } else {
          this.#applyHidden(new Set(detail.state.hidden || []));
        }
        this.#history?.hide([...this.#hidden]);
        this.#emit('legend', { type: detail.type, key: detail.key, hidden: [...this.#hidden] });
      }
    });
    host.append(legend.element);
    root.append(host);
    this._legend = legend;
  }

  #applyHidden(hidden) {
    this.#hidden = new Set(hidden);
    this.#scatter?.setHidden([...this.#hidden]);
    for (const [index, item] of (this._tooltipSpec?.series || []).entries()) {
      this.#u?.setSeries(index + 1, { show: !this.#hidden.has(item.key) });
    }
  }

  #composeTable(root, spec, transform) {
    const doc = this.shadowRoot.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'yk-chart-table';
    details.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Table';
    const table = createTable(doc, {
      spec,
      data: transform.tableRows,
      onSelect: detail => this.#onSelectionIntent(detail),
      onInspect: detail => this.#inspectKey(detail.key, { source: 'table', open: true })
    });
    details.append(summary, table.element);
    root.append(details);
    renderThresholdTable(table.table, this.#thresholds);
    this._table = table;
  }

  #tooltipModel(row) {
    return tooltipModel({
      spec: this._tooltipSpec,
      datum: {
        key: row.key,
        label: `${this._tooltipSpec.x?.label || 'Time'} ${row.key}`,
        values: row.values,
        n: row.n,
        coverage: this.#spec?.coverage,
        hidden: [...this.#hidden]
      },
      key: row.key
    });
  }

  #showTooltip(index) {
    const u = this.#u;
    const tooltip = this._tooltip;
    const row = this.#transform?.rows[index];
    if (!u || !tooltip || !row) return;
    const rect = u.over.getBoundingClientRect();
    const x = rect.left + u.valToPos(row.x, 'x');
    const y = rect.top + rect.height / 2;
    tooltip.show(this.#tooltipModel(row), { x, y });
  }

  #onCursor(u, tooltip) {
    const transform = this.#transform;
    if (!transform) return;
    const index = u.cursor.idx;
    if (index == null || u.cursor.left < 0) {
      tooltip.hide();
      return;
    }
    const row = transform.rows[index];
    if (!row) return;
    this.#inspectedKey = row.key;
    this.#inspectedIndex = index;
    this.#setHighlight(row.key);
    const rect = u.over.getBoundingClientRect();
    tooltip.show(this.#tooltipModel(row), { x: rect.left + u.cursor.left, y: rect.top + u.cursor.top });
  }

  #inspectKey(key, { index = null, series = null, source = 'pointer', open = false } = {}) {
    const rows = this.#transform?.rows || [];
    const position = index ?? rows.findIndex(row => row.key === key);
    if (position < 0 || !rows[position]) return;
    const row = rows[position];
    this.#inspectedKey = row.key;
    this.#inspectedIndex = position;
    if (Number.isInteger(series)) {
      const count = Math.max(1, (this._tooltipSpec?.series || []).length);
      this.#inspectedSeries = Math.min(Math.max(series, 0), count - 1);
    }
    this.#setHighlight(row.key);
    this.#showTooltip(position);
    this.#emit('inspect', {
      key: row.key,
      index: position,
      x: row.x,
      values: row.values,
      source,
      open: Boolean(open)
    });
  }

  #setHighlight(key, { propagate = true } = {}) {
    if (key === this.#highlight) return;
    this.#highlight = key;
    for (const row of this.shadowRoot.querySelectorAll('.yk-table tbody tr')) {
      if (row.dataset.entityKey === key) row.dataset.highlighted = 'true';
      else delete row.dataset.highlighted;
    }
    this.#u?.redraw(false);
    this.#scatter?.setHighlight(key);
    if (propagate && key) {
      this.#emit('yk-highlight', { key, chart: this.#chartId() });
    }
  }

  #syncScatterSelection() {
    this.#scatter?.setSelection(this.#selection);
  }

  #onSelectionIntent(detail = {}) {
    let next;
    if (detail.clear || detail.key == null) next = emptySelection();
    else if (detail.selected === true) next = addSelection(this.#selection, detail.key);
    else if (detail.selected === false) next = removeSelection(this.#selection, detail.key);
    else next = toggleSelection(this.#selection, detail.key, { exclude: Boolean(detail.exclude) });
    this.#selection = normaliseSelection(next);
    this.#selectionRegion = null;
    this.#history?.commitSelection(selectionIsEmpty(this.#selection) ? null : this.#selection);
    this.#syncSelectionUI();
    this.#syncScatterSelection();
    this.#emit('select', {
      key: detail.key ?? null,
      selected: detail.selected ?? null,
      additive: Boolean(detail.additive),
      exclude: Boolean(detail.exclude),
      selection: selectionPredicate(this.#selection),
      keys: selectedKeys(this.#selection)
    });
  }

  #syncSelectionUI() {
    for (const row of this.shadowRoot.querySelectorAll('.yk-table tbody tr')) {
      const key = row.dataset.entityKey;
      const box = row.querySelector('input.yk-table-select');
      if (box) box.checked = isSelected(this.#selection, key);
      if (isExcluded(this.#selection, key)) row.dataset.excluded = 'true';
      else delete row.dataset.excluded;
      if (isSelected(this.#selection, key)) row.dataset.selected = 'true';
      else delete row.dataset.selected;
    }
  }

  #commitBrush(brush) {
    const next = { from: Number(brush.from), to: Number(brush.to) };
    if (!Number.isFinite(next.from) || !Number.isFinite(next.to)) return;
    this.#brush = next;
    this.#history?.commitBrush(next);
    this.#emit('brush', { aligned: true, from: next.from, to: next.to });
  }

  #clearBrush() {
    this.#brush = null;
    this.#history?.commitBrush(null);
    this.#u?.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    this.#emit('brush', { cleared: true, from: null, to: null });
  }

  #zoomTo(window) {
    const from = Number(window?.from);
    const to = Number(window?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    this.#brush = null;
    this.#history?.zoom({ from, to });
    this.#setWindow({ from, to });
    this.#u?.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
    this.#emit('zoom', { from, to });
  }

  #panTo(window) {
    const from = Number(window?.from);
    const to = Number(window?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    this.#brush = null;
    this.#history?.pan({ from, to });
    this.#setWindow({ from, to });
    this.#emit('pan', { from, to });
  }

  #focusLegend(key) {
    const filter = legendFilter(key);
    if (filter) this.#history?.filter(filter.key, [filter.value]);
    this.#emit('filter', { key, filter: filter?.key ?? null, value: filter?.value ?? null });
  }

  #focusInspected(key) {
    const rows = this.#transform?.rows || [];
    const index = rows.findIndex(row => row.key === key);
    if (index >= 0) {
      const row = rows[index];
      const next = rows[index + 1]?.x;
      const previous = rows[index - 1]?.x;
      const from = next === undefined ? (previous ?? row.x) : row.x;
      const to = next === undefined ? row.x : next;
      if (to > from) {
        this.#brush = null;
        this.#history?.zoom({ from, to });
        this.#setWindow({ from, to });
        this.#u?.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        this.#emit('filter', { key, filter: 'bucket', value: `${from}..${to}` });
        return;
      }
    }
    this.#focusLegend(key);
  }

  #setWindow(window) {
    if (!this.#u) return;
    const min = Number(window?.from);
    const max = Number(window?.to);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) this.#u.setScale('x', { min, max });
  }

  #resetWindow() {
    if (!this.#u || !this.#baseWindow) return;
    const { min, max } = this.#baseWindow;
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) this.#u.setScale('x', { min, max });
  }

  #applyUrlState(state) {
    if (!state) return;
    this.#brush = this.#scatter ? null : decodeBrush(state.sel);
    this.#selection = decodeSelection(state.pick);
    this.#selectionRegion = null;
    this.#hidden = new Set(state.hide || []);
    this.#scatter?.setHidden([...this.#hidden]);
    for (const [index, item] of (this._tooltipSpec?.series || []).entries()) {
      this.#u?.setSeries(index + 1, { show: !this.#hidden.has(item.key) });
    }
    this._legend?.update({ hidden: [...this.#hidden] });
    if (state.from && state.to) this.#setWindow({ from: Number(state.from), to: Number(state.to) });
    else this.#resetWindow();
    this.#syncSelectionUI();
    this.#syncScatterSelection();
    this.#u?.redraw(false);
  }
}

const LEGEND_FILTERS = {
  model: 'model',
  harness: 'harness',
  repo: 'repo_id',
  kind: 'kind',
  plan: 'plan',
  tool: 'tool',
  source: 'source',
  event: 'event',
  conversation: 'conversation_id'
};

export function legendFilter(key) {
  const text = String(key || '');
  const at = text.indexOf(':');
  if (at <= 0) return null;
  const namespace = text.slice(0, at);
  const value = text.slice(at + 1);
  const filter = LEGEND_FILTERS[namespace];
  return filter ? { key: filter, value } : null;
}

export function defineChart(tag = TAG) {
  if (typeof customElements === 'undefined') return null;
  const existing = customElements.get(tag);
  if (existing) return existing;
  customElements.define(tag, YkChart);
  return YkChart;
}

defineChart();
