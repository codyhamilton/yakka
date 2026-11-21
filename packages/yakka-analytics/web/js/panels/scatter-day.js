// `scatter-day`: two time-grain aggregate measures on the same server bucket
// grid. Selecting a region means "contributing sessions of these aggregate
// buckets", never a session-by-session pairing of the two measures. The panel
// freezes the response's effective bucket, step and source window into the
// selection source, and the tray reports contributing sessions and rejection
// associations in their own units. It reuses the Phase 11 request, marginal and
// rectangle seams and adds no chart type, route, grain, join or gesture.

import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { formatMoney, formatNumber } from '../charts/formatters.js';
import { filterRefusal, table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import { measureMeta, mountPanelViews, whenPanelBody, whenPanelSlot } from './p10-shared.js';
import {
  canonicalRowKey, countSelection, formatScatterCell, marginalModel, regionPredicate,
  renderMarginals, renderScatterChooser, resolveScatterFields, scatterAxes, scatterCaveat,
  scatterApplies, scatterDefaults, scatterFilterScope, scatterLabel, scatterParams, scatterPopulationText, scatterSpecFields,
  scatterTableColumns, scatterTemplate, scatterUnit, subtractRegion, unionRegion
} from './scatter-shared.js';
import { ensureScatterStyles } from './scatter-session.js';
import { timeCohortSource } from '../core/selection-model.js';

export const DAY_CAPTION = 'Each dot is a time bucket, with priced spend across and commits up; buckets without prices remain marked as incomplete.';

registerCaption('scatter-day', ({ spec = {} } = {}) => {
  const scope = spec?.scope || {};
  const x = scope.x || 'cost_usd';
  const y = scope.y || 'commits';
  const size = scope.size !== undefined ? scope.size : '';
  if (x === 'cost_usd' && y === 'commits' && !size) return DAY_CAPTION;
  return scatterTemplate({ entity: 'time bucket', x, y, size });
});

export const TIME_MEASURES = [
  'cost_usd', 'model_calls', 'unpriced_calls', 'tokens_in', 'tokens_out', 'tokens_cache_read',
  'tokens_cache_write', 'tokens_reasoning', 'hook_events', 'conversations', 'artifact_versions',
  'distinct_content', 'commits', 'rejections'
];

const BUCKET_SECONDS = { hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };

export function bucketSeconds(bucket = 'day', step = 1) {
  const size = BUCKET_SECONDS[bucket] || BUCKET_SECONDS.day;
  const count = Number(step);
  return size * (Number.isFinite(count) && count > 0 ? count : 1);
}

function epochSeconds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value > 1e11 ? Math.floor(value / 1000) : value;
  const text = String(value);
  if (/^\d+$/.test(text)) return Number(text) > 1e11 ? Math.floor(Number(text) / 1000) : Number(text);
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

export function bucketStart(id) {
  if (id && typeof id === 'object') return epochSeconds(id.t);
  return epochSeconds(id);
}

// A bucket is half-open: [start, start + step). The inclusive source window
// intersects it when the bucket has not ended at `from` and does not start
// after `to`; a bucket starting exactly at `to` still holds that instant.
export function bucketInterval(id, { bucket = 'day', step = 1 } = {}) {
  const start = bucketStart(id);
  if (start === null) return null;
  return { start, end: start + bucketSeconds(bucket, step) };
}

export function bucketIntersectsWindow(interval, window = null) {
  if (!interval || !window) return true;
  const from = epochSeconds(window.from ?? window.start);
  const to = epochSeconds(window.to ?? window.end);
  if (from !== null && interval.end <= from) return false;
  if (to !== null && interval.start > to) return false;
  return true;
}

function fullyInsideWindow(interval, window) {
  if (!interval || !window) return true;
  const from = epochSeconds(window.from ?? window.start);
  const to = epochSeconds(window.to ?? window.end);
  if (from !== null && interval.start < from) return false;
  if (to !== null && interval.end - 1 > to) return false;
  return true;
}

// The effective bucket and step are the response's, never the client's guess.
export function timeBucketInfo(body = {}) {
  const effective = body.bucket ?? body.effective?.bucket ?? '';
  const requested = body.requested_bucket ?? body.requested?.bucket ?? effective;
  const raw = body.bucket_step ?? body.effective?.bucket_step ?? 1;
  const step = Number(raw);
  return {
    bucket: effective,
    bucket_step: Number.isFinite(step) && step > 0 ? step : 1,
    requested,
    coarsened: body.coarsened === true
      || Boolean(requested && requested !== 'auto' && effective && requested !== effective),
    window: body.window || null
  };
}

// The request seam: `bucket=auto` unless the scope names a unit, then only the
// published grain, mode and measured fields.
export function timeScatterParams({ scope = {}, spec = {}, grain = 'time', fields = [] } = {}) {
  const params = scatterParams({ scope, spec, grain, fields });
  // Time entities publish mode=aggregate. mode=scatter is refused as
  // "unsupported time mode" even though the bucket grid is the scatter's data.
  params.set('mode', 'aggregate');
  const unit = scope?.bucket || spec?.scope?.bucket || 'auto';
  params.set('bucket', String(unit));
  return params;
}

// A bucket point keeps the bucket identity and both measures. A null axis is
// counted in the bucket population but not drawn; only a server-supplied zero
// is plotted as zero. The partial flag comes from the response, or from the
// half-open bucket interval extending past the inclusive source window.
export function timePoint(row = {}, spec = {}, body = {}) {
  const { x, y, size } = { ...scatterSpecFields(spec), ...(spec.scope || {}) };
  const m = row.m || {};
  const xValue = x ? m[x] : null;
  const yValue = y ? m[y] : null;
  const drawn = xValue !== null && xValue !== undefined && yValue !== null && yValue !== undefined;
  const info = timeBucketInfo(body);
  const interval = bucketInterval(row.id, { bucket: info.bucket, step: info.bucket_step });
  const key = canonicalRowKey(row.id, 'time');
  const flaggedPartial = row?.flags?.partial === true || row?.partial === true
    || body?.partial === true
    || (Array.isArray(body?.partial?.buckets) && body.partial.buckets.includes(key));
  const inWindow = bucketIntersectsWindow(interval, info.window);
  return {
    key,
    x: drawn ? Number(xValue) : null,
    y: drawn ? Number(yValue) : null,
    group: null,
    size: size ? (m[size] ?? null) : null,
    sampled: row?.flags?.sampled === true,
    drawn,
    partial: flaggedPartial || !inWindow || !fullyInsideWindow(interval, info.window),
    interval,
    values: { ...m }
  };
}

function measureInfo(schema, name) {
  const base = measureMeta(schema, name);
  if (name === 'commits') return { ...base, label: 'Commits', unit: 'commits', kind: 'count' };
  if (name === 'rejections') return { ...base, label: 'Rejections', unit: 'rejections', kind: 'count' };
  if (name === 'conversations') return { ...base, label: 'Sessions', unit: 'sessions', kind: 'count' };
  if (name === 'cost_usd') return { ...base, label: 'Cost', unit: 'USD', kind: 'money' };
  return base;
}

function formatCell(value, meta) {
  if (value === null || value === undefined) return '—';
  if (meta.kind === 'money') return formatMoney(Number(value));
  return formatNumber(Number(value), { digits: meta.kind === 'number' ? 2 : 0 });
}

function timeLabel(id) {
  const start = bucketStart(id);
  if (start === null) return '—';
  return new Date(start * 1000).toISOString();
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureScatterStyles(doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCATTER_DAY_PANEL;
    const refusal = filterRefusal({ panel: { ...panel, applies: scatterApplies(panel) }, spec, scope: scatterFilterScope(scope), schema });
    if (refusal) return refusal;
    const axes = scatterAxes(panel, schema);
    const { x, y, size, colour } = resolveScatterFields({ spec, schema, panel });
    if (!x || !y) {
      return unsupportedState({
        grain: 'time',
        reason: 'the server publishes fewer than two numeric time measures; a bucket needs two aggregate measures',
        source: 'server /schema',
        nearest: axes.unsupported[0]?.try || null
      });
    }
    const sandbox = {
      grain: 'time', measures: [x, y, size].filter(Boolean), split: '',
      scope: { ...(spec.scope || {}), x, y, size, colour: '' }
    };
    const names = [x, y, size].filter(Boolean);
    const params = timeScatterParams({ scope, spec: sandbox, grain: 'time', fields: names });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'scatter-day' });
    if (!response.ok) {
      if (response.status === 400 && /unsupported|not defined|not published|invalid/i.test(body?.error || '')) {
        return unsupportedState({ grain: 'time', reason: body.error || 'the server refused this pairing', source: 'server /schema', nearest: axes.unsupported[0]?.try || null });
      }
      return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    }
    const post = filterRefusal({
      panel: { ...panel, applies: scatterApplies(panel) }, spec, scope: scatterFilterScope(scope), schema,
      ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : []
    });
    if (post) return post;
    const info = timeBucketInfo(body);
    const points = (Array.isArray(body.rows) ? body.rows : []).map(row => timePoint(row, sandbox, body));
    const drawn = points.filter(point => point.drawn);
    const population = body.population || null;
    if (!drawn.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no bucket has both ${x} and ${y} in window ${scope.win || 'all'}`, clear: null }]);
    }
    const caveat = scatterCaveat(sandbox, body);
    const populationText = scatterPopulationText(body);
    const source = timeCohortSource(body, names);
    // A bucket with no priced cost is incomplete even when the server did not
    // flag it partial: it must stay marked, never become a zero.
    const priceMissing = point => point.values?.cost_usd === null || point.values?.cost_usd === undefined;
    const incompletePoint = point => point.partial || !point.drawn || priceMissing(point);
    const incomplete = points.some(incompletePoint);
    const xMeta = { label: scatterLabel(x), unit: scatterUnit(x), kind: measureMeta(schema, x).kind };
    const yMeta = { label: scatterLabel(y), unit: scatterUnit(y), kind: measureMeta(schema, y).kind };
    const sizeMeta = size ? { label: scatterLabel(size), unit: scatterUnit(size) } : null;
    const entities = {};
    for (const point of points) {
      entities[point.key] = { grain: 'time', key: point.key, destination: '/ledger', label: timeLabel(point.interval ? { t: point.interval.start } : null) };
    }
    const chartSpec = {
      chart: 'scatter', type: 'scatter',
      title: `${xMeta.label} against ${yMeta.label} per ${info.bucket || 'bucket'}`,
      units: [xMeta.unit, yMeta.unit].filter(Boolean).join(' × '),
      timeBasis: 'the response bucket grid; each bucket aggregates its in-window facts',
      x: { key: x, label: xMeta.label, kind: 'number', unit: xMeta.unit },
      y: { key: y, label: yMeta.label, kind: 'number', unit: yMeta.unit },
      colour: null,
      size: size ? { key: 'size', label: sizeMeta.label, min: 2.5, max: 9 } : null,
      values: [
        { key: x, label: xMeta.label, unit: xMeta.unit, kind: xMeta.kind },
        { key: y, label: yMeta.label, unit: yMeta.unit, kind: yMeta.kind },
        ...(size ? [{ key: size, label: sizeMeta.label, unit: sizeMeta.unit, kind: sizeMeta.kind }] : [])
      ],
      series: [{ key: 'bucket', label: 'Buckets', unit: 'buckets', kind: 'count' }],
      sample: body.sampled === true ? { n: body.returned_n ?? points.length, total: body.population_n ?? population?.scope_n ?? points.length, rule: body.sample_rule || '' } : null,
      entities,
      empty: 'no eligible bucket has both axes'
    };
    const marginals = marginalModel(body.marginals, names);
    const ordered = [...points].sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const identityText = point => {
      const label = timeLabel(point.interval ? { t: point.interval.start } : null);
      return incompletePoint(point) ? `${label} · incomplete` : label;
    };
    const tableRows = ordered.map(point => [
      identityText(point),
      formatScatterCell(point.x, x),
      formatScatterCell(point.y, y),
      ...(size ? [formatScatterCell(point.size, size)] : [])
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
        caption: `Time buckets by ${xMeta.label} and ${yMeta.label}`,
        columns: scatterTableColumns({ x, y, size, colour: '' }),
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
      const grid = `${info.bucket || 'bucket'} grid, step ${info.bucket_step}${info.coarsened ? ', coarsened by the server' : ''}`;
      basis.textContent = `Basis: ${xMeta.label} (${xMeta.unit || 'count'}) against ${yMeta.label} (${yMeta.unit || 'count'}) on one shared ${grid}. ${populationText}. A region selects contributing sessions, not bucket counts, and never pairs a call with a commit.`;
      const caveats = doc.createElement('p');
      caveats.className = 'p11-scatter-caveat';
      caveats.textContent = caveat.text;
      details.append(summary, basis, caveats);
      if (incomplete) {
        const note = doc.createElement('p');
        note.className = 'p11-scatter-note';
        note.textContent = 'A partial or price-missing bucket stays marked as incomplete; it is not zero-filled. A partial bucket is covered only at the source-window edge and its measures are not a full interval.';
        details.append(note);
      }
      wrapper.append(views.element);
      const strip = renderMarginals(body, names, { doc, schema });
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
        const sampled = body.sampled === true ? (node.inspect?.()?.sampledMarkCount ?? points.filter(point => point.sampled).length) : 0;
        const hostNode = doc.querySelector(`[data-panel="${panel.id}"]`) || node;
        countSelection({ transport, grain: 'time', scope, predicate, tenant, signal }).then(result => {
          if (!result.ok) {
            caveats.dataset.countError = result.error || String(result.status);
            return;
          }
          const relation = result.population?.relation || null;
          const target = relation?.target_sessions || null;
          const selected = target ? Number(target.cohort_n) : result.count;
          const scopeN = target
            ? Number(target.scope_n)
            : (population?.scope_n ?? result.population?.scope_n ?? null);
          const expansion = target
            ? `${Number(target.cohort_n) || 0} contributing sessions; the target applies its own window and expands to those sessions' other facts, artifacts and plans. Bucket counts are never session counts.`
            : '';
          hostNode.dispatchEvent(new CustomEvent('select', {
            bubbles: true,
            composed: true,
            detail: {
              source: 'scatter-predicate',
              selection: {
                grain: 'time',
                unit: 'session',
                predicate,
                counts: { selected, scope: scopeN },
                sampled,
                associations: result.associations,
                relation,
                source,
                bucketPopulation: result.population,
                expansion
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
      const rendered = renderScatterChooser({ panelId: panel.id, panel, spec: sandbox, schema, doc, defaults: scatterDefaults(panel) });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', grain: 'time', axes: [x, y, size].filter(Boolean),
      bucket: info.bucket, bucket_step: info.bucket_step, coarsened: info.coarsened,
      window: info.window, partial: incomplete, population, source,
      sampled: body.sampled === true,
      basis: `scatter ${x} × ${y} on the shared ${info.bucket || 'bucket'} grid`,
      populationText, marginalCount: marginals.length, drawn: drawn.length,
      tableRows
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The time scatter failed.' });
  }
}

export const SCATTER_DAY_PANEL = {
  id: 'scatter-day',
  title: 'Time: two measures on one bucket grid',
  grain: 'time',
  measures: TIME_MEASURES,
  lenses: ['id'],
  charts: ['scatter'],
  requires: ['entities_time'],
  caveats: 'Both measures share one server bucket grid; a partial bucket covers only part of the source window. Selecting buckets means contributing sessions, never a causal pairing of calls with commits, and bucket counts are never session counts. Marginals are the whole population.',
  measureBasis: 'the response bucket grid; each bucket aggregates its in-window facts',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'time', mode: 'aggregate', fields: 'cost_usd,commits', bucket: 'auto' } }],
  load
};

export default SCATTER_DAY_PANEL;
