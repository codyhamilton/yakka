// Shared P10 seams: the schema-driven chooser, the one request builder every
// Trend/Compare/Quality/Cost/Tool panel uses, the population and comparison
// read-outs, and the small style/slot helpers. Pure helpers stay free of the
// DOM so the node checks can exercise them; the one render seam (the chooser)
// only dispatches a composed `spec` event and never touches the router.

import { currentWindow, ensurePulseStyles, scopeParams, whenPanelBody, windowParams, WINDOW_MS } from './pulse-strips.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { publishedNames } from '../core/schema-adapter.js';
import { decodeCohort, encodeCohort } from '../core/selection-model.js';
import { formatCount, formatMoney, formatNumber } from '../charts/formatters.js';

export { currentWindow, ensurePulseStyles, previousWindow, scopeParams, whenPanelBody, windowParams } from './pulse-strips.js';

const SPLIT_EXCLUDED = new Set(['hour_of_day', 'weekday', 'id']);
const FILTER_KEYS = ['repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id'];

// Units and kinds for the measures CONTRACTS.md publishes, used only when
// `/schema.measures` omits one. Never invents a measure or a dim.
export const MEASURE_FALLBACK = {
  cost_usd: { label: 'Cost', unit: 'USD', kind: 'money' },
  model_calls: { label: 'Model calls', unit: 'calls', kind: 'count' },
  unpriced_calls: { label: 'Unpriced calls', unit: 'calls', kind: 'count' },
  conversations: { label: 'Sessions', unit: 'sessions', kind: 'count' },
  hook_events: { label: 'Events', unit: 'events', kind: 'count' },
  artifact_versions: { label: 'Artifact versions', unit: 'versions', kind: 'count' },
  distinct_content: { label: 'Distinct content', unit: 'content hashes', kind: 'count' },
  commits: { label: 'Commits', unit: 'commits', kind: 'count' },
  rejections: { label: 'Rejections', unit: 'rejections', kind: 'count' },
  tokens_in: { label: 'Tokens in', unit: 'tokens', kind: 'tokens' },
  tokens_out: { label: 'Tokens out', unit: 'tokens', kind: 'tokens' },
  tokens_cache_read: { label: 'Cached tokens read', unit: 'tokens', kind: 'tokens' },
  tokens_cache_write: { label: 'Cached tokens written', unit: 'tokens', kind: 'tokens' },
  tokens_reasoning: { label: 'Reasoning tokens', unit: 'tokens', kind: 'tokens' }
};

function unitKind(unit) {
  const text = String(unit || '').toLowerCase();
  if (text === 'usd' || text.includes('dollar')) return 'money';
  if (text.includes('token')) return 'tokens';
  return 'count';
}

export function schemaGrain(schema, grain) {
  return schema?.grains?.[grain] || null;
}

export function measureMeta(schema, name) {
  const key = String(name || '');
  const mapped = schema?.measure_metadata?.[key] || {};
  const listed = (Array.isArray(schema?.measures) ? schema.measures : [])
    .find(item => (typeof item === 'string' ? item : item?.name) === key) || null;
  const fallback = MEASURE_FALLBACK[key] || {};
  const unit = mapped.unit || listed?.unit || fallback.unit || '';
  const dims = Array.isArray(mapped.dims) ? mapped.dims : Array.isArray(listed?.dims) ? listed.dims : [];
  return {
    name: key,
    label: fallback.label || key,
    unit,
    kind: fallback.kind || unitKind(unit),
    dims: dims.slice()
  };
}

// A measure is offered only when the grain `/schema` publishes it. The panel's
// own list is the upper bound; the server response decides the intersection.
export function offeredMeasures(panel, schema) {
  const grain = schemaGrain(schema, panel?.grain);
  const published = new Set(publishedNames(grain?.measures));
  return (panel?.measures || []).filter(measure => !grain ? true : published.has(measure));
}

export function offeredSplit(panel, measure, schema) {
  const grain = schemaGrain(schema, panel?.grain);
  const meta = measureMeta(schema, measure);
  const candidates = new Set([...publishedNames(grain?.lenses), ...(meta.dims || [])]);
  const offered = [...candidates].filter(lens => !SPLIT_EXCLUDED.has(lens));
  return offered.sort();
}

