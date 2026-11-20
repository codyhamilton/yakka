// `movers`: ranked change per lens value, current period against the previous
// equal-length period. Totals and daily sparkline series come from `/query`
// with `bucket=none` and `bucket=day`. The repo lens appears only when
// `/schema` offers `session_repo` for the time grain; otherwise the panel
// names the absent capability instead of inventing a join.

import '../charts/yk-bars.js';
import { formatCount, formatMoney, formatNumber } from '../charts/formatters.js';
import { cancelledState, emptyState, errorState } from '../core/panel-state.js';
import {
  emptyCausesFor, ensurePulseStyles, previousWindow, scopeParams, table, whenPanelBody, windowParams
} from './pulse-strips.js';

export const MOVER_DEFAULT_MEASURE = 'cost_usd';
const PANEL_MEASURES = ['cost_usd', 'model_calls', 'commits', 'unpriced_calls'];
const MEASURE_LABELS = { cost_usd: 'Cost', model_calls: 'Model calls', commits: 'Commits', unpriced_calls: 'Unpriced calls' };
const MEASURE_UNITS = { cost_usd: 'USD', model_calls: 'calls', commits: 'commits', unpriced_calls: 'calls' };
const FALLBACK_MEASURES = ['cost_usd', 'model_calls', 'commits'];

export function offeredMeasures(schema) {
  const listed = schema?.grains?.time?.measures;
  if (!Array.isArray(listed) || !listed.length) return FALLBACK_MEASURES.slice();
  const offered = PANEL_MEASURES.filter(measure => listed.includes(measure));
  return offered.length ? offered : FALLBACK_MEASURES.slice();
}

function schemaLenses(schema) {
  const grain = schema?.grains?.time;
  const list = [
    ...(Array.isArray(grain?.lenses) ? grain.lenses : []),
    ...(Array.isArray(grain?.predicate?.lenses) ? grain.predicate.lenses : [])
  ];
  return new Set(list);
}

// `/query` publishes the dimensions a time measure accepts; the raw `model`
// dimension is the valid model split there. Derived `session_model` belongs to
// a session-grain route and is never sent to `/query`.
function measureDims(schema, measure) {
  const grain = schema?.grains?.time;
  const metadata = grain?.measure_metadata?.[measure];
  if (Array.isArray(metadata?.dims) && metadata.dims.length) return metadata.dims;
  const listed = (Array.isArray(schema?.measures) ? schema.measures : [])
    .find(item => (typeof item === 'string' ? item : item?.name) === measure);
  return Array.isArray(listed?.dims) ? listed.dims : [];
}

// Harness and raw model are the offered `/query` splits for the selected
// measure; the repo lens is conditional on the grain publishing session_repo.
export function moverLenses(schema, measure = MOVER_DEFAULT_MEASURE) {
  const dims = measureDims(schema, measure);
  const offered = dims.length ? new Set(dims) : new Set(['harness', 'model']);
  const lenses = ['harness', 'model'].filter(lens => offered.has(lens));
  if (schemaLenses(schema).has('session_repo')) lenses.push('session_repo');
  return lenses.length ? lenses : ['harness'];
}

export function repoLensOffered(schema, measure = MOVER_DEFAULT_MEASURE) {
  return moverLenses(schema, measure).includes('session_repo');
}

export function parseQueryRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.map(row => ({
    t: row?.t || '',
    keys: Array.isArray(row?.k) ? row.k.map(String) : [],
    value: row?.v === null || row?.v === undefined || !Number.isFinite(Number(row.v)) ? null : Number(row.v)
  }));
}

export function groupTotals(body) {
  const totals = new Map();
  for (const row of parseQueryRows(body)) {
    const key = row.keys[0] ?? '';
    totals.set(key, (totals.get(key) || 0) + (row.value ?? 0));
  }
  return totals;
}

export function groupSeries(body) {
  const series = new Map();
  for (const row of parseQueryRows(body)) {
    const key = row.keys[0] ?? '';
    if (!series.has(key)) series.set(key, []);
    series.get(key).push({ t: row.t, value: row.value });
  }
  for (const points of series.values()) points.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  return series;
}

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
export function sparkline(points = []) {
  const values = points.map(point => point.value).filter(value => value !== null && Number.isFinite(value));
  if (!values.length) return '—';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map(value => BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, Math.round(((value - min) / span) * (BLOCKS.length - 1))))]).join('');
}

