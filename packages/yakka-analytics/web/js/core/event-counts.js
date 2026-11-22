// Truthful retained-event counts for the shared header. The strip never
// fabricates a zero: a missing capability is named as legacy, a failed request
// as unavailable, and a success carries the server's own matched and tenant
// totals plus the UTC checked_at rendered as a local timestamp.

export const EVENT_COUNTS_ROUTE = 'event-counts';
export const COUNTING_TEXT = 'Counting retained events…';
export const COUNTS_UNAVAILABLE_TEXT = 'Event counts unavailable';
export const COUNTS_LEGACY_TEXT = 'This server cannot report retained-event totals.';
export const COUNTS_RETRY_TEXT = 'Retry counts';

let snapshot = null;

export function currentEventCounts() {
  return snapshot ? { ...snapshot, matched: { ...snapshot.matched }, tenantTotal: { ...snapshot.tenantTotal } } : null;
}

export function clearEventCounts() {
  snapshot = null;
}

function number(value) {
  return Number.isFinite(value) ? value : null;
}

function grouping(value, locale = 'en-US') {
  return Number(value).toLocaleString(locale);
}

export function formatEventCountsText(body = {}, locale = 'en-US') {
  const matchedEvents = number(body?.matched?.events);
  const matchedRejections = number(body?.matched?.rejections);
  const tenantEvents = number(body?.tenant_total?.events);
  if (matchedEvents === null || matchedRejections === null || tenantEvents === null) return '';
  return `Events matching filters: ${grouping(matchedEvents, locale)} · Rejections: ${grouping(matchedRejections, locale)} · All retained events in tenant: ${grouping(tenantEvents, locale)}`;
}

export function formatCheckedAt(checkedAt, locale) {
  const at = Date.parse(checkedAt || '');
  if (!Number.isFinite(at)) return '';
  try {
    return new Date(at).toLocaleString(locale || undefined);
  } catch {
    return new Date(at).toISOString();
  }
}

// Pure classifier for the strip state. `capability` is the schema's
// features.event_counts flag; absence is a legacy server, not a zero count.
export function classifyEventCounts({ capability = false, response = null, body = null, error = null, locale = 'en-US' } = {}) {
  if (!capability) return { state: 'legacy', text: COUNTS_LEGACY_TEXT, snapshot: null };
  if (error || !response) return { state: 'error', text: COUNTS_UNAVAILABLE_TEXT, snapshot: null };
  if (!response.ok) return { state: 'error', text: COUNTS_UNAVAILABLE_TEXT, snapshot: null, status: response.status };
  const text = formatEventCountsText(body, locale);
  if (!text) return { state: 'error', text: COUNTS_UNAVAILABLE_TEXT, snapshot: null };
  const checkedAt = formatCheckedAt(body.checked_at, locale);
  const matched = {
    events: Number(body.matched.events),
    rejections: Number(body.matched.rejections),
    rows: number(body.matched.rows)
  };
  const tenantTotal = {
    events: Number(body.tenant_total.events),
    rejections: number(body.tenant_total.rejections),
    rows: number(body.tenant_total.rows)
  };
  return {
    state: 'success',
    text,
    checkedText: checkedAt ? `Counts checked ${checkedAt}` : '',
    snapshot: { matched, tenantTotal, checkedAt: body.checked_at || '', unit: body.unit || 'retained_record' }
  };
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createEventCountStrip({
  doc = globalThis.document,
  transport = null,
  readContext = null,
  allowRefresh = true,
  onRetry = null,
  locale = undefined
} = {}) {
  const element = el(doc, 'div', 'event-counts');
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  let capability = false;
  let context = readContext;
  let destroyed = false;
  let localSequence = 0;
  let lastKey = '';

  function render(state) {
    element.replaceChildren();
    element.dataset.state = state.state;
    element.append(el(doc, 'span', 'event-counts-text', state.text));
    if (state.state === 'success' && state.checkedText) {
      element.append(el(doc, 'span', 'event-counts-checked', state.checkedText));
    }
    if (state.state === 'legacy') {
      const link = el(doc, 'a', 'event-counts-ledger', 'Open Ledger');
      link.href = '/ledger';
      element.append(link);
    }
    if (state.state === 'error' && allowRefresh) {
      const retry = el(doc, 'button', 'event-counts-retry', COUNTS_RETRY_TEXT);
      retry.type = 'button';
      retry.addEventListener('click', () => {
        if (onRetry) onRetry();
        else load(context);
      });
      element.append(retry);
    }
  }

  async function load(nextContext = context) {
    if (destroyed) return null;
    context = nextContext || context;
    if (!capability || !transport || !context) {
      snapshot = null;
      render({ state: 'legacy', text: COUNTS_LEGACY_TEXT });
      return null;
    }
    localSequence += 1;
    const ticket = localSequence;
    snapshot = null;
    render({ state: 'loading', text: COUNTING_TEXT });
    try {
      const result = await transport.get(EVENT_COUNTS_ROUTE, context.paramsFor(), { tenant: context.tenant });
      if (destroyed || ticket !== localSequence) return null;
      const state = classifyEventCounts({ capability, response: result.response, body: result.body, locale });
      snapshot = state.snapshot || null;
      render(state);
      return state;
    } catch (error) {
      if (destroyed || ticket !== localSequence) return null;
      snapshot = null;
      render(classifyEventCounts({ capability, error, locale }));
      return null;
    }
  }

  function update({ readContext: nextContext = context, schema = null } = {}) {
    if (destroyed) return;
    context = nextContext || context;
    const nextCapability = Boolean(schema?.features?.event_counts);
    const key = nextContext ? `${nextContext.tenant}|${nextContext.generation}|${JSON.stringify(nextContext.window)}` : '';
    const changed = nextCapability !== capability || key !== lastKey;
    capability = nextCapability;
    lastKey = key;
    if (!changed) return;
    if (!capability) {
      snapshot = null;
      render({ state: 'legacy', text: COUNTS_LEGACY_TEXT });
      return;
    }
    load(context);
  }

  const api = {
    element,
    load,
    update,
    get state() { return element.dataset.state || ''; },
    destroy() { destroyed = true; localSequence += 1; }
  };

  render({ state: 'legacy', text: COUNTS_LEGACY_TEXT });
  return api;
}

export default createEventCountStrip;
