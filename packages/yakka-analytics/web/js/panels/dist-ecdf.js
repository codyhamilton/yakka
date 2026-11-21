// `dist-ecdf`: ECDF step lines built from the same distribution bins
// (cumulative count / n per group). Single mode draws one series per group;
// period compare draws the current and previous population as two series;
// cohort compare draws one split-value group with a column per cohort. The n
// and the highest bin edge stay visible.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, filterRefusal, table } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import {
  comparisonPlan, comparisonSummary, ensureP10Styles, measureMeta, mountPanelViews, populationLine,
  whenPanelBody, whenPanelSlot, wireChartScope
} from './p10-shared.js';
import {
  DIST_DIMS, DIST_MEASURES, PERIOD_UNSUPPORTED, SHARED_BOUNDARY_NOTE, distDimensionLabel, distMeasureOptions, periodRank,
  distributionParams, distributionSpec, fetchDistribution, previousDistributionParams, renderDistributionChooser
} from './dist-ranges.js';

export const DIST_ECDF_CAPTION = 'Each line shows the percentage of sessions at or below a cost; read up from a dollar amount to find that percentage.';
export const COMPECDF_CAPTION = 'Each line shows the percentage of calls at or below a cost in one period; a higher line means more calls fall below that cost.';

export const DIST_ECDF_CAPTIONS = {
  'G-ecdf': DIST_ECDF_CAPTION,
  'G-compecdf': COMPECDF_CAPTION
};

export const DIST_ECDF_DEFAULTS = { grain: 'conversation', dim: 'model' };

const CAPTION_SHAPE = {
  'G-ecdf': { grain: 'conversation', dim: 'model' },
  'G-compecdf': { grain: 'call', dim: 'model' }
};

function edgeOf(bin) {
  const hi = bin.hi ?? bin.to;
  const lo = bin.lo ?? bin.from;
  return hi === null || hi === undefined ? Number(lo) : Number(hi);
}

export function ecdfTableColumns(unit = 'USD') {
  return ['Group', 'Period', `Bin upper edge (${unit})`, 'Cumulative count', 'Cumulative share (%)'];
}

export function ecdfTableColumnSpecs(unit = 'USD') {
  return ecdfTableColumns(unit).map((label, index) => ({ label, numeric: index >= 2 }));
}

function edgeText(bin) {
  const hi = bin.hi ?? bin.to;
  if (hi === null || hi === undefined) {
    const lo = bin.lo ?? bin.from;
    return lo === null || lo === undefined ? '—' : `${lo}+`;
  }
  return String(hi);
}

export function cumulativeBins(bins = []) {
  const total = bins.reduce((sum, bin) => sum + Number(bin.n || 0), 0);
  let cumulative = 0;
  return bins
    .map(bin => ({ bin, edge: edgeOf(bin) }))
    .sort((a, b) => a.edge - b.edge)
    .map(item => {
      cumulative += Number(item.bin.n || 0);
      return {
        edge: item.edge,
        bin: item.bin,
        count: cumulative,
        share: total ? (cumulative / total) * 100 : null
      };
    });
}

// Group ascending, current before previous, then bin upper edge ascending.
// The current block is built first, so a stable group sort keeps current above
// previous within one group.
export function orderEcdfSides(sides = []) {
  return [...sides].sort((a, b) => String(a.group).localeCompare(String(b.group)) || periodRank(a.period) - periodRank(b.period));
}

export function ecdfTableRows(sides = []) {
  return orderEcdfSides(sides).flatMap(side => cumulativeBins(side.bins).map(item => [
    side.group,
    side.period || 'current',
    edgeText(item.bin),
    String(item.count),
    item.share === null ? '—' : String(Math.round(item.share * 10) / 10)
  ]));
}

