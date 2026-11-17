// Shared foundation for the Phase 8 first-party SVG elements. It owns the
// common lifecycle, the ready shell (title, basis, badges, legend, plot, table),
// the Boolean entity selection, the tooltip/highlight linking and the
// `inspect()` testability surface. Subclasses supply the model and geometry.
// It reads colours from CSS custom properties, so a theme change re-reads them.

import { ColourRegistry } from './colour-registry.js';
import { badgeModel, createBadges } from './badges.js';
import { formatBasis } from './formatters.js';
import { createLegend } from './legend.js';
import { createTable } from './table.js';
import { createTooltip, tooltipModel } from './tooltip.js';
import { adoptChartStyles, readTheme, readToken, watchTheme } from './styles.js';
import {
  addSelection, emptySelection, isExcluded, isSelected, normaliseSelection,
  removeSelection, selectedKeys, selectionIsEmpty, selectionPredicate, toggleSelection
} from './selection.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const DEFAULT_HEIGHT = 260;
export const MIN_TOUCH_PX = 44;

const registry = new ColourRegistry();

const LENS_FILTERS = {
  model: 'model',
  harness: 'harness',
  repo: 'repo_id',
  kind: 'kind',
  plan: 'plan',
  tool: 'tool_kind',
  scorer: 'scorer',
  stage: 'stage',
  cohort: 'cohort',
  source: 'source',
  event: 'event',
  conversation: 'conversation_id'
};

export function lensFilter(key) {
  const text = String(key || '');
  const at = text.indexOf(':');
  if (at <= 0) return null;
  return LENS_FILTERS[text.slice(0, at)] ? { key: LENS_FILTERS[text.slice(0, at)], value: text.slice(at + 1) } : null;
}

export function reasonText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.reason || value.message || JSON.stringify(value);
}

export function svgNode(doc, name, attrs = {}) {
  const element = doc.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    element.setAttribute(key, String(value));
  }
  return element;
}

export function textNode(doc, text, attrs = {}) {
  const element = svgNode(doc, 'text', attrs);
  element.textContent = text;
  return element;
}

const PATTERN_IDS = ['diagonal', 'vertical', 'horizontal', 'crosshatch', 'dots', 'dashes', 'grid'];

export function patternId(name) {
  return name && name !== 'hollow' && PATTERN_IDS.includes(name) ? `yk-pattern-${name}` : null;
}

export function ensurePatternDefs(svg, doc, ink = 'rgba(0, 0, 0, 0.32)') {
  if (svg.querySelector('[data-yk-pattern-defs]')) return;
  const defs = svgNode(doc, 'defs', { 'data-yk-pattern-defs': 'true' });
  const line = (d, extra = {}) => svgNode(doc, 'path', { d, stroke: ink, 'stroke-width': 1, fill: 'none', ...extra });
  const paths = {
    diagonal: () => [line('M0,6 L6,0')],
    vertical: () => [line('M3,0 L3,6')],
    horizontal: () => [line('M0,3 L6,3')],
    crosshatch: () => [line('M0,6 L6,0'), line('M0,0 L6,6')],
    dots: () => [svgNode(doc, 'circle', { cx: 3, cy: 3, r: 1, fill: ink })],
    dashes: () => [line('M0,3 L4,3')],
    grid: () => [line('M3,0 L3,6'), line('M0,3 L6,3')]
  };
  for (const name of PATTERN_IDS) {
    const pattern = svgNode(doc, 'pattern', { id: patternId(name), width: 6, height: 6, patternUnits: 'userSpaceOnUse' });
    pattern.append(...paths[name]());
    defs.append(pattern);
  }
  svg.prepend(defs);
}

const SHAPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star', 'cross', 'ring'];

