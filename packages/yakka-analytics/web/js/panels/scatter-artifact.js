// `scatter-artifact`: a numeric artifact measure against the same version's
// writing-session cost, calls or tokens, another same-kind check, versions or
// content bytes. `model` and `id` are never numeric axes. The panel reuses the
// Phase 11 request, marginal and rectangle-to-predicate seam; it adds no chart
// type, route, grain, join or gesture. The inspector opens the artifact reader.

import { applicabilityState, cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatMoney, formatNumber, formatPercent } from '../charts/formatters.js';
import { registerCaption } from './captions.js';
import { formatP10Value, measureMeta, mountPanelViews, schemaGrain, whenPanelBody, whenPanelSlot } from './p10-shared.js';
import { table } from './pulse-strips.js';
import {
  canonicalRowKey, countSelection, formatScatterCell, marginalModel, regionPredicate,
  renderMarginals, renderScatterChooser, resolveScatterFields, scatterAxes, scatterCaveat,
  scatterDefaults, scatterFilterScope, scatterLabel, scatterParams, scatterPopulationText, scatterTableColumns,
  scatterTemplate, scatterUnit, subtractRegion, unionRegion
} from './scatter-shared.js';
import { ensureScatterStyles } from './scatter-session.js';
import {
  MULTI_KIND_REFUSAL, catalogueChecks, defaultCheck, fetchContentBaselines, fetchScoreCatalogue, resolveScorer,
  scoreApplicabilityRefusal, scoreKind, scorerNames
} from './score-ranges.js';

export const ARTIFACT_CAPTION = 'Each dot is a file, with its writing session’s spend across and its clarity score up; this association does not prove that spending improves quality.';

registerCaption('scatter-artifact', ({ spec = {} } = {}) => {
  const scope = spec?.scope || {};
  const check = scope.check || 'clarity';
  const x = scope.x || 'writing_session_cost_usd';
  const y = scope.y || `score:${check}`;
  const size = scope.size !== undefined ? scope.size : '';
  if (check === 'clarity' && x === 'writing_session_cost_usd' && y === 'score:clarity' && !size) return ARTIFACT_CAPTION;
  return scatterTemplate({ entity: 'file', x, y, size });
});

const ARTIFACT_FIXED = new Set(['versions', 'distinct_writing_sessions', 'first_ts', 'last_ts', 'content_bytes']);
const ARTIFACT_COLOUR_NAMES = ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'screen_verdict', 'scorer'];
export const ARTIFACT_READER_NOTICE = 'Open the selected identity in the artifact reader.';

function isArtifactMeasure(name) {
  return ARTIFACT_FIXED.has(name) || name.startsWith('score:') || name.startsWith('writing_session_');
}

// Numeric axes are the artifact grain's published measures of 17.3. A dynamic
// `score:<check>` must be in the `/scores?kind=` catalogue; an unknown check is
// named unsupported with the nearest catalogue check, never requested.
export function artifactAxes(schema, catalogue = null) {
  const grain = schemaGrain(schema, 'artifact');
  const checks = catalogueChecks(catalogue || {});
  const checkSet = new Set(checks);
  const lenses = new Set(grain?.lenses || []);
  const modeFields = Array.isArray(grain?.scatter_fields) && grain.scatter_fields.length
    ? grain.scatter_fields
    : (grain?.measures || []);
  const axes = [];
  const unsupported = [];
  for (const name of modeFields) {
    if (name === 'id' || name === 'model' || lenses.has(name)) {
      unsupported.push({
        kind: 'axis', name,
        reason: name === 'id' ? 'id is an identity lens, not a numeric axis' : `${name} is categorical and cannot be a numeric scatter axis`,
        try: axes[0] || 'a numeric artifact measure'
      });
      continue;
    }
    if (!isArtifactMeasure(name)) continue;
    if (name.startsWith('score:')) {
      const check = name.slice('score:'.length);
      if (checks.length && !checkSet.has(check)) {
        unsupported.push({
          kind: 'axis', name,
          reason: `check ${check} is not in the score catalogue for this kind`,
          try: `score:${checks[0]}`
        });
        continue;
      }
    }
    if (!axes.includes(name)) axes.push(name);
  }
  return { axes, checks, unsupported };
}