export function defaultMeasure(panel, spec, schema) {
  const offered = offeredMeasures(panel, schema);
  const chosen = (spec?.measures || [])[0];
  if (chosen && offered.includes(chosen)) return chosen;
  if (offered.includes('cost_usd')) return 'cost_usd';
  return offered[0] || '';
}

export function chooserModel(panel, spec = {}, schema = null) {
  spec = spec || {};
  const measures = offeredMeasures(panel, schema);
  const measure = defaultMeasure(panel, spec, schema);
  const splits = offeredSplit(panel, measure, schema);
  const charts = (panel?.charts || []).slice();
  const unsupported = [];

  for (const name of panel?.measures || []) {
    if (!measures.includes(name)) {
      unsupported.push({
        kind: 'measure', name,
        reason: schemaGrain(schema, panel?.grain) ? 'not published for this grain' : 'grain not published',
        source: panel?.requires?.[0] ? `this plan's ${panel.requires[0]}` : 'server /schema'
      });
    }
  }
  const split = spec.split && splits.includes(spec.split) ? spec.split : '';
  if (spec.split && !splits.includes(spec.split)) {
    unsupported.push({ kind: 'split', name: spec.split, reason: 'no published lens/dim for this measure', source: 'server /schema' });
  }
  const chart = spec.chart && charts.includes(spec.chart) ? spec.chart : (charts[0] || '');
  if (spec.chart && !charts.includes(spec.chart)) {
    unsupported.push({ kind: 'chart', name: spec.chart, reason: 'not a chart this panel supports', source: 'chart kit' });
  }
  return { measures, splits, charts, unsupported, measure, split, chart };
}

const COHORT_KEYS = ['ca', 'cb', 'cc', 'cd'];
const COHORT_LABELS = { ca: 'A', cb: 'B', cc: 'C', cd: 'D' };

// The panel already receives `cohorts` (and `cmp`) from its effective scope via
// view-spec `cleanPanelScope`; no request seam reads global location state. The
// helper stays as the single normalisation point for pure callers.
export function scopeWithCohorts(scope = {}) {
  return scope;
}

// Decode the four URL slots in A–D order. A slot that does not decode is named
// by its letter and never sent; it does not silently disappear.
export function cohortSlots(scope = {}) {
  const slots = [];
  for (const key of COHORT_KEYS) {
    const text = scope.cohorts?.[key];
    if (!text) continue;
    const cohort = decodeCohort(text);
    slots.push({
      key,
      label: COHORT_LABELS[key],
      text: cohort ? encodeCohort(cohort) : '',
      cohort
    });
  }
  return slots;
}

// One request seam: the primary cohort is the first defined slot in A–D order.
// A malformed slot is named in the non-enumerable `issues` list so request
// builders never put it on the wire.
export function cohortParams(scope = {}) {
  const slots = cohortSlots(scopeWithCohorts(scope));
  const valid = slots.filter(slot => slot.cohort);
  const params = {};
  if (valid.length) params.cohort = valid[0].text;
  Object.defineProperty(params, 'issues', {
    enumerable: false,
    value: slots.filter(slot => !slot.cohort).map(slot => `Cohort ${slot.label} is malformed and was not sent.`)
  });
  return params;
}

// The comparison the panel should issue. It classifies the scope once so every
// panel applies the same cohort/period rules; it never invents a population.
export function comparisonPlan(scope = {}) {
  const scopeValue = scopeWithCohorts(scope);
  scope = scopeValue;
  const slots = cohortSlots(scope);
  const valid = slots.filter(slot => slot.cohort);
  const issues = slots.filter(slot => !slot.cohort).map(slot => `Cohort ${slot.label} is malformed and was not sent.`);
  const cmp = scope.cmp || 'off';

  if (cmp === 'period') {
    if (!currentWindow(scope)) {
      return { mode: 'period', current: null, previous: null, unsupported: 'Choose a finite period to compare periods.', issues };
    }
    const cohort = valid[0] ? valid[0].text : null;
    return { mode: 'period', current: { cohort }, previous: { cohort }, issues };
  }

  if (cmp === 'cohorts') {
    if (valid.length > 2) {
      return { mode: 'cohorts', unsupported: 'compare shows cohorts A and B; clear unused cohorts', issues };
    }
    const [a, b] = valid;
    if (a && b && a.cohort.grain !== b.cohort.grain) {
      return {
        mode: 'cohorts',
        unsupported: `Cohort A is ${a.cohort.grain} and Cohort B is ${b.cohort.grain}; compare cohorts from the same source grain.`,
        issues
      };
    }
    if (a && b) {
      return { mode: 'cohorts', a: a.text, b: b.text, aLabel: `Cohort ${a.label}`, bLabel: `Cohort ${b.label}`, issues };
    }
    if (a) {
      return { mode: 'cohorts', a: a.text, b: null, aLabel: `Cohort ${a.label}`, bLabel: 'all in scope', issues };
    }
    return { mode: 'cohorts', a: null, b: null, aLabel: 'Cohort A', bLabel: 'Cohort B', issues };
  }

  if (valid.length) return { mode: 'single', cohort: valid[0].text, issues };
  return { mode: 'none', issues };
}

