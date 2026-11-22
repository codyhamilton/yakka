// `scatter-session`: any two published session measures with a schema-valid
// colour and size, whole-population marginals and the rectangle-to-predicate
// seam. The panel draws one composed `<yk-chart type="scatter">`; it adds no
// chart type, gesture or route. A rectangle hands a canonical Boolean
// predicate and the server's exact count to the selection tray.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { filterRefusal, table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import { measureMeta, mountPanelViews, whenPanelBody, whenPanelSlot } from './p10-shared.js';
import {
  countSelection, formatScatterCell, marginalModel, regionPredicate, renderMarginals,
  scatterApplies, scatterFilterScope,
  renderScatterChooser, resolveScatterFields, scatterAxes, scatterCaveat, scatterColours,
  scatterDefaults, scatterLabel, scatterParams, scatterPopulationText, scatterRows,
  scatterTableColumns, scatterTemplate, scatterUnit, subtractRegion, unionRegion
} from './scatter-shared.js';

export const SESSION_CAPTION = 'Each dot is a session, with priced spend across and commit count up; larger dots mean more calls without prices.';

registerCaption('scatter-session', ({ spec = {} } = {}) => {
  const scope = spec?.scope || {};
  const x = scope.x || 'cost_usd';
  const y = scope.y || 'commits';
  const size = scope.size !== undefined ? scope.size : 'unpriced_calls';
  if (x === 'cost_usd' && y === 'commits' && (size || '') === 'unpriced_calls') return SESSION_CAPTION;
  return scatterTemplate({ entity: 'session', x, y, size });
});

let stylesLoaded = false;
export function ensureScatterStyles(doc = globalThis.document) {
  if (stylesLoaded || doc.querySelector('link[href="/css/scatter.css"]')) return;
  stylesLoaded = true;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/scatter.css';
  doc.head?.append(link);
}

export const SESSION_MEASURES = [
  'cost_usd', 'unpriced_calls', 'model_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'commits', 'artifact_versions',
  'distinct_content', 'duration_s', 'first_ts', 'last_ts'
];

