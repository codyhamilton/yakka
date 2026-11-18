// Shared Phase 11 scatter vocabulary: schema-valid numeric axes and size,
// categorical colour, the bounded scatter request, row keys, whole-population
// marginals, the canonical rectangle predicate and the tray's exact-population
// count. Pure helpers stay free of the DOM; the one render seam (the chooser)
// only dispatches a composed `spec` event and never touches the router.

import { measureMeta, requestParams, schemaGrain } from './p10-shared.js';
import { table } from './pulse-strips.js';
import { canonicalJson, canonicalPredicate } from '../core/selection-model.js';
import { formatCount } from '../charts/formatters.js';

const CATEGORICAL = new Set([
  'id', 'model', 'harness', 'session_model', 'session_repo', 'origin', 'has_artifacts',
  'kind', 'plan', 'repo_id', 'source', 'screen_verdict', 'scorer', 'shape', 'band', 'stage',
  'tool', 'tool_kind', 'norm_event', 'event'
]);

function publishedMeasures(grain) {
  return new Set([...(grain?.measures || []), ...(grain?.predicate?.measures || [])]);
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
  const measures = publishedMeasures(grain);
  const lenses = publishedLenses(grain);
  const axes = [];
  const unsupported = [];
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
    if (!measures.has(name) || !(grain?.measures || []).includes(name)) {
      unsupported.push({ kind: 'axis', name, reason: `${name} is not a published ${panel?.grain} measure`, try: nearest() });
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
  const numeric = grain ? publishedMeasures(grain) : null;
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
    return {
      field,
      label: item.label || field,
      unit: item.unit || '',
      bins,
      total: bins.reduce((sum, bin) => sum + bin.n, 0)
    };
  });
}

function dimensionMeta(schema, field) {
  const meta = measureMeta(schema, field);
  return { label: meta.label && meta.label !== field ? meta.label : field, unit: meta.unit || '' };
}

// Marginal strips are the whole population, not the sample. They reuse the
// existing `<yk-ranges type="histogram">` element and offer a table each.
export function renderMarginals(body = {}, fields = [], { doc = globalThis.document, schema = null } = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'scatter-marginals';
  const model = marginalModel(body.marginals, fields);
  if (!model.length) return wrapper;
  for (const marginal of model) {
    const figure = doc.createElement('section');
    figure.className = 'scatter-marginal';
    figure.dataset.field = marginal.field;
    const meta = dimensionMeta(schema, marginal.field);
    const heading = doc.createElement('h3');
    heading.textContent = `${meta.label || marginal.label} — whole population`;
    const chart = doc.createElement('yk-ranges');
    chart.setAttribute('type', 'histogram');
    chart.spec = {
      chart: 'ranges',
      type: 'histogram',
      units: meta.unit || marginal.unit,
      series: [{ key: 'count', label: 'Marks', unit: meta.unit || marginal.unit, kind: 'count' }],
      bins: marginal.bins.map(bin => ({ from: bin.from, to: bin.to })),
      x: { label: meta.label || marginal.label, kind: 'number' },
      sample: 'whole population'
    };
    chart.data = marginal.bins.map((bin, index) => ({
      key: `bin:${index}`,
      bin: { from: bin.from, to: bin.to },
      values: { count: bin.n },
      n: bin.n
    }));
    figure.append(heading, chart, table(doc, {
      caption: `${meta.label || marginal.label} (whole population)`,
      columns: [{ label: 'From', numeric: true }, { label: 'To', numeric: true }, { label: 'Marks', numeric: true }],
      rows: marginal.bins.map(bin => [
        String(bin.from),
        bin.to === null ? 'and above' : String(bin.to),
        formatCount(bin.n)
      ])
    }));
    wrapper.append(figure);
  }
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

// Numeric x, numeric y, optional colour, optional size and chart. Every list
// comes from the schema; a change dispatches a composed `spec` event from the
// panel host exactly like `renderChooser`.
export function renderScatterChooser({ panelId, spec = {}, schema = null, panel = null, doc = globalThis.document, onSpec = null } = {}) {
  const axes = scatterAxes(panel, schema);
  const colours = scatterColours(panel, schema);
  const fields = scatterSpecFields(spec, schema);
  const grain = spec.grain || panel?.grain || '';
  const wrapper = doc.createElement('div');
  wrapper.className = 'p11-chooser';
  const unsupported = [...axes.unsupported, ...colours.unsupported];
  const axisOptions = axes.axes.map(name => ({ value: name, label: measureMeta(schema, name).label }));
  const x = axes.axes.includes(fields.x) ? fields.x : (axes.axes[0] || '');
  const y = axes.axes.includes(fields.y) && fields.y !== x ? fields.y : (axes.axes.find(name => name !== x) || '');
  const size = axes.axes.includes(fields.size) ? fields.size : '';
  const colour = colours.colours.includes(fields.colour) ? fields.colour : '';

  const nextSpec = {
    grain,
    measures: [x, y, size].filter(Boolean),
    split: colour,
    chart: 'scatter',
    scope: { ...(spec.scope || {}), x, y, size, colour }
  };

  const dispatch = patch => {
    const merged = {
      ...nextSpec,
      ...patch,
      scope: { ...nextSpec.scope, ...(patch.scope || {}) }
    };
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: merged } }));
    if (typeof onSpec === 'function') onSpec(merged);
  };

  wrapper.append(
    select(doc, 'X measure', axisOptions, x, value => {
      const scope = { x: value };
      if (value === y) scope.y = axes.axes.find(name => name !== value) || '';
      dispatch({ scope });
    }),
    select(doc, 'Y measure', axisOptions, y, value => {
      const scope = { y: value };
      if (value === x) scope.x = axes.axes.find(name => name !== value) || '';
      dispatch({ scope });
    }),
    select(doc, 'Colour', [{ value: '', label: '(none)' }, ...colours.colours.map(name => ({ value: name, label: name }))], colour,
      value => dispatch({ split: value, scope: { colour: value } })),
    select(doc, 'Size', [{ value: '', label: '(none)' }, ...axisOptions], size,
      value => dispatch({ scope: { size: value } })),
    select(doc, 'Chart', (panel?.charts || ['scatter']).map(name => ({ value: name, label: name })), 'scatter', () => {})
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
  return { element: wrapper, fields: { x, y, size, colour }, unsupported, dispatch };
}