export function requestScope(scope = {}) {
  return scopeParams(scope);
}

function iso(value) {
  return new Date(Number(value)).toISOString();
}

// Every P10 request goes through here. Absolute current-window bounds come from
// the shared window parser; `win=all` becomes `all=1`; only contract filter
// names, excludes and `cohort` reach the wire.
export function requestParams({ scope = {}, spec = {}, measure = '', split = '', bucket = '', extra = null, cohort = undefined } = {}) {
  scope = scopeWithCohorts(scope);
  const params = new URLSearchParams();
  const win = currentWindow(scope);
  if (win) {
    params.set('from', iso(win.from));
    params.set('to', iso(win.to));
  } else {
    params.set('all', '1');
  }
  if (scope.tz) params.set('tz', scope.tz);
  for (const key of FILTER_KEYS) {
    const value = scope[key];
    if (Array.isArray(value)) { for (const item of value) if (item) params.append(key, item); }
    else if (typeof value === 'string' && value) params.set(key, value);
  }
  if (Array.isArray(scope.exclude)) for (const item of scope.exclude) if (item) params.append('exclude', item);
  if (measure) params.set('measure', measure);
  if (split) params.append('dim', split);
  if (bucket) params.set('bucket', bucket);
  const chosen = cohort === undefined
    ? cohortParams(scope)
    : (cohort ? { cohort: typeof cohort === 'string' ? cohort : encodeCohort(cohort) } : {});
  for (const [key, value] of Object.entries(chosen)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, item);
    else if (value !== undefined && value !== null && value !== '') params.set(key, value);
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (key === 'cohort' && params.has('cohort')) continue;
      if (Array.isArray(value)) { for (const item of value) if (item !== undefined) params.append(key, item); }
      else if (value !== undefined && value !== null && value !== '') params.set(key, value);
    }
  }
  return params;
}

// Shared honest-join refusal (CONTRACTS.md 17.3): a fact measure has no
// repo_id, so a direct repo split groups every row under the empty string; cost
// is not derived from tool counts. Each refusal names the nearest real view.
export function honestJoinGuard(measure, dims = []) {
  const picked = (Array.isArray(dims) ? dims : [dims]).filter(Boolean);
  const repo = picked.find(dim => dim === 'repo_id' || dim === 'session_repo');
  const tool = picked.find(dim => dim === 'tool' || dim === 'tool_kind');
  if (measure === 'cost_usd' && repo) {
    return {
      missing: `cost by ${picked.join(' × ')}`,
      reason: 'direct repo_id on usage rows is empty and session_repo is not served on /query for cost',
      try: '/distribution?dim=session_repo (counts, medians, unpriced)'
    };
  }
  if (measure === 'cost_usd' && tool) {
    return {
      missing: `cost by ${picked.join(' × ')}`,
      reason: 'cost is not derived from hook events or tool counts',
      try: 'hook_events by tool'
    };
  }
  if (measure === 'hook_events' && repo) {
    return {
      missing: `${measure} by ${repo}`,
      reason: 'these facts carry no repo_id; every row would group under the empty string',
      try: 'harness'
    };
  }
  return null;
}

// score-series resolutions are route-specific (DESIGN.md:99). The route entry,
// when published, replaces the legacy global auto/year flags; older schemas get
// the known day/week/month set for this route and never inferred global auto.
export const SCORE_SERIES_BUCKETS = ['day', 'week', 'month'];

