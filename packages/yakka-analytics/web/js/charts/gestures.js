// Gesture grammar for <yk-chart>. One engine maps pointer, mouse, wheel,
// keyboard and touch events to intents; the element owns state and history.
// The binding rows are DESIGN.md Interaction model > Gestures. No product
// inspector or tray UI lives here: open/filter/exclude/cohort are emitted as
// intents that later units consume.

export const DRAG_THRESHOLD_PX = 4;
export const TOUCH_TARGET_PX = 44;

export function windowOf(u) {
  return { min: u.scales.x.min, max: u.scales.x.max };
}

/** A new window scaled around `value`; factor < 1 zooms in. */
export function zoomWindow({ min, max }, value, factor) {
  if (![min, max, value, factor].every(Number.isFinite)) return { from: min, to: max };
  return { from: value - (value - min) * factor, to: value + (max - value) * factor };
}

/** A window shifted by `delta` data units, preserving its span. */
export function panWindow({ min, max }, delta) {
  return { min: min + delta, max: max + delta };
}

function nearestIndex(rows, value) {
  let best = null;
  let distance = Infinity;
  for (let index = 0; index < rows.length; index += 1) {
    const current = Math.abs(rows[index].x - value);
    if (current < distance) { distance = current; best = index; }
  }
  return best;
}

export function createHighlightPlugin({ getKey, getRows, getColour }) {
  return {
    hooks: {
      draw: u => {
        const key = typeof getKey === 'function' ? getKey() : null;
        if (!key) return;
        const row = (getRows() || []).find(item => item.key === key);
        if (!row) return;
        const x = u.valToPos(row.x, 'x');
        if (!Number.isFinite(x)) return;
        const { ctx } = u;
        ctx.save();
        ctx.strokeStyle = typeof getColour === 'function' ? getColour() : '#176b87';
        ctx.lineWidth = 1;
        if (ctx.setLineDash) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(x, u.bbox.top);
        ctx.lineTo(x, u.bbox.top + u.bbox.height);
        ctx.stroke();
        ctx.restore();
      }
    }
  };
}

/**
 * @param {object} options
 * @param {HTMLElement} options.element the <yk-chart> host
 * @param {object} options.handlers element callbacks (see below)
 */
