// Entity inspector: a side panel on wide screens and a bottom sheet below
// 900 px. It shows the inspected entity's facts and the five actions, manages
// focus, closes on Esc, and copies the current committed URL. It emits action
// intent; the app routes it and never re-implements the router here.

const SHEET = '(max-width: 899px)';

function destination(context = {}) {
  if (context.destination) return context.destination;
  const key = String(context.key ?? '');
  if (context.grain === 'session') return `/sessions/${encodeURIComponent(key)}`;
  if (context.grain === 'plan') return '/plans';
  if (context.grain === 'artifact' || context.grain === 'content') return '/artifact';
  return '/ledger';
}

function factRows(context = {}) {
  if (Array.isArray(context.facts)) return context.facts;
  const unit = context.unit || '';
  return Object.entries(context.values || {}).map(([label, value]) => ({ label, value, unit }));
}

function displayValue(fact) {
  if (fact.value === null || fact.value === undefined || fact.value === '') return '—';
  const value = typeof fact.value === 'number' ? fact.value.toLocaleString('en-US') : String(fact.value);
  return `${value}${fact.unit ? ` ${fact.unit}` : ''}`;
}

export function createInspector({ doc = globalThis.document, router, onAction = null } = {}) {
  const element = doc.createElement('aside');
  element.className = 'workspace-inspector';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-modal', 'false');
  element.setAttribute('aria-label', 'Entity inspector');
  element.dataset.open = 'false';
  element.hidden = true;
  const media = typeof doc.defaultView?.matchMedia === 'function' ? doc.defaultView.matchMedia(SHEET) : null;
  let opener = null;
  let open = false;

  function position() {
    element.dataset.position = media?.matches ? 'sheet' : 'side';
  }
  position();
  media?.addEventListener?.('change', position);

  function close() {
    if (!open) return;
    open = false;
    element.dataset.open = 'false';
    element.hidden = true;
    const target = opener;
    opener = null;
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    onAction?.({ action: 'close' });
  }

  async function copyLink() {
    const url = element.dataset.url || globalThis.location?.href || '';
    try {
      if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(url);
      else {
        const field = doc.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        element.append(field);
        field.select();
        doc.execCommand?.('copy');
        field.remove();
      }
      const status = element.querySelector('.workspace-inspector-status');
      if (status) status.textContent = 'Link copied.';
      element.dataset.copied = 'true';
      onAction?.({ action: 'copy', url });
    } catch {
      const status = element.querySelector('.workspace-inspector-status');
      if (status) status.textContent = 'Could not copy the link.';
    }
  }

  function act(action) {
    const context = element._context || {};
    if (action === 'open') {
      onAction?.({ action: 'open', destination: destination(context), grain: context.grain, key: context.key });
      router?.push(destination(context));
    } else if (action === 'copy-link') copyLink();
    else if (action === 'close') close();
    else onAction?.({ action, grain: context.grain, key: context.key, population: context.population, selection: context.selection });
  }

  function openInspector(context = {}) {
    element._context = context;
    open = true;
    opener = context.opener || doc.activeElement || null;
    position();
    element.hidden = false;
    element.dataset.open = 'true';
    element.dataset.grain = context.grain || '';
    element.dataset.key = String(context.key ?? '');
    element.dataset.url = context.url || globalThis.location?.href || '';

    element.replaceChildren();
    const header = doc.createElement('header');
    header.className = 'workspace-inspector-header';
    const title = doc.createElement('h2');
    title.className = 'workspace-inspector-title';
    title.textContent = context.title || `${context.grain || 'entity'} ${context.key ?? ''}`.trim();
    const closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'workspace-inspector-close';
    closeButton.dataset.action = 'close';
    closeButton.textContent = 'Close';
    closeButton.setAttribute('aria-label', 'Close inspector');
    closeButton.addEventListener('click', close);
    header.append(title, closeButton);

    const facts = doc.createElement('dl');
    facts.className = 'workspace-inspector-facts';
    const rows = factRows(context);
    if (!rows.length) {
      const empty = doc.createElement('p');
      empty.className = 'workspace-inspector-empty';
      empty.textContent = 'No entity facts were published for this mark.';
      facts.append(empty);
    }
    for (const fact of rows) {
      const dt = doc.createElement('dt');
      dt.textContent = fact.label;
      const dd = doc.createElement('dd');
      dd.textContent = displayValue(fact);
      facts.append(dt, dd);
    }

    const actions = doc.createElement('div');
    actions.className = 'workspace-inspector-actions';
    const buttons = [
      ['Open', 'open'], ['Filter to', 'filter'], ['Exclude', 'exclude'], ['Add to cohort', 'cohort'], ['Copy link', 'copy-link']
    ];
    for (const [label, action] of buttons) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'workspace-inspector-action';
      button.dataset.action = action;
      button.textContent = label;
      button.addEventListener('click', () => act(action));
      actions.append(button);
    }

    const status = doc.createElement('p');
    status.className = 'workspace-inspector-status';
    status.setAttribute('aria-live', 'polite');

    element.append(header, facts, actions, status);
    const first = element.querySelector('.workspace-inspector-close') || element.querySelector('button');
    first?.focus?.({ preventScroll: true });
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) { event.preventDefault(); close(); }
  }
  doc.addEventListener('keydown', onKeyDown);

  function destroy() {
    doc.removeEventListener('keydown', onKeyDown);
    media?.removeEventListener?.('change', position);
    element.remove();
  }

  return { element, open: openInspector, close, destroy, get isOpen() { return open; } };
}
