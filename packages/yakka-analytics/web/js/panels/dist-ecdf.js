// `dist-ecdf`: ECDF step lines built from the same distribution bins
// (cumulative count / n per group). Single mode draws one series per group;
// compare mode draws the current and previous population as two series. The n
// and the highest bin edge stay visible.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, table } from './pulse-strips.js';
import {
  ensureP10Styles, measureMeta, populationLine, whenPanelBody, whenPanelSlot, renderChooser, wireChartScope
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

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  const compare = scope.cmp === 'period';
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
    const body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ecdf' });
    const previous = compare ? await fetchDistribution(transport, previousDistributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-ecdf-previous' }) : null;
    const binCount = Math.max(0, ...(body.rows || []).map(row => (row.bins || []).length));
    if (!binCount) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: 'the server returned no bins for this distribution', clear: null }]);
    }
    let series;
    let data;
    let highest;
    if (compare) {
      const current = samplesFor(body.rows, binCount);
      const before = samplesFor(previous?.rows || [], binCount);
      highest = Math.max(...current.edges.filter(Number.isFinite), ...before.edges.filter(Number.isFinite));
      series = [
        { key: 'current', label: 'Current period', unit: meta.unit, kind: 'percent' },
        { key: 'previous', label: 'Previous period', unit: meta.unit, kind: 'percent' }
      ];
      data = [
        ...current.samples.map(sample => ({ x: sample.x, group: 'current' })),
        ...before.samples.map(sample => ({ x: sample.x, group: 'previous' }))
      ];
    } else {
      const groups = body.rows || [];
      const perGroup = groups.map(row => ({ key: `${dim}:${row.k}`, label: String(row.k), row }));
      highest = Math.max(...perGroup.flatMap(item => (item.row.bins || []).map(edgeOf)).filter(Number.isFinite));
      series = perGroup.map(item => ({ key: item.key, label: item.label, unit: meta.unit, kind: 'percent' }));
      data = perGroup.flatMap(item => {
        const samples = samplesFor([item.row], binCount);
        return samples.samples.map(sample => ({ x: sample.x, group: item.key }));
      });
    }
    if (!data.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} values in window ${scope.win || 'all'}`, clear: null }]);
    }
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist p10-ecdf';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ECDF from fixed distribution bins (cumulative count / n). ${populationLine(body)}. Highest bin edge ${Number.isFinite(highest) ? highest : '—'} ${meta.unit}.`;
      const node = doc.createElement('yk-chart');
      node.className = 'p10-dist-chart';
      node.spec = {
        chart: 'ecdf',
        type: 'ecdf',
        title: `${measure} ECDF by ${dim}${compare ? ' (current and previous period)' : ''}`,
        timeBasis: 'priced calls only; the scope window',
        units: meta.unit,
        x: { label: meta.label, kind: 'number', unit: meta.unit },
        y: { label: 'Cumulative share', kind: 'percent', unit: '%', min: 0, max: 1 },
        series
      };
      node.data = data;
      wireChartScope(node, panel.id, doc);
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = `n ${(body.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}${previous ? `; previous period n ${(previous.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)}` : ''}. Highest bin edge ${Number.isFinite(highest) ? highest : '—'} ${meta.unit}.`;
      const columns = [{ label: 'Group' }, { label: 'n', numeric: true }];
      wrapper.append(basis, node, note, table(doc, {
        caption: `${measure} ECDF populations`, columns,
        rows: (compare ? [['Current period', (body.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)], ['Previous period', (previous?.rows || []).reduce((sum, row) => sum + Number(row.n || 0), 0)]] : (body.rows || []).map(row => [String(row.k), String(row.n ?? '—')]))
      }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split: dim, chart: 'ecdf' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split: dim, grain, compare,
      population: body.population || null,
      previousPopulation: previous?.population || null,
      highest,
      basis: `${measure} ECDF by ${dim}${compare ? '; current and previous period' : ''}`
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