export const SESSION_LENSES = ['harness', 'session_model', 'session_repo', 'origin', 'has_artifacts', 'id'];

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal, schema = null } = context;
  const doc = context.doc || globalThis.document;
  ensureScatterStyles(doc);
  try {
    const resolvedSchema = schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCATTER_SESSION_PANEL;
    const refusal = filterRefusal({ panel: { ...panel, applies: scatterApplies(panel) }, spec, scope: scatterFilterScope(scope), schema: resolvedSchema });
    if (refusal) return refusal;
    const axes = scatterAxes(panel, resolvedSchema);
    const colours = scatterColours(panel, resolvedSchema);
    const { x, y, size, colour } = resolveScatterFields({ spec, schema: resolvedSchema, panel });
    if (!x || !y) {
      return unsupportedState({
        grain: 'session',
        reason: 'the server publishes fewer than two numeric session measures',
        source: 'server /schema',
        nearest: axes.unsupported[0]?.try || null
      });
    }
    const sandbox = { ...spec, grain: 'session', measures: [x, y, size].filter(Boolean), split: colour, scope: { ...(spec.scope || {}), x, y, size, colour } };
    const params = scatterParams({ scope, spec: sandbox, grain: 'session', fields: [x, y, size].filter(Boolean) });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'scatter-session' });
    const post = filterRefusal({
      panel: { ...panel, applies: scatterApplies(panel) }, spec, scope: scatterFilterScope(scope), schema: resolvedSchema,
      ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : []
    });
    if (post) return post;
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not defined|not published|invalid/i.test(body?.error || '')) {
        return unsupportedState({
          grain: 'session',
          reason: body.error || 'the server refused this pairing',
          source: 'server /schema',
          nearest: axes.unsupported[0]?.try || null
        });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const rows = scatterRows(body, sandbox);
    const population = body.population || null;
    if (!rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{
        kind: 'scope',
        label: `no session has both ${x} and ${y} in window ${scope.win || 'all'}`,
        clear: null
      }]);
    }
    const caveat = scatterCaveat(sandbox, body);
    const populationText = scatterPopulationText(body);
    const unsupported = [...axes.unsupported, ...colours.unsupported];
    const xMeta = { label: scatterLabel(x), unit: scatterUnit(x), kind: measureMeta(resolvedSchema, x).kind };
    const yMeta = { label: scatterLabel(y), unit: scatterUnit(y), kind: measureMeta(resolvedSchema, y).kind };
    const sizeMeta = size ? { label: scatterLabel(size), unit: scatterUnit(size) } : null;
    const entities = {};
    for (const row of rows) {
      entities[row.key] = { grain: 'session', key: row.key, destination: `/sessions/${encodeURIComponent(row.key)}` };
    }
    const chartSpec = {
      chart: 'scatter',
      type: 'scatter',
      title: `${xMeta.label} against ${yMeta.label}`,
      units: [xMeta.unit, yMeta.unit].filter(Boolean).join(' × '),
      timeBasis: 'session facts.ts window; measures over the applied scope',
      x: { key: x, label: xMeta.label, kind: 'number', unit: xMeta.unit },
      y: { key: y, label: yMeta.label, kind: 'number', unit: yMeta.unit },
      colour: colour ? { key: 'group', label: colour } : null,
      size: size ? { key: 'size', label: sizeMeta.label, min: 2.5, max: 9 } : null,
      values: [
        { key: x, label: xMeta.label, unit: xMeta.unit, kind: xMeta.kind },
        { key: y, label: yMeta.label, unit: yMeta.unit, kind: yMeta.kind },
        ...(size ? [{ key: size, label: sizeMeta.label, unit: sizeMeta.unit, kind: sizeMeta.kind }] : [])
      ],
      series: [{ key: colour || 'session', label: colour || 'Sessions', unit: 'sessions', kind: 'count' }],
      sample: body.sampled === true ? { n: body.returned_n ?? rows.length, total: body.population_n ?? population?.scope_n ?? rows.length, rule: body.sample_rule || '' } : null,
      entities,
      empty: 'no eligible session has both axes'
    };
    const marginals = marginalModel(body.marginals, [x, y, size].filter(Boolean));
    const ordered = [...rows].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p11-scatter';
      const node = doc.createElement('yk-chart');
      node.className = 'p11-scatter-chart';
      node.spec = chartSpec;
      node.data = ordered;
      const tableNode = table(doc, {
        caption: `Sessions by ${xMeta.label} and ${yMeta.label}`,
        columns: scatterTableColumns({ x, y, size, colour }),
        rows: ordered.map(row => [
          row.key,
          formatScatterCell(row.x, x),
          formatScatterCell(row.y, y),
          ...(size ? [formatScatterCell(row.size, size)] : []),
          ...(colour ? [row.group === null || row.group === undefined ? '—' : String(row.group)] : [])
        ])
      });
      const views = mountPanelViews({ panelId: panel.id, chart: node, table: tableNode, doc, label: 'Scatter view' });
      views.element.removeAttribute('data-panel');
      const details = doc.createElement('details');
      details.className = 'p10-details';
      const summary = doc.createElement('summary');
      summary.textContent = 'Data details';
      const caveats = doc.createElement('p');
      caveats.className = 'p11-scatter-caveat';
      caveats.textContent = caveat.text;
      const basis = doc.createElement('p');
      basis.className = 'p11-scatter-basis';
      basis.textContent = `Basis: ${xMeta.label} (${xMeta.unit || 'count'}) against ${yMeta.label} (${yMeta.unit || 'count'})${colour ? ` coloured by ${colour}` : ''}${size ? `, sized by ${sizeMeta.label}` : ''}. ${populationText}.`;
      details.append(summary, basis, caveats);
      wrapper.append(views.element);
      const strip = renderMarginals(body, [x, y, size].filter(Boolean), { doc, schema: resolvedSchema });
      if (strip.childNodes.length) wrapper.append(strip);
      wrapper.append(details);
      host.replaceChildren(wrapper);
      painted = node;

      // Rectangle -> canonical range predicate -> exact server count -> tray.
      // Never expands the rectangle into sampled identity keys.
      let predicate = null;
      node.addEventListener('select', event => {
        const detail = event.detail || {};
        if (detail.source !== 'scatter-rectangle') return;
        const rectangle = regionPredicate(detail.region, x, y);
        const additive = Boolean(detail.additive);
        const exclude = Boolean(detail.exclude);
        predicate = exclude ? subtractRegion(predicate, rectangle) : (additive ? unionRegion(predicate, rectangle) : rectangle);
        const sampled = node.inspect?.()?.sampledMarkCount ?? rows.filter(row => row.sampled).length;
        const host_ = doc.querySelector(`[data-panel="${panel.id}"]`) || node;
        countSelection({ transport, grain: 'session', scope, predicate, tenant, signal }).then(result => {
          if (!result.ok) {
            caveats.dataset.countError = result.error || String(result.status);
            return;
          }
          host_.dispatchEvent(new CustomEvent('select', {
            bubbles: true,
            composed: true,
            detail: {
              source: 'scatter-predicate',
              selection: {
                grain: 'session',
                unit: 'session',
                predicate,
                counts: { selected: result.count, scope: population?.scope_n ?? result.population?.scope_n ?? null },
                sampled,
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
      const rendered = renderScatterChooser({ panelId: panel.id, panel, spec: sandbox, schema: resolvedSchema, doc, defaults: scatterDefaults(panel) });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready',
      grain: 'session',
      axes: [x, y, size].filter(Boolean),
      colour,
      sampled: body.sampled === true,
      population,
      basis: `scatter ${x} × ${y}; ${caveat.sample}`,
      populationText,
      marginalCount: marginals.length,
      rows: rows.map(row => ({ key: row.key, x: row.x, y: row.y, group: row.group, size: row.size, sampled: row.sampled }))
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The session scatter failed.' });
  }
}

export const SCATTER_SESSION_PANEL = {
  id: 'scatter-session',
  title: 'Sessions: cost against output',
  grain: 'session',
  measures: SESSION_MEASURES,
  lenses: SESSION_LENSES,
  charts: ['scatter'],
  requires: ['entities_session'],
  caveats: 'Association, not cause. A sampled scatter labels the marks; marginals are the whole population. Unpriced cost is a lower bound and duration is an observed span, not active work time.',
  measureBasis: 'session facts.ts window; duration is last minus first in-window fact',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'session', mode: 'scatter', fields: 'cost_usd,commits,unpriced_calls' } }],
  load
};

export default SCATTER_SESSION_PANEL;