export function createGestureEngine({ element, handlers = {} }) {
  let u = null;
  let root = null;
  let controls = null;
  let suppressClick = false;
  let drag = null;
  let preview = null;
  let pinch = null;
  let selectMode = false;
  let pendingCohort = false;
  const pointers = new Map();

  function getRows() { return handlers.getRows?.() || []; }
  function getBrush() { return handlers.getBrush?.() || null; }
  function isSelectMode() { return selectMode; }

  function overRect() { return u.over.getBoundingClientRect(); }
  function clampLeft(left) { return Math.max(0, Math.min(left, u.over.clientWidth || 0)); }

  function indexAt(clientX) {
    const rows = getRows();
    if (!rows.length) return null;
    const left = clampLeft(clientX - overRect().left);
    return nearestIndex(rows, u.posToVal(left, 'x'));
  }

  function currentWindow() {
    return windowOf(u);
  }

  // Settled intents (`onZoom`/`onPan`) speak the history contract's from/to,
  // not uPlot's min/max.
  function currentWindowRange() {
    const window = currentWindow();
    return { from: window.min, to: window.max };
  }

  function clearPreview() {
    preview = null;
    if (u) u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  }

  function previewBrush(startX, endX) {
    const rect = overRect();
    const left = clampLeft(Math.min(startX, endX) - rect.left);
    const width = Math.min(Math.abs(endX - startX), (u.over.clientWidth || 0) - left);
    u.setSelect({ left, top: 0, width, height: u.over.clientHeight }, false);
    const from = u.posToVal(left, 'x');
    const to = u.posToVal(left + width, 'x');
    preview = { from: Math.min(from, to), to: Math.max(from, to) };
    handlers.onBrushPreview?.(preview);
  }

  function panBy(dx) {
    const rect = overRect();
    const span = drag.startWindow.max - drag.startWindow.min;
    const perPx = rect.width ? span / rect.width : 0;
    const next = panWindow(drag.startWindow, -dx * perPx);
    u.setScale('x', next);
  }

  function startPinch() {
    const points = [...pointers.values()];
    if (points.length < 2) return;
    const [a, b] = points;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const midX = (a.clientX + b.clientX) / 2 - overRect().left;
    pinch = {
      distance,
      window: currentWindow(),
      center: u.posToVal(clampLeft(midX), 'x')
    };
    drag = null;
    clearPreview();
  }

  function updatePinch() {
    const points = [...pointers.values()];
    if (!pinch || points.length < 2) return;
    const [a, b] = points;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
    const span = pinch.window.max - pinch.window.min;
    const nextSpan = Math.max(Number.MIN_VALUE, span * (pinch.distance / distance));
    u.setScale('x', { min: pinch.center - nextSpan / 2, max: pinch.center + nextSpan / 2 });
  }

  function navigate(index, series) {
    const rows = getRows();
    const row = rows[index];
    if (!row) return;
    handlers.onNavigate?.(row.key, index, series);
  }

  function adjustBrush(direction) {
    const rows = getRows();
    if (!rows.length) return;
    const inspected = handlers.getInspected?.() || {};
    let from;
    let to;
    if (getBrush()) {
      from = getBrush().from;
      to = getBrush().to;
    } else {
      const x = rows[inspected.index ?? 0]?.x ?? u.scales.x.min;
      const window = currentWindow();
      const step = (window.max - window.min) / 10;
      from = x;
      to = Math.min(window.max, x + step);
      if (to <= from) from = Math.max(window.min, to - step);
    }
    const xs = rows.map(row => row.x).sort((a, b) => a - b);
    if (direction < 0) {
      const lower = xs.filter(value => value < from).pop();
      if (lower !== undefined) from = lower;
    } else {
      const upper = xs.find(value => value > to);
      if (upper !== undefined) to = upper;
    }
    if (to > from) handlers.onBrush?.({ from, to });
  }

  function inspectValue() {
    const rows = getRows();
    const inspected = handlers.getInspected?.() || {};
    const row = rows[inspected.index ?? 0];
    return row ? row.x : (u ? u.scales.x.min : null);
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      shift: event.shiftKey,
      touch: event.pointerType === 'touch',
      moved: false,
      startWindow: currentWindow()
    };
    try { u.over.setPointerCapture(event.pointerId); } catch {}
  }

  function onPointerMove(event) {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
    if (pinch && pointers.size >= 2) { updatePinch(); return; }
    if (!drag) {
      if (event.pointerType !== 'touch') {
        const index = indexAt(event.clientX);
        if (index !== null) handlers.onHover?.(getRows()[index].key, index);
      }
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    if (drag.touch && !isSelectMode()) return;
    if (drag.shift) panBy(dx);
    else previewBrush(drag.startX, event.clientX);
  }

  function onPointerUp(event) {
    pointers.delete(event.pointerId);
    try { u.over.releasePointerCapture(event.pointerId); } catch {}
    if (pinch) {
      if (pointers.size < 2) {
        const window = currentWindowRange();
        pinch = null;
        handlers.onZoom?.(window);
      }
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (finished.moved) {
      suppressClick = true;
      if (finished.touch && !isSelectMode()) { clearPreview(); return; }
      if (finished.shift) {
        clearPreview();
        handlers.onPan?.(currentWindowRange());
      } else if (preview) {
        const brush = preview;
        preview = null;
        handlers.onBrush?.(brush);
      }
      return;
    }
    if (finished.touch) {
      suppressClick = true;
      const index = indexAt(finished.startX);
      if (index !== null) handlers.onActivate?.(getRows()[index].key, { source: 'touch' });
    }
  }

  function onPointerCancel(event) {
    pointers.delete(event.pointerId);
    if (pinch && pointers.size < 2) {
      const window = currentWindowRange();
      pinch = null;
      handlers.onZoom?.(window);
    }
    drag = null;
    clearPreview();
  }

  function onClick(event) {
    if (suppressClick) { suppressClick = false; return; }
    const index = indexAt(event.clientX);
    if (index === null) return;
    const key = getRows()[index].key;
    const additive = Boolean(event.shiftKey || event.ctrlKey || event.metaKey);
    const exclude = Boolean(event.altKey);
    if (additive || exclude) handlers.onSelection?.({ key, exclude });
    else handlers.onActivate?.(key, { source: 'pointer' });
  }

  function onDoubleClick(event) {
    event.preventDefault();
    suppressClick = true;
    const brush = getBrush();
    if (brush) { handlers.onZoom?.(brush); return; }
    const index = indexAt(event.clientX);
    const rows = getRows();
    const value = index !== null && rows[index] ? rows[index].x : u.posToVal(clampLeft(event.clientX - overRect().left), 'x');
    handlers.onZoom?.(zoomWindow(currentWindow(), value, 0.5));
  }

  function onWheel(event) {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const index = indexAt(event.clientX);
    const rows = getRows();
    const value = index !== null && rows[index] ? rows[index].x : u.posToVal(clampLeft(event.clientX - overRect().left), 'x');
    const factor = event.deltaY > 0 ? 1.25 : 0.8;
    handlers.onZoom?.(zoomWindow(currentWindow(), value, factor));
  }

  function onKeyDown(event) {
    if (event.target !== root) return;
    const rows = getRows();
    if (!rows.length) return;
    const inspected = handlers.getInspected?.() || {};
    let index = Math.max(0, Math.min(rows.length - 1, inspected.index ?? 0));
    let series = Math.max(0, inspected.series ?? 0);
    const key = rows[index]?.key;
    const seriesCount = handlers.getSpec?.()?.series?.length || 1;

    if (pendingCohort && /^[a-dA-D]$/.test(event.key)) {
      handlers.onCohort?.(event.key.toLowerCase(), key);
      pendingCohort = false;
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
        index = Math.min(rows.length - 1, index + 1);
        navigate(index, series);
        event.preventDefault();
        break;
      case 'ArrowLeft':
        index = Math.max(0, index - 1);
        navigate(index, series);
        event.preventDefault();
        break;
      case 'ArrowDown':
        series = Math.min(seriesCount - 1, series + 1);
        navigate(index, series);
        event.preventDefault();
        break;
      case 'ArrowUp':
        series = Math.max(0, series - 1);
        navigate(index, series);
        event.preventDefault();
        break;
      case 'Enter':
        handlers.onActivate?.(key, { source: 'keyboard' });
        event.preventDefault();
        break;
      case ' ':
      case 'Spacebar':
        handlers.onSelection?.({ key, selected: null });
        event.preventDefault();
        break;
      case 'o':
      case 'O':
        handlers.onOpen?.(key);
        event.preventDefault();
        break;
      case 'f':
      case 'F':
        handlers.onFilter?.(key);
        event.preventDefault();
        break;
      case 'x':
      case 'X':
        handlers.onSelection?.({ key, exclude: true });
        event.preventDefault();
        break;
      case 'c':
      case 'C':
        pendingCohort = true;
        event.preventDefault();
        break;
      case '[':
        adjustBrush(-1);
        event.preventDefault();
        break;
      case ']':
        adjustBrush(1);
        event.preventDefault();
        break;
      case '+':
      case '=':
        handlers.onZoom?.(zoomWindow(currentWindow(), inspectValue(), 0.7));
        event.preventDefault();
        break;
      case '-':
      case '_':
        handlers.onZoom?.(zoomWindow(currentWindow(), inspectValue(), 1.4));
        event.preventDefault();
        break;
      case 'Escape':
        if (handlers.getSelection?.()) handlers.onSelection?.({ clear: true });
        else if (getBrush()) handlers.onBrushCleared?.();
        event.preventDefault();
        break;
      default:
        break;
    }
  }

  function onFocus() {
    const inspected = handlers.getInspected?.();
    if (inspected && inspected.key) return;
    navigate(0, 0);
  }

  function setSelectMode(value) {
    selectMode = Boolean(value);
    if (controls?.mode) {
      controls.mode.dataset.active = selectMode ? 'true' : 'false';
      controls.mode.setAttribute('aria-pressed', selectMode ? 'true' : 'false');
    }
    handlers.onSelectMode?.(selectMode);
  }

  function mountControls(shell) {
    const doc = element.ownerDocument;
    const bar = doc.createElement('div');
    bar.className = 'yk-gesture-controls';

    const zoom = doc.createElement('button');
    zoom.type = 'button';
    zoom.className = 'yk-gesture-button';
    zoom.dataset.gesture = 'zoom-selection';
    zoom.textContent = 'Zoom to selection';
    zoom.addEventListener('click', () => {
      const brush = getBrush();
      if (brush) handlers.onZoom?.(brush);
    });

    const mode = doc.createElement('button');
    mode.type = 'button';
    mode.className = 'yk-gesture-button';
    mode.dataset.gesture = 'select-mode';
    mode.textContent = 'Select';
    mode.setAttribute('aria-pressed', 'false');
    mode.dataset.active = 'false';
    mode.addEventListener('click', () => setSelectMode(!selectMode));

    bar.append(zoom, mode);
    shell.append(bar);
    controls = { bar, zoom, mode };
  }

  function attach(chart, shell) {
    u = chart;
    root = shell;
    mountControls(root);
    root.addEventListener('keydown', onKeyDown);
    root.addEventListener('focus', onFocus);
    u.over.addEventListener('pointerdown', onPointerDown);
    u.over.addEventListener('pointermove', onPointerMove);
    u.over.addEventListener('pointerup', onPointerUp);
    u.over.addEventListener('pointercancel', onPointerCancel);
    u.over.addEventListener('click', onClick);
    u.over.addEventListener('dblclick', onDoubleClick);
    u.over.addEventListener('wheel', onWheel, { passive: false });
    return { setSelectMode, clearPreview };
  }

  function destroy() {
    if (root) {
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('focus', onFocus);
    }
    if (u) {
      u.over.removeEventListener('pointerdown', onPointerDown);
      u.over.removeEventListener('pointermove', onPointerMove);
      u.over.removeEventListener('pointerup', onPointerUp);
      u.over.removeEventListener('pointercancel', onPointerCancel);
      u.over.removeEventListener('click', onClick);
      u.over.removeEventListener('dblclick', onDoubleClick);
      u.over.removeEventListener('wheel', onWheel);
    }
    controls?.bar?.remove();
    controls = null;
    u = null;
    root = null;
    pointers.clear();
    drag = null;
    pinch = null;
  }

  return { attach, destroy, setSelectMode, isSelectMode: () => selectMode };
}
