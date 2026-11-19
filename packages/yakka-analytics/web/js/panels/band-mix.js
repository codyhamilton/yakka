// `band-mix`: file-weighted band composition per artifact kind. `band:<check>`
// is a structured lens; the panel reads it and never writes a legacy
// `exclude=band:<check>:<value>` string. The population is files, not hashes.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import {
  ensureP10Styles, requestParams, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import {
  BASELINE_LABEL, QUALITY_KINDS, baselineBand, catalogueChecks, groupName, qualityScope,
  renderQualityChooser, resolveScorer, scorerNames
} from './score-ranges.js';
import { stripPopulationText } from './score-strips.js';

export const BAND_KEYS = ['low', 'mid', 'high', 'unscored', 'baseline_unavailable'];
const BAND_LABELS = {
  low: 'below p25', mid: 'mid (p25–p75 inclusive)', high: 'above p75',
  unscored: 'unscored', baseline_unavailable: 'baseline_unavailable'
};

function countOf(group) {
  const value = group?.n ?? group?.count ?? group?.v ?? group?.value ?? 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function splitGroup(group) {
  if (Array.isArray(group?.k)) return { band: String(group.k[0] ?? ''), kind: String(group.k[1] ?? 'all') };
  if (group?.band !== undefined) return { band: String(group.band), kind: String(group?.kind ?? group?.key ?? 'all') };
  const key = groupName(group);
  const at = key.indexOf('|');
  if (at > 0) return { band: key.slice(0, at), kind: key.slice(at + 1) };
  return { band: key, kind: 'all' };
}

// Accepts both the aggregate `groups` shape and the `/query`-style `rows` shape.
export function bandMixRows(body = {}) {
  const counts = new Map();
  const kinds = [];
  const push = (band, kind, count) => {
    if (!BAND_KEYS.includes(band)) return;
    if (!kinds.includes(kind)) kinds.push(kind);
    if (!counts.has(kind)) counts.set(kind, new Map());
    const map = counts.get(kind);
    map.set(band, (map.get(band) || 0) + count);
  };
  for (const row of Array.isArray(body?.rows) ? body.rows : []) {
    const { band, kind } = splitGroup(row);
    push(band, kind, countOf(row));
  }
  for (const group of Array.isArray(body?.groups) ? body.groups : []) {
    const { band, kind } = splitGroup(group);
    push(band, kind, countOf(group));
  }
  const rows = kinds.map(kind => ({
    key: kind,
    label: kind,
    values: Object.fromEntries(BAND_KEYS.map(band => [band, counts.get(kind)?.get(band) || 0]))
  }));
  return {
    rows,
    series: BAND_KEYS.map(band => ({ key: band, label: BAND_LABELS[band], unit: 'files', kind: 'count' })),
    omittedGroups: body?.omitted_groups ?? 0,
    omittedN: body?.omitted_n ?? 0,
    population: body?.population || null
  };
}

export function bandMixTableRows(model = {}) {
  return (model.rows || []).map(row => [
    row.label, ...BAND_KEYS.map(band => row.values[band] === null || row.values[band] === undefined ? '—' : String(row.values[band]))
  ]);
}

async function fetchCatalogue(transport, kind, options) {
  const { response, body } = await transport.get('scores', new URLSearchParams({ kind }), options);
  return { response, body, checks: catalogueChecks(body) };
}

async function fetchBaselines(transport, { kind, check, tenant, signal, stateKey }) {
  const params = new URLSearchParams({ population: 'content', kind, check });
  if (tenant) params.set('tenant', tenant);
  return transport.request('baselines', { params, signal, stateKey });
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || BAND_MIX_PANEL;
    const requested = qualityScope(spec);
    const kind = QUALITY_KINDS.includes(requested.kind) ? requested.kind : 'design';
    const catalogue = await fetchCatalogue(transport, kind, { tenant, signal, stateKey: 'band-mix-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: catalogue.checks[0] });
    }
    const check = requested.check || catalogue.checks[0];
    const baselines = await fetchBaselines(transport, { kind, check, tenant, signal, stateKey: 'band-mix-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    const band = baselineBand(resolved.entry);
    const pageMax = Number(schema?.budgets?.page_max) || 0;
    const params = requestParams({
      scope, spec: { ...spec, split: '' }, measure: '',
      extra: {
        grain: 'artifact', check, mode: 'aggregate', stat: 'count',
        ...(resolved.scorer ? { scorer: resolved.scorer } : {}),
        dim: [`band:${check}`, 'kind'],
        ...(pageMax ? { limit: String(pageMax) } : {})
      }
    });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'band-mix' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    const model = bandMixRows(body);
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${check} band counts in window ${scope.win || 'all'}`, clear: null }]);
    }
    const provenance = band
      ? `${BASELINE_LABEL}: p25 ${band.from}, median ${band.median}, p75 ${band.to} (n ${band.n}).`
      : 'baseline_unavailable: no content baseline is retained, so every file is counted under baseline_unavailable rather than unscored.';
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: file-weighted artifact observations, band:<check> lens for ${check}, scorer ${resolved.scorer || 'none'}. ${stripPopulationText(body)}. ${provenance}`;
      const node = doc.createElement('yk-bars');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'bars', type: 'stacked',
        title: `${check} band composition by kind (files)`,
        units: 'files',
        timeBasis: 'the selected artifact version; files, not content hashes',
        series: model.series,
        x: { label: 'Kind', kind: 'text' }
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        'Bands are strict below p25, inclusive mid p25–p75 and strict above p75; unscored and baseline_unavailable are separate groups.',
        model.omittedGroups ? `${model.omittedGroups} groups omitted (${model.omittedN} files).` : '',
        'Files are never pooled with content hashes.'
      ].filter(Boolean).join(' ');
      const columns = [{ label: 'Kind' }, ...model.series.map(series => ({ label: series.label, numeric: true }))];
      wrapper.append(basis, node, note, table(doc, { caption: `${check} band composition by kind`, columns, rows: bandMixTableRows(model) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderQualityChooser({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), lens: null, lenses: [], chart: 'stacked'
      });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split: 'kind',
      baseline: band || 'baseline_unavailable',
      population: model.population,
      omittedGroups: model.omittedGroups, omittedN: model.omittedN,
      basis: `${check} file-weighted band counts by kind; ${provenance}`,
      tableRows: bandMixTableRows(model)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The band composition query failed.' });
  }
}

export const BAND_MIX_PANEL = {
  id: 'band-mix',
  title: 'Band mix',
  grain: 'artifact',
  measures: ['score'],
  lenses: ['kind', 'band'],
  charts: ['stacked'],
  requires: ['entities_artifact', 'scores_by_lens'],
  caveats: 'File-weighted band counts from the structured band:<check> lens. Unscored and baseline_unavailable stay distinct; files are never content hashes.',
  measureBasis: 'the selected artifact version’s band against its scorer’s all-time content baseline',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'artifact', check: 'clarity', mode: 'aggregate', stat: 'count', dim: ['band:clarity', 'kind'] } }],
  load
};

export default BAND_MIX_PANEL;
