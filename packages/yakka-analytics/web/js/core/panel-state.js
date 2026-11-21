// The one panel-state vocabulary every frame uses. Badge presentation lives in
// charts/badges.js; this module only owns states, transitions and the text a
// panel needs for an empty or unsupported result.

export const PANEL_STATES = ['loading', 'ready', 'empty', 'unsupported', 'unauthorized', 'busy', 'timeout', 'error', 'cancelled'];

export const BADGE_STATES = ['partial', 'sampled', 'coarsened', 'clipped', 'lower-bound'];

// Every defined state may follow every other; the vocabulary, not a narrow
// transition table, is what panels and loaders agree on.
const TRANSITIONS = Object.fromEntries(PANEL_STATES.map(state => [state, new Set(PANEL_STATES)]));

export function isPanelState(value) {
  return PANEL_STATES.includes(value);
}

export function isSettled(state) {
  return isPanelState(state) && state !== 'loading';
}

export function canTransition(from, to) {
  if (!isPanelState(from) || !isPanelState(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from].has(to);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new Error(`panel state cannot move from ${from} to ${to}`);
  return to;
}

export function initialState() {
  return 'loading';
}

// Draw the loading state with the number of requests this panel has in flight.
export function loadingState(inFlight = 0) {
  return { state: 'loading', inFlight: Number.isFinite(inFlight) ? inFlight : 0 };
}

// Empty results name what produced zero and offer to clear each cause. The
// caller supplies the applied causes; this module never guesses them.
export function emptyCauses({ filters = [], cohort = null, selection = null } = {}) {
  const causes = [];
  for (const filter of filters) {
    if (!filter) continue;
    causes.push({
      kind: 'filter',
      key: filter.key || filter.name || '',
      label: filter.label || `${filter.key || filter.name}: ${filter.value}`,
      clear: filter.clear || null
    });
  }
  if (cohort) causes.push({ kind: 'cohort', key: 'cohort', label: cohort.label || `cohort ${cohort.slot || ''}`.trim(), clear: cohort.clear || null });
  if (selection) causes.push({ kind: 'selection', key: 'sel', label: selection.label || 'selection', clear: selection.clear || null });
  return causes;
}

export function emptyState(causes = []) {
  return { state: 'empty', causes };
}

export function errorState({ message = '', code = '', retry = null } = {}) {
  return { state: 'error', message, code, retry };
}

// Cancelled is never an error: retry and no code.
export function cancelledState({ retry = null } = {}) {
  return { state: 'cancelled', retry };
}

export function unauthorizedState({ message = '', code = '', retry = null } = {}) {
  return { state: 'unauthorized', message, code, retry };
}

export function busyState({ message = '', code = 'busy', retry = null, retryAfter = 0 } = {}) {
  return { state: 'busy', message, code, retry, retryAfter };
}

export function timeoutState({ message = '', code = 'query_timeout', retry = null } = {}) {
  return { state: 'timeout', message, code, retry };
}

function isTimeoutCode(code) {
  return /timeout/i.test(String(code || ''));
}

// One classification for server responses so loaders do not each invent their
// own. 401/403 are authorization (unless the route names an unsupported
// capability), 503 `busy` is busy, 503/504 timeouts are timeouts, and every
// other non-OK response is an ordinary error. Never an empty observation.
export function stateFromResponse({ status = 0, body = {} } = {}) {
  const code = typeof body?.code === 'string' ? body.code : '';
  const message = typeof body?.error === 'string' ? body.error : '';
  const retry = typeof body?.retry === 'function' ? body.retry : null;
  if (!status) return errorState({ message: message || 'The server did not answer.', code, retry });
  if (status === 401 || status === 403) {
    if (code === 'unsupported' || /unsupported/i.test(message)) {
      return unsupportedState({
        feature: body?.feature || body?.missing || '',
        grain: body?.grain || '',
        reason: message,
        source: body?.source || '',
        nearest: body?.nearest || null
      });
    }
    return unauthorizedState({
      message: message || (status === 401 ? 'Sign in again to read this tenant.' : 'This tenant is not authorized for this read.'),
      code: code || String(status),
      retry
    });
  }
  if (status === 503 && code === 'busy') {
    return busyState({ message: message || 'The server is busy; retry shortly.', code, retry, retryAfter: body?.retry_after ?? body?.retryAfter ?? 0 });
  }
  if ((status === 503 || status === 504) && isTimeoutCode(code)) {
    return timeoutState({ message: message || 'The read timed out; narrow the window or retry.', code, retry });
  }
  if (status === 504 || isTimeoutCode(code)) {
    return timeoutState({ message: message || 'The read timed out.', code: code || String(status), retry });
  }
  return errorState({ message: message || `The server returned ${status}.`, code: code || String(status), retry });
}

// An unsupported state names the missing capability, why it is missing, what
// supplies it, and the nearest supported choice the server does offer.
export function unsupportedState({ feature = '', grain = '', measure = '', lens = '', reason = '', source = '', nearest = null } = {}) {
  const missing = feature || [grain, measure, lens].filter(Boolean).join(' · ');
  return { state: 'unsupported', missing, reason, source, nearest };
}

// One applicability classification that reuses the unsupported state rather
// than adding a second vocabulary. The exact refusal sentence is supplied by
// the filter-applicability helper; the frame renders `message` verbatim.
export function applicabilityState({ labels = [], message = '', filters = [] } = {}) {
  const sorted = [...new Set(labels || [])].sort();
  const text = message || `This chart cannot apply ${sorted.join(', ')}. Change the filters to view it.`;
  return {
    ...unsupportedState({ feature: sorted.join(', '), reason: 'active filter unsupported' }),
    applicability: true,
    labels: sorted,
    unsupportedFilters: filters,
    message: text
  };
}

export function unsupportedText(result = {}) {
  const missing = result.missing || 'this capability';
  const reason = result.reason ? ` (${result.reason})` : '';
  const source = result.source ? ` Supplied by ${result.source}.` : '';
  const nearest = result.nearest ? ` Nearest supported choice: ${result.nearest}.` : '';
  return `${missing} is not supported${reason}.${source}${nearest}`.replace(/\s+/g, ' ').trim();
}

// A state result is ready only when the panel says so and reports no error.
// An unknown state name, an explicit failure, or a non-ready payload is
// classified, never silently shown as ready.
export function classifyResult(result) {
  if (!result || typeof result !== 'object') return errorState({ message: 'The panel returned no result.' });
  if ('state' in result) {
    if (isPanelState(result.state)) return result;
    return errorState({ message: `The panel returned an unknown state: ${String(result.state)}.`, code: 'state' });
  }
  if (result.error) return errorState({ message: String(result.error), code: result.code || '', retry: result.retry || null });
  if (result.response && result.response.ok === false) {
    return stateFromResponse({ status: result.response.status, body: result.body || result.error });
  }
  if (result.ok === false || result.ready === false) {
    return errorState({ message: result.message || 'The panel did not produce a ready result.', code: result.code || '', retry: result.retry || null });
  }
  return { state: 'ready', ...result };
}
