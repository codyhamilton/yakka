// `scatter-plan`: associated plan cost against what the plan produced
// (artifacts, versions, a design score or complete share). Associated cost is
// the sum of associated sessions and is non-additive across plans, so the panel
// shows the overlap banner and never calls a total plan-exact spend. It reuses
// the Phase 11 request, marginal and rectangle-to-predicate seam and adds no
// chart type, route, grain, join or gesture. The plan explorer is Phase 12.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatMoney, formatNumber, formatPercent } from '../charts/formatters.js';
import { formatP10Value, measureMeta, schemaGrain, whenPanelBody, whenPanelSlot } from './p10-shared.js';
import { table } from './pulse-strips.js';
import {
  canonicalRowKey, countSelection, marginalModel, regionPredicate, renderMarginals,
  renderScatterChooser, scatterCaveat, scatterParams, scatterPopulationText, subtractRegion, unionRegion
} from './scatter-shared.js';
import { ensureScatterStyles } from './scatter-session.js';
import { catalogueChecks } from './score-ranges.js';

const PLAN_FIXED = [
  'artifacts', 'versions', 'sessions', 'shared_sessions', 'associated_cost_usd', 'unpriced_calls',
  'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
  'span_days', 'first_ts', 'last_ts'
];
const PLAN_COLOUR_NAMES = ['repo_id', 'harness', 'session_model'];
export const PLAN_EXPLORER_NOTICE = 'The plan explorer arrives in Phase 12; Open names the plan destination but the explorer is not served yet.';

// Numeric axes are the plan grain's published measures of 17.3. A dynamic
// `design_score:<check>` must be in the catalogue when one is supplied; a plan
// measure the schema does not publish is never offered.
export function planAxes(schema, catalogue = null) {
  const grain = schemaGrain(schema, 'plan');
  const checks = catalogueChecks(catalogue || {});
  const checkSet = new Set(checks);
  const lenses = new Set(grain?.lenses || []);
  const axes = [];
  const unsupported = [];
  for (const name of grain?.measures || []) {
    if (name === 'id' || lenses.has(name)) {
      unsupported.push({ kind: 'axis', name, reason: 'id is an identity lens, not a numeric axis', try: axes[0] || 'a numeric plan measure' });
      continue;
    }
    if (name.startsWith('design_score:')) {
      const check = name.slice('design_score:'.length);
      if (checks.length && !checkSet.has(check)) {
        unsupported.push({
          kind: 'axis', name,
          reason: `check ${check} is not in the score catalogue`,
          try: `design_score:${checks[0]}`
        });
        continue;
      }
    } else if (!name.startsWith('artifacts:') && !PLAN_FIXED.includes(name)) {
      continue;
    }
    if (!axes.includes(name)) axes.push(name);
  }
  return { axes, checks, unsupported };
}

export function planColours(schema) {
  const grain = schemaGrain(schema, 'plan');
  const lenses = new Set(grain?.lenses || []);
  const colours = PLAN_COLOUR_NAMES.filter(name => lenses.has(name));
  const unsupported = [...lenses]
    .filter(name => name === 'id' || name === 'model')
    .map(name => ({
      kind: 'colour', name,
      reason: name === 'id' ? 'id is an identity lens, not a colour' : 'model is not a plan colour lens',
      try: colours[0] || 'repo_id'
    }));
  return { colours, unsupported };
}

// The plan identity and `/plans/<repo>/<plan>` destination Phase 12 will serve.
export function planIdentity(row = {}) {
  const id = row && typeof row.id === 'object' && row.id ? row.id : {};
  const lens = row.l || {};
  return {
    repo_id: lens.repo_id ?? id.repo_id ?? row.repo_id ?? '',
    plan: lens.plan ?? id.plan ?? row.plan ?? ''
  };
}

export function planDestination(identity = {}) {
  return `/plans/${encodeURIComponent(String(identity.repo_id ?? ''))}/${encodeURIComponent(String(identity.plan ?? ''))}`;
}

// Null complete_share (no_executions) and null design_score stay out of the
// marks; they are counted in the population, never drawn as zero.
export function planPoint(row = {}, spec = {}) {
  const scope = spec.scope || {};
  const measures = Array.isArray(spec.measures) ? spec.measures : [];
  const x = scope.x || spec.x || measures[0] || 'associated_cost_usd';
  const y = scope.y || spec.y || measures[1] || 'artifacts';
  const size = scope.size !== undefined ? scope.size : (spec.size ?? measures[2] ?? '');
  const colour = spec.split || scope.colour || '';
  const m = row.m || {};
  const l = row.l || {};
  const xValue = m[x];
  const yValue = m[y];
  const drawn = xValue !== null && xValue !== undefined && yValue !== null && yValue !== undefined;
  return {
    key: canonicalRowKey(row.id, 'plan'),
    x: drawn ? Number(xValue) : null,
    y: drawn ? Number(yValue) : null,
    group: colour ? (l[colour] ?? null) : null,
    size: size ? (m[size] ?? null) : null,
    sampled: false,
    drawn,
    identity: planIdentity(row),
    shared_sessions: m.shared_sessions ?? null,
    unpriced_calls: m.unpriced_calls ?? null,
    values: { ...m, ...l }
  };
}

