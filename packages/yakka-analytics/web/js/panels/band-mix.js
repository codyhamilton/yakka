// `band-mix`: file-weighted band composition per artifact kind. `band:<check>`
// is a structured lens; the panel reads it and never writes a legacy
// `exclude=band:<check>:<value>` string. The population is files, not content
// versions.

import '../charts/yk-bars.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import {
  ensureP10Styles, mountPanelViews, requestParams, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import {
  BASELINE_LABEL, baselineBand, defaultCheck, fetchContentBaselines, fetchScoreCatalogue, groupName, installScoreControls,
  multiKindRefusal, renderScoreControls, requestedScore, resolveScorer, scoreApplicabilityRefusal,
  scoreCaption, scoreKind, scorerNames
} from './score-ranges.js';
import { stripPopulationText } from './score-strips.js';

export const BAND_KEYS = ['low', 'mid', 'high', 'unscored', 'baseline_unavailable'];
export const BAND_LABELS = {
  low: 'below p25', mid: 'mid (p25–p75 inclusive)', high: 'above p75',
  unscored: 'unscored', baseline_unavailable: 'baseline unavailable'
};
export const BAND_TOKENS = {
  low: '--yk-status-bad',
  mid: '--yk-status-warn',
  high: '--yk-status-good',
  unscored: '--yk-neutral-unscored',
  baseline_unavailable: '--yk-neutral-unknown'
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
// A band the server did not report is absent, not an invented zero.
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
  const orderedKinds = [...kinds].sort((a, b) => String(a).localeCompare(String(b)));
  const rows = orderedKinds.map(kind => ({
    key: kind,
    label: kind,
    values: Object.fromEntries(
      BAND_KEYS.filter(band => counts.get(kind)?.has(band))
        .map(band => [band, counts.get(kind).get(band)])
    )
  }));
  return {
    rows,
    series: BAND_KEYS.map(band => ({
      key: band, label: BAND_LABELS[band], unit: 'files', kind: 'count',
      cssVar: BAND_TOKENS[band], token: BAND_TOKENS[band]
    })),
    omittedGroups: body?.omitted_groups ?? 0,
    omittedN: body?.omitted_n ?? 0,
    population: body?.population || null
  };
}

export function bandMixTableColumns() {
  return ['Kind', 'Band', 'Files'];
}

// Kind ascending, then the published band order, then unscored and baseline
// unavailable. Only bands the server reported become rows.
export function bandMixTableRows(model = {}) {
  const rows = [];
  const kinds = [...(model.rows || [])].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  for (const row of kinds) {
    for (const band of BAND_KEYS) {
      if (!Object.hasOwn(row.values || {}, band)) continue;
      rows.push([row.label, BAND_LABELS[band], String(row.values[band])]);
    }
  }
  return rows;
}

registerCaption('band-mix', ({ spec = {} } = {}) => {
  const key = spec?.scope?.captionKey || 'G-bands';
  const check = spec?.scope?.check || 'clarity';
  return scoreCaption(key, { check });
});

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
  const resolvedKind = scoreKind(scope, spec);
  if (resolvedKind.multi) return multiKindRefusal();
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || BAND_MIX_PANEL;
    const refusal = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'artifact' });
    if (refusal) return refusal;
    const requested = requestedScore(spec, scope);
    const kind = resolvedKind.kind;
    const catalogue = await fetchScoreCatalogue(transport, kind, { tenant, signal, stateKey: 'band-mix-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, check: '', scorer: '' });
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    }
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: catalogue.checks[0] });
    }
    const check = requested.check || defaultCheck(catalogue.checks);
    const baselines = await fetchContentBaselines(transport, { kind, check, scorer: requested.scorer, tenant, signal, stateKey: 'band-mix-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    if (!resolved.scorer) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks: catalogue.checks, scorer: '', scorers: scorerNames(baselines.body) });
      return unsupportedState({ measure: `a scorer for ${check}`, reason: 'no scorer is published for this check', source: 'server /baselines', nearest: null });
    }
    installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks: catalogue.checks, scorer: resolved.scorer, scorers: scorerNames(baselines.body) });
    const band = baselineBand(resolved.entry);
    const pageMax = Number(schema?.budgets?.page_max) || 0;
    const params = requestParams({
      scope: { ...scope, kind }, spec: { ...spec, split: '' }, measure: '',
      extra: {
        grain: 'artifact', check, mode: 'aggregate', stat: 'count',
        ...(resolved.scorer ? { scorer: resolved.scorer } : {}),
        dim: [`band:${check}`, 'kind'],
        ...(pageMax ? { limit: String(pageMax) } : {})
      }
    });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'band-mix' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    const post = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'artifact', ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [] });
    if (post) return post;
    const model = bandMixRows(body);
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${check} band counts in window ${scope.win || 'all'}`, clear: null }]);
    }
    const provenance = band
      ? `${BASELINE_LABEL}: p25 ${band.from}, median ${band.median}, p75 ${band.to} (n ${band.n}).`
      : 'Baseline unavailable: no content baseline is retained, so every file is counted under baseline unavailable rather than unscored.';
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const node = doc.createElement('yk-bars');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'bars', type: 'stacked', orientation: 'horizontal',
        title: `${check} band composition by kind (files)`,
        units: 'files',
        timeBasis: 'the selected artifact version; files, not content versions',
        series: model.series,
        x: { label: 'Kind', kind: 'text' }
      };
      node.data = model.rows;
      const tableNode = table(doc, {
        caption: `${check} band composition by kind (files)`,
        columns: bandMixTableColumns().map((label, index) => ({ label, numeric: index === 2 })),
        rows: bandMixTableRows(model)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: node, table: tableNode, doc,
        defaultView: 'chart', label: 'Band mix view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: file-weighted artifact observations, band:${check} lens, scorer ${resolved.scorer}. ${stripPopulationText(body)}. ${provenance}`;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        'Bands are strict below p25, inclusive mid p25–p75 and strict above p75; unscored and baseline unavailable are separate groups.',
        model.omittedGroups ? `${model.omittedGroups} groups omitted (${model.omittedN} files).` : '',
        'Files are never pooled with content versions.'
      ].filter(Boolean).join(' ');
      wrapper.append(views.element, basis, note);
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderScoreControls({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), split: 'kind', splits: ['kind'], includeSplit: false
      }));
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
  title: 'Artifact score bands',
  grain: 'artifact',
  measures: ['score'],
  lenses: ['kind', 'band'],
  charts: ['stacked'],
  requires: ['entities_artifact', 'scores_by_lens'],
  caveats: 'File-weighted band counts from the structured band:<check> lens. Unscored and baseline unavailable stay distinct; files are never content versions.',
  measureBasis: 'the selected artifact version’s band against its scorer’s all-history content baseline',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'artifact', check: 'clarity', mode: 'aggregate', stat: 'count', dim: ['band:clarity', 'kind'] } }],
  load
};

export default BAND_MIX_PANEL;
