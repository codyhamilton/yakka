// `dist-ecdf`: ECDF step lines built from the same distribution bins
// (cumulative count / n per group). Single mode draws one series per group;
// period compare draws the current and previous population as two series;
// cohort compare draws one split-value group with a column per cohort. The n
// and the highest bin edge stay visible.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, table } from './pulse-strips.js';
import {
  comparisonPlan, comparisonSummary, ensureP10Styles, measureMeta, populationLine, whenPanelBody, whenPanelSlot, renderChooser, wireChartScope
} from './p10-shared.js';
import {
  DIST_DIMS, DIST_MEASURES, PERIOD_UNSUPPORTED, distributionParams, distributionSpec, fetchDistribution, previousDistributionParams
} from './dist-ranges.js';

function edgeOf(bin) {
  const hi = bin.hi ?? bin.to;
  const lo = bin.lo ?? bin.from;
  return hi === null || hi === undefined ? Number(lo) : Number(hi);
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
    const measure = (spec.measures || [])[0] && DIST_MEASURES.includes((spec.measures || [])[0]) ? spec.measures[0] : 'cost_usd';
    const distributed = distributionSpec(spec);
    if (!distributed.ok) {
      return unsupportedState({
        missing: `${measure} by ${distributed.dim} at ${distributed.grain} grain`,
        reason: distributed.reason,
        source: 'contract 17.3',
        nearest: `${distributed.try} grain`
      });
    }
    const { grain, dim } = distributed;
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
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
    const binCount = Math.max(0, ...(body.rows || []).map(row => (row.bins || []).length), ...((other?.rows || []).map(row => (row.bins || []).length)));
    if (!binCount) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: 'the server returned no bins for this distribution', clear: null }]);
    }
    const charts = [];
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
        }
        if (!series.length) continue;
        charts.push({ group, series, data, highest: Math.max(...edgeValues), n: [body, other].map(item => (item?.rows || []).find(row => String(row.k) === group)).map(row => Number(row?.n || 0)) });
      }
    } else if (compare) {
      const current = samplesFor(body.rows, binCount);
      const before = samplesFor(other?.rows || [], binCount);
      charts.push({
        group: '', highest: Math.max(...current.edges.filter(Number.isFinite), ...before.edges.filter(Number.isFinite)),
        series: [
          { key: 'current', label: 'Current period', unit: meta.unit, kind: 'percent' },
          { key: 'previous', label: 'Previous period', unit: meta.unit, kind: 'percent' }
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
      charts.push({
        group: '', highest: Math.max(...edges),
        series: perGroup.map(item => ({ key: item.key, label: item.label, unit: meta.unit, kind: 'percent' })),
        data: perGroup.flatMap(item => samplesFor([item.row], binCount).samples.map(sample => ({ x: sample.x, group: item.key }))),
        n: perGroup.map(item => Number(item.row.n || 0))
      });
    }
    if (!charts.some(chart => chart.data.length)) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} values in window ${scope.win || 'all'}`, clear: null }]);
    }
    const summary = cohortCompare
      ? comparisonSummary({ plan, sides: { a: withUnpriced(body), b: withUnpriced(other) }, unit: meta.unit }).text
      : '';
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist p10-ecdf';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      const highest = Math.max(...charts.map(chart => chart.highest).filter(Number.isFinite));
      basis.textContent = `Basis: ECDF from fixed distribution bins (cumulative count / n). ${populationLine(body)}. Highest bin edge ${Number.isFinite(highest) ? highest : '—'} ${meta.unit}.${cohortCompare ? ` ${summary}` : ''}`;
      wrapper.append(basis);
      for (const item of charts) {
        const node = doc.createElement('yk-chart');
        node.className = 'p10-dist-chart';
        node.dataset.split = item.group;
        node.spec = {
          chart: 'ecdf',
          type: 'ecdf',
          title: `${measure} ECDF by ${dim}${cohortCompare ? ` · ${item.group}` : compare ? ' (current and previous period)' : ''}`,
          timeBasis: 'priced calls only; the scope window',
          units: meta.unit,
          x: { label: meta.label, kind: 'number', unit: meta.unit },
          y: { label: 'Cumulative share', kind: 'percent', unit: '%', min: 0, max: 1 },
          series: item.series
        };
        node.data = item.data;
        wireChartScope(node, panel.id, doc);
        wrapper.append(node);
      }
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = cohortCompare
        ? `Both cohorts are listed by sample size; the ECDF steps each population separately.`
        : `n ${(body.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}${other ? `; previous period n ${(other.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}` : ''}. Highest bin edge ${Number.isFinite(Math.max(...charts.map(chart => chart.highest).filter(Number.isFinite))) ? Math.max(...charts.map(chart => chart.highest).filter(Number.isFinite)) : '—'} ${meta.unit}.`;
      const columns = cohortCompare
        ? [{ label: 'Group' }, { label: 'Cohort' }, { label: 'n', numeric: true }]
        : [{ label: 'Group' }, { label: 'n', numeric: true }];
      const tableRows = cohortCompare
        ? charts.flatMap(item => [0, 1].map(index => [item.group, item.series[index]?.label || '—', String(item.n[index] ?? 0)]))
        : compare
          ? [['Current period', String((body.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0))], ['Previous period', String((other?.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0))]]
          : (body.rows || []).map(row => [String(row.k), String(row.n ?? '—')]);
      wrapper.append(note, table(doc, { caption: `${measure} ECDF populations`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split: dim, chart: 'ecdf' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split: dim, grain, compare, cohortCompare,
      population: body.population || null,
      previousPopulation: other?.population || null,
      highest: Math.max(...charts.map(chart => chart.highest).filter(Number.isFinite)),
      basis: `${measure} ECDF by ${dim}${compare ? '; current and previous period' : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`
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
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'call', dim: 'model' } }],
  load
};

export default DIST_ECDF_PANEL;
