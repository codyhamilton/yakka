// `score-ranges`: per-kind/check distinct-hash ranges with a scorer-specific
// all-time baseline. The scorer is chosen from /baselines before the ranges are
// read, so the baseline band and the range groups are the same rubric run. The
// hash population is never pooled with artifact files.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { table } from './pulse-strips.js';
import {
  ensureP10Styles, populationLine, requestParams, schemaGrain, whenPanelBody, whenPanelSlot
} from './p10-shared.js';

export const QUALITY_KINDS = ['design', 'brief', 'report'];
export const QUALITY_LENSES = ['harness', 'session_model', 'repo_id', 'plan', 'screen_verdict'];
export const BASELINE_LABEL = 'all-time scorer baseline';

export function qualityStyles(doc = globalThis.document) {
  ensureP10Styles('/css/trends.css', doc);
  ensureP10Styles('/css/quality.css', doc);
}

export function qualityScope(spec = {}) {
  const scope = spec?.scope || {};
  return {
    kind: typeof scope.kind === 'string' ? scope.kind : '',
    check: typeof scope.check === 'string' ? scope.check : '',
    scorer: typeof scope.scorer === 'string' ? scope.scorer : ''
  };
}

export function groupName(group) {
  const value = group?.key ?? group?.group ?? (Array.isArray(group?.k) ? group.k[0] : group?.k) ?? 'all';
  return String(value);
}

export function catalogueChecks(body = {}) {
  return (Array.isArray(body?.checks) ? body.checks : [])
    .map(entry => entry?.name)
    .filter(name => typeof name === 'string' && name);
}

export function scorerNames(body = {}) {
  const scorers = body?.scorers;
  return scorers && typeof scorers === 'object' ? Object.keys(scorers) : [];
}

// A requested scorer must be named by the baseline response; otherwise the
// panel says it is unsupported rather than inventing a baseline.
export function resolveScorer(body = {}, check = '', requested = '') {
  const scorers = body?.scorers && typeof body.scorers === 'object' ? body.scorers : {};
  const names = Object.keys(scorers);
  const entryFor = name => scorers[name]?.[check] || null;
  if (requested) {
    if (!Object.hasOwn(scorers, requested)) return { scorer: requested, entry: null, unknown: true };
    return { scorer: requested, entry: entryFor(requested), unknown: false };
  }
  const positive = names.find(name => Number(entryFor(name)?.n) > 0);
  if (positive) return { scorer: positive, entry: entryFor(positive), unknown: false };
  const named = names.find(name => entryFor(name));
  return { scorer: named || '', entry: named ? entryFor(named) : null, unknown: false };
}

// The baseline band is the scorer's p25–p75 over distinct hashes. A missing or
// empty baseline is `baseline_unavailable`, never `unscored`.
export function baselineBand(entry) {
  if (!entry || !(Number(entry.n) > 0)) return null;
  const from = Number(entry.p25);
  const to = Number(entry.p75);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to, label: BASELINE_LABEL, n: entry.n, median: entry.median ?? null };
}

export function contentSplits(schema) {
  const grain = schemaGrain(schema, 'content');
  const published = new Set(grain?.lenses || []);
  return QUALITY_LENSES.filter(lens => !published.size || published.has(lens));
}

export function defaultSplit(splits, requested = '') {
  if (requested && splits.includes(requested)) return requested;
  for (const name of ['harness', 'session_model', 'repo_id']) if (splits.includes(name)) return name;
  return splits[0] || '';
}

function entryFor(body, check) {
  const checks = Array.isArray(body?.checks) ? body.checks : [];
  return checks.find(entry => entry?.name === check) || checks[0] || null;
}

