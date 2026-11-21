// Shared Phase 11 scatter vocabulary: schema-valid numeric axes and size,
// categorical colour, the bounded scatter request, row keys, whole-population
// marginals, the canonical rectangle predicate and the tray's exact-population
// count. Pure helpers stay free of the DOM; the one render seam (the chooser)
// only dispatches a composed `spec` event and never touches the router.

import { canonicalPanelSpec } from '../core/view-spec.js';
import { CAPTION_TEMPLATES, LABELS } from './captions.js';
import { requestParams, schemaGrain } from './p10-shared.js';
import { table } from './pulse-strips.js';
import { canonicalJson, canonicalPredicate } from '../core/selection-model.js';
import { formatCount, formatMoney, formatNumber } from '../charts/formatters.js';

const SCORE_UNIT = 'normalized score 0–1';

const FIELD_LABELS = {
  cost_usd: 'Priced spend',
  writing_session_cost_usd: 'Writing-session spend',
  associated_cost_usd: 'Associated spend',
  commits: 'Commits',
  artifacts: 'Files',
  unpriced_calls: 'Unpriced calls',
  model_calls: 'Model calls',
  writing_session_model_calls: 'Writing-session model calls',
  writing_session_tokens_in: 'Writing-session input tokens',
  writing_session_tokens_out: 'Writing-session output tokens',
  writing_session_tokens_cache_read: 'Writing-session cached input tokens',
  writing_session_tokens_cache_write: 'Writing-session cache-write tokens',
  writing_session_tokens_reasoning: 'Writing-session reasoning tokens',
  writing_session_hook_events: 'Writing-session hook events',
  sessions: 'Associated sessions',
  shared_sessions: 'Shared sessions',
  versions: 'Versions',
  content_bytes: 'Content bytes',
  duration_s: 'Duration',
  first_ts: 'First seen',
  last_ts: 'Last seen',
  executions_complete: 'Executions complete',
  executions_unreported: 'Executions unreported',
  executions_started: 'Executions started',
  complete_share: 'Complete share',
  span_days: 'Span days',
  distinct_writing_sessions: 'Distinct writing sessions',
  conversations: 'Sessions',
  rejections: 'Rejections',
  artifact_versions: 'Artifact versions',
  distinct_content: 'Distinct content',
  hook_events: 'Hook events'
};