export function createShape(doc, shape = 'circle', { x = 0, y = 0, size = 8, fill = 'currentColor' } = {}) {
  const s = SHAPES.includes(shape) ? shape : 'circle';
  const r = size / 2;
  if (s === 'circle') return svgNode(doc, 'circle', { cx: x, cy: y, r, fill });
  if (s === 'ring') return svgNode(doc, 'circle', { cx: x, cy: y, r, fill: 'none', stroke: fill, 'stroke-width': 2 });
  if (s === 'square') return svgNode(doc, 'rect', { x: x - r, y: y - r, width: size, height: size, fill });
  if (s === 'diamond') return svgNode(doc, 'polygon', { points: `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`, fill });
  if (s === 'triangle') return svgNode(doc, 'polygon', { points: `${x},${y - r} ${x + r},${y + r} ${x - r},${y + r}`, fill });
  if (s === 'hexagon') {
    const points = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 3) * i - Math.PI / 2;
      points.push(`${x + r * Math.cos(angle)},${y + r * Math.sin(angle)}`);
    }
    return svgNode(doc, 'polygon', { points: points.join(' '), fill });
  }
  if (s === 'star') {
    const points = [];
    for (let i = 0; i < 10; i += 1) {
      const radius = i % 2 === 0 ? r : r / 2.3;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      points.push(`${x + radius * Math.cos(angle)},${y + radius * Math.sin(angle)}`);
    }
    return svgNode(doc, 'polygon', { points: points.join(' '), fill });
  }
  const q = r * 0.35;
  return svgNode(doc, 'polygon', {
    points: `${x - q},${y - r} ${x + q},${y - r} ${x + q},${y - q} ${x + r},${y - q} ${x + r},${y + q} ${x + q},${y + q} ${x + q},${y + r} ${x - q},${y + r} ${x - q},${y + q} ${x - r},${y + q} ${x - r},${y - q} ${x - q},${y - q}`,
    fill
  });
}

let baseStyles = null;

function baseSheet() {
  if (typeof CSSStyleSheet === 'undefined') return null;
  if (!baseStyles) {
    baseStyles = new CSSStyleSheet();
    baseStyles.replaceSync(`
      :host { display: block; min-width: 0; }
      .yk-svg-frame { position: relative; }
      .yk-svg-plot { display: block; max-width: 100%; }
      .yk-mark { cursor: pointer; }
      .yk-mark-hit { fill: transparent; pointer-events: all; }
      .yk-mark:focus-visible { outline: 2px solid var(--yk-chart-focus); outline-offset: 2px; }
      .yk-table tbody tr[data-selected='true'] { background: color-mix(in srgb, var(--yk-chart-focus) 12%, transparent); }
      .yk-table tbody tr[data-excluded='true'] { opacity: 0.6; text-decoration: line-through; }
      .yk-table tbody tr[data-highlighted='true'] { outline: 1px dashed var(--yk-chart-focus); outline-offset: -1px; }
      input.yk-table-select { min-width: 44px; min-height: 44px; }
    `);
  }
  return baseStyles;
}

export class SvgChartElement extends (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) {
  #spec = null;
  #data = [];
  #hidden = new Set();
  #selection = emptySelection();
  #pending = Promise.resolve();
  #token = 0;
  #model = null;
  #geometry = null;
  #marks = [];
  #styledSpec = null;
  #styledSeries = [];
  #cursor = null;
  #inspectedKey = null;
  #inspectedIndex = 0;
  #highlight = null;
  #legend = null;
  #tooltip = null;
  #stopTheme = null;
  #observer = null;
  #highlightHandler = null;
  #lastWidth = 0;
  #brush = null;
  #pendingCohort = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  // Subclass seams. A subclass supplies its model and its geometry.
  buildModel(/* { spec, data } */) {
    return { state: 'ready', rows: [], series: [], tableRows: [] };
  }

  renderPlot(/* { svg, doc, model, spec, plot, margin, styleFor, hidden } */) {
    return { marks: [] };
  }

  chartType(spec) {
    return spec?.chart || this.localName || 'svg';
  }

  supportsBrush() {
    return false;
  }

  get spec() { return this.#spec; }
  set spec(value) {
    this.#spec = value || null;
    this.#hidden = new Set();
    this.#selection = emptySelection();
    this.#inspectedKey = null;
    this.#inspectedIndex = 0;
    this.#cursor = null;
    this.#schedule();
  }

  get data() { return this.#data; }
  set data(value) {
    this.#data = Array.isArray(value) ? value : [];
    this.#schedule();
  }

  connectedCallback() {
    this.#stopTheme = watchTheme(() => this.#schedule());
    if (!this.#highlightHandler) {
      this.#highlightHandler = event => {
        const detail = event.detail || {};
        if (!detail.key || detail.chart === this.dataset.chart) return;
        if (!(this.#model?.rows || []).some(row => row.key === detail.key)) return;
        this.#setHighlight(detail.key, { propagate: false });
      };
      (this.ownerDocument || document).addEventListener('yk-highlight', this.#highlightHandler);
    }
    if (!this.#observer && typeof ResizeObserver !== 'undefined') {
      this.#observer = new ResizeObserver(() => {
        const width = Math.max(280, Math.round(this.clientWidth || 0));
        if (this.#lastWidth && Math.abs(width - this.#lastWidth) <= 1) return;
        this.#schedule();
      });
      this.#observer.observe(this);
    }
    this.#schedule();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#stopTheme?.();
    this.#stopTheme = null;
    if (this.#highlightHandler) {
      (this.ownerDocument || document).removeEventListener('yk-highlight', this.#highlightHandler);
      this.#highlightHandler = null;
    }
  }

  whenSettled() {
    return this.#pending;
  }

  // Subclasses with a continuous time axis call this; a categorical subclass
  // leaves `supportsBrush()` false and never emits `brush`.
  setBrush(value) {
    return this.#setBrush(value);
  }

  #schedule() {
    if (!this.isConnected) return this.#pending;
    this.#pending = this.#render();
    return this.#pending;
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail }));
  }

