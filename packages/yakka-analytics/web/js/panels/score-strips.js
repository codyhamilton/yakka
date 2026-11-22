// `score-strips`: file-weighted artifact observations. One mark per latest
// artifact file, keyed by its canonical (repo_id, path) identity so the shared
// inspector opens the artifact reader. A file is never counted as a content
// version, and the strip is always grouped by document kind.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import {
  ensureP10Styles, mountPanelViews, requestParams, schemaGrain, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import {
  SCORE_UNIT, defaultCheck, fetchContentBaselines, fetchScoreCatalogue, installScoreControls, multiKindRefusal,
  renderScoreControls, requestedScore, resolveScorer, scoreApplicabilityRefusal, scoreCaption,
  scoreKind, scorerNames
} from './score-ranges.js';

export const ARTIFACT_LENSES = ['kind', 'plan', 'repo_id', 'harness', 'session_model', 'source', 'screen_verdict'];
export const READER_NOTICE = 'Open this identity in the artifact reader.';

export function artifactSplits(schema) {
  const grain = schemaGrain(schema, 'artifact');
  const published = new Set(grain?.lenses || []);
  return ARTIFACT_LENSES.filter(lens => !published.size || published.has(lens));
}

export function defaultArtifactSplit(splits, requested = '') {
  if (requested && splits.includes(requested)) return requested;
  for (const name of ['kind', 'plan', 'repo_id']) if (splits.includes(name)) return name;
  return splits[0] || 'kind';
}

// The canonical compact JSON identity is `{"path","repo_id"}` in that order.
export function scoreIdentity(row = {}) {
  const lens = row.l || {};
  const path = lens.path ?? row.path ?? '';
  const repoId = lens.repo_id ?? row.repo_id ?? '';
  const hash = lens.content_hash ?? lens.hash ?? row.content_hash ?? row.hash ?? row.id ?? '';
  return { path, repo_id: repoId, hash };
}

export function artifactDestination(identity = {}) {
  const params = new URLSearchParams();
  params.set('repo_id', String(identity.repo_id ?? ''));
  params.set('path', String(identity.path ?? ''));
  params.set('hash', String(identity.hash ?? ''));
  return `/artifact?${params.toString()}`;
}

function observedOf(row = {}) {
  const lens = row.l || {};
  const value = lens.observed ?? lens.observed_at ?? lens.ts ?? row.observed ?? row.observed_at ?? row.ts ?? null;
  return value === null || value === undefined ? '—' : String(value);
}

export function stripRows(body = {}, check = '', lens = 'kind') {
  const measure = `score:${check}`;
  const entities = {};
  const byIdentity = new Map();
  for (const row of Array.isArray(body?.rows) ? body.rows : []) {
    const identity = scoreIdentity(row);
    const key = JSON.stringify({ path: identity.path, repo_id: identity.repo_id });
    const measureMap = row.m || {};
    const value = measureMap[measure] ?? measureMap.score ?? null;
    const group = String(row.l?.[lens] ?? row.l?.kind ?? '(none)');
    const observed = observedOf(row);
    // One dot per latest file: a repeated identity is the same file, so keep a
    // single mark (the last row when the server did not order observed times).
    if (byIdentity.has(key)) continue;
    byIdentity.set(key, {
      key,
      group,
      label: identity.path || key,
      values: { [measure]: value === null || value === undefined ? null : Number(value) },
      sampled: row.flags?.sampled === true,
      n: 1,
      identity,
      score: value === null || value === undefined ? null : Number(value),
      scorer: row.l?.scorer ?? row.scorer ?? '',
      observed,
      kind: row.l?.kind ?? ''
    });
    entities[key] = {
      destination: artifactDestination(identity),
      entity: { grain: 'artifact', path: identity.path, repo_id: identity.repo_id, content_hash: identity.hash, kind: row.l?.kind ?? '' }
    };
  }
  const rows = [...byIdentity.values()].sort((a, b) => {
    return String(a.identity.repo_id).localeCompare(String(b.identity.repo_id))
      || String(a.identity.path).localeCompare(String(b.identity.path))
      || String(a.identity.hash).localeCompare(String(b.identity.hash));
  });
  return { rows, entities, measure, population: body?.population || null };
}

export function stripTableColumns() {
  return ['Repository', 'Path', 'Kind', `Score (${SCORE_UNIT})`, 'Scorer', 'Observed'];
}

export function stripTableRows(rows = []) {
  const value = item => item === null || item === undefined ? '—' : String(item);
  return rows.map(row => [
    row.identity.repo_id || '—',
    row.identity.path || '—',
    row.kind || '—',
    value(row.score),
    row.scorer || '—',
    row.observed || '—'
  ]);
}