export function scoreRangeRows(body = {}, check = '') {
  const entry = entryFor(body, check);
  const rows = (Array.isArray(entry?.groups) ? entry.groups : []).map(group => {
    const key = groupName(group);
    return {
      key,
      label: key,
      n: group.n,
      values: {
        min: group.min, q1: group.p25, median: group.median, q3: group.p75, max: group.max, p95: group.p95
      }
    };
  });
  return {
    rows,
    omittedGroups: entry?.omitted_groups ?? body?.omitted_groups ?? 0,
    omittedN: entry?.omitted_n ?? body?.omitted_n ?? 0,
    population: body?.population || entry?.population || null
  };
}

export function scoreRangeTableRows(rows = []) {
  return rows.map(row => [
    row.label,
    ...['min', 'q1', 'median', 'q3', 'max', 'p95'].map(key => row.values[key] === null || row.values[key] === undefined ? '—' : String(row.values[key])),
    row.n === null || row.n === undefined ? '—' : String(row.n)
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

function chooseOption(select, label, options, value, onChange) {
  const field = select.ownerDocument.createElement('label');
  field.className = 'p10-chooser-field';
  field.append(select.ownerDocument.createTextNode(label));
  const control = select.ownerDocument.createElement('select');
  control.setAttribute('aria-label', label);
  for (const option of options) {
    const node = select.ownerDocument.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    control.append(node);
  }
  control.addEventListener('change', () => onChange(control.value));
  field.append(control);
  select.append(field);
}

// The 10-01 renderChooser offers measure/split/chart; the quality panels choose
// kind/check/scorer and a lens. This follows its markup and event shape while
// keeping the extra choices in the panel's scope.
export function renderQualityChooser({
  panelId, panel = null, spec = {}, doc = globalThis.document,
  kind = '', kinds = QUALITY_KINDS, check = '', checks = [], scorer = '', scorers = [],
  lens = null, lenses = [], includeScorer = true, chart = '', onSpec = null
} = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  let next = { kind, check, scorer, lens };
  const dispatch = () => {
    const scope = { ...(spec.scope || {}) };
    if (next.kind) scope.kind = next.kind;
    if (next.check) scope.check = next.check;
    if (next.scorer) scope.scorer = next.scorer;
    const merged = canonicalPanelSpec({
      grain: spec.grain || panel?.grain || '',
      measures: (spec.measures && spec.measures.length) ? spec.measures : (panel?.measures?.slice(0, 1) || []),
      split: next.lens === null ? (spec.split || '') : next.lens,
      chart: spec.chart || chart || panel?.charts?.[0] || '',
      scope
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: merged } }));
    if (typeof onSpec === 'function') onSpec(merged);
  };

  chooseOption(wrapper, 'Kind', kinds.map(value => ({ value, label: value })), kind, value => { next = { ...next, kind: value }; dispatch(); });
  chooseOption(wrapper, 'Check', checks.length ? checks.map(value => ({ value, label: value })) : [{ value: '', label: 'no published check' }], check, value => { next = { ...next, check: value }; dispatch(); });
  if (includeScorer) {
    chooseOption(wrapper, 'Scorer', scorers.length ? scorers.map(value => ({ value, label: value })) : [{ value: '', label: 'baseline_unavailable' }], scorer, value => { next = { ...next, scorer: value }; dispatch(); });
  }
  if (lens !== null) {
    chooseOption(wrapper, 'Split', lenses.length ? lenses.map(value => ({ value, label: value })) : [{ value: '', label: '(none)' }], lens, value => { next = { ...next, lens: value }; dispatch(); });
  }
  return { element: wrapper, dispatch };
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  qualityStyles(doc);
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCORE_RANGES_PANEL;
    const requested = qualityScope(spec);
    const kind = QUALITY_KINDS.includes(requested.kind) ? requested.kind : 'design';
    const catalogue = await fetchCatalogue(transport, kind, { tenant, signal, stateKey: 'score-ranges-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({
        measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind',
        source: 'server /scores', nearest: catalogue.checks[0]
      });
    }
    const check = requested.check || catalogue.checks[0];
    const baselines = await fetchBaselines(transport, { kind, check, tenant, signal, stateKey: 'score-ranges-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({
        measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check',
        source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null
      });
    }
    const split = defaultSplit(contentSplits(schema), spec.split || '');
    if (spec.split && !contentSplits(schema).includes(spec.split) && spec.split !== split) {
      return unsupportedState({ lens: `split ${spec.split}`, reason: 'not published for the content grain', source: 'server /schema', nearest: split || null });
    }
    const topMax = Number(schema?.budgets?.top_max) || 0;
    const params = requestParams({
      scope: { ...scope, kind }, spec, check: '', measure: '', split,
      extra: { kind, check, ...(resolved.scorer ? { scorer: resolved.scorer } : {}), ...(topMax ? { limit: String(topMax) } : {}) }
    });
    const { response, body } = await transport.get('scores', params, { tenant, signal, stateKey: 'score-ranges' });
    if (!response.ok) return errorState({ message: body?.error || `The server returned ${response.status}.`, code: body?.code || String(response.status || '') });
    const model = scoreRangeRows(body, check);
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${check} hashes in window ${scope.win || 'all'}`, clear: null }]);
    }
    const band = baselineBand(resolved.entry);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: distinct content hashes, latest score per hash/check and canonical representative. Check ${check}, scorer ${resolved.scorer || 'none'}. ${band ? `${BASELINE_LABEL} p25 ${band.from} – p75 ${band.to} (n ${band.n}).` : 'baseline_unavailable: no content baseline is retained for this scorer and check.'} ${populationLine({ population: model.population })}.`;
      const node = doc.createElement('yk-ranges');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'ranges', type: 'box', legend: 'entities',
        title: `${check} by ${split} (content hashes)`,
        units: 'score',
        timeBasis: 'latest known score per distinct content hash; the window selects the artifact facts',
        series: [{ key: 'score', label: check, unit: 'score', kind: 'number' }],
        ...(band ? { baseline: band } : {})
      };
      node.data = model.rows;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        'Each box is one group of content hashes; n counts distinct content hashes, not files.',
        model.omittedGroups ? `${model.omittedGroups} groups omitted (${model.omittedN} hashes).` : '',
        'The baseline is the selected scorer’s all-time p25–p75 over distinct hashes.'
      ].filter(Boolean).join(' ');
      const columns = [{ label: 'Group' }, ...['Min', 'Q1', 'Median', 'Q3', 'Max', 'p95', 'n'].map(label => ({ label, numeric: true }))];
      wrapper.append(basis, node, note, table(doc, { caption: `${check} ranges by ${split}`, columns, rows: scoreRangeTableRows(model.rows) }));
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      const rendered = renderQualityChooser({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), lens: split,
        lenses: contentSplits(schema), chart: 'ranges'
      });
      slot.replaceChildren(rendered.element);
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split,
      baseline: band || 'baseline_unavailable',
      population: model.population,
      omittedGroups: model.omittedGroups, omittedN: model.omittedN,
      basis: `${check} distinct content hashes by ${split}; scorer ${resolved.scorer || 'none'}; ${band ? 'all-time scorer baseline' : 'baseline_unavailable'}`,
      tableRows: scoreRangeTableRows(model.rows)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score range query failed.' });
  }
}

export const SCORE_RANGES_PANEL = {
  id: 'score-ranges',
  title: 'Score ranges',
  grain: 'content',
  measures: ['score'],
  lenses: QUALITY_LENSES,
  charts: ['ranges'],
  requires: ['scores_by_lens'],
  caveats: 'Distinct content hashes only; the baseline is the selected scorer’s all-time p25–p75. A missing baseline is baseline_unavailable, never unscored.',
  measureBasis: 'latest known score per distinct content hash, canonical representative',
  requests: () => [{ route: '/v1/analytics/scores', method: 'GET', params: { kind: 'design', check: 'clarity', dim: 'harness' } }],
  load
};

export default SCORE_RANGES_PANEL;