// The overlap banner: associated cost is a sum of sessions, non-additive across
// plans. `shared_sessions` and `unpriced_calls` stay visible; a total is never
// presented as plan-exact spend.
export function planOverlap(rows = []) {
  const plans = rows.length;
  const shared = rows.reduce((n, row) => n + Number(row.m?.shared_sessions ?? 0), 0);
  const unpriced = rows.reduce((n, row) => n + Number(row.m?.unpriced_calls ?? 0), 0);
  return {
    plans, shared, unpriced,
    text: `associated_cost_usd is the sum of associated sessions and is non-additive across plans; it is not plan-exact spend. ${shared} shared-session reports across ${plans} plans (a session may be shared by more than one plan); ${unpriced} unpriced calls in the associated sessions.`
  };
}

export function planNullText(points = []) {
  const notDrawn = points.filter(point => !point.drawn).length;
  if (!notDrawn) return '';
  return `${notDrawn} plan rows have a null axis and are counted in the population but not drawn; complete_share is null with no_executions and design_score is null when the plan has no scored design.`;
}

function measureInfo(schema, name) {
  const base = measureMeta(schema, name);
  if (name === 'associated_cost_usd') return { ...base, label: 'Associated cost', unit: 'USD', kind: 'money' };
  if (name === 'unpriced_calls') return { ...base, label: 'Unpriced calls', unit: 'calls', kind: 'count' };
  if (name === 'artifacts') return { ...base, label: 'Artifacts', unit: 'artifacts', kind: 'count' };
  if (name.startsWith('artifacts:')) return { ...base, label: `Artifacts ${name.slice('artifacts:'.length)}`, unit: 'artifacts', kind: 'count' };
  if (name === 'versions') return { ...base, label: 'Versions', unit: 'versions', kind: 'count' };
  if (name === 'sessions') return { ...base, label: 'Associated sessions', unit: 'sessions', kind: 'count' };
  if (name === 'shared_sessions') return { ...base, label: 'Shared sessions', unit: 'sessions', kind: 'count' };
  if (name === 'complete_share') return { ...base, label: 'Complete share', unit: 'share', kind: 'percent' };
  if (name.startsWith('design_score:')) return { ...base, label: `Design score ${name.slice('design_score:'.length)}`, unit: 'score', kind: 'number' };
  if (name === 'span_days') return { ...base, label: 'Span', unit: 'days', kind: 'number' };
  if (name === 'first_ts') return { ...base, label: 'First seen', unit: 'epoch seconds', kind: 'number' };
  if (name === 'last_ts') return { ...base, label: 'Last seen', unit: 'epoch seconds', kind: 'number' };
  return base;
}

