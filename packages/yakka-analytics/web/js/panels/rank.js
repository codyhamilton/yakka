// `rank`: top N of a measure per lens with `(other)`. Single mode is a ranked
// bar chart; compare mode is a two-series slope with the committed diverging
// ramp so an increase and a decrease are distinguishable. A missing previous
// period is unsupported, never an invented baseline.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { formatCount, formatMoney } from '../charts/formatters.js';
import { currentWindow, previousWindow, table } from './pulse-strips.js';
import { canonicalRowKey } from './scatter-shared.js';
import { planDestination, planIdentity } from './scatter-plan.js';
import {
  cohortParams, comparisonPlan, comparisonSummary, ensureP10Styles, honestJoinGuard, measureMeta,
  populationLine, rankRows, requestParams, schemaGrain, whenPanelBody, whenPanelSlot, renderChooser, windowParams
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

// --- Plan-grain mode ------------------------------------------------------
// Plan mode is explicit in the view spec (`grain: 'plan'`) so a measure name
// never switches the panel by inference. The time-grain path below is left
// byte-compatible; every plan helper stays pure for the node checks.

const PLAN_FILTER_KEYS = ['repo_id', 'harness', 'session_model'];

export const PLAN_RANK_MEASURES = [
  'artifacts', 'versions', 'sessions', 'shared_sessions', 'associated_cost_usd', 'unpriced_calls',
  'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
  'design_score:clarity', 'design_score:structure', 'span_days', 'first_ts', 'last_ts'
];

function planNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function isPlanRank(spec = {}) {
  return spec?.grain === 'plan' || spec?.scope?.grain === 'plan';
}

// Only measures the plan grain publishes are offered; `id` and the grain's
// lenses are identities, never ranking measures.
export function publishedPlanMeasures(schema) {
  const grain = schemaGrain(schema, 'plan');
  if (!grain) return [];
  const lenses = new Set(grain.lenses || []);
  return (grain.measures || []).filter(name => name && name !== 'id' && !lenses.has(name));
}

export function planRankMeasure(schema, spec = {}) {
  const offered = publishedPlanMeasures(schema);
  const requested = Array.isArray(spec?.measures) ? String(spec.measures[0] || '') : '';
  if (requested) {
    return { measure: offered.includes(requested) ? requested : '', offered, requested, unsupported: !offered.includes(requested) };
  }
  const fallback = offered.includes('associated_cost_usd') ? 'associated_cost_usd' : (offered[0] || '');
  return { measure: fallback, offered, requested: '', unsupported: false };
}

// Period and cohort comparison are time-grain only; a single cohort is a filter
// and stays allowed on the plan route.
export function planComparisonUnsupported(scope = {}) {
  const plan = comparisonPlan(scope);
  if (plan.mode === 'period' || plan.mode === 'cohorts') return 'period comparison is time-grain only';
  return null;
}

function iso(value) {
  return new Date(Number(value)).toISOString();
}

// `/entities?grain=plan` takes the shared window, the three plan lenses, the
// exclude list, the first valid cohort and a plan-measure sort. No time-only
// parameter (`bucket`, `measure`, `dim`) is ever sent.
export function planRankParams({ scope = {}, measure = 'associated_cost_usd', limit = 12 } = {}) {
  const params = new URLSearchParams();
  const win = currentWindow(scope);
  if (win) {
    params.set('from', iso(win.from));
    params.set('to', iso(win.to));
  } else {
    params.set('all', '1');
    const frozen = scope.to ? Date.parse(scope.to) : NaN;
    if (Number.isFinite(frozen)) params.set('to', new Date(frozen).toISOString());
  }
  if (scope.tz) params.set('tz', scope.tz);
  for (const key of PLAN_FILTER_KEYS) {
    const value = scope[key];
    if (Array.isArray(value)) { for (const item of value) if (item) params.append(key, item); }
    else if (typeof value === 'string' && value) params.set(key, value);
  }
  if (Array.isArray(scope.exclude)) for (const item of scope.exclude) if (item) params.append('exclude', item);
  const cohort = cohortParams(scope).cohort;
  if (cohort) params.set('cohort', cohort);
  params.set('grain', 'plan');
  params.set('sort', `${measure}:desc`);
  params.set('limit', String(limit));
  return params;
}

// The page is the top page the server publishes; `top_max` capped by `page_max`.
export function planRankLimit(schema) {
  const bounds = [Number(schema?.budgets?.top_max), Number(schema?.budgets?.page_max)]
    .filter(value => Number.isFinite(value) && value > 0);
  return bounds.length ? Math.max(1, Math.floor(Math.min(...bounds))) : 12;
}

function planCostNote(row = {}) {
  const measures = row?.m || {};
  const flags = row?.flags || {};
  if (measures.associated_cost_usd === null || measures.associated_cost_usd === undefined) {
    return flags.associated_cost_null_reason === 'all_unpriced' ? 'all unpriced' : 'unpriced';
  }
  return flags.associated_cost_lower_bound === true ? 'lower bound' : '';
}

function executionsText(measures = {}) {
  const part = (label, value) => `${value === null || value === undefined ? '—' : value} ${label}`;
  return [
    part('complete', measures.executions_complete),
    part('unreported', measures.executions_unreported),
    part('started', measures.executions_started)
  ].join(' · ');
}

// One row per returned plan. A null ranking measure stays in the table and the
// counts, never in the marks and never as zero. Values carry the extra facts the
// inspector names (identity, overlap/lower bound, executions).
export function planRankRows(body = {}, measure = 'associated_cost_usd') {
  const rows = [];
  for (const row of Array.isArray(body.rows) ? body.rows : []) {
    const identity = planIdentity(row);
    const measures = row?.m || {};
    const value = planNumber(measures[measure]);
    const label = `${identity.repo_id}/${identity.plan}`;
    const lowerBound = row?.flags?.associated_cost_lower_bound === true;
    const allUnpriced = row?.flags?.associated_cost_null_reason === 'all_unpriced';
    rows.push({
      key: canonicalRowKey(row?.id, 'plan'),
      label,
      identity,
      nullValue: value === null,
      lowerBound,
      allUnpriced,
      costNote: planCostNote(row),
      values: {
        [measure]: value,
        'plan identity': label,
        'cost note': planCostNote(row),
        associated_cost_usd: planNumber(measures.associated_cost_usd),
        shared_sessions: planNumber(measures.shared_sessions),
        unpriced_calls: planNumber(measures.unpriced_calls),
        sessions: planNumber(measures.sessions),
        executions: executionsText(measures),
        last_ts: planNumber(measures.last_ts)
      },
      lenses: row?.l || {},
      flags: row?.flags || {}
    });
  }
  return {
    rows,
    drawn: rows.filter(row => !row.nullValue),
    nulls: rows.filter(row => row.nullValue),
    sharedReports: rows.reduce((sum, row) => sum + (row.values.shared_sessions ?? 0), 0),
    lowerBoundCount: rows.filter(row => row.lowerBound).length,
    allUnpricedCount: rows.filter(row => row.allUnpriced).length
  };
}

// Associated cost is a sum of associated sessions, non-additive across plans.
// The page never becomes a plan-exact total; the shared-session figure is a
// report count because one session can appear under more than one plan.
export function planRankOverlap(rows = []) {
  const plans = rows.length;
  const shared = rows.reduce((sum, row) => sum + (planNumber(row?.values?.shared_sessions ?? row?.m?.shared_sessions) ?? 0), 0);
  const isLower = row => (row?.lowerBound ?? row?.flags?.associated_cost_lower_bound === true) === true;
  const isUnpriced = row => (row?.allUnpriced ?? row?.flags?.associated_cost_null_reason === 'all_unpriced') === true;
  const lower = rows.filter(row => isLower(row) && !isUnpriced(row)).length;
  const unpriced = rows.filter(row => isUnpriced(row)).length;
  return {
    plans,
    shared,
    lower,
    unpriced,
    text: `Associated cost sums sessions and overlaps across plans; ${shared} shared-session ${shared === 1 ? 'report' : 'reports'} across ${plans} plans touch more than one plan (a session may be shared by more than one plan), so no total here is plan-exact spend.`,
    lowerText: lower ? `${lower} plan rows are lower bounds: the priced subset only, never a complete cost.` : '',
    unpricedText: unpriced ? `${unpriced} plan rows are all unpriced: their associated cost is null, not $0.` : ''
  };
}

export function planRankCostText(value, { lowerBound = false, allUnpriced = false } = {}) {
  if (value === null || value === undefined) return allUnpriced ? 'all unpriced' : 'unpriced';
  return formatMoney(Number(value), { lowerBound });
}

function planLastSeen(value) {
  const seconds = planNumber(value);
  return seconds === null ? '—' : new Date(seconds * 1000).toISOString().slice(0, 10);
}

export function planRankEntities(rows = []) {
  const entities = {};
  for (const row of rows) {
    entities[row.key] = {
      grain: 'plan',
      key: row.key,
      identity: row.identity,
      destination: planDestination(row.identity),
      entity: { grain: 'plan', repo_id: row.identity.repo_id, plan: row.identity.plan }
    };
  }
  return entities;
}

function renderPlanChooser({ panelId, measure, offered, schema, spec, doc }) {
  const label = doc.createElement('label');
  label.className = 'p12-rank-chooser-field';
  label.append(doc.createTextNode('Rank by '));
  const select = doc.createElement('select');
  select.className = 'p12-rank-measure';
  select.setAttribute('aria-label', 'Rank by');
  for (const name of offered) {
    const option = doc.createElement('option');
    option.value = name;
    option.textContent = measureMeta(schema, name).label;
    option.selected = name === measure;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    const next = canonicalPanelSpec({ grain: 'plan', measures: [select.value], chart: 'rank', scope: spec?.scope || {} });
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  });
  label.append(select);
  return label;
}