function aggregateBins(rows = []) {
  const byIndex = new Map();
  for (const row of rows) {
    (row.bins || []).forEach((bin, index) => {
      if (!byIndex.has(index)) byIndex.set(index, { lo: bin.lo ?? bin.from, hi: bin.hi ?? bin.to, n: 0 });
      byIndex.get(index).n += Number(bin.n || 0);
    });
  }
  return [...byIndex.values()].sort((a, b) => edgeOf(a) - edgeOf(b));
}

// One sample per observed value. Bins are fixed, so repeating each edge by its
// count reproduces cumulative count / n exactly when the element steps them.
function samplesFor(rows = [], binCount = null) {
  const perBin = new Array(binCount ?? 0).fill(0);
  let edges = [];
  for (const row of rows) {
    (row.bins || []).forEach((bin, index) => {
      if (!edges[index]) edges[index] = edgeOf(bin);
      perBin[index] = (perBin[index] || 0) + Number(bin.n || 0);
    });
  }
  const samples = [];
  edges.forEach((edge, index) => {
    for (let count = 0; count < (perBin[index] || 0); count += 1) samples.push({ x: edge });
  });
  return { samples, total: perBin.reduce((sum, value) => sum + value, 0), edges };
}

function withUnpriced(body) {
  if (!body || !Array.isArray(body.rows)) return body;
  if (body.unpriced !== undefined) return body;
  const unpriced = body.rows.reduce((sum, row) => sum + Number(row.unpriced || 0), 0);
  return { ...body, unpriced };
}

function splitValuesOf(...bodies) {
  const values = [];
  for (const body of bodies) {
    for (const row of body?.rows || []) {
      const key = String(row.k);
      if (!values.includes(key)) values.push(key);
    }
  }
  return values;
}

function filterScopeFor(scope = {}) {
  const rest = { ...scope };
  delete rest.grain;
  delete rest.dim;
  delete rest.captionKey;
  return rest;
}

function ignoredList(body) {
  return Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [];
}

function renderChooser(panel, spec, schema, doc) {
  whenPanelSlot(panel.id, 'chooser', doc, slot => {
    slot.replaceChildren(renderDistributionChooser({ panelId: panel.id, panel, spec, schema, doc }));
  });
}