export function buildMoverModel({ lens, measure = MOVER_DEFAULT_MEASURE, current = new Map(), previous = null, unpriced = null, series = new Map(), population = null, hasPrevious = true } = {}) {
  const keys = new Set([...current.keys(), ...(previous ? previous.keys() : [])]);
  const rows = [...keys].map(key => {
    const now = current.has(key) ? current.get(key) : null;
    const before = previous && previous.has(key) ? previous.get(key) : null;
    const change = now === null || before === null ? null : now - before;
    return {
      key: `${lens}:${key}`,
      label: key || '(empty)',
      current: now,
      previous: before,
      change,
      unpriced: unpriced && unpriced.has(key) ? unpriced.get(key) : null,
      sparkline: sparkline(series.get(key) || [])
    };
  });
  rows.sort((a, b) => {
    if (a.change === null && b.change === null) return String(a.key).localeCompare(String(b.key));
    if (a.change === null) return 1;
    if (b.change === null) return -1;
    if (b.change !== a.change) return b.change - a.change;
    return String(a.key).localeCompare(String(b.key));
  });
  return { lens, measure, rows, hasPrevious, population, nPerGroup: 'not supplied per group' };
}

function formatMoverValue(value, measure) {
  if (value === null || value === undefined) return 'not supplied';
  if (measure === 'cost_usd') return formatMoney(Number(value));
  return formatCount(value, { unit: MEASURE_UNITS[measure] || '' });
}

function renderMovers(host, model, doc, context) {
  ensurePulseStyles(doc);
  host.replaceChildren();
  const wrapper = doc.createElement('div');
  wrapper.className = 'pulse-movers';
  const heading = doc.createElement('p');
  heading.className = 'pulse-basis';
  heading.textContent = model.hasPrevious
    ? 'Basis: server totals for the current window against the previous equal-length window; association, not cause.'
    : 'Basis: server totals for the current window; all-history has no previous period. Association, not cause.';
  wrapper.append(heading);

  const chooserLabel = doc.createElement('label');
  chooserLabel.className = 'pulse-chooser';
  chooserLabel.append(doc.createTextNode('Measure '));
  const chooser = doc.createElement('select');
  chooser.setAttribute('aria-label', 'Movers measure');
  for (const measure of context.measures) {
    const option = doc.createElement('option');
    option.value = measure;
    option.textContent = MEASURE_LABELS[measure] || measure;
    option.selected = measure === model.measure;
    chooser.append(option);
  }
  chooser.addEventListener('change', () => context.refresh?.(chooser.value));
  chooserLabel.append(chooser);
  wrapper.append(chooserLabel);

  if (!model.rows.length) {
    const empty = doc.createElement('p');
    empty.className = 'pulse-note';
    empty.textContent = `No groups for ${model.lens} in this window.`;
    wrapper.append(empty);
  } else {
    const chart = doc.createElement('yk-bars');
    chart.className = 'pulse-movers-bars';
    chart.setAttribute('aria-label', `${MEASURE_LABELS[model.measure] || model.measure} change by ${model.lens}`);
    wrapper.append(chart);
    chart.spec = {
      chart: 'bars', type: 'lollipop', title: `${MEASURE_LABELS[model.measure] || model.measure} by ${model.lens}`,
      units: MEASURE_UNITS[model.measure] || '',
      series: [{ key: model.measure, label: MEASURE_LABELS[model.measure] || model.measure, unit: MEASURE_UNITS[model.measure] || '', kind: model.measure === 'cost_usd' ? 'money' : 'count' }]
    };
    chart.data = model.rows.map(row => ({ key: row.key, label: row.label, values: { [model.measure]: row.current } }));
    wrapper.append(table(doc, {
      caption: `${MEASURE_LABELS[model.measure] || model.measure} change by ${model.lens}, ranked by change`,
      columns: [
        { label: model.lens }, { label: 'Current', numeric: true }, { label: 'Previous', numeric: true },
        { label: 'Change', numeric: true }, { label: 'Unpriced', numeric: true }, { label: 'Daily' }, { label: 'n' }
      ],
      rows: model.rows.map(row => [
        row.label,
        formatMoverValue(row.current, model.measure),
        model.hasPrevious ? formatMoverValue(row.previous, model.measure) : 'no previous period',
        row.change === null ? (model.hasPrevious ? 'not supplied' : 'no previous period') : formatMoverValue(row.change, model.measure),
        row.unpriced === null ? 'not supplied' : formatCount(row.unpriced, { unit: 'calls' }),
        row.sparkline,
        model.nPerGroup
      ])
    }));
  }
  host.append(wrapper);
}

async function query(transport, measure, lens, bucket, params, { tenant, signal, stateKey }) {
  const search = new URLSearchParams(params);
  search.set('measure', measure);
  search.set('dim', lens);
  search.set('bucket', bucket);
  const { response, body } = await transport.get('query', search, { tenant, signal, stateKey });
  if (!response.ok) {
    const error = new Error(body?.error || `The server returned ${response.status}.`);
    error.code = body?.code || String(response.status || '');
    throw error;
  }
  return body || {};
}