export function scoreSeriesRoute(schema = null) {
  const route = schema?.resolutions?.routes?.['score-series'];
  const buckets = Array.isArray(route?.buckets)
    ? route.buckets.filter(name => typeof name === 'string' && name)
    : [];
  return {
    buckets: buckets.length ? buckets : SCORE_SERIES_BUCKETS.slice(),
    auto: route?.auto === true,
    published: Boolean(route)
  };
}

export function bucketForWindow(scope = {}, schema = null) {
  const supported = scoreSeriesRoute(schema).buckets;
  const pick = name => supported.includes(name) ? name : (supported[supported.length - 1] || 'month');
  const win = currentWindow(scope);
  if (!win) return pick('month');
  const days = (win.to - win.from) / (WINDOW_MS.d);
  if (days <= 90) return pick('day');
  if (days <= 730) return pick('week');
  return pick('month');
}

// Effective bucket/window text from the response contract (17.1): the server
// reports `requested_bucket`, `bucket`, `coarsened` and `window`. The legacy
// `requested`/`effective` shape is read too so Phase 9 responses still render.
export function bucketInfo(body = {}) {
  const requested = body.requested_bucket ?? body.requested?.bucket ?? body.requested?.resolution ?? '';
  const effective = body.bucket ?? body.effective?.bucket ?? body.effective?.resolution ?? requested;
  const coarsened = body.coarsened === true || Boolean(requested && effective && requested !== effective);
  return { requested, effective, coarsened, window: body.window || null };
}

export function coarsenedText(body = {}) {
  const { requested, effective, coarsened } = bucketInfo(body);
  if (!effective) return 'The server did not report an effective bucket.';
  return coarsened
    ? `Requested ${requested} buckets; the server coarsened them to ${effective}.`
    : `Cells are ${effective} buckets.`;
}

export function windowText(body = {}) {
  const window = body.window;
  if (!window) return '';
  const from = window.from ?? window.start;
  const to = window.to ?? window.end;
  if (from === undefined || to === undefined) return '';
  return `Effective window ${from} → ${to}.`;
}

export function populationLine(result = {}) {
  const population = result?.population || result?.response?.population || null;
  if (!population) return 'the server did not report a population';
  const unit = population.unit || population.grain || 'row';
  const returned = population.returned_n ?? 0;
  const eligible = population.eligible_n ?? population.scope_n ?? 0;
  const relation = population.relation?.resolved_n !== undefined
    ? ` · ${population.relation.resolved_n} ${population.relation.resolved_unit || 'session'} resolved by the cohort`
    : '';
  return `${returned} of ${eligible} ${unit}${relation}`;
}

// Each coverage fact names its own unit. Nothing is blended into a percentage.
export function coverageFacts(result = {}) {
  const population = result?.population || result?.response?.population || null;
  const facts = [];
  for (const [reason, count] of Object.entries(population?.missing_by_reason || {})) {
    if (count !== undefined && count !== null) facts.push(`${formatCount(count)} missing: ${reason}`);
  }
  const body = result?.body || result;
  if (body?.unpriced !== undefined && body.unpriced !== null) facts.push(`${formatCount(body.unpriced)} unpriced`);
  if (body?.omitted_groups !== undefined && body.omitted_groups !== null) facts.push(`${formatCount(body.omitted_groups)} groups omitted`);
  if (body?.omitted_n !== undefined && body?.omitted_n !== null) facts.push(`${formatCount(body.omitted_n)} rows in omitted groups`);
  if (body?.unscored !== undefined && body.unscored !== null) facts.push(`${formatCount(body.unscored)} unscored`);
  if (body?.unattributed !== undefined && body?.unattributed !== null) facts.push(`${formatCount(body.unattributed)} unattributed`);
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  for (const label of ['(mixed)', '(none)', '(multi)']) {
    const row = rows.find(item => String(item?.k) === label);
    if (row) facts.push(`${formatCount(row.n ?? 0)} ${label}`);
  }
  for (const key of ['partial', 'sampled', 'coarsened', 'clipped', 'lower_bound']) {
    if (body?.[key]) facts.push(key.replace('_', ' '));
  }
  return facts;
}

function sideSummary(label, body, unit) {
  const population = body?.population || body?.response?.population || null;
  return {
    label,
    unit: population?.unit || unit || 'row',
    population,
    coverage: coverageFacts(body || {}),
    sample: population ? population.returned_n : null,
    present: Boolean(body)
  };
}