registerCaption('dist-ecdf', ({ spec = {}, scope = {}, schema = null } = {}) => {
  const key = spec?.scope?.captionKey || 'G-ecdf';
  const measure = (spec?.measures || [])[0] || 'cost_usd';
  const resolved = distributionSpec(spec, DIST_ECDF_DEFAULTS);
  const shape = CAPTION_SHAPE[key] || CAPTION_SHAPE['G-ecdf'];
  const compare = String(scope?.cmp || 'off') === 'period';
  const single = !scope?.cmp || scope.cmp === 'off';
  const mode = key === 'G-compecdf' ? compare : single;
  if (mode && measure === 'cost_usd' && resolved.ok && resolved.grain === shape.grain && resolved.dim === shape.dim) {
    return DIST_ECDF_CAPTIONS[key] || DIST_ECDF_CAPTION;
  }
  return CAPTION_TEMPLATES['cumulative distribution']({
    measure,
    population: key === 'G-compecdf' ? 'model_calls' : 'conversations',
    unit: measureMeta(schema, measure).unit || ''
  });
});

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const plan = comparisonPlan(scope);
  if (plan.unsupported) return unsupportedState({ missing: 'comparison', reason: plan.unsupported, source: 'scope' });
  const compare = plan.mode === 'period';
  const cohortCompare = plan.mode === 'cohorts';
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || DIST_ECDF_PANEL;
    const filterScope = filterScopeFor(scope);
    const refusal = filterRefusal({ panel, spec, scope: filterScope, schema });
    if (refusal) return refusal;
    const measures = distMeasureOptions(schema);
    const requestedMeasure = (spec.measures || [])[0] || '';
    if (requestedMeasure && !measures.includes(requestedMeasure)) {
      return unsupportedState({
        missing: requestedMeasure, reason: 'not published for the session grain', source: 'server /schema',
        nearest: measures[0] || null
      });
    }
    const measure = requestedMeasure || (measures.includes('cost_usd') ? 'cost_usd' : (measures[0] || 'cost_usd'));
    const distributed = distributionSpec(spec, DIST_ECDF_DEFAULTS);
    if (!distributed.ok) {
      renderChooser(panel, spec, schema, doc);
      return unsupportedState({
        missing: `${measure} by ${distributed.dim} at ${distributed.grain} grain`,
        reason: distributed.reason,
        source: 'contract 17.3',
        nearest: `${distributed.try} grain`
      });
    }
    const { grain, dim } = distributed;
    if (compare && !currentWindow(scope)) {
      renderChooser(panel, spec, schema, doc);
      return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    }
    const meta = measureMeta(schema, measure);
    let body;
    let other = null;
    if (cohortCompare) {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.a }), { tenant, signal, stateKey: 'dist-ecdf' });
      other = plan.b
        ? await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.b }), { tenant, signal, stateKey: 'dist-ecdf-b' })
        : await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: null }), { tenant, signal, stateKey: 'dist-ecdf-b' });
    } else {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ecdf' });
      other = compare ? await fetchDistribution(transport, previousDistributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ecdf-previous' }) : null;
    }
    const post = filterRefusal({
      panel, spec, scope: filterScope, schema,
      ignoredFilters: [...ignoredList(body), ...ignoredList(other)]
    });
    if (post) return post;
    const binCount = Math.max(0, ...(body.rows || []).map(row => (row.bins || []).length), ...((other?.rows || []).map(row => (row.bins || []).length)));
    if (!binCount) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
      return emptyState([{ kind: 'scope', label: 'the server returned no bins for this distribution', clear: null }]);
    }
    const charts = [];
    let sides = [];
    if (cohortCompare) {
      for (const group of splitValuesOf(body, other)) {
        const series = [];
        const data = [];
        const edgeValues = [];
        for (const side of [{ body, key: 'a', label: plan.aLabel }, { body: other, key: 'b', label: plan.bLabel }]) {
          const row = (side.body?.rows || []).find(item => String(item.k) === group);
          const samples = row ? samplesFor([row], binCount) : { samples: [], edges: [] };
          edgeValues.push(...samples.edges.filter(Number.isFinite));
          series.push({ key: side.key, label: side.label, unit: meta.unit, kind: 'percent' });
          data.push(...samples.samples.map(sample => ({ x: sample.x, group: side.key })));
          sides.push({ group, period: side.label, bins: row?.bins || [] });
        }
        if (!series.length) continue;
        charts.push({ group, series, data, highest: Math.max(...edgeValues), n: [body, other].map(item => (item?.rows || []).find(row => String(row.k) === group)).map(row => Number(row?.n || 0)) });
      }
    } else if (compare) {
      const current = samplesFor(body.rows, binCount);
      const before = samplesFor(other?.rows || [], binCount);
      sides = [
        { group: 'all', period: 'current', bins: aggregateBins(body.rows) },
        { group: 'all', period: 'previous', bins: aggregateBins(other?.rows || []) }
      ];
      charts.push({
        group: '', highest: Math.max(...current.edges.filter(Number.isFinite), ...before.edges.filter(Number.isFinite)),
        series: [
          { key: 'current', label: 'Current period', unit: meta.unit, kind: 'percent' },
          { key: 'previous', label: 'Previous period', unit: meta.unit, kind: 'percent', dash: 'dashed' }
        ],
        data: [
          ...current.samples.map(sample => ({ x: sample.x, group: 'current' })),
          ...before.samples.map(sample => ({ x: sample.x, group: 'previous' }))
        ],
        n: [current.total, before.total]
      });
    } else {
      const groups = body.rows || [];
      const perGroup = groups.map(row => ({ key: `${dim}:${row.k}`, label: String(row.k), row }));
      const edges = perGroup.flatMap(item => (item.row.bins || []).map(edgeOf)).filter(Number.isFinite);
      sides = perGroup.map(item => ({ group: String(item.row.k), period: 'current', bins: item.row.bins || [] }));
      charts.push({
        group: '', highest: Math.max(...edges),
        series: perGroup.map(item => ({ key: item.key, label: item.label, unit: meta.unit, kind: 'percent' })),
        data: perGroup.flatMap(item => samplesFor([item.row], binCount).samples.map(sample => ({ x: sample.x, group: item.key }))),
        n: perGroup.map(item => Number(item.row.n || 0))
      });
    }
    if (!charts.some(chart => chart.data.length)) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
      return emptyState([{ kind: 'scope', label: `no ${measure} values in window ${scope.win || 'all'}`, clear: null }]);
    }
    const summary = cohortCompare
      ? comparisonSummary({ plan, sides: { a: withUnpriced(body), b: withUnpriced(other) }, unit: meta.unit }).text
      : '';
    const highestEdge = Math.max(...charts.map(chart => chart.highest).filter(Number.isFinite));
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist p10-ecdf';
      const chartHost = doc.createElement('div');
      chartHost.className = 'p10-dist-charts';
      for (const item of charts) {
        const node = doc.createElement('yk-chart');
        node.className = 'p10-dist-chart';
        node.dataset.split = item.group;
        node.spec = {
          chart: 'ecdf',
          type: 'ecdf',
          title: `${meta.label} ECDF by ${distDimensionLabel(dim)}${cohortCompare ? ` · ${item.group}` : compare ? ' (current and previous period)' : ''}`,
          timeBasis: 'priced calls only; the scope window',
          units: meta.unit,
          x: { label: meta.label, kind: 'number', unit: meta.unit },
          y: { label: 'Cumulative share', kind: 'percent', unit: '%', min: 0, max: 1 },
          series: item.series
        };
        node.data = item.data;
        wireChartScope(node, panel.id, doc);
        chartHost.append(node);
      }
      const tableNode = table(doc, {
        caption: `${meta.label} ECDF populations`,
        columns: ecdfTableColumnSpecs(meta.unit || 'USD'),
        rows: ecdfTableRows(sides)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: chartHost, table: tableNode, doc,
        defaultView: 'chart', label: 'Distribution ECDF view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      const boundary = plan.mode === 'period' ? ` ${SHARED_BOUNDARY_NOTE}` : '';
      basis.textContent = `Basis: ECDF from fixed distribution bins (cumulative count / n). ${populationLine(body)}. Highest bin edge ${Number.isFinite(highestEdge) ? highestEdge : '—'} ${meta.unit}.${cohortCompare ? ` ${summary}` : ''}${boundary}`;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = cohortCompare
        ? `Both cohorts are listed by sample size; the ECDF steps each population separately.`
        : `n ${(body.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}${other ? `; previous period n ${(other.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}` : ''}. Highest bin edge ${Number.isFinite(highestEdge) ? highestEdge : '—'} ${meta.unit}.`;
      wrapper.append(views.element, note, basis);
      host.replaceChildren(wrapper);
    });
    renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
    return {
      state: 'ready', measure, split: dim, grain, compare, cohortCompare,
      population: body.population || null,
      previousPopulation: other?.population || null,
      highest: highestEdge,
      basis: `${measure} ECDF by ${dim}${compare ? `; current and previous period. ${SHARED_BOUNDARY_NOTE}` : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} ECDF`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The distribution query failed.' });
  }
}

export const DIST_ECDF_PANEL = {
  id: 'dist-ecdf',
  title: 'Distribution ECDF',
  grain: 'session',
  measures: DIST_MEASURES,
  lenses: [...DIST_DIMS],
  charts: ['ecdf'],
  requires: [],
  caveats: 'ECDF from the server’s fixed bins; n and the highest bin edge are shown. Compare draws both populations as two series.',
  measureBasis: 'call or conversation priced values in the scope window',
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'conversation', dim: 'model' } }],
  load
};

export default DIST_ECDF_PANEL;
