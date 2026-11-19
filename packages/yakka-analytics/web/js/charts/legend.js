// Legend contract: toggle, focus and isolate controls with 44 px targets.
// The legend emits intent only; it never fetches.

export function legendModel(series = [], state = {}) {
  const hidden = new Set(state.hidden || []);
  const active = state.active ?? null;
  const isolated = state.isolated ?? null;
  return series.map(item => ({
    key: item.key,
    label: item.label || item.key,
    shape: item.shape || 'circle',
    pattern: item.pattern || null,
    cssVar: item.cssVar || null,
    hidden: hidden.has(item.key),
    active: active === item.key,
    isolated: isolated === item.key
  }));
}

export function classifyIntent(event) {
  if (event.altKey) return 'focus';
  if (event.ctrlKey || event.metaKey) return 'isolate';
  return 'toggle';
}

export function createLegend(doc, { series = [], state = {}, onIntent = null, label = 'Series' } = {}) {
  const element = doc.createElement('div');
  element.className = 'yk-legend';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  let current = { hidden: [], active: null, isolated: null, ...state };
  render();

  return { element, update, destroy };

  function emit(type, key) {
    if (type === 'toggle') {
      const hidden = new Set(current.hidden || []);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      current = { ...current, hidden: [...hidden] };
    } else if (type === 'focus') {
      current = { ...current, active: key };
    } else if (type === 'isolate') {
      current = { ...current, isolated: key };
    }
    render();
    const detail = { type, key, state: publicState() };
    element.dispatchEvent(new CustomEvent('yk-legend-intent', { bubbles: true, detail }));
    if (typeof onIntent === 'function') onIntent(detail);
    return detail;
  }

  function publicState() {
    return { hidden: [...(current.hidden || [])], active: current.active ?? null, isolated: current.isolated ?? null };
  }

  function update(next = {}) {
    current = { hidden: [], active: null, isolated: null, ...current, ...next };
    render();
    return publicState();
  }

  function handle(event, key) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;
    const type = action === 'toggle' ? classifyIntent(event) : action;
    emit(type, key);
  }

  function render() {
    element.replaceChildren();
    for (const item of legendModel(series, current)) {
      const row = doc.createElement('div');
      row.className = 'yk-legend-item';
      row.dataset.key = item.key;
      if (item.hidden) row.dataset.hidden = 'true';
      if (item.active) row.dataset.active = 'true';
      if (item.isolated) row.dataset.isolated = 'true';

      const swatch = doc.createElement('span');
      swatch.className = 'yk-legend-swatch';
      swatch.dataset.shape = item.shape;
      if (item.pattern) swatch.dataset.pattern = item.pattern;
      if (item.cssVar) swatch.style.setProperty('--yk-swatch', `var(${item.cssVar})`);
      swatch.setAttribute('aria-hidden', 'true');

      const toggle = doc.createElement('button');
      toggle.type = 'button';
      toggle.className = 'yk-legend-toggle';
      toggle.dataset.action = 'toggle';
      toggle.setAttribute('aria-pressed', item.hidden ? 'false' : 'true');
      toggle.setAttribute('aria-label', `${item.hidden ? 'Show' : 'Hide'} ${item.label}`);
      toggle.append(swatch, doc.createTextNode(item.label));
      toggle.addEventListener('click', event => handle(event, item.key));

      const focus = doc.createElement('button');
      focus.type = 'button';
      focus.className = 'yk-legend-focus';
      focus.dataset.action = 'focus';
      focus.setAttribute('aria-pressed', item.active ? 'true' : 'false');
      focus.textContent = 'Focus';
      focus.setAttribute('aria-label', `Focus ${item.label}`);
      focus.addEventListener('click', event => handle(event, item.key));

      const isolate = doc.createElement('button');
      isolate.type = 'button';
      isolate.className = 'yk-legend-isolate';
      isolate.dataset.action = 'isolate';
      isolate.setAttribute('aria-pressed', item.isolated ? 'true' : 'false');
      isolate.textContent = 'Isolate';
      isolate.setAttribute('aria-label', `Isolate ${item.label}`);
      isolate.addEventListener('click', event => handle(event, item.key));

      row.append(toggle, focus, isolate);
      element.append(row);
    }
  }

  function destroy() {
    element.replaceChildren();
  }
}
