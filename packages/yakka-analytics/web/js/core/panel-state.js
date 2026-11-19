// The one panel-state vocabulary every frame uses. Badge presentation lives in
// charts/badges.js; this module only owns states, transitions and the text a
// panel needs for an empty or unsupported result.

export const PANEL_STATES = ['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled'];

export const BADGE_STATES = ['partial', 'sampled', 'coarsened', 'clipped', 'lower-bound'];

const TRANSITIONS = {
  loading: new Set(['ready', 'empty', 'error', 'unsupported', 'cancelled', 'loading']),
  ready: new Set(['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled']),
  empty: new Set(['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled']),
  error: new Set(['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled']),
  unsupported: new Set(['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled']),
  cancelled: new Set(['loading', 'ready', 'empty', 'error', 'unsupported', 'cancelled'])
};

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

// An unsupported state names the missing capability, why it is missing, what
// supplies it, and the nearest supported choice the server does offer.
export function unsupportedState({ feature = '', grain = '', measure = '', lens = '', reason = '', source = '', nearest = null } = {}) {
  const missing = feature || [grain, measure, lens].filter(Boolean).join(' · ');
  return { state: 'unsupported', missing, reason, source, nearest };
}

export function unsupportedText(result = {}) {
  const missing = result.missing || 'this capability';
  const reason = result.reason ? ` (${result.reason})` : '';
  const source = result.source ? ` Supplied by ${result.source}.` : '';
  const nearest = result.nearest ? ` Nearest supported choice: ${result.nearest}.` : '';
  return `${missing} is not supported${reason}.${source}${nearest}`.replace(/\s+/g, ' ').trim();
}

// A state result is ready when the panel says so and reports no error. Every
// other shape is classified, never silently shown as ready.
export function classifyResult(result) {
  if (!result || typeof result !== 'object') return errorState({ message: 'The panel returned no result.' });
  if (isPanelState(result.state)) return result;
  if (result.error) return errorState({ message: String(result.error), code: result.code || '', retry: result.retry || null });
  return { state: 'ready', ...result };
}