export function stripPopulationText(body = {}) {
  const population = body?.population || {};
  const returned = population.returned_n ?? 0;
  const eligible = population.eligible_n ?? population.scope_n ?? 0;
  const missing = population.missing_by_reason || {};
  const parts = [`${returned} of ${eligible} files`];
  for (const [reason, count] of Object.entries(missing)) if (count !== null && count !== undefined) parts.push(`${count} missing: ${reason}`);
  return parts.join('; ');
}

// The same-kind check catalogue the artifact grain advertises. Older schemas
// without it fall back to the `/scores?kind=` read, never to another kind.
export function kindChecks(schema, kind = '') {
  const byKind = schemaGrain(schema, 'artifact')?.checks_by_kind;
  const list = byKind && Array.isArray(byKind[kind]) ? byKind[kind] : [];
  return list.filter(name => typeof name === 'string' && name);
}

registerCaption('score-strips', ({ spec = {} } = {}) => {
  const key = spec?.scope?.captionKey || 'G-strips';
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
    const panel = context.panel || SCORE_STRIPS_PANEL;
    const refusal = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'artifact' });
    if (refusal) return refusal;
    const requested = requestedScore(spec, scope);
    const kind = resolvedKind.kind;
    let checks = kindChecks(schema, kind);
    if (!checks.length) {
      const catalogue = await fetchScoreCatalogue(transport, kind, { tenant, signal, stateKey: 'score-strips-catalogue' });
      if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
      checks = catalogue.checks;
    }
    if (!checks.length) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, check: '', scorer: '' });
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    }
    if (requested.check && !checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /schema', nearest: checks[0] });
    }
    const check = requested.check || defaultCheck(checks);
    const baselines = await fetchContentBaselines(transport, { kind, check, scorer: requested.scorer, tenant, signal, stateKey: 'score-strips-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({ measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check', source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null });
    }
    if (!resolved.scorer) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks, scorer: '', scorers: scorerNames(baselines.body) });
      return unsupportedState({ measure: `a scorer for ${check}`, reason: 'no scorer is published for this check', source: 'server /baselines', nearest: null });
    }
    installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks, scorer: resolved.scorer, scorers: scorerNames(baselines.body) });
    const pageMax = Number(schema?.budgets?.page_max) || 0;
    const params = requestParams({
      scope: { ...scope, kind }, spec: { ...spec, split: '' }, measure: '',
      extra: {
        grain: 'artifact', check, ...(resolved.scorer ? { scorer: resolved.scorer } : {}),
        fields: [`score:${check}`],
        sort: `score:${check}:asc`,
        ...(pageMax ? { limit: String(pageMax) } : {})
      }
    });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'score-strips' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    const post = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'artifact', ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [] });
    if (post) return post;
    const model = stripRows(body, check, 'kind');
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no scored artifact files in window ${scope.win || 'all'}`, clear: null }]);
    }
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const node = doc.createElement('yk-ranges');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'ranges', type: 'strip',
        title: `${check} per artifact file by kind`,
        units: SCORE_UNIT,
        timeBasis: 'the selected artifact version; files, not content versions',
        series: [{ key: model.measure, label: check, unit: SCORE_UNIT, kind: 'number' }],
        entities: model.entities
      };
      node.data = model.rows;
      const tableNode = table(doc, {
        caption: `${check} scored artifact files (${SCORE_UNIT})`,
        columns: stripTableColumns().map((label, index) => ({ label, numeric: index === 3 })),
        rows: stripTableRows(model.rows)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: node, table: tableNode, doc,
        defaultView: 'chart', label: 'Score strips view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: one dot per latest artifact file, scored ${check} by ${resolved.scorer}. ${stripPopulationText(body)}. Files are a different population from content versions.`;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = `${READER_NOTICE} Scores are a ${SCORE_UNIT}.`;
      wrapper.append(views.element, basis, note);
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderScoreControls({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks, scorers: scorerNames(baselines.body), split: 'kind', splits: ['kind'], includeSplit: false
      }));
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split: 'kind',
      population: body.population || null,
      stripPopulation: stripPopulationText(body),
      basis: `${check} file-weighted artifacts by kind; ${stripPopulationText(body)}`,
      tableRows: stripTableRows(model.rows),
      entities: model.entities
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score strip query failed.' });
  }
}

export const SCORE_STRIPS_PANEL = {
  id: 'score-strips',
  title: 'Artifact clarity by kind',
  grain: 'artifact',
  measures: ['score'],
  lenses: ARTIFACT_LENSES,
  charts: ['strip'],
  requires: ['entities_artifact', 'scores_by_lens'],
  caveats: 'File-weighted; one mark per latest artifact file. The identity (repo_id, path) opens the artifact reader. Files are never counted as content versions.',
  measureBasis: 'the selected artifact version’s latest score',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'artifact', check: 'clarity', fields: ['score:clarity'] } }],
  load
};

export default SCORE_STRIPS_PANEL;
