// First-party Canvas 2D scatter behind the <yk-chart> element contract. This
// is the declared fallback from CONTRACTS.md 17.5: no second library, no
// per-point DOM. A base canvas holds axes and every mark; a transparent
// overlay holds hover and rectangle feedback so a pointer move never redraws
// the 5,000 marks. Hit-testing and rectangle membership come from hit-test.js.

import { nearestPoint, pointsInRect, rectToData } from './hit-test.js';
import {
  SCATTER_PADDING, projectScatter, scatterLayout, drawMark
} from './scatter.js';

export const DRAG_THRESHOLD_PX = 4;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

const INTEGER_FIELDS = new Set(['artifacts', 'artifact_versions', 'commits', 'conversations', 'distinct_content', 'model_calls', 'rejections', 'sessions', 'shared_sessions', 'unpriced_calls', 'versions']);

export function formatScatterTick(value, field = '') {
  if (!finite(value)) return '';
  if (INTEGER_FIELDS.has(field)) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(value));
  const magnitude = Math.abs(value);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(1).replace(/\.0$/, '');
  if (magnitude >= 1) return value.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
  return value.toPrecision(2);
}

export function createCanvasScatter({
  doc, frame, spec, points, tokens = {}, styleFor = null,
  onHover = null, onLeave = null, onInspect = null, onSelection = null,
  onMarkSelection = null, onSelectMode = null
} = {}) {
  const stack = doc.createElement('div');
  stack.className = 'yk-scatter-stack';
  const base = doc.createElement('canvas');
  base.className = 'yk-scatter-canvas';
  const overlay = doc.createElement('canvas');
  overlay.className = 'yk-scatter-canvas yk-scatter-overlay';
  overlay.setAttribute('tabindex', '0');
  overlay.setAttribute('role', 'img');
  overlay.setAttribute('aria-label', spec.title || 'Scatter plot');
  stack.append(base, overlay);
  frame.append(stack);
  const controls = doc.createElement('div');
  controls.className = 'yk-gesture-controls';
  const select = doc.createElement('button');
  select.type = 'button';
  select.className = 'yk-gesture-button';
  select.dataset.gesture = 'select-mode';
  select.dataset.active = 'false';
  select.setAttribute('aria-pressed', 'false');
  select.textContent = 'Select';
  controls.append(select);
  frame.parentElement.insertBefore(controls, frame);
  let selectMode = false;
  select.addEventListener('click', () => {
    selectMode = !selectMode;
    select.dataset.active = String(selectMode);
    select.setAttribute('aria-pressed', String(selectMode));
    onSelectMode?.(selectMode);
  });

  const baseCtx = base.getContext('2d');
  const overlayCtx = overlay.getContext('2d');
  let layout = null;
  let marks = [];
  let hovered = null;
  let drag = null;
  let pointer = null;
  let lastClickTouch = false;
  let lastClickModifiers = null;
  let suppressClick = false;
  let hidden = new Set();
  let selected = new Set();
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize());

  function pixelRatio() {
    return Math.max(1, Math.min(2, (doc.defaultView?.devicePixelRatio || 1)));
  }

  function resize() {
    const width = Math.max(320, Math.round(frame.clientWidth || 640));
    const height = Math.max(200, Math.round(frame.clientHeight || 240));
    const ratio = pixelRatio();
    for (const canvas of [base, overlay]) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    layout = scatterLayout(points, {
      width, height, padding: SCATTER_PADDING,
      xInteger: INTEGER_FIELDS.has(spec.x?.key), yInteger: INTEGER_FIELDS.has(spec.y?.key)
    });
    marks = projectScatter(points, layout).map(point => {
      const style = styleFor ? styleFor(point) : null;
      return {
        ...point,
        colour: style?.colour || tokens.focus || '#176b87',
        shape: point.shape || style?.shape || 'circle',
        styleShape: style?.shape || 'circle',
        pattern: style?.pattern || null
      };
    });
    drawBase();
    drawOverlay();
  }

  function ctxFor(canvas, ctx) {
    const ratio = pixelRatio();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    return ctx;
  }

  function drawAxes(ctx) {
    const { plot, xScale, yScale } = layout;
    ctx.save();
    ctx.strokeStyle = tokens.grid || '#e6ebf2';
    ctx.fillStyle = tokens.muted || '#586579';
    ctx.lineWidth = 1;
    ctx.font = '12px system-ui, sans-serif';
    const xTicks = INTEGER_FIELDS.has(spec.x?.key) ? Math.max(1, Math.min(5, Math.ceil(xScale.max - xScale.min))) : 5;
    const yTicks = INTEGER_FIELDS.has(spec.y?.key) ? Math.max(1, Math.min(5, Math.ceil(yScale.max - yScale.min))) : 5;
    for (let i = 0; i <= xTicks; i += 1) {
      const x = plot.left + (plot.width * i) / xTicks;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.top + plot.height);
      ctx.stroke();
      const value = xScale.min + ((xScale.max - xScale.min) * i) / xTicks;
      ctx.textAlign = i === 0 ? 'left' : i === xTicks ? 'right' : 'center';
      ctx.fillText(formatScatterTick(value, spec.x?.key), x, plot.top + plot.height + 16);
    }
    for (let i = 0; i <= yTicks; i += 1) {
      const y = plot.top + (plot.height * i) / yTicks;
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      const value = yScale.max - ((yScale.max - yScale.min) * i) / yTicks;
      ctx.textAlign = 'right';
      ctx.fillText(formatScatterTick(value, spec.y?.key), plot.left - 6, y + 4);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = tokens.text || '#18212f';
    ctx.font = '12px system-ui, sans-serif';
    const xText = `${spec.x?.label || 'X'}${spec.x?.unit ? ` (${spec.x.unit})` : ''}`;
    const yText = `${spec.y?.label || 'Y'}${spec.y?.unit ? ` (${spec.y.unit})` : ''}`;
    ctx.fillText(xText, plot.left, plot.top + plot.height + 31);
    ctx.textAlign = 'right';
    ctx.fillText(yText, plot.left + plot.width, plot.top - 2);
    ctx.restore();
  }

  function drawBase() {
    if (!layout) return;
    const ctx = ctxFor(base, baseCtx);
    ctx.fillStyle = tokens.surface || 'transparent';
    ctx.fillRect(0, 0, layout.width, layout.height);
    drawAxes(ctx);
    for (const mark of marks) {
      if (hidden.has(mark.group)) continue;
      const isSelected = selected.has(mark.key);
      drawMark(ctx, mark.shape, mark.px, mark.py, mark.size, {
        fill: mark.sampled ? 'transparent' : mark.colour,
        stroke: mark.colour,
        hollow: mark.sampled,
        alpha: isSelected ? 1 : mark.sampled ? 0.75 : 0.9
      });
      if (isSelected) {
        ctx.save();
        ctx.strokeStyle = tokens.focus || '#176b87';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(mark.px, mark.py, mark.size + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawOverlay() {
    if (!layout) return;
    const ctx = ctxFor(overlay, overlayCtx);
    if (drag && drag.moved) {
      const bounds = dragBounds();
      ctx.save();
      ctx.fillStyle = 'rgba(23, 107, 135, 0.12)';
      ctx.strokeStyle = tokens.focus || '#176b87';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      ctx.strokeRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      ctx.restore();
    }
    if (hovered) {
      ctx.save();
      ctx.strokeStyle = tokens.focus || '#176b87';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hovered.px, hovered.py, hovered.size + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function localPoint(event) {
    const rect = overlay.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearestAt(position) {
    if (!layout) return null;
    return nearestPoint(marks, {
      x: position.x + layout.plot.left,
      y: position.y + layout.plot.top
    }, { xToPx: mark => mark.px, yToPx: mark => mark.py });
  }

  function dragBounds() {
    const region = drag.region;
    return {
      left: Math.min(region.x0, region.x1),
      right: Math.max(region.x0, region.x1),
      top: Math.min(region.y0, region.y1),
      bottom: Math.max(region.y0, region.y1)
    };
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const position = localPoint(event);
    drag = {
      pointerId: event.pointerId,
      region: { x0: position.x, y0: position.y, x1: position.x, y1: position.y },
      additive: Boolean(event.shiftKey || event.ctrlKey || event.metaKey),
      exclude: Boolean(event.altKey),
      touch: event.pointerType === 'touch',
      moved: false
    };
    lastClickModifiers = { shift: Boolean(event.shiftKey), ctrl: Boolean(event.ctrlKey), meta: Boolean(event.metaKey), alt: Boolean(event.altKey) };
    try { overlay.setPointerCapture(event.pointerId); } catch {}
  }

  function onPointerMove(event) {
    const position = localPoint(event);
    if (drag && drag.pointerId === event.pointerId) {
      drag.region.x1 = position.x;
      drag.region.y1 = position.y;
      if (!drag.moved && Math.hypot(drag.region.x1 - drag.region.x0, drag.region.y1 - drag.region.y0) >= DRAG_THRESHOLD_PX) {
        drag.moved = true;
      }
      if (drag.moved) { drawOverlay(); return; }
    }
    const hit = nearestAt(position);
    if (!hit) return;
    hovered = hit.point;
    pointer = { left: hit.px - layout.plot.left, top: hit.py - layout.plot.top, idx: hit.index, x: hit.point.x, y: hit.point.y, values: hit.point.values };
    drawOverlay();
    onHover?.(hit.point, hit.index, { x: event.clientX, y: event.clientY });
  }

  function onPointerUp(event) {
    try { overlay.releasePointerCapture(event.pointerId); } catch {}
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    lastClickTouch = finished.touch;
    if (finished.moved) {
      suppressClick = true;
      if (finished.touch && !selectMode) { drawOverlay(); return; }
      const bounds = {
        left: Math.min(finished.region.x0, finished.region.x1),
        right: Math.max(finished.region.x0, finished.region.x1),
        top: Math.min(finished.region.y0, finished.region.y1),
        bottom: Math.max(finished.region.y0, finished.region.y1)
      };
      const keys = pointsInRect(marks, {
        left: bounds.left + layout.plot.left,
        right: bounds.right + layout.plot.left,
        top: bounds.top + layout.plot.top,
        bottom: bounds.bottom + layout.plot.top
      }, { xToPx: mark => mark.px, yToPx: mark => mark.py });
      const data = rectToData(bounds, {
        xToData: value => xToData(value, layout),
        yToData: value => yToData(value, layout)
      });
      drawOverlay();
      onSelection?.({ keys, data, additive: finished.additive, exclude: finished.exclude });
      return;
    }
    drawOverlay();
  }

  function onClick(event) {
    if (suppressClick) { suppressClick = false; lastClickModifiers = null; lastClickTouch = false; return; }
    const hit = nearestAt(localPoint(event));
    if (hit) {
      hovered = hit.point;
      pointer = { left: hit.px - layout.plot.left, top: hit.py - layout.plot.top, idx: hit.index, x: hit.point.x, y: hit.point.y, values: hit.point.values };
      const touch = event.pointerType === 'touch' || lastClickTouch;
      const modifiers = lastClickModifiers || { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey };
      lastClickTouch = false;
      lastClickModifiers = null;
      if (touch && selectMode) onMarkSelection?.({ key: hovered.key, additive: true, source: 'touch' });
      else if (modifiers.shift || modifiers.ctrl || modifiers.meta || modifiers.alt) {
        onMarkSelection?.({ key: hovered.key, additive: true, exclude: Boolean(modifiers.alt), source: 'pointer' });
      } else onInspect?.(hovered, hovered.index);
    }
    drawOverlay();
  }

  function onPointerLeave() {
    if (drag) return;
    hovered = null;
    pointer = null;
    drawOverlay();
    onLeave?.();
  }

  function onKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Escape', ' ', 'Spacebar', 'x', 'X'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      hovered = null;
      pointer = null;
      drawOverlay();
      onLeave?.();
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar' || event.key.toLowerCase() === 'x') {
      if (hovered) onMarkSelection?.({ key: hovered.key, additive: true, exclude: event.key.toLowerCase() === 'x', source: 'keyboard' });
      return;
    }
    if (!marks.length) return;
    const current = hovered ? marks.indexOf(hovered) : -1;
    let next = current;
    if (event.key === 'ArrowRight') next = current < 0 ? 0 : Math.min(marks.length - 1, current + 1);
    if (event.key === 'ArrowLeft') next = current <= 0 ? 0 : current - 1;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : Math.min(marks.length - 1, current + 10);
    if (event.key === 'ArrowUp') next = current < 0 ? 0 : Math.max(0, current - 10);
    if (event.key === 'Enter') { if (hovered) onInspect?.(hovered, marks.indexOf(hovered)); return; }
    hovered = marks[next];
    pointer = { left: hovered.px - layout.plot.left, top: hovered.py - layout.plot.top, idx: next, x: hovered.x, y: hovered.y, values: hovered.values };
    drawOverlay();
    const rect = overlay.getBoundingClientRect();
    onHover?.(hovered, next, { x: rect.left + hovered.px, y: rect.top + hovered.py });
  }

  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('click', onClick);
  overlay.addEventListener('pointerleave', onPointerLeave);
  overlay.addEventListener('keydown', onKeyDown);
  if (observer) observer.observe(frame);

  resize();

  return {
    element: stack,
    resize,
    destroy() {
      observer?.disconnect();
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerUp);
      overlay.removeEventListener('click', onClick);
      overlay.removeEventListener('pointerleave', onPointerLeave);
      overlay.removeEventListener('keydown', onKeyDown);
      controls.remove();
      stack.remove();
    },
    setHighlight(key) {
      hovered = key == null ? null : marks.find(mark => mark.key === key) || null;
      if (!hovered) pointer = null;
      drawOverlay();
    },
    setHidden(next = []) {
      hidden = new Set(next);
      drawBase();
    },
    setSelection(selection = { include: [], exclude: [] }) {
      selected = new Set([...(selection.include || []), ...(selection.exclude || [])].map(String));
      drawBase();
    },
    inspect() {
      const rect = overlay.getBoundingClientRect();
      const plot = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      const { xScale, yScale } = layout;
      return {
        plot,
        xScale: { key: 'x', time: false, min: xScale.min, max: xScale.max, width: xScale.width },
        yScale: { key: 'y', min: yScale.min, max: yScale.max, height: yScale.height },
        xToPx: value => xToPx(value, layout),
        yToPx: value => yToPx(value, layout),
        xToData: position => xToData(position, layout),
        yToData: position => yToData(position, layout),
        cursor: pointer ? { ...pointer } : null,
        hoveredKey: hovered?.key ?? null,
        selectMode,
        marks: marks.map(mark => ({
          key: mark.key,
          index: mark.index,
          x: mark.x,
          y: mark.y,
          px: mark.px - layout.plot.left,
          py: mark.py - layout.plot.top,
          group: mark.group,
          shape: mark.shape,
          size: mark.size,
          colour: mark.colour,
          sampled: mark.sampled,
          values: mark.values
        })),
        groups: [...new Set(marks.map(mark => mark.group).filter(value => value != null))].sort(),
        sampledMarkCount: marks.filter(mark => mark.sampled).length
      };
    }
  };
}

function xToPx(value, layout) {
  if (!layout || !finite(value)) return NaN;
  const { xScale, plot } = layout;
  return ((value - xScale.min) / (xScale.max - xScale.min)) * plot.width;
}

function yToPx(value, layout) {
  if (!layout || !finite(value)) return NaN;
  const { yScale, plot } = layout;
  return (1 - (value - yScale.min) / (yScale.max - yScale.min)) * plot.height;
}

function xToData(position, layout) {
  if (!layout || !finite(position)) return NaN;
  const { xScale, plot } = layout;
  return xScale.min + (position / plot.width) * (xScale.max - xScale.min);
}

function yToData(position, layout) {
  if (!layout || !finite(position)) return NaN;
  const { yScale, plot } = layout;
  return yScale.min + (1 - position / plot.height) * (yScale.max - yScale.min);
}