function formatCell(value, meta) {
  if (value === null || value === undefined) return meta.kind === 'money' ? 'unpriced' : '—';
  if (meta.kind === 'money') return formatMoney(Number(value));
  if (meta.kind === 'percent') return formatPercent(Number(value));
  if (meta.kind === 'number') return formatNumber(Number(value), { digits: 2 });
  return formatP10Value(value, meta);
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureScatterStyles(doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCATTER_PLAN_PANEL;
    const axisModel = planAxes(schema, context.catalogue || null);
    const colourModel = planColours(schema);
    const axes = axisModel.axes;
    const requested = spec?.scope || {};
    const measureList = Array.isArray(spec.measures) ? spec.measures : [];
    const roleX = requested.x || measureList[0] || '';
    const roleY = requested.y || measureList[1] || '';
    const roleSize = requested.size !== undefined ? requested.size : (measureList[2] || '');
    const roleColour = spec.split || requested.colour || '';
    const x = axes.includes(roleX) ? roleX : (axes.includes('associated_cost_usd') ? 'associated_cost_usd' : (axes[0] || ''));
    const y = axes.includes(roleY) && roleY !== x ? roleY : (axes.includes('artifacts') && 'artifacts' !== x ? 'artifacts' : (axes.find(name => name !== x) || ''));
    const size = axes.includes(roleSize) && roleSize !== x && roleSize !== y ? roleSize : '';
    const colour = colourModel.colours.includes(roleColour)
      ? roleColour
      : (colourModel.colours.includes('repo_id') ? 'repo_id' : (colourModel.colours[0] || ''));
    if (!x || !y) {
      return unsupportedState({ grain: 'plan', reason: 'the server publishes fewer than two numeric plan measures', source: 'server /schema', nearest: axisModel.unsupported[0]?.try || null });
    }
    const sandbox = {
      grain: 'plan', measures: [x, y, size].filter(Boolean), split: colour,
      scope: { ...(spec.scope || {}), x, y, size, colour }
    };
    const params = scatterParams({ scope, spec: sandbox, grain: 'plan', fields: [x, y, size].filter(Boolean) });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'scatter-plan' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not defined|not published|invalid/i.test(body?.error || '')) {
        return unsupportedState({ grain: 'plan', reason: body.error || 'the server refused this pairing', source: 'server /schema', nearest: axisModel.unsupported[0]?.try || null });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const points = (Array.isArray(body.rows) ? body.rows : []).map(row => planPoint(row, sandbox));
    const drawn = points.filter(point => point.drawn);
    const population = body.population || null;
    if (!drawn.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no plan has both ${x} and ${y} in window ${scope.win || 'all'}`, clear: null }]);
    }
    const caveat = scatterCaveat(sandbox, body);
    const populationText = scatterPopulationText(body);
    const overlap = planOverlap(body.rows || []);
    const nullText = planNullText(points);
    const unsupported = [...axisModel.unsupported, ...colourModel.unsupported];
    const xMeta = measureInfo(schema, x);
    const yMeta = measureInfo(schema, y);
    const sizeMeta = size ? measureInfo(schema, size) : null;
    const entities = {};
    for (const point of drawn) {
      entities[point.key] = {
        grain: 'plan', key: point.key, identity: point.identity,
        destination: planDestination(point.identity),
        entity: { grain: 'plan', repo_id: point.identity.repo_id, plan: point.identity.plan },
        reader: 'Phase 12'
      };
    }
    const chartSpec = {
      chart: 'scatter', type: 'scatter',
      title: `${xMeta.label} against ${yMeta.label}`,
      units: [xMeta.unit, yMeta.unit].filter(Boolean).join(' × '),
      timeBasis: 'in-window artifact facts; associated sessions aggregate inside the applied window',
      x: { key: x, label: xMeta.label, kind: 'number', unit: xMeta.unit },
      y: { key: y, label: yMeta.label, kind: 'number', unit: yMeta.unit },
      colour: colour ? { key: 'group', label: colour } : null,
      size: size ? { key: 'size', label: sizeMeta.label, min: 2.5, max: 9 } : null,
      values: [
        { key: x, label: xMeta.label, unit: xMeta.unit, kind: xMeta.kind },
        { key: y, label: yMeta.label, unit: yMeta.unit, kind: yMeta.kind },
        ...(size ? [{ key: size, label: sizeMeta.label, unit: sizeMeta.unit, kind: sizeMeta.kind }] : [])
      ],
      series: [{ key: colour || 'plan', label: colour || 'Plans', unit: 'plans', kind: 'count' }],
      sample: body.sampled === true ? { n: body.returned_n ?? drawn.length, total: body.population_n ?? population?.scope_n ?? drawn.length, rule: body.sample_rule || '' } : null,
      entities,
      empty: 'no eligible plan has both axes'
    };
    const marginals = marginalModel(body.marginals, [x, y, size].filter(Boolean));
    const columns = [
      { label: 'Plan' }, { label: 'Repo' },
      { label: xMeta.label, numeric: true }, { label: yMeta.label, numeric: true },
      { label: 'Shared sessions', numeric: true }, { label: 'Unpriced calls', numeric: true }
    ];
    const tableRows = points.map(point => [
      point.identity.plan || '—',
      point.identity.repo_id || '—',
      formatCell(point.x, xMeta),
      formatCell(point.y, yMeta),
      point.shared_sessions === null || point.shared_sessions === undefined ? '—' : String(point.shared_sessions),
      point.unpriced_calls === null || point.unpriced_calls === undefined ? '—' : String(point.unpriced_calls)
    ]);
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p11-scatter';
      const banner = doc.createElement('p');
      banner.className = 'p11-scatter-banner';
      banner.textContent = overlap.text;
      const basis = doc.createElement('p');
      basis.className = 'p11-scatter-basis';
      basis.textContent = `Basis: ${xMeta.label} (${xMeta.unit || 'count'}) against ${yMeta.label} (${yMeta.unit || 'count'})${colour ? ` coloured by ${colour}` : ''}${size ? `, sized by ${sizeMeta.label}` : ''}. ${populationText}.`;
      const caveats = doc.createElement('p');
      caveats.className = 'p11-scatter-caveat';
      caveats.textContent = caveat.text;
      const node = doc.createElement('yk-chart');
      node.className = 'p11-scatter-chart';
      node.spec = chartSpec;
      node.data = drawn;
      wrapper.append(banner, basis, caveats);
      if (unsupported.length) {
        const list = doc.createElement('ul');
        list.className = 'p11-unsupported';
        list.setAttribute('aria-label', 'Unsupported scatter choices');
        for (const item of unsupported) {
          const entry = doc.createElement('li');
          entry.dataset.kind = item.kind;
          entry.textContent = `${item.kind} ${item.name} is unsupported: ${item.reason}. Try ${item.try}.`;
          list.append(entry);
        }
        wrapper.append(list);
      }
      wrapper.append(node);
      if (nullText) {
        const nullNote = doc.createElement('p');
        nullNote.className = 'p11-scatter-note';
        nullNote.textContent = nullText;
        wrapper.append(nullNote);
      }
      const note = doc.createElement('p');
      note.className = 'p11-scatter-note';
      note.textContent = PLAN_EXPLORER_NOTICE;
      wrapper.append(note);
      const strip = renderMarginals(body, [x, y, size].filter(Boolean), { doc, schema });
      if (strip.childNodes.length) wrapper.append(strip);
      wrapper.append(table(doc, { caption: `${x} against ${y} (plan)`, columns, rows: tableRows }));
      host.replaceChildren(wrapper);
      painted = node;

      let predicate = null;
      node.addEventListener('select', event => {
        const detail = event.detail || {};
        if (detail.source !== 'scatter-rectangle') return;
        const rectangle = regionPredicate(detail.region, x, y);
        const additive = Boolean(detail.additive);
        const exclude = Boolean(detail.exclude);
        predicate = exclude ? subtractRegion(predicate, rectangle) : (additive ? unionRegion(predicate, rectangle) : rectangle);
        const hostNode = doc.querySelector(`[data-panel="${panel.id}"]`) || node;
        countSelection({ transport, grain: 'plan', scope, predicate, tenant, signal }).then(result => {
          if (!result.ok) {
            caveats.dataset.countError = result.error || String(result.status);
            return;
          }
          hostNode.dispatchEvent(new CustomEvent('select', {
            bubbles: true, composed: true,
            detail: {
              source: 'scatter-predicate',
              selection: {
                grain: 'plan', unit: 'plan', predicate,
                counts: { selected: result.count, scope: population?.scope_n ?? result.population?.scope_n ?? null },
                sampled: 0,
                associations: result.associations
              }
            }
          }));
        }).catch(error => {
          if (error?.name === 'AbortError') return;
          caveats.dataset.countError = error?.message || 'the exact count failed';
        });
      });
    });
    await painted?.whenSettled?.();
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const chooserPanel = { ...panel, measures: axes, lenses: colourModel.colours };
      const rendered = renderScatterChooser({ panelId: panel.id, panel: chooserPanel, spec: sandbox, schema, doc });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', grain: 'plan', axes: [x, y, size].filter(Boolean), colour,
      sampled: body.sampled === true, population, overlap, nullText,
      basis: `scatter ${x} × ${y}; ${caveat.sample}`,
      populationText, marginalCount: marginals.length, drawn: drawn.length,
      tableRows, entities
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The plan scatter failed.' });
  }
}

export const SCATTER_PLAN_PANEL = {
  id: 'scatter-plan',
  title: 'Plans: associated cost against what they produced',
  grain: 'plan',
  measures: [
    'associated_cost_usd', 'artifacts', 'versions', 'sessions', 'shared_sessions', 'unpriced_calls',
    'executions_complete', 'executions_unreported', 'executions_started', 'complete_share',
    'design_score:clarity', 'design_score:structure', 'span_days', 'first_ts', 'last_ts'
  ],
  lenses: ['repo_id', 'harness', 'session_model', 'id'],
  charts: ['scatter'],
  requires: ['entities_plan'],
  caveats: 'Associated cost is a sum of associated sessions, non-additive across plans and never plan-exact spend. An unpriced associated cost is null, not zero; complete_share is null with no_executions.',
  measureBasis: 'in-window artifact facts; associated sessions aggregate inside the applied window',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'plan', mode: 'scatter', fields: 'associated_cost_usd,artifacts' } }],
  load
};

export default SCATTER_PLAN_PANEL;
