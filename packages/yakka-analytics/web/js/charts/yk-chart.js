// <yk-chart> — the one uPlot-backed time-series element. It composes the 7-01
// foundations (colour registry, formatters, tooltip, legend, badges, table,
// cached stylesheet) with the mode transforms, scales and thresholds here.
// The element owns no gesture grammar beyond uPlot's primitive select/brush
// events; 7-03 composes those.

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
  buildScales, scaleGroupKey, scaleRange, xIsNumeric, xPxToData, xToPx, yPxToData, yToPx
} from './scales.js';
import { createThresholdPlugin, renderThresholdTable, thresholdModel } from './thresholds.js';

const TAG = 'yk-chart';
export const CHART_HEIGHT = 240;
const registry = new ColourRegistry();
const hostStyles = typeof CSSStyleSheet === 'undefined' ? null : new CSSStyleSheet();
if (hostStyles) hostStyles.replaceSync(':host { display: block; min-width: 0; }');

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
  #selection = null;
  #thresholds = [];
  #observer = null;
  #stopTheme = null;

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
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#u?.destroy();
    this.#u = null;
    this.#stopTheme?.();
    this.#stopTheme = null;
  }

  whenSettled() {
    return this.#pending;
  }

  inspect() {
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
      selection: this.#selection ? { ...this.#selection } : null,
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
    this.#u?.destroy();
    this.#u = null;
    this.#transform = null;
    this.#thresholds = [];
    this.#selection = null;

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

    const transform = transformSeriesData({ spec, data: this.#data });
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
    this.shadowRoot.append(tooltip.element);

    const group = scaleGroupKey(styledSpec);
    const zeroBased = transform.type === 'columns';
    const scales = buildScales(styledSpec, { zeroBased });
    const plotRows = transform.rows.map(row => row.values);
    const xs = transform.rows.map(row => row.x);
    const data = [xs, ...seriesStyles.map(item => plotRows.map(values => values[item.key] ?? null))];

    const hidden = new Set(this.#hidden);
    const seriesOpts = [
      { label: styledSpec.x?.label || 'Time' },
      ...seriesStyles.map(item => {
        const base = {
          key: item.key,
          label: item.label,
          stroke: item.colour,
          width: 2,
          spanGaps: false,
          show: !hidden.has(item.key),
          points: { show: false }
        };
        if (transform.type === 'area') {
          base.fill = withAlpha(item.colour, 0.18);
        }
        if (transform.type === 'columns') {
          base.fill = item.colour;
          base.width = 0;
          base.paths = uPlot.paths.bars({ size: [0.72, Infinity, 1] });
          base.points = { show: false };
        }
        return base;
      })
    ];

    const axisStroke = readToken(this, '--yk-chart-muted');
    const gridStroke = readToken(this, '--yk-chart-grid');
    const units = styledSpec.units || seriesStyles[0]?.unit || '';

    const opts = {
      width: Math.max(320, frame.clientWidth || 640),
      height: CHART_HEIGHT,
      padding: [12, 12, 0, 0],
      legend: { show: false },
      cursor: {
        points: { show: false },
        drag: { x: true, y: false, setScale: false, uni: 12 },
        ...(group ? { sync: { key: group, scales: ['x', null] } } : {})
      },
      scales,
      series: seriesOpts,
      bands: transform.bands,
      axes: [
        { stroke: axisStroke, grid: { stroke: gridStroke }, ticks: { stroke: gridStroke }, labelFont: '12px system-ui, sans-serif' },
        { stroke: axisStroke, grid: { stroke: gridStroke }, ticks: { stroke: gridStroke }, label: units, labelFont: '12px system-ui, sans-serif' }
      ],
      plugins: this.#thresholds.length > 0 ? [createThresholdPlugin(this.#thresholds, { host: this })] : [],
      hooks: {
        setCursor: [u => this.#onCursor(u, tooltip)],
        setSelect: [u => this.#onSelect(u)]
      }
    };

    this.#u = new uPlot(opts, data, frame);
    this._tooltipSpec = styledSpec;
    this._tooltip = tooltip;

    this.#u.over.addEventListener('click', event => this.#onClick(event));

    this.#observer?.disconnect();
    this.#observer = new ResizeObserver(entries => {
      const width = Math.round(entries[0]?.contentRect?.width || 0);
      if (width > 0 && this.#u) this.#u.setSize({ width: Math.max(320, width), height: CHART_HEIGHT });
    });
    this.#observer.observe(frame);

    this.#composeLegend(root, styledSpec);
    this.#composeTable(root, styledSpec, transform);
    this.#applyState('ready');
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
        this.#hidden = new Set(detail.state.hidden || []);
        for (const [index, item] of spec.series.entries()) {
          this.#u?.setSeries(index + 1, { show: !this.#hidden.has(item.key) });
        }
      }
    });
    host.append(legend.element);
    root.append(host);
    this._legend = legend;
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
      onSelect: detail => this.#emit('select', detail),
      onInspect: detail => this.#emit('inspect', detail)
    });
    details.append(summary, table.element);
    root.append(details);
    renderThresholdTable(table.table, this.#thresholds);
    this._table = table;
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
    const model = tooltipModel({
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
    const rect = u.over.getBoundingClientRect();
    tooltip.show(model, { x: rect.left + u.cursor.left, y: rect.top + u.cursor.top });
  }

  #onSelect(u) {
    if (!u.select) return;
    if (u.select.width > 0) {
      const from = u.posToVal(u.select.left, 'x');
      const to = u.posToVal(u.select.left + u.select.width, 'x');
      this.#selection = { from: Math.min(from, to), to: Math.max(from, to) };
      this.#emit('brush', { aligned: true, ...this.#selection });
    } else if (this.#selection) {
      this.#selection = null;
      this.#emit('brush', { cleared: true, from: null, to: null });
    }
  }

  #onClick(event) {
    const u = this.#u;
    if (!u || u.cursor.idx == null) return;
    const row = this.#transform?.rows[u.cursor.idx];
    if (!row) return;
    const detail = {
      key: row.key,
      index: u.cursor.idx,
      x: row.x,
      values: row.values,
      additive: Boolean(event.shiftKey || event.ctrlKey || event.metaKey),
      exclude: Boolean(event.altKey)
    };
    this.#emit('select', detail);
    this.#emit('inspect', detail);
  }
}

export function defineChart(tag = TAG) {
  if (typeof customElements === 'undefined') return null;
  const existing = customElements.get(tag);
  if (existing) return existing;
  customElements.define(tag, YkChart);
  return YkChart;
}

defineChart();