async function loadLens(transport, lens, measure, scope, prev, { tenant, signal, stateKey, allowUnpriced = false }) {
  const currentBody = await query(transport, measure, lens, 'none', scopeParams(scope), { tenant, signal, stateKey: `${stateKey}-cur` });
  const seriesBody = await query(transport, measure, lens, 'day', scopeParams(scope), { tenant, signal, stateKey: `${stateKey}-series` });
  let previousBody = null;
  if (prev) {
    try { previousBody = await query(transport, measure, lens, 'none', windowParams(prev), { tenant, signal, stateKey: `${stateKey}-prev` }); } catch { previousBody = null; }
  }
  let unpriced = null;
  if (allowUnpriced) {
    try {
      const body = await query(transport, 'unpriced_calls', lens, 'none', scopeParams(scope), { tenant, signal, stateKey: `${stateKey}-unpriced` });
      unpriced = groupTotals(body);
    } catch { unpriced = null; }
  }
  return buildMoverModel({
    lens,
    measure,
    current: groupTotals(currentBody),
    previous: previousBody ? groupTotals(previousBody) : null,
    unpriced,
    series: groupSeries(seriesBody),
    population: currentBody.population || null,
    hasPrevious: Boolean(prev && previousBody)
  });
}

export async function load({ scope = {}, spec = {}, transport, tenant, signal, doc = globalThis.document, clear = null } = {}) {
  spec = spec || {};
  ensurePulseStyles(doc);
  try {
    const { body: schema } = await transport.schema(tenant);
    const measures = offeredMeasures(schema);
    const measuresList = measures.length ? measures : FALLBACK_MEASURES;
    let measure = (spec.measures || [])[0];
    if (!measuresList.includes(measure)) measure = measuresList.includes(MOVER_DEFAULT_MEASURE) ? MOVER_DEFAULT_MEASURE : measuresList[0];
    const lenses = moverLenses(schema, measure);
    const prev = previousWindow(scope);
    const models = [];
    for (const lens of lenses) {
      models.push(await loadLens(transport, lens, measure, scope, prev, { tenant, signal, stateKey: `movers-${lens}`, allowUnpriced: measuresList.includes('unpriced_calls') }));
    }
    const context = {
      measures: measuresList,
      refresh: nextMeasure => load({ scope, spec: { ...spec, measures: [nextMeasure] }, transport, tenant, doc, signal: undefined, clear })
    };
    if (!models.some(model => model.rows.length)) {
      whenPanelBody('movers', doc, host => host.replaceChildren());
      const causes = emptyCausesFor(scope, clear);
      if (!causes.length) causes.push({ kind: 'scope', label: `no ${measure} groups in window ${scope.win || 'all'}`, clear: null });
      return emptyState(causes);
    }
    whenPanelBody('movers', doc, host => {
      host.replaceChildren();
      const container = doc.createElement('div');
      container.className = 'pulse-movers-list';
      for (const model of models) {
        const section = doc.createElement('section');
        section.className = 'pulse-mover-lens';
        const title = doc.createElement('h3');
        title.textContent = `By ${model.lens}`;
        section.append(title);
        const holder = doc.createElement('div');
        section.append(holder);
        renderMovers(holder, model, doc, context);
        container.append(section);
      }
      if (!repoLensOffered(schema, measure)) {
        const note = doc.createElement('p');
        note.className = 'pulse-note';
        note.textContent = 'Repository lens not offered: the server does not list session_repo for the time grain.';
        container.append(note);
      }
      host.append(container);
    });
    return {
      state: 'ready',
      measure,
      lenses,
      models: models.map(model => ({ lens: model.lens, rows: model.rows })),
      basis: 'query totals; current versus previous equal-length window; association, not cause',
      population: models[0]?.population || null
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The movers query failed.', code: error?.code || '' });
  }
}

export const MOVERS_PANEL = {
  id: 'movers',
  title: 'Movers',
  grain: 'time',
  measures: PANEL_MEASURES,
  lenses: ['harness', 'model', 'session_repo'],
  charts: ['bars', 'lines'],
  requires: [],
  caveats: 'Ranked change is an association, not cause. The repo lens is offered only when /schema lists session_repo for the time grain. Per-group n and unpriced counts are named when the server does not supply them.',
  measureBasis: 'query bucket totals on the summary event-time window',
  requests: () => [
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', dim: 'harness', bucket: 'none' } },
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', dim: 'harness', bucket: 'day' } },
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', dim: 'model', bucket: 'none' } }
  ],
  load
};

export default MOVERS_PANEL;