  #setBrush(value) {
    if (!this.supportsBrush()) return null;
    this.#brush = value;
    this.#emit('brush', value);
    return value;
  }

  async #render() {
    const token = ++this.#token;
    const doc = this.shadowRoot.ownerDocument;
    this.dataset.state = 'loading';
    try {
      await adoptChartStyles(this.shadowRoot);
      const sheet = baseSheet();
      if (sheet && !this.shadowRoot.adoptedStyleSheets.includes(sheet)) {
        this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, sheet];
      }
    } catch (error) {
      if (token !== this.#token) return;
      this.#message('error', `chart stylesheet failed: ${error.message}`);
      return;
    }
    if (token !== this.#token || !this.isConnected) return;

    const spec = this.#spec || {};
    const chartId = this.chartType(spec);
    this.dataset.chart = chartId;
    this.#tooltip?.hide();

    if (spec.unsupported) return this.#message('unsupported', reasonText(spec.unsupported));
    if (!Array.isArray(this.#data) || this.#data.length === 0) {
      return this.#message('empty', reasonText(spec.empty) || 'no rows in the current window');
    }

    let model;
    try {
      model = this.buildModel({ spec, data: this.#data }) || {};
    } catch (error) {
      return this.#message('error', error.message);
    }
    if (model.state === 'unsupported') return this.#message('unsupported', reasonText(model.reason || model.unsupported));
    if (model.state === 'error') return this.#message('error', reasonText(model.reason));
    if (model.state === 'empty' || !(model.rows || []).length) {
      return this.#message('empty', reasonText(model.reason || spec.empty) || 'no rows in the current window');
    }

    this.#model = model;
    const styleFor = key => {
      const style = registry.style(key);
      return { ...style, colour: readToken(this, style.cssVar) || style.light };
    };
    registry.register([...(model.entityKeys || model.rows.map(row => row.key)), ...(model.series || []).map(item => item.key)]);
    const series = (model.series || []).map(item => {
      const style = styleFor(item.key);
      return { ...style, ...item, label: item.label ?? style.label, cssVar: style.cssVar, shape: item.shape ?? style.shape, pattern: item.pattern ?? style.pattern, colour: style.colour, hidden: this.#hidden.has(item.key) };
    });
    const styledSpec = { ...spec, ...(model.spec || {}), series, x: model.x || spec.x || { label: 'Category', kind: 'text' } };
    this.#styledSpec = styledSpec;
    this.#styledSeries = series;

    const root = this.#shell(chartId, styledSpec, 'ready');
    const frame = root.querySelector('.yk-chart-frame');
    const doc2 = this.shadowRoot.ownerDocument;
    const width = Math.max(280, Math.round(frame.clientWidth || this.clientWidth || 640));
    const height = Math.max(120, Math.round(model.height || spec.height || DEFAULT_HEIGHT));
    const margin = { left: spec.margin?.left ?? 64, right: spec.margin?.right ?? 16, top: spec.margin?.top ?? 16, bottom: spec.margin?.bottom ?? 36 };
    const plot = {
      left: margin.left,
      top: margin.top,
      width: Math.max(1, width - margin.left - margin.right),
      height: Math.max(1, height - margin.top - margin.bottom)
    };
    const svg = svgNode(doc2, 'svg', {
      class: 'yk-svg-plot',
      role: 'img',
      'aria-label': spec.title || chartId,
      viewBox: `0 0 ${width} ${height}`,
      width: String(width),
      height: String(height)
    });
    frame.append(svg);
    ensurePatternDefs(svg, doc2, readToken(this, '--yk-pattern-ink') || 'rgba(0, 0, 0, 0.32)');

    const geometry = this.renderPlot({ svg, doc: doc2, model, spec: styledSpec, plot, margin, styleFor, hidden: new Set(this.#hidden) }) || {};
    const rect = svg.getBoundingClientRect();
    const clientPlot = {
      left: rect.left + margin.left,
      top: rect.top + margin.top,
      width: plot.width,
      height: plot.height
    };
    this.#geometry = { ...geometry, plot, clientPlot, margin };
    this.#marks = (geometry.marks || []).map(mark => ({ ...mark }));
    this.#lastWidth = Math.max(280, Math.round(this.clientWidth || width));

    const tooltip = createTooltip(doc2);
    this.shadowRoot.querySelector(':scope > .yk-tooltip')?.remove();
    this.shadowRoot.append(tooltip.element);
    this.#tooltip = tooltip;

    this.#wireMarks();
    this.#composeLegend(root, styledSpec);
    this.#composeTable(root, styledSpec, model);
    this.#applySelectionUI();
    if (this.#highlight) this.#applyHighlightUI();
    this.#applyState('ready');
    this.dataset.theme = readTheme(doc2);
  }

  #shell(chartId, spec, state) {
    const doc = this.shadowRoot.ownerDocument;
    this.shadowRoot.replaceChildren();
    const root = doc.createElement('div');
    root.className = 'yk-chart';
    root.dataset.chart = chartId;
    root.dataset.state = state;
    root.tabIndex = 0;
    root.addEventListener('keydown', event => this.#onKeyDown(event));

    const title = doc.createElement('p');
    title.className = 'yk-chart-title';
    title.textContent = spec.title || chartId;
    root.append(title);

    const units = spec.units || spec.series?.[0]?.unit || '';
    const basis = spec.timeBasis || spec.basis ? formatBasis(spec.timeBasis || spec.basis) : 'categorical; no time axis';
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
    frame.className = 'yk-chart-frame yk-svg-frame';
    root.append(frame);

    this.dataset.chart = chartId;
    this.dataset.state = state;
    this.shadowRoot.append(root);
    return root;
  }

  #applyState(state) {
    this.dataset.state = state;
    const root = this.shadowRoot.querySelector('.yk-chart');
    if (root) root.dataset.state = state;
  }

  #message(state, reason) {
    const spec = this.#spec || {};
    const root = this.#shell(this.chartType(spec), spec, state);
    root.querySelector('.yk-chart-frame')?.remove();
    const doc = this.shadowRoot.ownerDocument;
    const message = doc.createElement('p');
    message.className = 'yk-chart-message';
    message.dataset.kind = state;
    message.textContent = state === 'unsupported' ? `Unsupported: ${reason}` : state === 'error' ? `Error: ${reason}` : `Empty: ${reason}`;
    root.append(message);
    this.#model = null;
    this.#marks = [];
    this.#geometry = null;
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
        if (detail.type === 'focus') {
          const filter = lensFilter(detail.key);
          this.#emit('filter', { key: detail.key, filter: filter?.key ?? null, value: filter?.value ?? null });
          this.#emit('legend', { type: detail.type, key: detail.key, hidden: [...this.#hidden] });
          return;
        }
        if (detail.type === 'isolate') {
          this.#hidden = new Set(spec.series.map(item => item.key).filter(key => key !== detail.key));
        } else {
          this.#hidden = new Set(detail.state.hidden || []);
        }
        this.#emit('legend', { type: detail.type, key: detail.key, hidden: [...this.#hidden] });
        this.#schedule();
      }
    });
    host.append(legend.element);
    root.append(host);
    this.#legend = legend;
  }

  #composeTable(root, spec, model) {
    const doc = this.shadowRoot.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'yk-chart-table';
    details.open = true;
    const summary = doc.createElement('summary');
    summary.textContent = 'Table';
    const tableSpec = { ...spec, series: model.tableSeries || spec.series, x: model.x || spec.x };
    const table = createTable(doc, {
      spec: tableSpec,
      data: model.tableRows || [],
      onSelect: detail => this.#onSelectionIntent(detail),
      onInspect: detail => this.#inspectKey(detail.key, { source: 'table', open: true })
    });
    details.append(summary, table.element);
    root.append(details);
    this._table = table;
  }

  #wireMarks() {
    for (const [index, mark] of this.#marks.entries()) {
      const element = mark.element;
      if (!element) continue;
      element.dataset.mark = String(index);
      element.dataset.entityKey = String(mark.key);
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', mark.label || String(mark.key));
      element.addEventListener('pointerenter', event => this.#hoverMark(mark, event.clientX, event.clientY));
      element.addEventListener('pointermove', event => this.#hoverMark(mark, event.clientX, event.clientY));
      element.addEventListener('pointerleave', () => this.#leaveMark());
      element.addEventListener('focus', () => this.#focusMark(mark));
      element.addEventListener('blur', () => this.#leaveMark());
      element.addEventListener('click', event => this.#clickMark(mark, event));
    }
  }

  #markForRow(index) {
    return this.#marks.find(mark => mark.index === index) || null;
  }

  #pointFor(mark) {
    const plot = this.#geometry?.clientPlot;
    if (!plot) return { x: 0, y: 0 };
    return { x: plot.left + mark.px, y: plot.top + mark.py };
  }

  #hoverMark(mark, x, y) {
    this.#inspectedKey = mark.key;
    this.#inspectedIndex = mark.index;
    this.#cursor = { key: mark.key, index: mark.index, px: mark.px, py: mark.py, left: mark.px, top: mark.py, values: mark.values };
    this.#setHighlight(mark.key);
    this.#showTooltip(mark, x, y);
  }

  #focusMark(mark) {
    const point = this.#pointFor(mark);
    this.#hoverMark(mark, point.x, point.y);
  }

  #leaveMark() {
    this.#tooltip?.hide();
    this.#cursor = null;
    const focused = this.shadowRoot.activeElement;
    if (!focused || !focused.closest?.('[data-mark]')) this.#setHighlight(null);
  }

  #showTooltip(mark, x, y) {
    const row = this.#model?.rows?.[mark.index] || {};
    const label = row.label || String(mark.key);
    const model = tooltipModel({
      spec: this.#styledSpec,
      datum: {
        key: mark.key,
        label: `${this.#styledSpec?.x?.label || 'Entity'} ${label}`,
        values: row.values || mark.values || {},
        n: row.n,
        coverage: row.coverage || this.#spec?.coverage
      },
      key: mark.key
    });
    this.#tooltip?.show(model, { x, y });
  }

  #clickMark(mark, event) {
    if (event.altKey) {
      this.#onSelectionIntent({ key: mark.key, exclude: true, additive: true });
      return;
    }
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      this.#onSelectionIntent({ key: mark.key, additive: true });
      return;
    }
    this.#inspectKey(mark.key, { index: mark.index, source: 'pointer', open: false });
  }

  #inspectKey(key, { index = null, source = 'pointer', open = false } = {}) {
    const rows = this.#model?.rows || [];
    const position = index ?? rows.findIndex(row => row.key === key);
    if (position < 0 || !rows[position]) return;
    const mark = this.#markForRow(position);
    if (!mark) return;
    this.#inspectedKey = key;
    this.#inspectedIndex = position;
    this.#cursor = { key, index: position, px: mark.px, py: mark.py, left: mark.px, top: mark.py, values: mark.values };
    this.#setHighlight(key);
    const point = this.#pointFor(mark);
    this.#showTooltip(mark, point.x, point.y);
    this.#emit('inspect', { key, index: position, x: mark.x, y: mark.y, values: mark.values, source, open: Boolean(open) });
  }

  #setHighlight(key, { propagate = true } = {}) {
    if (key === this.#highlight) return;
    this.#highlight = key;
    this.#applyHighlightUI();
    if (propagate && key) this.#emit('yk-highlight', { key, chart: this.dataset.chart });
  }

  #applyHighlightUI() {
    for (const mark of this.#marks) {
      if (!mark.element) continue;
      if (mark.key === this.#highlight) mark.element.dataset.highlight = 'true';
      else delete mark.element.dataset.highlight;
    }
    for (const row of this.shadowRoot.querySelectorAll('.yk-table tbody tr')) {
      if (row.dataset.entityKey === this.#highlight) row.dataset.highlighted = 'true';
      else delete row.dataset.highlighted;
    }
  }

  #onSelectionIntent(detail = {}) {
    let next;
    if (detail.clear || detail.key == null) next = emptySelection();
    else if (detail.selected === true) next = addSelection(this.#selection, detail.key);
    else if (detail.selected === false) next = removeSelection(this.#selection, detail.key);
    else next = toggleSelection(this.#selection, detail.key, { exclude: Boolean(detail.exclude) });
    this.#selection = normaliseSelection(next);
    this.#applySelectionUI();
    this.#emit('select', {
      key: detail.key ?? null,
      selected: detail.selected ?? null,
      additive: Boolean(detail.additive),
      exclude: Boolean(detail.exclude),
      selection: selectionPredicate(this.#selection),
      keys: selectedKeys(this.#selection)
    });
  }

  #applySelectionUI() {
    for (const mark of this.#marks) {
      if (!mark.element) continue;
      if (isSelected(this.#selection, mark.key)) mark.element.dataset.selected = 'true';
      else delete mark.element.dataset.selected;
      if (isExcluded(this.#selection, mark.key)) mark.element.dataset.excluded = 'true';
      else delete mark.element.dataset.excluded;
    }
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

  #onKeyDown(event) {
    if (!this.#model) return;
    const rows = this.#model.rows || [];
    if (!rows.length) return;
    let index = Math.max(0, Math.min(rows.length - 1, this.#inspectedIndex ?? 0));
    const row = rows[index];
    const key = row.key;

    if (this.#pendingCohort && /^[a-dA-D]$/.test(event.key)) {
      this.#pendingCohort = false;
      this.#emit('cohort', { slot: event.key.toLowerCase(), key, selection: selectionPredicate(this.#selection) });
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        index = Math.min(rows.length - 1, index + 1);
        this.#navigate(index);
        event.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        index = Math.max(0, index - 1);
        this.#navigate(index);
        event.preventDefault();
        break;
      case 'Enter':
        this.#inspectKey(key, { index, source: 'keyboard', open: false });
        event.preventDefault();
        break;
      case ' ':
      case 'Spacebar':
        this.#onSelectionIntent({ key, selected: null });
        event.preventDefault();
        break;
      case 'o':
      case 'O':
        this.#emit('open', { key, selection: selectionPredicate(this.#selection) });
        event.preventDefault();
        break;
      case 'f':
      case 'F': {
        const filter = lensFilter(key);
        this.#emit('filter', { key, filter: filter?.key ?? null, value: filter?.value ?? null });
        event.preventDefault();
        break;
      }
      case 'x':
      case 'X':
        this.#onSelectionIntent({ key, exclude: true });
        event.preventDefault();
        break;
      case 'c':
      case 'C':
        this.#pendingCohort = true;
        event.preventDefault();
        break;
      case 'Escape':
        if (!selectionIsEmpty(this.#selection)) this.#onSelectionIntent({ clear: true });
        else if (this.#brush) this.#setBrush(null);
        event.preventDefault();
        break;
      default:
        this.#pendingCohort = false;
        break;
    }
  }

  #navigate(index) {
    const mark = this.#markForRow(index);
    if (!mark) return;
    this.#inspectedKey = mark.key;
    this.#inspectedIndex = index;
    mark.element?.focus?.({ preventScroll: true });
  }

  inspect() {
    const model = this.#model;
    const geometry = this.#geometry;
    const plot = geometry?.clientPlot || { left: 0, top: 0, width: 0, height: 0 };
    const marks = this.#marks.map(mark => ({
      key: mark.key,
      index: mark.index,
      x: mark.x,
      y: mark.y,
      values: mark.values,
      px: mark.px,
      py: mark.py,
      style: { cssVar: mark.style?.cssVar ?? null, shape: mark.style?.shape ?? null, pattern: mark.style?.pattern ?? null }
    }));
    return {
      chart: this.dataset.chart || null,
      state: this.dataset.state || null,
      type: this.#spec?.type ?? null,
      bucket: this.#spec?.bucket ?? this.#spec?.resolution ?? null,
      window: model?.window ?? null,
      selection: selectionPredicate(this.#selection),
      selectionKeys: selectedKeys(this.#selection),
      brush: this.supportsBrush() ? (this.#brush ? { ...this.#brush } : null) : null,
      inspectedKey: this.#inspectedKey,
      inspectedIndex: this.#inspectedIndex,
      highlight: this.#highlight,
      categories: model?.rows?.map(row => row.key) || [],
      series: this.#styledSeries.map(item => ({ key: item.key, label: item.label, visible: !this.#hidden.has(item.key) })),
      plot,
      xScale: geometry?.xScale ?? null,
      yScale: geometry?.yScale ?? null,
      xToPx: geometry?.xToPx || (() => 0),
      yToPx: geometry?.yToPx || (() => 0),
      xToData: geometry?.xToData || (() => null),
      yToData: geometry?.yToData || (() => null),
      cursor: this.#cursor ? { ...this.#cursor } : null,
      marks
    };
  }
}

export function defineSvgChart(tag, Class) {
  if (typeof customElements === 'undefined') return null;
  const existing = customElements.get(tag);
  if (existing) return existing;
  customElements.define(tag, Class);
  return Class;
}
