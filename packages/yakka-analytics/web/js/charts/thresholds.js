// Threshold lines and bands. A threshold is spec metadata, not a measure: it
// is drawn in the plot frame, listed under the table, and carries no
// interaction and no selectable mark.

import { STATUS } from './colour-registry.js';
import { formatNumber, formatValue } from './formatters.js';

const TONES = ['good', 'warn', 'bad', 'info'];

export function thresholdModel(spec = {}) {
  const list = Array.isArray(spec.thresholds) ? spec.thresholds : [];
  return list.map((item, index) => {
    const tone = TONES.includes(item.tone) ? item.tone : 'info';
    const hasBand = Number.isFinite(item.from) && Number.isFinite(item.to);
    return {
      key: item.key || `threshold:${index + 1}`,
      label: item.label || item.key || `Threshold ${index + 1}`,
      tone,
      value: Number.isFinite(item.value) ? item.value : null,
      from: hasBand ? Math.min(item.from, item.to) : null,
      to: hasBand ? Math.max(item.from, item.to) : null,
      unit: item.unit || '',
      kind: item.kind || 'number'
    };
  });
}

export function thresholdColour(tone, host) {
  const safe = TONES.includes(tone) ? tone : 'info';
  const cssVar = `--yk-status-${safe}`;
  const fromHost = host ? getComputedStyle(host).getPropertyValue(cssVar).trim() : '';
  return { tone: safe, cssVar, colour: fromHost || STATUS[safe].light };
}

export function thresholdValueText(threshold) {
  const unit = threshold.unit ? ` ${threshold.unit}` : '';
  if (threshold.from !== null && threshold.to !== null) {
    return `${formatNumber(threshold.from)}–${formatNumber(threshold.to)}${unit}`;
  }
  if (threshold.value === null) return '—';
  return `${formatValue(threshold.value, { kind: threshold.kind })}${unit}`;
}

export function drawThresholds(u, model, { host = null } = {}) {
  if (!u?.ctx || !u.bbox) return;
  if (u.root) u.root.dataset.thresholds = String(model.length);
  if (model.length === 0) return;
  const ctx = u.ctx;
  const { left, top, width, height } = u.bbox;
  const pxRatio = uPlotRatio(u);
  ctx.save();
  ctx.font = `${Math.round(11 * pxRatio)}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const threshold of model) {
    const { colour } = thresholdColour(threshold.tone, host);
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    ctx.lineWidth = Math.max(1, Math.round(pxRatio));
    ctx.setLineDash([Math.round(4 * pxRatio), Math.round(3 * pxRatio)]);
    if (threshold.from !== null && threshold.to !== null) {
      const yTop = u.valToPos(threshold.to, 'y', true);
      const yBottom = u.valToPos(threshold.from, 'y', true);
      ctx.globalAlpha = 0.14;
      ctx.fillRect(left, Math.min(yTop, yBottom), width, Math.abs(yBottom - yTop));
      ctx.globalAlpha = 1;
      ctx.strokeRect(left, Math.min(yTop, yBottom), width, Math.abs(yBottom - yTop));
      ctx.fillText(threshold.label, left + 4 * pxRatio, Math.min(yTop, yBottom) + 9 * pxRatio);
    } else if (threshold.value !== null) {
      const y = u.valToPos(threshold.value, 'y', true);
      if (y < top || y > top + height) continue;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.fillText(`${threshold.label} (${thresholdValueText(threshold)})`, left + 4 * pxRatio, y - 6 * pxRatio);
    }
  }
  ctx.restore();
}

export function createThresholdPlugin(model, { host = null } = {}) {
  return {
    hooks: {
      draw: [u => drawThresholds(u, model, { host })]
    }
  };
}

/**
 * List thresholds under the table's own caption and rows. This mutates only
 * the table element the 7-01 table module returns; the module contract is
 * unchanged.
 */
export function renderThresholdTable(table, model) {
  if (!table) return null;
  table.querySelector('tfoot[data-thresholds]')?.remove();
  if (model.length === 0) return null;
  const doc = table.ownerDocument;
  const tfoot = doc.createElement('tfoot');
  tfoot.dataset.thresholds = 'true';
  const columns = table.querySelectorAll('thead th').length || 2;
  for (const threshold of model) {
    const row = doc.createElement('tr');
    row.dataset.thresholdKey = threshold.key;
    row.dataset.tone = threshold.tone;
    const label = doc.createElement('th');
    label.scope = 'row';
    label.textContent = threshold.label;
    const value = doc.createElement('td');
    value.colSpan = Math.max(1, columns - 1);
    value.textContent = thresholdValueText(threshold);
    row.append(label, value);
    tfoot.append(row);
  }
  table.append(tfoot);
  return tfoot;
}

function uPlotRatio(u) {
  const ratio = u?.root?.ownerDocument?.defaultView?.devicePixelRatio;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}