function titleCase(text = '') {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// The controlled label dictionary is the only place an identifier becomes
// prose. A `score:<check>` axis is a score, never a percentage.
export function scatterLabel(name = '') {
  if (!name) return '';
  if (String(name).startsWith('score:')) return `${titleCase(String(name).slice(6).replace(/_/g, ' '))} score`;
  if (String(name).startsWith('design_score:')) return `Design score (${String(name).slice(13)})`;
  if (FIELD_LABELS[name]) return FIELD_LABELS[name];
  const dictionary = LABELS.measures[name] || LABELS.entities[name];
  if (dictionary) return titleCase(dictionary);
  return String(name).replace(/_/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

export function scatterUnit(name = '') {
  if (!name) return '';
  if (['cost_usd', 'writing_session_cost_usd', 'associated_cost_usd'].includes(name)) return 'USD';
  if (name === 'commits') return 'commits';
  if (name === 'artifacts') return 'files';
  if (name === 'versions') return 'versions';
  if (name === 'sessions' || name === 'shared_sessions') return 'sessions';
  if (name === 'content_bytes') return 'bytes';
  if (String(name).startsWith('score:')) return SCORE_UNIT;
  if (['unpriced_calls', 'model_calls', 'writing_session_model_calls'].includes(name)) return 'calls';
  if (['tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'tokens_reasoning',
    'writing_session_tokens_in', 'writing_session_tokens_out', 'writing_session_tokens_cache_read',
    'writing_session_tokens_cache_write', 'writing_session_tokens_reasoning'].includes(name)) return 'tokens';
  if (name === 'hook_events' || name === 'writing_session_hook_events') return 'events';
  if (name === 'conversations') return 'sessions';
  if (name === 'artifact_versions') return 'versions';
  if (name === 'rejections') return 'rejections';
  if (name === 'complete_share') return 'percent';
  if (name === 'duration_s') return 'seconds';
  if (name === 'span_days') return 'days';
  if (name === 'distinct_writing_sessions') return 'sessions';
  return '';
}

export function scatterColourLabel(name = '') {
  if (!name) return '';
  return titleCase(LABELS.entities[name] || name.replace(/_/g, ' '));
}

// Prose inside a caption is never title-cased mid-sentence.
export function scatterProseLabel(name = '') {
  const text = scatterLabel(name);
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

const CATEGORICAL = new Set([
  'id', 'model', 'harness', 'session_model', 'session_repo', 'origin', 'has_artifacts',
  'kind', 'plan', 'repo_id', 'source', 'screen_verdict', 'scorer', 'shape', 'band', 'stage',
  'tool', 'tool_kind', 'norm_event', 'event'
]);

function publishedMeasures(grain) {
  return new Set([...(grain?.measures || []), ...(grain?.predicate?.measures || [])]);
}

// Scatter is its own mode. When the grain publishes `scatter_fields`, those are
// the only permitted numeric axes; the general measure list is not a scatter
// capability. Older schemas without the list fall back to the grain measures.
function scatterNumericFields(grain) {
  const mode = Array.isArray(grain?.scatter_fields)
    ? grain.scatter_fields.filter(name => typeof name === 'string' && name)
    : [];
  if (!mode.length) return publishedMeasures(grain);
  const measures = new Set(grain?.measures || []);
  return new Set(mode.filter(name => !measures.size || measures.has(name)));
}

function publishedLenses(grain) {
  return new Set([...(grain?.lenses || []), ...(grain?.predicate?.lenses || [])]);
}

// Numeric axes are exactly the measures the grain publishes; the grain's
// predicate list (when present) must be able to resolve them too, so a region
// the panel can draw is always a cohort the server can answer. `id` is an
// identity lens and `model` is categorical; neither is a numeric axis.
export function scatterAxes(panel, schema) {
  const grain = schemaGrain(schema, panel?.grain);
  const measures = scatterNumericFields(grain);
  const lenses = publishedLenses(grain);
  const axes = [];
  const unsupported = [];
  const modeFields = Array.isArray(grain?.scatter_fields) && grain.scatter_fields.length > 0;
  for (const name of panel?.measures || []) {
    const nearest = () => axes[0] || 'a numeric measure the server publishes';
    if (CATEGORICAL.has(name) || lenses.has(name)) {
      unsupported.push({ kind: 'axis', name, reason: `${name} is categorical and cannot be a numeric scatter axis`, try: nearest() });
      continue;
    }
    if (!grain) {
      unsupported.push({ kind: 'axis', name, reason: 'the grain is not published by /schema', try: nearest() });
      continue;
    }
    if (!measures.has(name)) {
      unsupported.push({
        kind: 'axis', name,
        reason: modeFields ? `${name} is not a published ${panel?.grain} scatter field` : `${name} is not a published ${panel?.grain} measure`,
        try: nearest()
      });
      continue;
    }
    if (grain?.predicate && Array.isArray(grain.predicate.measures) && !grain.predicate.measures.includes(name)) {
      unsupported.push({ kind: 'axis', name, reason: `${name} is not in the grain's published predicate measures`, try: nearest() });
      continue;
    }
    if (!axes.includes(name)) axes.push(name);
  }
  return { axes, unsupported };
}

// Colour is a published lens. `id` is an identity lens for explicit marks and
// is never a colour; a lens the grain does not publish is named, not coerced.
export function scatterColours(panel, schema) {
  const grain = schemaGrain(schema, panel?.grain);
  const lenses = publishedLenses(grain);
  const colours = [];
  const unsupported = [];
  for (const name of panel?.lenses || []) {
    const nearest = () => colours[0] || 'a lens the server publishes';
    if (name === 'id') {
      unsupported.push({ kind: 'colour', name, reason: 'id is an identity lens, not a colour', try: nearest() });
      continue;
    }
    if (!grain) {
      unsupported.push({ kind: 'colour', name, reason: 'the grain is not published by /schema', try: nearest() });
      continue;
    }
    if (!lenses.has(name)) {
      unsupported.push({ kind: 'colour', name, reason: `${name} is not a published ${panel?.grain} lens`, try: nearest() });
      continue;
    }
    if (!colours.includes(name)) colours.push(name);
  }
  return { colours, unsupported };
}

// The roles of the axes. They ride in the panel spec's scope bag (which the
// canonical view-spec codec preserves) so measure sorting cannot reorder them.
export function scatterSpecFields(spec = {}, schema = null) {
  const scope = spec.scope || {};
  const measures = Array.isArray(spec.measures) ? spec.measures : [];
  const grain = schemaGrain(schema, spec.grain);
  const numeric = grain ? scatterNumericFields(grain) : null;
  const pick = (candidate, fallback) => {
    if (candidate && (!numeric || numeric.has(candidate))) return candidate;
    if (fallback && (!numeric || numeric.has(fallback))) return fallback;
    return candidate || fallback || '';
  };
  return {
    x: pick(scope.x, measures[0]),
    y: pick(scope.y, measures[1]),
    size: scope.size !== undefined ? scope.size : (measures[2] || ''),
    colour: spec.split || scope.colour || ''
  };
}

// The four G contracts fix the defaults. A panel falls back to its own default
// only when the committed spec does not select a role; an explicit None stays
// None so a user can clear Size or Colour.
export const SCATTER_DEFAULTS = {
  'scatter-session': { x: 'cost_usd', y: 'commits', size: 'unpriced_calls', colour: '' },
  'scatter-artifact': { x: 'writing_session_cost_usd', y: 'score:clarity', size: '', colour: '' },
  'scatter-plan': { x: 'associated_cost_usd', y: 'artifacts', size: '', colour: 'repo_id' },
  'scatter-day': { x: 'cost_usd', y: 'commits', size: '', colour: '' }
};

export function scatterDefaults(panel = {}) {
  return SCATTER_DEFAULTS[panel?.id] || { x: '', y: '', size: '', colour: '' };
}

// Intersect the committed roles with the panel's advertised numeric/categorical
// options. X and Y stay distinct, Size/Colour may be None, and a raw id/model is
// never a numeric axis because `scatterAxes` already excludes it.
export function resolveScatterFields({ spec = {}, schema = null, panel = null, defaults = null } = {}) {
  const fallback = defaults || scatterDefaults(panel);
  const axes = scatterAxes(panel, schema).axes;
  const colours = scatterColours(panel, schema).colours;
  const scope = spec?.scope || {};
  // With no schema the caller's defaults are the only evidence; never drop them.
  const valid = name => Boolean(name) && (axes.length ? axes.includes(name) : true);
  const pick = (value, candidate) => {
    if (value !== undefined) {
      if (value === '') return '';
      if (valid(value)) return value;
    }
    return valid(candidate) ? candidate : '';
  };
  let x = pick(scope.x, fallback.x) || axes[0] || '';
  let y = pick(scope.y, fallback.y);
  if (!y || y === x) y = axes.find(name => name !== x) || '';
  let size = pick(scope.size, fallback.size);
  if (size === x || size === y) size = '';
  let colour = '';
  if (scope.colour !== undefined) colour = scope.colour === '' ? '' : (colours.includes(scope.colour) ? scope.colour : '');
  else if (spec.split && colours.includes(spec.split)) colour = spec.split;
  else if (fallback.colour && colours.includes(fallback.colour)) colour = fallback.colour;
  return { x, y, size, colour, axes, colours };
}

// The route filters each scatter entity source declares. They are declared here
// rather than on the panel entry so the shared frame never treats P6/P5 roles
// (which ride in the effective scope) as applied filters.
export const SCATTER_APPLIES = {
  'scatter-session': ['repo_id', 'session_repo', 'harness', 'session_model', 'origin', 'has_artifacts'],
  'scatter-artifact': ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'screen_verdict', 'scorer'],
  'scatter-plan': ['repo_id', 'harness', 'session_model'],
  'scatter-day': ['repo_id', 'harness', 'session_repo', 'session_model']
};

export function scatterApplies(panel = {}) {
  return SCATTER_APPLIES[panel?.id] || [];
}

// Panel-local roles live in the effective scope after assembly; strip them
// before the F check so they are never mistaken for shared filters.
export function scatterFilterScope(scope = {}) {
  const out = { ...scope };
  for (const key of ['x', 'y', 'size', 'colour', 'captionKey', 'check', 'scorer']) delete out[key];
  return out;
}

// A scatter caption is the literal G sentence for the exact default roles and
// the P10 template for any alternate axis or size. Colour never changes it.
export function scatterTemplate({ entity = 'entity', x = '', y = '', size = '' } = {}) {
  return CAPTION_TEMPLATES.scatter({
    entity, entityLabel: entity,
    x, xLabel: scatterProseLabel(x),
    y, yLabel: scatterProseLabel(y),
    size, sizeLabel: size ? scatterProseLabel(size) : ''
  });
}

// The P10 scatter table: Identity, X, Y, Size if selected, Colour if selected.
export function scatterTableColumns({ x = '', y = '', size = '', colour = '' } = {}) {
  const columns = [
    { label: 'Identity' },
    { label: `X (${scatterUnit(x) || 'count'})`, numeric: true },
    { label: `Y (${scatterUnit(y) || 'count'})`, numeric: true }
  ];
  if (size) columns.push({ label: `Size (${scatterUnit(size) || 'count'})`, numeric: true });
  if (colour) columns.push({ label: 'Colour' });
  return columns;
}

export function formatScatterCell(value, field = '') {
  if (value === null || value === undefined) return '—';
  if (scatterUnit(field) === 'USD') return formatMoney(Number(value));
  if (String(field).startsWith('score:')) return formatNumber(Number(value), { digits: 2 });
  return formatNumber(Number(value), { digits: 0 });
}

// One request seam. Bounds come from the shared window parser; only the
// published scatter mode, grain and fields are added, never an invented
// measure, dim or window.
export function scatterParams({ scope = {}, spec = {}, grain = '', fields = [] } = {}) {
  const names = (Array.isArray(fields) ? fields : []).filter(Boolean);
  return requestParams({
    scope,
    spec,
    extra: { grain, mode: 'scatter', fields: names.join(',') }
  });
}

// A session key is its `conversation_id` string; every other grain's key is
// the sorted-JSON identity object, so composite identities are never split on
// a delimiter.
export function canonicalRowKey(id, grain = '') {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'number') return String(id);
  if (grain === 'session') {
    if (typeof id.conversation_id === 'string') return id.conversation_id;
  }
  return canonicalJson(id);
}

// Map server rows to chart rows. A null axis keeps the entity in the typed
// population but is not drawn; a missing score is never zero-filled. A null
// size stays null and the chart uses its minimum radius.
export function scatterRows(body = {}, spec = {}) {
  const { x, y, size, colour } = scatterSpecFields(spec);
  const grain = spec.grain || body.grain || body.population?.grain || '';
  const rows = [];
  for (const row of Array.isArray(body.rows) ? body.rows : []) {
    const measures = row?.m || {};
    const lens = row?.l || {};
    const xValue = x ? measures[x] : null;
    const yValue = y ? measures[y] : null;
    if (xValue === null || xValue === undefined || yValue === null || yValue === undefined) continue;
    rows.push({
      key: canonicalRowKey(row.id, grain),
      x: Number(xValue),
      y: Number(yValue),
      group: colour ? (lens[colour] ?? null) : null,
      size: size ? (measures[size] ?? null) : null,
      sampled: row?.flags?.sampled === true,
      values: { ...measures, ...lens }
    });
  }
  return rows;
}

// Read the server's fixed whole-population bins for each field. The shape is
// accepted as `{field: bins}` or `[{field, bins}]`; bins are `{lo,hi,n}`.
export function marginalModel(marginals, fields = []) {
  if (!marginals) return [];
  const list = Array.isArray(marginals)
    ? marginals.slice()
    : Object.entries(marginals).map(([field, value]) => (
      value && typeof value === 'object' && !Array.isArray(value) ? { field, ...value } : { field, bins: value }
    ));
  const byField = new Map();
  for (const item of list) {
    const field = String(item?.field ?? item?.measure ?? item?.name ?? '');
    if (field) byField.set(field, item);
  }
  const names = fields.length ? fields.filter(field => byField.has(field)) : [...byField.keys()];
  return names.map(field => {
    const item = byField.get(field);
    const bins = (item.bins || item.values || []).map(bin => ({
      from: Number(bin.lo ?? bin.from),
      to: bin.hi === null || bin.hi === undefined ? null : Number(bin.hi ?? bin.to),
      n: Number(bin.n ?? bin.count ?? 0)
    }));
    const missing = item.missing ?? item.missing_n ?? item.n_missing;
    return {
      field,
      label: item.label || scatterLabel(field),
      unit: item.unit || scatterUnit(field),
      missing: missing === undefined || missing === null ? null : Number(missing),
      bins,
      total: bins.reduce((sum, bin) => sum + bin.n, 0)
    };
  });
}

export function marginalTableColumns() {
  return [
    { label: 'Axis' },
    { label: 'From', numeric: true },
    { label: 'To', numeric: true },
    { label: 'Count', numeric: true },
    { label: 'Missing count', numeric: true }
  ];
}

// X then Y, bin lower edge ascending. Missing count is an axis total, stated on
// the first row only so it is never summed twice.
export function marginalTableRows(model = []) {
  const rows = [];
  for (const marginal of model) {
    marginal.bins.forEach((bin, index) => {
      rows.push([
        scatterLabel(marginal.field),
        String(bin.from),
        bin.to === null ? 'and above' : String(bin.to),
        formatCount(bin.n),
        index === 0 ? (marginal.missing === null ? '—' : formatCount(marginal.missing)) : '—'
      ]);
    });
  }
  return rows;
}

// Marginal strips are the whole population, not the sample. They reuse the
// existing `<yk-ranges type="histogram">` element and add one shared table in
// axis order (X then Y) with the fixed columns from the G contracts.
export function renderMarginals(body = {}, fields = [], { doc = globalThis.document, schema = null } = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'scatter-marginals';
  const model = marginalModel(body.marginals, fields);
  if (!model.length) return wrapper;
  const strips = doc.createElement('div');
  strips.className = 'scatter-marginal-strips';
  for (const marginal of model) {
    const figure = doc.createElement('section');
    figure.className = 'scatter-marginal';
    figure.dataset.field = marginal.field;
    figure.dataset.axis = marginal.field === fields[0] ? 'x' : marginal.field === fields[1] ? 'y' : 'size';
    const meta = { label: marginal.label || scatterLabel(marginal.field), unit: marginal.unit || scatterUnit(marginal.field) };
    const heading = doc.createElement('h3');
    heading.textContent = `${meta.label} — whole population`;
    const chart = doc.createElement('yk-ranges');
    chart.setAttribute('type', 'histogram');
    chart.spec = {
      chart: 'ranges',
      type: 'histogram',
      units: meta.unit,
      series: [{ key: 'count', label: 'Count', unit: meta.unit, kind: 'count' }],
      bins: marginal.bins.map(bin => ({ from: bin.from, to: bin.to })),
      x: { label: meta.label, kind: 'number' },
      sample: 'whole population'
    };
    chart.data = marginal.bins.map((bin, index) => ({
      key: `bin:${index}`,
      bin: { from: bin.from, to: bin.to },
      values: { count: bin.n },
      n: bin.n
    }));
    figure.append(heading, chart);
    strips.append(figure);
  }
  wrapper.append(strips, table(doc, {
    caption: 'Marginal distributions (whole population)',
    columns: marginalTableColumns(),
    rows: marginalTableRows(model)
  }));
  return wrapper;
}

// A rectangle is ranges on the two numeric measures; it never expands into
// sampled identity keys. An empty previous region is the rectangle itself.
export function regionPredicate(region, xMeasure, yMeasure) {
  const x = region?.x || {};
  const y = region?.y || {};
  const xLo = x.min ?? x.lo ?? region?.x0 ?? null;
  const xHi = x.max ?? x.hi ?? region?.x1 ?? null;
  const yLo = y.min ?? y.lo ?? region?.y0 ?? null;
  const yHi = y.max ?? y.hi ?? region?.y1 ?? null;
  return canonicalPredicate({
    and: [
      { range: { measure: xMeasure, lo: xLo, hi: xHi } },
      { range: { measure: yMeasure, lo: yLo, hi: yHi } }
    ]
  });
}

export function unionRegion(previous, rectangle) {
  if (!previous) return canonicalPredicate(rectangle);
  return canonicalPredicate({ or: [canonicalPredicate(previous), canonicalPredicate(rectangle)] });
}

export function subtractRegion(previous, rectangle) {
  if (!previous) return canonicalPredicate(rectangle);
  return canonicalPredicate({ and: [canonicalPredicate(previous), { not: canonicalPredicate(rectangle) }] });
}

function countOf(population) {
  if (!population) return null;
  const value = population.cohort_n ?? population.scope_n;
  return value === undefined || value === null ? null : Number(value);
}

// The tray's exact-population count: one bounded aggregate request over the
// same frozen window. Never a client sum of a page.
export async function countSelection({ transport, grain, scope = {}, predicate, tenant = '', signal } = {}) {
  const params = requestParams({
    scope,
    extra: {
      grain,
      mode: 'aggregate',
      stat: 'count',
      predicate: canonicalJson(canonicalPredicate(predicate))
    }
  });
  const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'scatter-count' });
  const population = body?.population || null;
  return {
    ok: Boolean(response?.ok),
    status: response?.status ?? 0,
    error: body?.error || '',
    count: countOf(population),
    population,
    associations: population?.relation?.associations || []
  };
}