function populationCounts(population) {
  if (!population) return '';
  const unit = population.unit || population.grain || 'row';
  return [
    `${formatCount(population.scope_n ?? 0)} ${unit} in scope`,
    `${formatCount(population.cohort_n ?? population.scope_n ?? 0)} after the cohort`,
    `${formatCount(population.eligible_n ?? 0)} eligible`,
    `${formatCount(population.returned_n ?? 0)} returned`
  ].join(', ');
}

function sideLabel(key, plan) {
  if (key === 'current') return 'Current period';
  if (key === 'previous') return 'Previous period';
  if (key === 'a') return plan?.aLabel || 'Cohort A';
  if (key === 'b') return plan?.bLabel || 'all in scope';
  return key;
}

// A comparison always prints both populations, their units, coverage and sample
// sizes. A missing side is named, never treated as zero; a difference is only
// ever shown beside both sides.
export function comparisonSummary({ plan = null, sides = null, unit = '', current = null, previous = null } = {}) {
  if (plan?.unsupported) return { sides: [], text: plan.unsupported, unsupported: plan.unsupported, unit };
  // Legacy call shape: comparisonSummary({current, previous, unit}).
  const legacy = sides === null && (current !== undefined || previous !== undefined);
  let entries = [];
  if (legacy) entries = [{ key: 'current', label: 'Current period', body: current }, { key: 'previous', label: 'Previous period', body: previous }];
  else if (Array.isArray(sides)) entries = sides.map(item => ({ label: item.label, body: item.body ?? item.result ?? null }));
  else if (sides && typeof sides === 'object') {
    entries = Object.entries(sides).map(([key, body]) => ({ label: sideLabel(key, plan), body: body || null }));
  }
  const summaries = entries.map(entry => sideSummary(entry.label, entry.body, unit));
  const lines = summaries.map(side => {
    if (!side.present) {
      if (legacy && side.label === 'Previous period') return `${side.label}: no previous period (all-history scope).`;
      return `${side.label}: not reported (no population).`;
    }
    const counts = populationCounts(side.population) || populationLine({ population: side.population });
    const coverage = side.coverage.length ? ` Coverage: ${side.coverage.join(', ')}.` : '';
    return `${side.label}: ${counts}.${coverage}`;
  });
  return { sides: summaries, text: lines.join(' '), unit: unit || (summaries[0]?.unit || 'row') };
}

export function deltaText(current, previous, unit = '') {
  if (current === null || current === undefined || previous === null || previous === undefined) return 'not comparable';
  const delta = Number(current) - Number(previous);
  if (!Number.isFinite(delta)) return 'not comparable';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = unit === 'USD'
    ? formatMoney(Math.abs(delta))
    : formatCount(Math.abs(delta), { unit });
  return `${sign}${magnitude}`;
}

// A contract lens on every series keeps legend focus emit the right chip.
export function lensSeries(lens, values, meta = {}) {
  return (values || []).map(value => ({
    key: `${lens}:${value}`,
    label: String(value),
    lens,
    unit: meta.unit || '',
    kind: meta.kind || 'count'
  }));
}

// `queryRows` maps a `/query` body to `<yk-chart>` rows. `dims` is the split
// lens (or ''). Sparse server rows stay sparse: no missing bucket is invented.
export function queryRows(body = {}, measure = '', split = '', meta = {}) {
  const source = Array.isArray(body.rows) ? body.rows : [];
  const keys = [];
  for (const row of source) {
    const value = split ? (row.k?.[0] ?? '') : 'all';
    if (!keys.includes(value)) keys.push(value);
  }
  const series = split ? lensSeries(split, keys, meta) : [{ key: measure, label: meta.label || measure, unit: meta.unit || '', kind: meta.kind || 'count' }];
  const byTime = new Map();
  for (const row of source) {
    const x = row.t ? Date.parse(row.t) : null;
    if (x === null || !Number.isFinite(x)) continue;
    const k = split ? `${split}:${row.k?.[0] ?? ''}` : measure;
    if (!byTime.has(x)) byTime.set(x, { key: `t:${row.t}`, x, values: {} });
    byTime.get(x).values[k] = row.v === null || row.v === undefined ? null : Number(row.v);
  }
  const rows = [...byTime.values()].sort((a, b) => a.x - b.x);
  return { series: series.filter(item => split ? keys.includes(item.label) : true), rows, keys };
}

