// Older analytics servers apply different rejection semantics to these
// advanced fields. Refuse their use in retained-record lists until the server
// advertises the shared record_filters predicate.
export const LEGACY_RECORD_FILTER_MESSAGE = 'This server cannot apply these filters to rejection records.';

const LEGACY_UNSAFE_FILTERS = new Set([
  'conversation_id', 'event', 'norm_event', 'tool', 'model', 'source'
]);

function excludeLens(value) {
  const raw = String(value || '');
  const separator = raw.indexOf(':');
  return separator < 0 ? '' : raw.slice(0, separator);
}

export function hasUnsafeLegacyRecordFilters(state = {}) {
  if (Object.keys(state.filters || {}).some(key => LEGACY_UNSAFE_FILTERS.has(key))) return true;
  return (state.exclude || []).some(value => excludeLens(value) !== 'stage');
}
