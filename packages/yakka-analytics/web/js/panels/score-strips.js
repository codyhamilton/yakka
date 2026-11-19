// `score-strips`: file-weighted artifact observations. One mark per returned
// artifact file, keyed by its canonical (repo_id, path) identity so the shared
// inspector opens the artifact reader.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { table } from './pulse-strips.js';
import {
  ensureP10Styles, requestParams, schemaGrain, whenPanelBody, whenPanelSlot
} from './p10-shared.js';
import { QUALITY_KINDS, catalogueChecks, qualityScope, renderQualityChooser } from './score-ranges.js';

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

export function stripRows(body = {}, check = '', lens = 'kind') {
  const measure = `score:${check}`;
  const entities = {};
  const rows = (Array.isArray(body?.rows) ? body.rows : []).map(row => {
    const identity = scoreIdentity(row);
    const key = JSON.stringify({ path: identity.path, repo_id: identity.repo_id });
    const measureMap = row.m || {};
    const value = measureMap[measure] ?? measureMap.score ?? null;
    const group = String(row.l?.[lens] ?? row.l?.kind ?? '(none)');
    entities[key] = {
      destination: artifactDestination(identity),
      entity: { grain: 'artifact', path: identity.path, repo_id: identity.repo_id, content_hash: identity.hash, kind: row.l?.kind ?? '' }
    };
    return {
      key,
      group,
      label: identity.path || key,
      values: { [measure]: value === null || value === undefined ? null : Number(value) },
      sampled: row.flags?.sampled === true,
      n: 1,
      identity
    };
  });
  return { rows, entities, measure, population: body?.population || null };
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

async function fetchCatalogue(transport, kind, options) {
  const { response, body } = await transport.get('scores', new URLSearchParams({ kind }), options);
  return { response, body, checks: catalogueChecks(body) };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCORE_STRIPS_PANEL;
    const requested = qualityScope(spec);
    const kind = QUALITY_KINDS.includes(requested.kind) ? requested.kind : 'design';
    const catalogue = await fetchCatalogue(transport, kind, { tenant, signal, stateKey: 'score-strips-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({ measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind', source: 'server /scores', nearest: catalogue.checks[0] });
    }
    const check = requested.check || catalogue.checks[0];
    const splits = artifactSplits(schema);
    const lens = defaultArtifactSplit(splits, spec.split || '');
    if (spec.split && !splits.includes(spec.split)) {
      return unsupportedState({ lens: `lens ${spec.split}`, reason: 'not published for the artifact grain', source: 'server /schema', nearest: lens || null });
    }
    const pageMax = Number(schema?.budgets?.page_max) || 0;
    const params = requestParams({
      scope, spec: { ...spec, split: '' }, measure: '',
      extra: {
        grain: 'artifact', check,
        fields: [`score:${check}`, ...(lens ? [lens] : [])],
        sort: `score:${check}:asc`,
        ...(pageMax ? { limit: String(pageMax) } : {})
      }
    });
    const { response, body } = await transport.get('entities', params, { tenant, signal, stateKey: 'score-strips' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    const model = stripRows(body, check, lens);
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no scored artifact files in window ${scope.win || 'all'}`, clear: null }]);
    }
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: file-weighted artifact observations (one mark per returned file), scored ${check}. ${stripPopulationText(body)}. Files are a different population from content hashes.`;
      const node = doc.createElement('yk-ranges');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'ranges', type: 'strip',
        title: `${check} per artifact file by ${lens}`,
        units: 'score',
        timeBasis: 'the selected artifact version; files, not content hashes',
        series: [{ key: model.measure, label: check, unit: 'score', kind: 'number' }],
        entities: model.entities
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = `${READER_NOTICE} Population: ${stripPopulationText(body)}.`;
      const columns = [{ label: 'File' }, { label: 'Repo' }, { label: 'Score', numeric: true }, { label: 'Group' }];
      const rows = model.rows.map(row => [
        row.identity.path || '—',
        row.identity.repo_id || '—',
        row.values[model.measure] === null || row.values[model.measure] === undefined ? '—' : String(row.values[model.measure]),
        row.group
      ]);
      wrapper.append(basis, node, note, table(doc, { caption: `${check} scored artifact files`, columns, rows }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderQualityChooser({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: requested.scorer,
        checks: catalogue.checks, scorers: [], includeScorer: false,
        lens, lenses: splits, chart: 'strip'
      });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', kind, check, split: lens,
      population: body.population || null,
      stripPopulation: stripPopulationText(body),
      basis: `${check} file-weighted artifacts by ${lens}; ${stripPopulationText(body)}`,
      tableRows: model.rows.map(row => [row.identity.path, row.identity.repo_id, row.values[model.measure], row.group]),
      entities: model.entities
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score strip query failed.' });
  }
}

export const SCORE_STRIPS_PANEL = {
  id: 'score-strips',
  title: 'Score strips',
  grain: 'artifact',
  measures: ['score'],
  lenses: ARTIFACT_LENSES,
  charts: ['strip'],
  requires: ['entities_artifact', 'scores_by_lens'],
  caveats: 'File-weighted; one mark per returned artifact file. The identity (repo_id, path) opens the artifact reader. Files are never counted as content hashes.',
  measureBasis: 'the selected artifact version’s latest score',
  requests: () => [{ route: '/v1/analytics/entities', method: 'GET', params: { grain: 'artifact', check: 'clarity', fields: ['score:clarity', 'kind'] } }],
  load
};

export default SCORE_STRIPS_PANEL;
