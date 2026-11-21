// `dist-hist`: fixed-bin histograms per group. The first group's server bins
// become the fixed `spec.bins`; a zero-filled bin is the server's count, never
// an invented value for a null score. Compare shows current and previous side
// by side, or one split-value group with a column per cohort.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, filterRefusal, table } from './pulse-strips.js';
import { CAPTION_TEMPLATES, registerCaption } from './captions.js';
import {
  comparisonPlan, comparisonSummary, ensureP10Styles, measureMeta, mountPanelViews, populationLine, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import {
  DIST_DIMS, DIST_MEASURES, PERIOD_UNSUPPORTED, SHARED_BOUNDARY_NOTE, distDimensionLabel, distMeasureOptions, periodRank,
  distributionParams, distributionSpec, fetchDistribution, previousDistributionParams, renderDistributionChooser
} from './dist-ranges.js';

export const DIST_HIST_CAPTION = 'Each bar counts model calls in a cost range for a harness; taller bars mean more calls in that range.';
export const COMPHIST_CAPTION = 'Each bar counts calls in a cost range for the selected or previous equal-length period; compare bar heights within the same range.';

export const DIST_HIST_CAPTIONS = {
  'G-hist': DIST_HIST_CAPTION,
  'G-comphist': COMPHIST_CAPTION
};

export const DIST_HIST_DEFAULTS = { grain: 'call', dim: 'harness' };

const CAPTION_SHAPE = {
  'G-hist': { grain: 'call', dim: 'harness' },
  'G-comphist': { grain: 'call', dim: 'model' }
};

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

export function histogramTableColumns(unit = 'USD') {
  return ['Group', 'Period', `From (${unit})`, `To (${unit})`, 'Count', 'Unpriced'];
}

export function histogramTableColumnSpecs(unit = 'USD') {
  return histogramTableColumns(unit).map((label, index) => ({ label, numeric: index >= 2 }));
}

// Group ascending, current before previous, bin lower edge ascending. The
// current block is built first, so a stable group sort keeps current above
// previous within one group.
export function orderHistogramCharts(charts = []) {
  return [...charts].sort((a, b) => String(a.group).localeCompare(String(b.group)) || periodRank(a.period) - periodRank(b.period));
}

function edgeText(value) {
  return value === null || value === undefined ? '—' : String(value);
}

// Unpriced is a group/period count, not a per-bin count: it is stated on the
// first bin row and left as an em dash on the rest so it is never summed twice.
export function histogramTableRows(charts = []) {
  return charts.flatMap(item => item.rows.map((row, index) => [
    item.group,
    item.period || 'current',
    edgeText(row.bin.from),
    edgeText(row.bin.to),
    String(row.values.count),
    index === 0 ? edgeText(item.unpriced) : '—'
  ]));
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

registerCaption('dist-hist', ({ spec = {}, scope = {}, schema = null } = {}) => {
  const key = spec?.scope?.captionKey || 'G-hist';
  const measure = (spec?.measures || [])[0] || 'cost_usd';
  const resolved = distributionSpec(spec, DIST_HIST_DEFAULTS);
  const shape = CAPTION_SHAPE[key] || CAPTION_SHAPE['G-hist'];
  const compare = String(scope?.cmp || 'off') === 'period';
  const single = !scope?.cmp || scope.cmp === 'off';
  const mode = key === 'G-comphist' ? compare : single;
  if (mode && measure === 'cost_usd' && resolved.ok && resolved.grain === shape.grain && resolved.dim === shape.dim) {
    return DIST_HIST_CAPTIONS[key] || DIST_HIST_CAPTION;
  }
  return CAPTION_TEMPLATES.histogram({
    measure,
    population: 'model_calls',
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
    const panel = context.panel || DIST_HIST_PANEL;
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
    const distributed = distributionSpec(spec, DIST_HIST_DEFAULTS);
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
    const post = filterRefusal({
      panel, spec, scope: filterScope, schema,
      ignoredFilters: [...ignoredList(body), ...ignoredList(other)]
    });
    if (post) return post;
    const bins = fixedBins(body.rows);
    if (!bins.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
      return emptyState([{ kind: 'scope', label: 'the server returned no bins for this distribution', clear: null }]);
    }
    const charts = [];
    if (cohortCompare) {
      for (const group of splitValuesOf(body, other)) {
        for (const side of [{ body, label: labels.first }, { body: other, label: labels.second }]) {
          const row = (side.body?.rows || []).find(item => String(item.k) === group);
          if (!row) continue;
          charts.push({ group, label: side.label, side: side.label === labels.first ? 'a' : 'b', period: side.label, rows: histogramRows(row, bins), n: row.n, unpriced: row.unpriced });
        }
      }
    } else {
      for (const row of body.rows || []) charts.push({ group: String(row.k), label: String(row.k), period: 'current', rows: histogramRows(row, bins), n: row.n, unpriced: row.unpriced });
      for (const row of other?.rows || []) charts.push({ group: String(row.k), label: String(row.k), period: 'previous', rows: histogramRows(row, bins), n: row.n, unpriced: row.unpriced });
    }
    const ordered = orderHistogramCharts(charts);
    const summary = cohortCompare
      ? comparisonSummary({ plan, sides: { a: withUnpriced(body), b: withUnpriced(other) }, unit: meta.unit }).text
      : '';
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-dist p10-hist';
      const chartHost = doc.createElement('div');
      chartHost.className = 'p10-dist-charts';
      if (cohortCompare) {
        for (const group of splitValuesOf(body, other)) {
          const section = doc.createElement('div');
          section.className = 'p10-split-group';
          section.dataset.split = group;
          for (const item of ordered.filter(chart => chart.group === group)) {
            const node = doc.createElement('yk-ranges');
            node.className = 'p10-dist-chart';
            node.dataset.group = String(item.group);
            node.dataset.cohort = item.side;
            node.dataset.period = item.period;
            node.spec = {
              chart: 'ranges',
              type: 'histogram',
              title: `${meta.label} · ${item.group} · ${item.label} (n ${item.n ?? 0})`,
              timeBasis: 'priced calls only; the scope window',
              units: meta.unit,
              bins,
              series: [{ key: 'count', label: 'Calls', unit: 'calls', kind: 'count' }]
            };
            node.data = item.rows;
            section.append(node);
          }
          chartHost.append(section);
        }
      } else {
        for (const item of ordered) {
          const node = doc.createElement('yk-ranges');
          node.className = 'p10-dist-chart';
          node.dataset.group = String(item.group);
          node.dataset.period = item.period;
          node.spec = {
            chart: 'ranges',
            type: 'histogram',
            title: `${meta.label} · ${item.label}${compare ? ` · ${item.period} period` : ''} (n ${item.n ?? 0})`,
            timeBasis: 'priced calls only; the scope window',
            units: meta.unit,
            bins,
            series: [{ key: 'count', label: 'Calls', unit: 'calls', kind: 'count' }]
          };
          node.data = item.rows;
          chartHost.append(node);
        }
      }
      const tableNode = table(doc, {
        caption: `${meta.label} fixed-bin histogram by ${distDimensionLabel(dim)}`,
        columns: histogramTableColumnSpecs(meta.unit || 'USD'),
        rows: histogramTableRows(ordered)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: chartHost, table: tableNode, doc,
        defaultView: 'chart', label: 'Distribution histogram view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      const boundary = plan.mode === 'period' ? ` ${SHARED_BOUNDARY_NOTE}` : '';
      basis.textContent = `Basis: ${measure} over ${grain} grain by ${dim}, fixed bins from the first group. ${populationLine(body)}.${cohortCompare ? ` ${summary}` : ''}${boundary}`;
      wrapper.append(views.element, basis);
      host.replaceChildren(wrapper);
    });
    renderChooser(panel, { ...spec, measures: [measure], scope: { ...(spec.scope || {}), grain, dim } }, schema, doc);
    return {
      state: 'ready', measure, split: dim, grain, compare, cohortCompare,
      population: body.population || null,
      previousPopulation: other?.population || null,
      bins: bins.length,
      basis: `${measure} fixed-bin histogram by ${dim}${compare ? `; current and previous period. ${SHARED_BOUNDARY_NOTE}` : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`
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
  requests: () => [{ route: '/v1/analytics/distribution', method: 'GET', params: { measure: 'cost_usd', grain: 'call', dim: 'harness' } }],
  load
};

export default DIST_HIST_PANEL;
