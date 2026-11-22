// One shared caption seam for every panel. A registered caption is either a
// literal string or a function of the panel, spec, scope, schema and result;
// chart families share the templates below, and the label dictionary is the
// only place an identifier becomes prose. A panel that registers no usable
// caption gets an explicit refusal, never generic basis text.

export const LABELS = {
  measures: {
    cost_usd: 'priced spend',
    usd: 'USD',
    model_calls: 'model calls',
    unpriced_calls: 'unpriced calls',
    hook_events: 'hook events',
    conversations: 'sessions',
    artifact_versions: 'artifact versions',
    distinct_content: 'distinct content',
    commits: 'commits',
    rejections: 'rejections',
    tokens_in: 'input tokens',
    tokens_out: 'output tokens',
    tokens_cache_read: 'cached input tokens',
    tokens_cache_write: 'cache-write tokens',
    tokens_reasoning: 'reasoning tokens'
  },
  entities: {
    model: 'model',
    harness: 'coding tool',
    session_model: 'session model',
    session_repo: 'repository',
    repo_id: 'repository',
    kind: 'document kind',
    plan: 'plan',
    tool: 'tool',
    tool_kind: 'tool category'
  },
  buckets: {
    hour: 'hour',
    day: 'day',
    week: 'week',
    month: 'month'
  },
  units: {
    usd: 'USD',
    calls: 'calls',
    events: 'events',
    versions: 'versions',
    commits: 'commits',
    sessions: 'sessions',
    rejections: 'rejections',
    tokens: 'tokens',
    observations: 'observations',
    files: 'files',
    bytes: 'bytes',
    percent: 'percent',
    score: 'normalized score (0–1)'
  }
};

// A raw snake_case identifier is never prose. Values such as "cache-write" and
// "middle half" pass; "session_repo" does not.
const RAW_IDENTIFIER = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;

export function hasRawIdentifier(value) {
  return RAW_IDENTIFIER.test(String(value || ''));
}

function measureLabel(value) {
  if (!value) return '';
  return LABELS.measures[value] || value;
}

function entityLabel(value) {
  if (!value) return '';
  return LABELS.entities[value] || value;
}

function bucketLabel(value, step) {
  if (!value) return '';
  if (step) return `${step} ${LABELS.buckets[value] || value} buckets`;
  return LABELS.buckets[value] || value;
}

function unitLabel(value) {
  if (!value) return '';
  const key = String(value).toLowerCase();
  return LABELS.units[key] || value;
}

function label(value, resolve, explicit) {
  if (explicit) return explicit;
  return resolve(value);
}

function populationLabel(value) {
  if (!value) return '';
  return LABELS.measures[value] || LABELS.entities[value] || value;
}

function checkLabel(value) {
  if (!value) return '';
  if (value === 'clarity') return 'clarity';
  return String(value).replace(/_/g, ' ');
}

