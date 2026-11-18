// `scatter-session`: any two published session measures with a schema-valid
// colour and size, whole-population marginals and the rectangle-to-predicate
// seam. The panel draws one composed `<yk-chart type="scatter">`; it adds no
// chart type, gesture or route. A rectangle hands a canonical Boolean
// predicate and the server's exact count to the selection tray.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { measureMeta, whenPanelBody, whenPanelSlot } from './p10-shared.js';
import {
  countSelection, marginalModel, regionPredicate, renderMarginals, renderScatterChooser,
  scatterAxes, scatterCaveat, scatterColours, scatterParams, scatterPopulationText, scatterRows,
  scatterSpecFields, subtractRegion, unionRegion
} from './scatter-shared.js';

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

function chosenAxes(axes, fields) {
  const has = name => Boolean(name) && axes.includes(name);
  const firstOther = name => axes.find(candidate => candidate !== name) || '';
  const x = has(fields.x) ? fields.x : (axes.includes('cost_usd') ? 'cost_usd' : (axes[0] || ''));
  const y = has(fields.y) && fields.y !== x ? fields.y : (axes.includes('commits') && 'commits' !== x ? 'commits' : firstOther(x));
  const size = has(fields.size) && fields.size !== x && fields.size !== y ? fields.size : (axes.includes('unpriced_calls') && !['unpriced_calls'].includes(x) && 'unpriced_calls' !== y ? 'unpriced_calls' : '');
  return { x, y, size };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal, schema = null } = context;
  const doc = context.doc || globalThis.document;
  ensureScatterStyles(doc);
  try {
    const resolvedSchema = schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCATTER_SESSION_PANEL;
    const axes = scatterAxes(panel, resolvedSchema);
    const colours = scatterColours(panel, resolvedSchema);
    const fields = scatterSpecFields(spec, resolvedSchema);
    const { x, y, size } = chosenAxes(axes.axes, fields);
    const colour = colours.colours.includes(fields.colour)
      ? fields.colour
      : (colours.colours.includes('session_model') ? 'session_model' : (colours.colours[0] || ''));
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
    const xMeta = measureMeta(resolvedSchema, x);
    const yMeta = measureMeta(resolvedSchema, y);
    const sizeMeta = size ? measureMeta(resolvedSchema, size) : null;
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
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p11-scatter';
      const basis = doc.createElement('p');
      basis.className = 'p11-scatter-basis';
      basis.textContent = `Basis: ${xMeta.label} (${xMeta.unit || 'count'}) against ${yMeta.label} (${yMeta.unit || 'count'})${colour ? ` coloured by ${colour}` : ''}${size ? `, sized by ${sizeMeta.label}` : ''}. ${populationText}.`;
      const caveats = doc.createElement('p');
      caveats.className = 'p11-scatter-caveat';
      caveats.textContent = caveat.text;
      const node = doc.createElement('yk-chart');
      node.className = 'p11-scatter-chart';
      node.spec = chartSpec;
      node.data = rows;
      wrapper.append(basis, caveats);
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
      const strip = renderMarginals(body, [x, y, size].filter(Boolean), { doc, schema: resolvedSchema });
      if (strip.childNodes.length) wrapper.append(strip);
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
      const rendered = renderScatterChooser({ panelId: panel.id, panel, spec: sandbox, schema: resolvedSchema, doc });
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
