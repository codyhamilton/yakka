// `dist-hist`: fixed-bin histograms per group. The first group's server bins
// become the fixed `spec.bins`; a zero-filled bin is the server's count, never
// an invented value for a null score. Compare shows current and previous side
// by side, or one split-value group with a column per cohort.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, table } from './pulse-strips.js';
import {
  comparisonPlan, comparisonSummary, ensureP10Styles, measureMeta, populationLine, whenPanelBody, whenPanelSlot, renderChooser
} from './p10-shared.js';
import {
  DIST_DIMS, DIST_MEASURES, PERIOD_UNSUPPORTED, distributionParams, distributionSpec, fetchDistribution, previousDistributionParams
} from './dist-ranges.js';

export function fixedBins(rows = []) {
  const bins = rows?.[0]?.bins || [];
  return bins.map(bin => ({ from: Number(bin.lo ?? bin.from), to: bin.hi === undefined || bin.hi === null ? null : Number(bin.hi ?? bin.to) }));
}

export function histogramRows(row, bins) {
  return bins.map((bin, index) => {
    const match = (row?.bins || []).find(item => Number(item.lo ?? item.from) === bin.from);
    return {
      key: `bin:${index}`,
      bin,
      values: { count: match ? Number(match.n) : 0 },
      n: match ? Number(match.n) : 0
    };
  });
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
    const panel = context.panel || DIST_HIST_PANEL;
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
    let labels = { first: compare ? 'current' : '', second: 'previous' };
    if (cohortCompare) {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.a }), { tenant, signal, stateKey: 'dist-hist' });
      other = plan.b
        ? await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: plan.b }), { tenant, signal, stateKey: 'dist-hist-b' })
        : await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim, cohort: null }), { tenant, signal, stateKey: 'dist-hist-b' });
      labels = { first: plan.aLabel, second: plan.bLabel };
    } else {
      body = await fetchDistribution(transport, distributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-hist' });
      other = compare ? await fetchDistribution(transport, previousDistributionParams({ scope, measure, grain, dim }), { tenant, signal, stateKey: 'dist-hist-previous' }) : null;
    }
    const bins = fixedBins(body.rows);
    if (!bins.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: 'the server returned no bins for this distribution', clear: null }]);
    }
    const charts = [];
    if (cohortCompare) {
      for (const group of splitValuesOf(body, other)) {
        for (const side of [{ body, label: labels.first }, { body: other, label: labels.second }]) {
          const row = (side.body?.rows || []).find(item => String(item.k) === group);
          if (!row) continue;
          charts.push({ group, label: side.label, side: side.label === labels.first ? 'a' : 'b', period: side.label, rows: histogramRows(row, bins), n: row.n });
        }
      }
    } else {
      for (const row of body.rows || []) charts.push({ group: row.k, label: String(row.k), period: 'current', rows: histogramRows(row, bins), n: row.n });
      for (const row of other?.rows || []) charts.push({ group: row.k, label: String(row.k), period: 'previous', rows: histogramRows(row, bins), n: row.n });
    }
    const summary = cohortCompare
      ? comparisonSummary({ plan, sides: { a: withUnpriced(body), b: withUnpriced(other) }, unit: meta.unit }).text
      : '';
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist p10-hist';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${measure} over ${grain} grain by ${dim}, fixed bins from the first group. ${populationLine(body)}.${cohortCompare ? ` ${summary}` : ''}`;
      wrapper.append(basis);
      if (cohortCompare) {
        for (const group of splitValuesOf(body, other)) {
          const section = doc.createElement('div');
          section.className = 'p10-split-group';
          section.dataset.split = group;
          for (const item of charts.filter(chart => chart.group === group)) {
            const node = doc.createElement('yk-ranges');
            node.className = 'p10-dist-chart';
            node.dataset.group = String(item.group);
            node.dataset.cohort = item.side;
            node.dataset.period = item.period;
            node.spec = {
              chart: 'ranges',
              type: 'histogram',
              title: `${measure} · ${item.group} · ${item.label} (n ${item.n ?? 0})`,
              timeBasis: 'priced calls only; the scope window',
              units: meta.unit,
              bins,
              series: [{ key: 'count', label: 'Calls', unit: 'calls', kind: 'count' }]
            };
            node.data = item.rows;
            section.append(node);
          }
          wrapper.append(section);
        }
      } else {
        for (const item of charts) {
          const node = doc.createElement('yk-ranges');
          node.className = 'p10-dist-chart';
          node.dataset.group = String(item.group);
          node.dataset.period = item.period;
          node.spec = {
            chart: 'ranges',
            type: 'histogram',
            title: `${measure} · ${item.label}${compare ? ` · ${item.period} period` : ''} (n ${item.n ?? 0})`,
            timeBasis: 'priced calls only; the scope window',
            units: meta.unit,
            bins,
            series: [{ key: 'count', label: 'Calls', unit: 'calls', kind: 'count' }]
          };
          node.data = item.rows;
          wrapper.append(node);
        }
      }
      const columns = [{ label: 'Group' }, { label: cohortCompare ? 'Cohort' : 'Period' }, { label: 'Bin' }, { label: 'Count', numeric: true }];
      const tableRows = charts.flatMap(item => item.rows.map(row => [
        cohortCompare ? item.group : item.label, cohortCompare ? item.period : (compare ? item.period : 'current'),
        row.bin.to === null ? `${row.bin.from}+` : `${row.bin.from}–${row.bin.to}`,
        String(row.values.count)
      ]));
      wrapper.append(table(doc, { caption: `${measure} fixed-bin histogram by ${dim}`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split: dim, chart: 'histogram' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split: dim, grain, compare, cohortCompare,
      population: body.population || null,
      previousPopulation: other?.population || null,
      bins: bins.length,
      basis: `${measure} fixed-bin histogram by ${dim}${compare ? '; current and previous period' : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} histogram`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The distribution query failed.' });
  }
}

export const DIST_HIST_PANEL = {
  id: 'dist-hist',
  title: 'Distribution histogram',
  grain: 'session',
  measures: DIST_MEASURES,
  lenses: [...DIST_DIMS],
  charts: ['histogram'],
  requires: [],
  caveats: 'Fixed server bins; an empty bin is the server’s zero. Compare puts current and previous side by side, never one delta.',
  measureBasis: 'call or conversation priced values in the scope window',
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'call', dim: 'model' } }],
  load
};

export default DIST_HIST_PANEL;