async function loadPlanRank(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  const panel = context.panel || RANK_PANEL;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/workflow.css', doc);
  const comparison = planComparisonUnsupported(scope);
  if (comparison) return unsupportedState({ missing: 'period comparison', reason: comparison, source: 'scope' });
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    if (!schemaGrain(schema, 'plan')) {
      return unsupportedState({ grain: 'plan', reason: 'the server publishes no plan grain', source: 'server /schema' });
    }
    const chosen = planRankMeasure(schema, spec);
    if (chosen.unsupported) {
      return unsupportedState({ missing: `${chosen.requested} ranking`, reason: 'not published for the plan grain', source: 'server /schema' });
    }
    if (!chosen.measure) {
      return unsupportedState({ grain: 'plan', reason: 'the server publishes no numeric plan measure', source: 'server /schema' });
    }
    const measure = chosen.measure;
    const meta = measureMeta(schema, measure);
    const limit = planRankLimit(schema);
    const params = planRankParams({ scope, measure, limit });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'rank-plan' });
    if (!response.ok) {
      if (response.status === 400) return unsupportedState({ missing: `${measure} by plan`, reason: body?.error, source: 'server /schema' });
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const mapped = planRankRows(body, measure);
    if (!mapped.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no plans in window ${scope.win || 'all'}`, clear: null }]);
    }
    const population = body.population || null;
    const overlap = measure === 'associated_cost_usd' ? planRankOverlap(mapped.rows) : null;
    const entities = planRankEntities(mapped.drawn);
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p12-rank';
      const basis = doc.createElement('p');
      basis.className = 'p12-rank-basis';
      basis.textContent = `Basis: ${meta.label} (${meta.unit || 'count'}) per plan identity, sorted by ${meta.label} from the server; ${populationLine(body)}.`;
      wrapper.append(basis);
      if (overlap) {
        const banner = doc.createElement('p');
        banner.className = 'p12-rank-banner';
        banner.textContent = overlap.text;
        wrapper.append(banner);
        for (const text of [overlap.lowerText, overlap.unpricedText].filter(Boolean)) {
          const note = doc.createElement('p');
          note.className = 'p12-rank-note';
          note.textContent = text;
          wrapper.append(note);
        }
      }
      if (mapped.nulls.length && !overlap?.unpriced) {
        const note = doc.createElement('p');
        note.className = 'p12-rank-note';
        note.textContent = `${mapped.nulls.length} plan rows have a null ${meta.label} and are counted but not drawn.`;
        wrapper.append(note);
      }
      if (mapped.drawn.length) {
        const node = doc.createElement('yk-bars');
        node.className = 'p12-rank-chart';
        node.spec = {
          chart: 'bars',
          type: 'ranked',
          title: `${meta.label} per plan`,
          timeBasis: 'the scope window; associated cost sums in-window session costs',
          units: meta.unit,
          series: [{ key: measure, label: meta.label, unit: meta.unit, kind: meta.kind }],
          entities,
          empty: `no plan has a non-null ${measure} in this window`
        };
        node.data = mapped.drawn.map(row => ({ key: row.key, label: row.label, values: row.values }));
        painted = node;
        wrapper.append(node);
      } else {
        const note = doc.createElement('p');
        note.className = 'p12-rank-note';
        note.textContent = `All ${mapped.rows.length} plan rows have a null ${meta.label}; no bar is drawn and no $0 is shown.`;
        wrapper.append(note);
      }
      const columns = [{ label: 'Repo' }, { label: 'Plan' }];
      if (measure !== 'associated_cost_usd') columns.push({ label: meta.label, numeric: true });
      columns.push(
        { label: 'Associated cost', numeric: true }, { label: 'Shared sessions', numeric: true },
        { label: 'Unpriced calls', numeric: true }, { label: 'Sessions', numeric: true },
        { label: 'Executions' }, { label: 'Last seen' }
      );
      const tableRows = mapped.rows.map(row => {
        const cells = [row.identity.repo_id || '—', row.identity.plan || '—'];
        if (measure !== 'associated_cost_usd') {
          cells.push(row.nullValue ? '—' : formatCount(row.values[measure], { unit: meta.unit || '' }));
        }
        const count = value => value === null || value === undefined ? '—' : formatCount(value);
        cells.push(
          planRankCostText(row.values.associated_cost_usd, { lowerBound: row.lowerBound, allUnpriced: row.allUnpriced }),
          count(row.values.shared_sessions), count(row.values.unpriced_calls), count(row.values.sessions),
          row.values.executions, planLastSeen(row.values.last_ts)
        );
        return cells;
      });
      wrapper.append(table(doc, { caption: `${meta.label} per plan`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
    });
    await painted?.whenSettled?.();
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderPlanChooser({ panelId: panel.id, measure, offered: chosen.offered, schema, spec, doc }));
    });
    return {
      state: 'ready', grain: 'plan', measure, limit,
      rows: mapped.rows.length, drawn: mapped.drawn.length, nulls: mapped.nulls.length,
      population, overlap, entities,
      basis: `${measure} per plan identity; top ${mapped.rows.length} of ${population?.scope_n ?? mapped.rows.length} plans`
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    if (error?.status === 400) return unsupportedState({ missing: `${spec.measures?.[0] || 'plan'} ranking`, reason: error.message, source: 'server /schema' });
    return errorState({ message: error?.message || 'The plan ranking query failed.' });
  }
}

export async function load(context = {}) {
  if (isPlanRank(context.spec || {})) return loadPlanRank(context);
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
    const rankSplits = ['model', 'harness', 'session_model', 'session_repo', 'repo_id', 'tool', 'tool_kind', 'kind', 'plan'];
    const dims = measureMeta(schema, measure).dims;
    const validSplits = dims.length ? dims : rankSplits;
    if (spec.split && dims.length && !validSplits.includes(spec.split)) {
      return unsupportedState({ missing: `${measure} by ${spec.split}`, reason: 'not a published dimension for this measure', source: 'server /schema', nearest: validSplits.find(name => rankSplits.includes(name)) || null });
    }
    const split = spec.split && validSplits.includes(spec.split)
      ? spec.split
      : (validSplits.find(name => rankSplits.includes(name)) || 'model');
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