// Honest uncertainty: the sample sentence and the association-not-cause line.
export function scatterCaveat(spec = {}, body = {}) {
  const unit = body.population?.unit || body.unit || body.grain || spec?.grain || 'entity';
  const sampled = body.sampled === true;
  const returned = Number(body.returned_n ?? body.population?.returned_n ?? (body.rows || []).length);
  const population = Number(body.population_n ?? body.population?.scope_n ?? returned);
  const sample = sampled
    ? `sample of ${formatCount(returned)} of ${formatCount(population)}; marginals are the whole population`
    : `every eligible ${unit} in scope is drawn; marginals are the whole population`;
  const association = 'association, not cause — a mark region names a population, it does not explain it';
  return { sample, association, text: `${sample}. ${association}.` };
}

// The typed population sentence: one unit, sample, returned and eligible.
export function scatterPopulationText(body = {}) {
  const population = body.population || {};
  const unit = population.unit || body.unit || body.grain || 'entity';
  const eligible = Number(population.eligible_n ?? body.population_n ?? population.scope_n ?? 0);
  const returned = Number(body.returned_n ?? population.returned_n ?? (body.rows || []).length);
  const whole = Number(body.population_n ?? population.scope_n ?? eligible);
  const sampled = body.sampled === true;
  const marks = sampled ? 'sampled marks' : 'marks';
  return `${formatCount(eligible)} eligible ${unit} · ${formatCount(returned)} ${marks} of ${formatCount(whole)} in the whole population`;
}