// Colour is a published categorical lens only. `model` is a writing-session
// attribute (offered as `session_model`), and `id` is an identity lens.
export function artifactColours(schema) {
  const grain = schemaGrain(schema, 'artifact');
  const lenses = new Set(grain?.lenses || []);
  const colours = [];
  const unsupported = [];
  for (const name of ARTIFACT_COLOUR_NAMES) if (lenses.has(name)) colours.push(name);
  for (const name of lenses) {
    if (name.startsWith('band:')) colours.push(name);
    else if (name === 'id') unsupported.push({ kind: 'colour', name, reason: 'id is an identity lens, not a colour', try: colours[0] || 'kind' });
    else if (name === 'model') unsupported.push({ kind: 'colour', name, reason: 'model is a writing-session attribute; use session_model', try: colours[0] || 'kind' });
  }
  return { colours, unsupported };
}

// The identity the inspector and `/artifact?...` destination use. The reader
// itself uses the identity `repo_id` + `path` + `hash`.
export function artifactIdentity(row = {}) {
  const id = row && typeof row.id === 'object' && row.id ? row.id : {};
  const lens = row.l || {};
  const repo_id = lens.repo_id ?? id.repo_id ?? row.repo_id ?? '';
  const path = lens.path ?? id.path ?? row.path ?? '';
  const hash = lens.content_hash ?? lens.hash ?? id.content_hash ?? id.hash
    ?? row.content_hash ?? row.hash ?? (typeof row.id === 'string' ? row.id : '');
  return { repo_id, path, hash };
}

export function artifactDestination(identity = {}) {
  const params = new URLSearchParams();
  params.set('repo_id', String(identity.repo_id ?? ''));
  params.set('path', String(identity.path ?? ''));
  params.set('hash', String(identity.hash ?? ''));
  return `/artifact?${params.toString()}`;
}

// A null axis keeps the artifact in the typed population but is not drawn; it
// is never zero-filled. An unpriced writing-session cost stays null.
export function artifactPoint(row = {}, spec = {}) {
  const scope = spec.scope || {};
  const measures = Array.isArray(spec.measures) ? spec.measures : [];
  const x = scope.x || spec.x || measures[0] || '';
  const y = scope.y || spec.y || measures[1] || '';
  const size = scope.size !== undefined ? scope.size : (spec.size ?? measures[2] ?? '');
  const colour = spec.split || scope.colour || '';
  const m = row.m || {};
  const l = row.l || {};
  const xValue = x ? m[x] : null;
  const yValue = y ? m[y] : null;
  const drawn = xValue !== null && xValue !== undefined && yValue !== null && yValue !== undefined;
  return {
    key: canonicalRowKey(row.id, 'artifact'),
    x: drawn ? Number(xValue) : null,
    y: drawn ? Number(yValue) : null,
    group: colour ? (l[colour] ?? null) : null,
    size: size ? (m[size] ?? null) : null,
    sampled: row.flags?.sampled === true,
    drawn,
    identity: artifactIdentity(row),
    values: { ...m, ...l }
  };
}

// Every null/unpriced population is counted under its own label. A partially
// priced writing session is a lower bound; an all-unpriced one is a null cost,
// never `$0`.
export function artifactMissing(rows = [], body = {}, check = '') {
  const missing = body?.population?.missing_by_reason || {};
  const flagCount = name => rows.reduce((n, row) => n + (row.flags?.[name] ? 1 : 0), 0);
  const unscored = flagCount('unscored') || Number(missing.unscored || 0);
  const contentUnavailable = flagCount('content_unavailable') || Number(missing.content_unavailable || 0);
  const nullCost = rows.reduce((n, row) => n + (row.m?.writing_session_cost_usd === null ? 1 : 0), 0);
  const lowerBound = flagCount('lower_bound');
  const unpriced = rows.reduce((n, row) => n + Number(row.flags?.unpriced_calls ?? (row.flags?.unpriced ? 1 : 0)), 0);
  return {
    unscored, contentUnavailable, nullCost, lowerBound, unpriced,
    check,
    text: [
      `${unscored} unscored`,
      `${contentUnavailable} content_unavailable`,
      `${nullCost} with a null writing-session cost`,
      `${lowerBound} lower-bound writing-session costs`,
      `${unpriced} unpriced calls`
    ].join('; ')
  };
}

