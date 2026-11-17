// Tooltip contract. The tooltip names every visible series with its unit,
// n and coverage flags, and carries the entity key under the cursor so tests
// (and the linking code) can read it without a test-only branch.

import { formatNumber, formatValue, NULL_TEXT } from './formatters.js';
import { coverageFlags } from './badges.js';

export function tooltipModel({ spec = {}, datum = {}, key = null } = {}) {
  const visible = (spec.series || []).filter(series => !series.hidden && !(datum.hidden || []).includes(series.key));
  const rowValues = datum.values || {};
  const counts = datum.n || {};
  const flags = coverageFlags(datum.coverage || spec.coverage || {});
  const rows = visible.map(series => ({
    key: series.key,
    label: series.label || series.key,
    value: formatValue(rowValues[series.key], { kind: series.kind || 'number', unit: series.unit, ...series.format }),
    unit: series.unit || '',
    shape: series.shape || 'circle',
    cssVar: series.cssVar || null,
    n: counts[series.key] ?? datum.n ?? null,
    flags: series.flags ? coverageFlags(series.flags) : flags
  }));
  return {
    key: key ?? datum.key ?? null,
    title: datum.label || spec.title || key || '',
    rows,
    flags,
    sample: datum.sample || spec.sample || null
  };
}

export class ChartTooltip {
  constructor(doc = globalThis.document) {
    this.doc = doc;
    this.element = doc.createElement('div');
    this.element.className = 'yk-tooltip';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.element.hidden = true;
  }

  render(model) {
    const doc = this.doc;
    this.element.replaceChildren();
    if (model.key !== null && model.key !== undefined) this.element.dataset.entityKey = String(model.key);
    else delete this.element.dataset.entityKey;
    if (model.title) {
      const title = doc.createElement('p');
      title.className = 'yk-tooltip-title';
      title.textContent = model.title;
      this.element.append(title);
    }
    const list = doc.createElement('ul');
    list.className = 'yk-tooltip-series';
    for (const row of model.rows) {
      const item = doc.createElement('li');
      item.className = 'yk-tooltip-row';
      item.dataset.key = row.key;
      const swatch = doc.createElement('span');
      swatch.className = 'yk-tooltip-swatch';
      swatch.dataset.shape = row.shape;
      if (row.cssVar) swatch.style.setProperty('--yk-swatch', `var(${row.cssVar})`);
      const label = doc.createElement('span');
      label.className = 'yk-tooltip-label';
      label.textContent = row.label;
      const value = doc.createElement('span');
      value.className = 'yk-tooltip-value';
      value.textContent = `${row.value}${row.unit ? ` ${row.unit}` : ''}`;
      const n = doc.createElement('span');
      n.className = 'yk-tooltip-n';
      n.textContent = row.n === null || row.n === undefined ? '' : `n=${formatNumber(row.n)}`;
      item.append(swatch, label, value, n);
      for (const flag of row.flags) {
        const badge = doc.createElement('span');
        badge.className = 'yk-tooltip-flag';
        badge.dataset.kind = flag.kind;
        badge.textContent = flag.label;
        item.append(badge);
      }
      list.append(item);
    }
    this.element.append(list);
    if (model.flags.length > 0) {
      const flags = doc.createElement('p');
      flags.className = 'yk-tooltip-flags';
      flags.textContent = model.flags.map(flag => flag.label).join(' · ');
      this.element.append(flags);
    }
    if (model.sample) {
      const sample = doc.createElement('p');
      sample.className = 'yk-tooltip-sample';
      sample.textContent = `sample of ${formatNumber(model.sample.n)} of ${formatNumber(model.sample.total)}`;
      this.element.append(sample);
    }
    if (model.rows.length === 0 && !model.title) this.element.textContent = NULL_TEXT;
    return this;
  }

  show(model, { x = 0, y = 0 } = {}) {
    this.render(model);
    this.element.hidden = false;
    this.element.style.setProperty('--yk-tooltip-x', `${Math.round(x)}px`);
    this.element.style.setProperty('--yk-tooltip-y', `${Math.round(y)}px`);
    return this;
  }

  hide() {
    this.element.hidden = true;
    return this;
  }
}

export function createTooltip(doc) {
  return new ChartTooltip(doc);
}