export const CAPTION_TEMPLATES = {
  columns: vars => `Each bar shows ${label(vars.measure, measureLabel, vars.measureLabel)} per ${label(vars.bucket, value => bucketLabel(value, vars.step), vars.bucketLabel)}, grouped by ${label(vars.group, entityLabel, vars.groupLabel)}; taller bars mean more ${label(vars.unit, unitLabel, vars.unitLabel)}.`,

  'lines/area': vars => `Each line shows ${label(vars.measure, measureLabel, vars.measureLabel)} over time for one ${label(vars.group, entityLabel, vars.groupLabel)}; higher points mean more ${label(vars.unit, unitLabel, vars.unitLabel)} in that bucket.`,

  'small multiples': vars => `Each small chart shows ${label(vars.measure, measureLabel, vars.measureLabel)} over time for one ${label(vars.group, entityLabel, vars.groupLabel)} on the same scale; compare heights across charts.`,

  'rank/bars': vars => `Each bar shows ${label(vars.measure, measureLabel, vars.measureLabel)} for one ${label(vars.group, entityLabel, vars.groupLabel)}; longer bars mean more ${label(vars.unit, unitLabel, vars.unitLabel)}.`,

  'stacked/share': vars => `Each bar shows ${label(vars.measure, measureLabel, vars.measureLabel)} for one ${label(vars.group, entityLabel, vars.groupLabel)}, split by ${label(vars.series, entityLabel, vars.seriesLabel)}; compare segment lengths using the ${label(vars.unit, unitLabel, vars.unitLabel)} axis.`,

  treemap: vars => `Each rectangle shows ${label(vars.measure, measureLabel, vars.measureLabel)} for a ${label(vars.child, entityLabel, vars.childLabel)} within a ${label(vars.parent, entityLabel, vars.parentLabel)}; larger rectangles mean more ${label(vars.unit, unitLabel, vars.unitLabel)}.`,

  ranges: vars => `Each row shows the spread of ${label(vars.measure, measureLabel, vars.measureLabel)} for one ${label(vars.group, entityLabel, vars.groupLabel)}; the box covers the middle half and the line marks the median.`,

  slope: vars => `Each segment joins a ${label(vars.group, entityLabel, vars.groupLabel)}’s previous and selected-period ${label(vars.measure, measureLabel, vars.measureLabel)}; an upward segment means more ${label(vars.unit, unitLabel, vars.unitLabel)} in the selected period.`,

  histogram: vars => {
    const population = label(vars.population, populationLabel, vars.populationLabel);
    return `Each bar counts ${population} in a ${label(vars.measure, measureLabel, vars.measureLabel)} range; taller bars mean more ${population} in that range.`;
  },

  'cumulative distribution': vars => `Each line shows the percentage of ${label(vars.population, populationLabel, vars.populationLabel)} at or below a ${label(vars.measure, measureLabel, vars.measureLabel)} value; read up from a value to find that percentage.`,

  scatter: vars => {
    const sizeSentence = vars.size || vars.sizeLabel
      ? `larger dots mean more ${label(vars.size, populationLabel, vars.sizeLabel)}`
      : 'all dots have the same size';
    return `Each dot is a ${label(vars.entity, entityLabel, vars.entityLabel)}, with ${label(vars.x, measureLabel, vars.xLabel)} across and ${label(vars.y, measureLabel, vars.yLabel)} up; ${sizeSentence}.`;
  },

  calendar: vars => `Each square shows ${label(vars.measure, measureLabel, vars.measureLabel)} on one day; use the labelled colour scale to compare ${label(vars.unit, unitLabel, vars.unitLabel)}.`,

  rhythm: () => 'Each square counts hook events for a weekday and hour in the selected timezone; use the labelled colour scale to compare event counts.',

  'score ranges/trend': vars => {
    const kind = vars.kind || 'design';
    const check = checkLabel(vars.check || 'clarity');
    const group = label(vars.group, entityLabel, vars.groupLabel);
    if (vars.mode === 'trend') {
      return `Each line shows ${kind} ${check} scores over time for one ${group}; the middle line is the median and the outer lines bound the middle half.`;
    }
    return `Each row shows ${kind} ${check} scores for a ${group}, counting each content version once; the box covers the middle half and the line marks the median.`;
  },

  strip: vars => `Each dot is a file’s latest ${label(vars.check, checkLabel, vars.checkLabel)} score, grouped by ${label(vars.group, entityLabel, vars.groupLabel)}; dots farther right have higher scores.`,

  'band mix': vars => `Each bar counts files of one document kind by ${label(vars.check, checkLabel, vars.checkLabel)} band; unscored files are shown separately from scored files.`
};

const captions = new Map();

export function registerCaption(panelId, caption) {
  if (typeof panelId !== 'string' || !panelId.trim()) throw new Error('caption needs a panel id');
  if (typeof caption !== 'string' && typeof caption !== 'function') throw new Error(`caption for ${panelId} must be a string or a function`);
  captions.set(panelId, caption);
  return caption;
}

export function clearCaptions() {
  captions.clear();
}

export function hasCaption(panelId) {
  return captions.has(panelId);
}

function refusal(panelId) {
  return `No plain-language caption is registered for ${panelId}.`;
}

// Resolve the panel's caption (registered later or on the entry) against the
// current context. A missing, non-string, empty or raw-identifier result is an
// explicit refusal. A template that advertises a label with no dictionary
// entry surfaces as a refusal rather than a guessed word.
export function captionFor(panel, spec = {}, context = {}) {
  const id = typeof panel?.id === 'string' ? panel.id : '';
  const registered = captions.has(id) ? captions.get(id) : panel?.caption;
  if (registered === undefined || registered === null) return refusal(id);
  let value;
  try {
    value = typeof registered === 'function'
      ? registered({ panel, spec, scope: context?.scope || {}, schema: context?.schema || null, ...context })
      : registered;
  } catch {
    return refusal(id);
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || hasRawIdentifier(text)) return refusal(id);
  return text;
}