function measureInfo(schema, name) {
  const base = measureMeta(schema, name);
  if (name === 'writing_session_cost_usd') return { ...base, label: 'Writing-session cost', unit: 'USD', kind: 'money' };
  if (name === 'writing_session_model_calls') return { ...base, label: 'Writing-session model calls', unit: 'calls', kind: 'count' };
  if (name === 'writing_session_hook_events') return { ...base, label: 'Writing-session hook events', unit: 'events', kind: 'count' };
  if (name.startsWith('writing_session_tokens_')) {
    const suffix = name.slice('writing_session_tokens_'.length).replace(/_/g, ' ');
    return { ...base, label: `Writing-session tokens ${suffix}`, unit: 'tokens', kind: 'tokens' };
  }
  if (name.startsWith('score:')) return { ...base, label: `Score ${name.slice('score:'.length)}`, unit: 'score', kind: 'number' };
  if (name === 'content_bytes') return { ...base, label: 'Content bytes', unit: 'bytes', kind: 'count' };
  if (name === 'versions') return { ...base, label: 'Versions', unit: 'versions', kind: 'count' };
  if (name === 'distinct_writing_sessions') return { ...base, label: 'Distinct writing sessions', unit: 'sessions', kind: 'count' };
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

function chooseOption(doc, labelText, options, value, onChange) {
  const label = doc.createElement('label');
  label.className = 'p11-chooser-field';
  label.append(doc.createTextNode(labelText));
  const control = doc.createElement('select');
  control.setAttribute('aria-label', labelText);
  for (const option of options) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    control.append(node);
  }
  control.addEventListener('change', () => onChange(control.value));
  label.append(control);
  return label;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureScatterStyles(doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCATTER_ARTIFACT_PANEL;
    const resolvedKind = scoreKind(scope, spec);
    if (resolvedKind.multi) {
      return applicabilityState({
        labels: ['document kind'], filters: ['kind'],
        message: MULTI_KIND_REFUSAL
      });
    }
    const refusal = scoreApplicabilityRefusal({ panel, spec, scope: scatterFilterScope(scope), schema, grain: 'artifact' });
    if (refusal) return refusal;
    const requested = spec?.scope || {};
    const kind = resolvedKind.kind;
    const catalogue = await fetchScoreCatalogue(transport, kind, { tenant, signal, stateKey: 'scatter-artifact-catalogue' });
    if (!catalogue.response.ok) {
      return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    }
    const checks = catalogue.checks;
    if (!checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: checks[0] });
    }
    const check = requested.check || defaultCheck(checks);
    const baselines = await fetchContentBaselines(transport, { kind, check, scorer: requested.scorer, tenant, signal, stateKey: 'scatter-artifact-baseline' });
    if (!baselines.response.ok) {
      return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    }
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    if (!resolved.scorer) {
      return unsupportedState({ measure: `a scorer for ${check}`, reason: 'no scorer is published for this check', source: 'server /baselines', nearest: null });
    }
    const axisModel = artifactAxes(schema, catalogue.body);
    const colourModel = artifactColours(schema);
    const rolePanel = { ...panel, measures: axisModel.axes, lenses: colourModel.colours };
    const defaults = { ...scatterDefaults(panel), y: `score:${check}` };
    const { x, y, size, colour } = resolveScatterFields({ spec, schema, panel: rolePanel, defaults });
    if (!x || !y) {
      return unsupportedState({
        grain: 'artifact', reason: 'the server publishes fewer than two numeric artifact measures',
        source: 'server /schema', nearest: axisModel.unsupported[0]?.try || null
      });
    }
    const sandbox = {
      grain: 'artifact', measures: [x, y, size].filter(Boolean), split: colour,
      scope: { ...(spec.scope || {}), x, y, size, colour, kind, check, scorer: resolved.scorer }
    };
    const params = scatterParams({ scope: { ...scope, kind }, spec: sandbox, grain: 'artifact', fields: [x, y, size].filter(Boolean) });
    params.set('check', check);
    params.set('scorer', resolved.scorer);
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'scatter-artifact' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not defined|not published|invalid/i.test(body?.error || '')) {
        return unsupportedState({ grain: 'artifact', reason: body.error || 'the server refused this pairing', source: 'server /schema', nearest: axisModel.unsupported[0]?.try || null });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const post = scoreApplicabilityRefusal({
      panel, spec, scope: scatterFilterScope(scope), schema, grain: 'artifact',
      ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : []
    });
    if (post) return post;
    const points = (Array.isArray(body.rows) ? body.rows : []).map(row => artifactPoint(row, sandbox));
    const drawn = points.filter(point => point.drawn);
    const population = body.population || null;
    if (!drawn.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no artifact has both ${x} and ${y} in window ${scope.win || 'all'}`, clear: null }]);
    }
    const caveat = scatterCaveat(sandbox, body);
    const populationText = scatterPopulationText(body);
    const missing = artifactMissing(body.rows || [], body, check);
    const unsupported = [...axisModel.unsupported, ...colourModel.unsupported];
    const xMeta = { label: scatterLabel(x), unit: scatterUnit(x), kind: measureMeta(schema, x).kind };
    const yMeta = { label: scatterLabel(y), unit: scatterUnit(y), kind: 'number' };
    const sizeMeta = size ? { label: scatterLabel(size), unit: scatterUnit(size) } : null;
    const entities = {};
    for (const point of drawn) {
      entities[point.key] = {
        grain: 'artifact', key: point.key, identity: point.identity,
        destination: artifactDestination(point.identity),
        entity: { grain: 'artifact', repo_id: point.identity.repo_id, path: point.identity.path, content_hash: point.identity.hash },
        reader: 'artifact reader'
      };
    }
    const chartSpec = {
      chart: 'scatter', type: 'scatter',
      title: `${xMeta.label} against ${yMeta.label}`,
      units: [xMeta.unit, yMeta.unit].filter(Boolean).join(' × '),
      timeBasis: 'the selected artifact version; writing-session measures aggregate inside the applied window',
      x: { key: x, label: xMeta.label, kind: 'number', unit: xMeta.unit },
      y: { key: y, label: yMeta.label, kind: 'number', unit: yMeta.unit },
      colour: colour ? { key: 'group', label: colour } : null,
      size: size ? { key: 'size', label: sizeMeta.label, min: 2.5, max: 9 } : null,
      values: [
        { key: x, label: xMeta.label, unit: xMeta.unit, kind: xMeta.kind },
        { key: y, label: yMeta.label, unit: yMeta.unit, kind: yMeta.kind },
        ...(size ? [{ key: size, label: sizeMeta.label, unit: sizeMeta.unit, kind: sizeMeta.kind }] : [])
      ],
      series: [{ key: colour || 'artifact', label: colour || 'Artifacts', unit: 'artifacts', kind: 'count' }],
      sample: body.sampled === true ? { n: body.returned_n ?? drawn.length, total: body.population_n ?? population?.scope_n ?? drawn.length, rule: body.sample_rule || '' } : null,
      entities,
      empty: 'no eligible artifact has both axes'
    };
    const marginals = marginalModel(body.marginals, [x, y, size].filter(Boolean));
    const ordered = [...points].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const tableRows = ordered.map(point => [
      `${point.identity.repo_id || '—'}/${point.identity.path || '—'}`,
      formatScatterCell(point.x, x),
      formatScatterCell(point.y, y),
      ...(size ? [formatScatterCell(point.size, size)] : []),
      ...(colour ? [point.group === null || point.group === undefined ? '—' : String(point.group)] : [])
    ]);
    let painted = null;
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p11-scatter';
      const node = doc.createElement('yk-chart');
      node.className = 'p11-scatter-chart';
      node.spec = chartSpec;
      node.data = ordered.filter(point => point.drawn);
      const tableNode = table(doc, {
        caption: `Files by ${xMeta.label} and ${yMeta.label}`,
        columns: scatterTableColumns({ x, y, size, colour }),
        rows: tableRows
      });
      const views = mountPanelViews({ panelId: panel.id, chart: node, table: tableNode, doc, label: 'Scatter view' });
      views.element.removeAttribute('data-panel');
      const details = doc.createElement('details');
      details.className = 'p10-details';
      const summary = doc.createElement('summary');
      summary.textContent = 'Data details';
      const basis = doc.createElement('p');
      basis.className = 'p11-scatter-basis';
      basis.textContent = `Basis: ${xMeta.label} (${xMeta.unit || 'count'}) against ${yMeta.label} (${yMeta.unit || 'count'})${colour ? ` coloured by ${colour}` : ''}${size ? `, sized by ${sizeMeta.label}` : ''}. ${populationText}. ${missing.text}.`;
      const caveats = doc.createElement('p');
      caveats.className = 'p11-scatter-caveat';
      caveats.textContent = caveat.text;
      const note = doc.createElement('p');
      note.className = 'p11-scatter-note';
      note.textContent = `${missing.text}. ${ARTIFACT_READER_NOTICE}`;
      details.append(summary, basis, caveats, note);
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
        details.append(list);
      }
      wrapper.append(views.element);
      const strip = renderMarginals(body, [x, y, size].filter(Boolean), { doc, schema });
      if (strip.childNodes.length) wrapper.append(strip);
      wrapper.append(details);
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
        const sampled = node.inspect?.()?.sampledMarkCount ?? drawn.filter(point => point.sampled).length;
        const hostNode = doc.querySelector(`[data-panel="${panel.id}"]`) || node;
        countSelection({ transport, grain: 'artifact', scope, predicate, tenant, signal }).then(result => {
          if (!result.ok) {
            caveats.dataset.countError = result.error || String(result.status);
            return;
          }
          hostNode.dispatchEvent(new CustomEvent('select', {
            bubbles: true, composed: true,
            detail: {
              source: 'scatter-predicate',
              selection: {
                grain: 'artifact', unit: 'artifact', predicate,
                counts: { selected: result.count, scope: population?.scope_n ?? result.population?.scope_n ?? null },
                sampled, associations: result.associations
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
      const rendered = renderScatterChooser({ panelId: panel.id, panel: rolePanel, spec: sandbox, schema, doc, defaults });
      const checkField = chooseOption(doc, 'Check', checks.map(value => ({ value, label: scatterLabel(`score:${value}`).replace(/ score$/, '') })), check,
        value => rendered.dispatch({ scope: { check: value, y: `score:${value}` } }));
      const scorerOptions = scorerNames(baselines.body);
      const scorerField = chooseOption(doc, 'Scorer', scorerOptions.map(value => ({ value, label: value })), resolved.scorer,
        value => rendered.dispatch({ scope: { scorer: value } }));
      rendered.element.insertBefore(scorerField, rendered.element.firstChild);
      rendered.element.insertBefore(checkField, rendered.element.firstChild);
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', grain: 'artifact', kind, check, scorer: resolved.scorer, axes: [x, y, size].filter(Boolean), colour,
      sampled: body.sampled === true, population, missing,
      basis: `scatter ${x} × ${y}; ${caveat.sample}`,
      populationText, marginalCount: marginals.length, drawn: drawn.length,
      tableRows, entities
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The artifact scatter failed.' });
  }
}

export const SCATTER_ARTIFACT_PANEL = {
  id: 'scatter-artifact',
  title: 'Artifacts: score against the writing session',
  grain: 'artifact',
  measures: [
    'score:clarity', 'score:structure', 'writing_session_cost_usd', 'writing_session_model_calls',
    'writing_session_tokens_in', 'writing_session_tokens_out', 'writing_session_tokens_cache_read',
    'writing_session_tokens_cache_write', 'writing_session_tokens_reasoning', 'writing_session_hook_events',
    'versions', 'distinct_writing_sessions', 'content_bytes', 'first_ts', 'last_ts'
  ],
  lenses: [...ARTIFACT_COLOUR_NAMES, 'band:clarity', 'band:structure', 'model', 'id'],
  charts: ['scatter'],
  requires: ['entities_artifact', 'scores_by_lens'],
  caveats: 'A null score is unscored, a missing blob is content_unavailable, and an all-unpriced writing session is a null cost, never $0. A partially priced session is a lower bound. Association, not cause; marginals are the whole population.',
  measureBasis: 'the selected artifact version; writing-session measures aggregate inside the applied window',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'artifact', mode: 'scatter', fields: 'writing_session_cost_usd,score:clarity' } }],
  load
};

export default SCATTER_ARTIFACT_PANEL;