export function rankRows(body = {}, measure = '', split = '', meta = {}) {
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(row => ({
    key: `${split}:${row.k?.[0] ?? ''}`,
    label: row.k?.[0] ?? '(none)',
    values: { [measure]: row.v === null || row.v === undefined ? null : Number(row.v) },
    lenses: split ? { [split]: row.k?.[0] ?? '' } : {}
  }));
  return { rows, series: [{ key: measure, label: meta.label || measure, unit: meta.unit || '', kind: meta.kind || 'count' }] };
}

export function ensureP10Styles(href = '/css/trends.css', doc = globalThis.document) {
  let path = href;
  let document_ = doc;
  if (href && typeof href === 'object') { path = '/css/trends.css'; document_ = href; }
  if (typeof path !== 'string' || !path) path = '/css/trends.css';
  if (document_.querySelector(`link[href="${path}"]`)) return;
  const link = document_.createElement('link');
  link.rel = 'stylesheet';
  link.href = path;
  document_.head?.append(link);
}

export function whenPanelSlot(panelId, slot, doc = globalThis.document, paint = () => {}) {
  const selector = `[data-panel="${panelId}"] .workspace-panel-${slot}`;
  const host = doc.querySelector(selector);
  if (host) { paint(host); return; }
  queueMicrotask(() => {
    const later = doc.querySelector(selector);
    if (later) paint(later);
  });
}

// A chart's settled zoom carries absolute epoch milliseconds. The panel host
// re-emits it as an ISO `scope` event; the app owns the router and pushes
// `win:''` with those bounds. The chart's own history write is not relied on.
export function wireChartScope(chart, panelId, doc = globalThis.document) {
  if (!chart || typeof chart.addEventListener !== 'function') return;
  chart.addEventListener('zoom', event => {
    const from = Number(event.detail?.from);
    const to = Number(event.detail?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('scope', {
      bubbles: true, composed: true,
      detail: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
    }));
  });
}

function select(doc, labelText, options, value, onChange) {
  const label = doc.createElement('label');
  label.className = 'p10-chooser-field';
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

// Three labelled selects plus the unsupported list. A change dispatches a
// composed `spec` event from the panel host; the app owns the router.
export function renderChooser({ panelId, spec = {}, schema = null, panel = null, doc = globalThis.document, onSpec = null } = {}) {
  const model = chooserModel(panel, spec, schema);
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const nextSpec = { ...canonicalPanelSpec(spec) || {}, grain: spec.grain || panel?.grain || '', scope: spec.scope || {} };

  const dispatch = patch => {
    const merged = canonicalPanelSpec({
      ...nextSpec,
      ...patch,
      measures: patch.measures || nextSpec.measures || [model.measure],
      scope: nextSpec.scope || {}
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: merged } }));
    if (typeof onSpec === 'function') onSpec(merged);
  };

  wrapper.append(select(doc, 'Measure', model.measures.map(name => ({ value: name, label: measureMeta(schema, name).label })), model.measure,
    value => dispatch({ measures: [value] })));
  wrapper.append(select(doc, 'Split', [{ value: '', label: '(none)' }, ...model.splits.map(name => ({ value: name, label: name }))], model.split,
    value => dispatch({ split: value })));
  wrapper.append(select(doc, 'Chart', model.charts.map(name => ({ value: name, label: name })), model.chart,
    value => dispatch({ chart: value })));

  if (model.unsupported.length) {
    const list = doc.createElement('ul');
    list.className = 'p10-unsupported';
    list.setAttribute('aria-label', 'Unsupported combinations');
    for (const item of model.unsupported) {
      const node = doc.createElement('li');
      node.dataset.kind = item.kind;
      node.textContent = `${item.kind} ${item.name} is unsupported: ${item.reason}. Supplied by ${item.source}.`;
      list.append(node);
    }
    wrapper.append(list);
  }
  return { element: wrapper, model, dispatch };
}

export function formatP10Value(value, meta = {}) {
  if (value === null || value === undefined) return '—';
  if (meta.kind === 'money') return formatMoney(Number(value));
  if (meta.kind === 'tokens') return formatCount(Number(value), { unit: 'tokens' });
  return formatNumber(Number(value), { digits: meta.kind === 'percent' ? 2 : 0 });
}
