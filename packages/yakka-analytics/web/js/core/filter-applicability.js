// Filter applicability: a chart is refused, never silently unfiltered, when an
// active shared filter is not one the chosen measure's route can apply. The
// supported set is the intersection of the measure's published dimensions and
// the panel/route's declared scope filters. Exclude entries count as their
// dimension, not as a filter named "exclude". A response ignored_filters entry
// is unsupported even when the client expected the route to apply it, except
// on a mixed summary that gates each measure itself. Pure helpers only; the
// panel frame renders the returned state.

import { applicabilityState as panelApplicabilityState } from './panel-state.js';

export const UNSUPPORTED_FILTER_MESSAGE = 'This chart cannot apply {labels}. Change the filters to view it.';

const SCOPE_ONLY = new Set(['win', 'from', 'to', 'tz', 'cohorts', 'sel', 'pick', 'hide', 'cmp', 'all']);

const FILTER_LABELS = {
  repo_id: 'repository',
  session_repo: 'repository',
  kind: 'document kind',
  model: 'model',
  harness: 'harness',
  session_model: 'session model',
  plan: 'plan',
  tool: 'tool',
  tool_kind: 'tool category',
  conversation_id: 'conversation',
  source: 'source',
  norm_event: 'normalized event',
  event: 'event',
  stage: 'stage',
  weekday: 'weekday',
  hour_of_day: 'hour of day'
};

export function filterLabel(name) {
  if (!name) return '';
  return FILTER_LABELS[name] || String(name).replace(/_/g, ' ');
}

function publishedDims(schema, measure, grain = '') {
  if (!measure) return [];
  const metadata = schema?.measure_metadata?.[measure];
  if (Array.isArray(metadata?.dims)) return metadata.dims.slice();
  const global = findMeasure(schema?.measures, measure);
  if (Array.isArray(global?.dims)) return global.dims.slice();
  const grainMeasures = schema?.grains?.[grain]?.measures;
  const scoped = findMeasure(grainMeasures, measure);
  if (Array.isArray(scoped?.dims)) return scoped.dims.slice();
  return [];
}

function findMeasure(list, name) {
  if (!Array.isArray(list)) return null;
  return list.find(item => (typeof item === 'string' ? item : item?.name) === name) || null;
}

function declaredRouteFilters(panel = {}) {
  const declared = panel?.applies ?? panel?.scopeFilters;
  if (declared && !Array.isArray(declared) && typeof declared === 'object') {
    if (Array.isArray(declared.filters)) return declared.filters.slice();
    return Object.keys(declared).filter(key => declared[key]);
  }
  if (Array.isArray(declared)) return declared.slice();
  return null;
}

// `band:<check>:<value>` keeps the check in the dimension; every other exclude
// splits on the first colon, matching the shared filter's dim:value form.
function excludeDimension(value) {
  const text = String(value ?? '');
  if (!text) return '';
  if (text.startsWith('band:')) {
    const at = text.lastIndexOf(':');
    if (at > 'band:'.length) return text.slice(0, at);
  }
  const at = text.indexOf(':');
  return at < 0 ? '' : text.slice(0, at);
}

function activeFilters(scope = {}, ignoredFilters = []) {
  const active = new Map();
  const entries = Object.entries(scope || {}).filter(([key]) => key !== 'filters');
  if (scope?.filters && typeof scope.filters === 'object') entries.push(...Object.entries(scope.filters));
  for (const [key, raw] of entries) {
    if (SCOPE_ONLY.has(key)) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    if (key === 'exclude') {
      for (const value of values) {
        const dim = excludeDimension(value);
        if (dim) active.set(dim, true);
      }
      continue;
    }
    if (values.some(value => value !== undefined && value !== null && value !== '')) active.set(key, true);
  }
  const ignored = [];
  for (const name of ignoredFilters || []) {
    const key = String(name || '');
    if (!key) continue;
    ignored.push(key);
    active.set(key, true);
  }
  return { active: [...active.keys()], ignored: [...new Set(ignored)] };
}

function supportedSet(panel, schema, measure) {
  const dims = publishedDims(schema, measure, panel?.grain);
  const declared = declaredRouteFilters(panel);
  if (declared) {
    const published = new Set(declared);
    return new Set(dims.length ? dims.filter(name => published.has(name)) : declared);
  }
  return new Set(dims);
}

export function applicability({ panel = {}, spec = {}, scope = {}, schema = null, ignoredFilters = [] } = {}) {
  const measure = spec?.measures?.[0] || panel?.measures?.[0] || '';
  // Mixed summary panels can answer a shared filter for some cells while
  // explicitly marking other measures unavailable. Their union is the panel
  // read capability; individual cells own their narrower applicability. The
  // panel's declared filters are the published union, so a single measure's
  // narrower schema dims must not refuse the shared read.
  const supported = panel?.appliesByAnyMeasure
    ? new Set(declaredRouteFilters(panel) || [])
    : supportedSet(panel, schema, measure);
  const { active, ignored } = activeFilters(scope, ignoredFilters);
  const ignoredSet = new Set(ignored);
  const unsupportedFilters = [];
  const labels = new Set();
  for (const name of active) {
    // A mixed summary keeps a filter the union can apply and gates the cells
    // that cannot. Every other panel treats a server-ignored filter as dropped.
    if (supported.has(name) && (!ignoredSet.has(name) || panel?.appliesByAnyMeasure)) continue;
    unsupportedFilters.push(name);
    labels.add(filterLabel(name));
  }
  const sortedLabels = [...labels].sort();
  const sortedUnsupported = [...new Set(unsupportedFilters)].sort();
  const applicable = sortedUnsupported.length === 0;
  return {
    applicable,
    measure,
    labels: sortedLabels,
    message: applicable ? '' : refusalMessage(sortedLabels),
    supportedFilters: [...supported].sort(),
    unsupportedFilters: sortedUnsupported,
    ignoredFilters: ignored
  };
}

export function refusalMessage(labels = []) {
  return UNSUPPORTED_FILTER_MESSAGE.replace('{labels}', [...new Set(labels)].sort().join(', '));
}

export function applicabilityState(result) {
  if (!result || result.applicable) return null;
  return panelApplicabilityState({
    labels: result.labels,
    message: result.message || refusalMessage(result.labels),
    filters: result.unsupportedFilters
  });
}
