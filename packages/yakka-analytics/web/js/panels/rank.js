// `rank`: top N of a measure per lens with `(other)`. Single mode is a ranked
// bar chart; compare mode is a two-series slope with the committed diverging
// ramp so an increase and a decrease are distinguishable. A missing previous
// period is unsupported, never an invented baseline.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { currentWindow, previousWindow, table } from './pulse-strips.js';
import {
  comparisonPlan, comparisonSummary, ensureP10Styles, honestJoinGuard, measureMeta, populationLine, rankRows,
  requestParams, whenPanelBody, whenPanelSlot, renderChooser, windowParams
} from './p10-shared.js';

const PERIOD_UNSUPPORTED = 'Choose a finite period to compare periods.';

export const RANK_MEASURES = [
  'cost_usd', 'model_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write',
  'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions', 'commits', 'rejections'
];

function previousParams({ scope, measure, split, extra }) {
  const previous = previousWindow(scope);
  if (!previous) return null;
  const params = requestParams({ scope, measure, split, bucket: 'none', extra });
  const window = windowParams(previous);
  params.set('from', window.get('from'));
  params.set('to', window.get('to'));
  return params;
}

export function slopeRows(currentBody, previousBody, measure, split) {
  const current = rankRows(currentBody, measure, split);
  const previous = rankRows(previousBody, measure, split);
  const order = [];
  const byGroup = new Map();
  for (const row of current.rows) {
    if (!byGroup.has(row.label)) { byGroup.set(row.label, { key: row.key, label: row.label, values: {}, lenses: row.lenses }); order.push(row.label); }
    byGroup.get(row.label).values.current = row.values[measure];
  }
  for (const row of previous.rows) {
    if (!byGroup.has(row.label)) { byGroup.set(row.label, { key: row.key, label: row.label, values: {}, lenses: row.lenses }); order.push(row.label); }
    byGroup.get(row.label).values.previous = row.values[measure];
  }
  return {
    series: [
      { key: 'previous', label: 'Previous period', unit: current.series[0].unit, kind: current.series[0].kind },
      { key: 'current', label: 'Current period', unit: current.series[0].unit, kind: current.series[0].kind }
    ],
    rows: order.map(label => byGroup.get(label))
  };
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
    const panel = context.panel || RANK_PANEL;
    const offered = (schema?.grains?.time?.measures || []);
    const measure = (spec.measures || [])[0] && (!offered.length || offered.includes(spec.measures[0])) ? spec.measures[0] : 'cost_usd';
    if (offered.length && !offered.includes(measure)) {
      return unsupportedState({ missing: measure, reason: 'not published for the time grain', source: 'server /schema' });
    }
    const validSplits = ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan'];
    const split = spec.split && validSplits.includes(spec.split) ? spec.split : 'model';
    const guard = honestJoinGuard(measure, [split]);
    if (guard) return unsupportedState({ missing: guard.missing, reason: guard.reason, source: 'contract 17.3', nearest: guard.try });
    if (compare && !currentWindow(scope)) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const extra = topMax ? { top: String(Math.min(100, topMax)) } : null;
    const meta = measureMeta(schema, measure);
    const current = await transport.get('query', requestParams({ scope, measure, split, bucket: 'none', extra }), { tenant, signal, stateKey: cohortCompare ? 'rank-a' : 'rank' });
    if (!current.response.ok) {
      if (current.response.status === 400) return unsupportedState({ missing: `${measure} by ${split}`, reason: current.body?.error, source: 'server /schema' });
      return errorState({ message: current.body?.error || `The server returned ${current.response.status}.`, code: current.body?.code || '' });
    }
    let series;
    let rows;
    let charts = null;
    let previousBody = null;
    let summary = '';
    if (cohortCompare) {
      const bParams = plan.b
        ? requestParams({ scope, measure, split, bucket: 'none', extra, cohort: plan.b })
        : requestParams({ scope, measure, split, bucket: 'none', extra, cohort: null });
      const other = await transport.get('query', bParams, { tenant, signal, stateKey: 'rank-b' });
      if (!other.response.ok) return errorState({ message: other.body?.error || `The server returned ${other.response.status}.`, code: other.body?.code || '' });
      previousBody = other.body;
      const rankedA = rankRows(current.body, measure, split, meta);
      const rankedB = rankRows(previousBody, measure, split, meta);
      const labels = [...new Set([...rankedA.rows, ...rankedB.rows].map(row => row.label))];
      charts = labels.map(label => {
        const rowA = rankedA.rows.find(row => row.label === label);
        const rowB = rankedB.rows.find(row => row.label === label);
        return {
          group: label,
          series: [
            { key: 'a', label: plan.aLabel, unit: meta.unit, kind: meta.kind },
            { key: 'b', label: plan.bLabel, unit: meta.unit, kind: meta.kind }
          ],
          rows: [{ key: `split:${label}`, label, values: { a: rowA?.values[measure], b: rowB?.values[measure] }, lenses: rowA?.lenses || rowB?.lenses || {} }]
        };
      });
      series = charts[0]?.series || [];
      rows = charts.flatMap(item => item.rows);
      summary = comparisonSummary({ plan, sides: { a: current.body, b: previousBody }, unit: meta.unit }).text;
    } else if (compare) {
      const params = previousParams({ scope, measure, split, extra });
      if (!params) return unsupportedState({ missing: 'period comparison', reason: PERIOD_UNSUPPORTED, source: 'scope' });
      const previous = await transport.get('query', params, { tenant, signal, stateKey: 'rank-previous' });
      if (!previous.response.ok) return errorState({ message: previous.body?.error || `The server returned ${previous.response.status}.`, code: previous.body?.code || '' });
      previousBody = previous.body;
      const slope = slopeRows(current.body, previousBody, measure, split);
      series = slope.series;
      rows = slope.rows;
    } else {
      const ranked = rankRows(current.body, measure, split, meta);
      series = ranked.series;
      rows = ranked.rows;
    }
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${measure} groups in window ${scope.win || 'all'}`, clear: null }]);
    }
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-rank';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = cohortCompare
        ? `Basis: ${measure} (${meta.unit}) per ${split}, bucket=none, ${plan.aLabel} against ${plan.bLabel}. ${populationLine(current.body)}. ${summary}`
        : compare
          ? `Basis: ${measure} (${meta.unit}) per ${split}, bucket=none, current against the previous equal-length period. ${populationLine(current.body)}.`
          : `Basis: ${measure} (${meta.unit}) per ${split}, bucket=none. ${populationLine(current.body)}.`;
      if (charts) {
        for (const item of charts) {
          const section = doc.createElement('div');
          section.className = 'p10-split-group';
          section.dataset.split = item.group;
          const node = doc.createElement('yk-bars');
          node.className = 'p10-rank-chart';
          node.dataset.split = item.group;
          node.spec = {
            chart: 'bars',
            type: 'slope',
            title: `${meta.label} by ${split} · ${item.group} (${plan.aLabel} against ${plan.bLabel})`,
            timeBasis: 'both cohorts in the scope window',
            units: meta.unit,
            series: item.series,
            top: topMax ? Math.min(100, topMax) : undefined,
            deltaRamp: true
          };
          node.data = item.rows;
          section.append(node);
          wrapper.append(section);
        }
      } else {
        const node = doc.createElement('yk-bars');
        node.className = 'p10-rank-chart';
        node.spec = {
          chart: 'bars',
          type: compare ? 'slope' : 'ranked',
          title: `${meta.label} by ${split}${compare ? ' (current against previous period)' : ''}`,
          timeBasis: compare ? 'current window against the equal length immediately before' : 'the scope window',
          units: meta.unit,
          series,
          top: topMax ? Math.min(100, topMax) : undefined,
          ...(compare ? { deltaRamp: true } : {})
        };
        node.data = rows;
        wrapper.append(node);
      }
      const columns = charts
        ? [{ label: 'Group' }, { label: plan.aLabel, numeric: true }, { label: plan.bLabel, numeric: true }, { label: 'Change', numeric: true }]
        : compare
          ? [{ label: 'Group' }, { label: 'Previous period', numeric: true }, { label: 'Current period', numeric: true }, { label: 'Change', numeric: true }]
          : [{ label: 'Group' }, { label: meta.label, numeric: true }];
      const tableRows = charts
        ? charts.map(item => {
          const row = item.rows[0];
          return [item.group, String(row.values.a ?? '—'), String(row.values.b ?? '—'), String(Number(row.values.b) - Number(row.values.a))];
        })
        : compare
          ? rows.map(row => [row.label, String(row.values.previous ?? '—'), String(row.values.current ?? '—'), String(Number(row.values.current) - Number(row.values.previous))])
          : rows.map(row => [row.label, String(row.values[measure] ?? '—')]);
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = cohortCompare
        ? 'Both cohorts are listed per group with their sample sizes; the change is shown beside them, never as a lone delta.'
        : compare
          ? 'Both periods are listed; the change is shown beside them, never as a lone delta. Up is the committed positive diverging token and down the negative one.'
          : 'Top groups are bounded by the published top budget; (other) folds the rest.';
      wrapper.append(basis, note, table(doc, { caption: `${measure} by ${split}`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderChooser({ panelId: panel.id, panel, spec: { ...spec, measures: [measure], split, chart: compare || cohortCompare ? 'slope' : 'ranked' }, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', measure, split, compare, cohortCompare,
      groups: charts ? charts.length : undefined,
      population: current.body.population || null,
      previousPopulation: previousBody?.population || null,
      basis: `${measure} per ${split}, bucket=none${compare ? '; current and previous period' : cohortCompare ? `; ${plan.aLabel} and ${plan.bLabel}` : ''}`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'cost_usd'} ranking`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The ranking query failed.' });
  }
}

export const RANK_PANEL = {
  id: 'rank',
  title: 'Rank',
  grain: 'time',
  measures: RANK_MEASURES,
  lenses: ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan'],
  charts: ['rank', 'slope'],
  requires: [],
  caveats: 'Compare is a two-series slope with the committed diverging ramp; more than two periods or no previous period is unsupported, never an invented baseline.',
  measureBasis: 'the scope window at bucket=none; compare uses the equal length immediately before',
  requests: () => [
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'none', dim: 'model' } },
    { route: '/v1/analytics/query', method: 'GET', params: { measure: 'cost_usd', bucket: 'none', dim: 'model', window: 'previous' } }
  ],
  load
};

export default RANK_PANEL;