function select(doc, labelText, options, value, onChange) {
  const label = doc.createElement('label');
  label.className = 'p11-chooser-field';
  label.append(doc.createTextNode(labelText));
  const control = doc.createElement('select');
  control.setAttribute('aria-label', labelText);
  for (const option of options) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    control.append(node);
  }
  control.addEventListener('change', () => onChange(control.value));
  label.append(control);
  return label;
}

// P6: X axis, Y axis, Size (None then numeric fields) and Colour (None then
// categorical lenses). Numeric-only X/Y, deterministic panel-list order, and a
// change writes scope.x/y/size/colour and keeps measures by codec.
export function renderScatterChooser({ panelId, spec = {}, schema = null, panel = null, doc = globalThis.document, onSpec = null, defaults = null } = {}) {
  const axes = scatterAxes(panel, schema);
  const colours = scatterColours(panel, schema);
  const fields = resolveScatterFields({ spec, schema, panel, defaults });
  const grain = spec.grain || panel?.grain || '';
  const wrapper = doc.createElement('div');
  wrapper.className = 'p11-chooser';
  const unsupported = [...axes.unsupported, ...colours.unsupported];
  const axisOptions = fields.axes.map(name => ({ value: name, label: scatterLabel(name) }));
  const sizeOptions = [{ value: '', label: 'None' }, ...axisOptions];
  const colourOptions = [{ value: '', label: 'None' }, ...fields.colours.map(name => ({ value: name, label: scatterColourLabel(name) }))];

  const dispatch = patch => {
    const scope = { ...(spec.scope || {}), ...(patch.scope || {}) };
    const next = canonicalPanelSpec({
      grain,
      measures: [scope.x, scope.y, scope.size].filter(Boolean),
      split: scope.colour || '',
      chart: 'scatter',
      scope
    }) || { grain, measures: [], chart: 'scatter', scope };
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
    if (typeof onSpec === 'function') onSpec(next);
  };

  const other = (value, current) => fields.axes.find(name => name !== value && name !== current) || '';

  wrapper.append(
    select(doc, 'X axis', axisOptions, fields.x, value => {
      const scope = { x: value };
      if (value === fields.y) scope.y = other(value, fields.x);
      dispatch({ scope });
    }),
    select(doc, 'Y axis', axisOptions, fields.y, value => {
      const scope = { y: value };
      if (value === fields.x) scope.x = other(value, fields.y);
      dispatch({ scope });
    }),
    select(doc, 'Size', sizeOptions, fields.size, value => dispatch({ scope: { size: value } })),
    select(doc, 'Colour', colourOptions, fields.colour, value => dispatch({ scope: { colour: value } }))
  );

  if (unsupported.length) {
    const list = doc.createElement('ul');
    list.className = 'p11-unsupported';
    list.setAttribute('aria-label', 'Unsupported scatter choices');
    for (const item of unsupported) {
      const node = doc.createElement('li');
      node.dataset.kind = item.kind;
      node.textContent = `${item.kind} ${item.name} is unsupported: ${item.reason}. Try ${item.try}.`;
      list.append(node);
    }
    wrapper.append(list);
  }
  return { element: wrapper, fields, unsupported, dispatch };
}
