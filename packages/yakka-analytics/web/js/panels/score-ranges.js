// `score-ranges`: per-harness (or another published content lens) score ranges
// with the selected scorer's all-history baseline band. The score population is
// one observation per content version (content hash), never an artifact file.
// Check and scorer are the only quality controls beyond the panel's Group by.

import '../charts/yk-ranges.js';
import { cancelledState, emptyState, errorState, unsupportedState } from '../core/panel-state.js';
import { canonicalPanelSpec } from '../core/view-spec.js';
import { filterRefusal, table } from './pulse-strips.js';
import { registerCaption } from './captions.js';
import {
  ensureP10Styles, mountPanelViews, requestParams, schemaGrain, whenPanelBody, whenPanelSlot
} from './p10-shared.js';

export const QUALITY_KINDS = ['design', 'brief', 'report'];
export const QUALITY_LENSES = ['harness', 'session_model', 'repo_id', 'plan', 'screen_verdict'];
export const SCORE_UNIT = 'normalized score (0–1)';
export const BASELINE_LABEL = 'All-history baseline for this scorer in this tenant';
export const MULTI_KIND_REFUSAL = 'Choose one document kind for this chart.';

export const SCORE_CAPTIONS = {
  'G-scores': 'Each row shows design clarity scores for a harness, counting each content version once; the box covers the middle half and the line marks the median.',
  'G-scoretrend': 'Each line shows design clarity scores over time for one session model; the middle line is the median and the outer lines bound the middle half.',
  'G-strips': 'Each dot is a file’s latest clarity score, grouped by document kind; dots farther right have higher scores.',
  'G-bands': 'Each bar counts files of one document kind by clarity band; unscored files are shown separately from scored files.'
};

const CONTENT_FALLBACK_FILTERS = ['kind', 'harness', 'session_model', 'repo_id', 'plan'];
const ARTIFACT_FALLBACK_FILTERS = ['kind', 'plan', 'repo_id', 'harness', 'session_model'];

export function humanCheck(check = '') {
  if (!check) return 'clarity';
  return String(check).replace(/_/g, ' ');
}

// The literal caption is authoritative. P10 allows only the selected kind and
// check to replace "design" and "clarity"; the rest of the sentence is fixed.
export function scoreCaption(key, { kind = 'design', check = 'clarity' } = {}) {
  const literal = SCORE_CAPTIONS[key];
  if (!literal) return '';
  if (key === 'G-scores' || key === 'G-scoretrend') {
    return literal.replace('design', String(kind || 'design')).replace('clarity', humanCheck(check));
  }
  return literal.replace('clarity', humanCheck(check));
}

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

// The active global kind(s). A repeated multi-kind scope is refused by the
// single-kind score endpoints; an empty kind falls back to the panel default.
export function activeKindValues(scope = {}) {
  const values = [];
  for (const raw of [scope?.kind, scope?.filters?.kind]) {
    for (const value of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      if (typeof value === 'string' && value && !values.includes(value)) values.push(value);
    }
  }
  return values;
}

export function scoreKind(scope = {}, spec = {}) {
  const active = activeKindValues(scope);
  if (active.length > 1) return { multi: true, kind: '', values: active };
  if (active.length === 1) return { multi: false, kind: active[0], values: active };
  const requested = activeKindValues({ kind: spec?.scope?.kind });
  if (requested.length > 1) return { multi: true, kind: '', values: requested };
  if (requested.length === 1) return { multi: false, kind: requested[0], values: requested };
  return { multi: false, kind: 'design', values: [] };
}

export function requestedScore(spec = {}, scope = {}) {
  return {
    check: typeof spec?.scope?.check === 'string' ? spec.scope.check : (typeof scope?.check === 'string' ? scope.check : ''),
    scorer: typeof spec?.scope?.scorer === 'string' ? spec.scope.scorer : (typeof scope?.scorer === 'string' ? scope.scorer : '')
  };
}

// Panel-local keys live in the effective scope after assembly but are not
// shared filters; strip them before the F check. `kind` stays: it is the
// selected score kind and is supported by these endpoints.
export function scoreFilterScope(scope = {}) {
  const out = { ...scope };
  for (const key of ['check', 'scorer', 'captionKey', 'grain', 'dim', 'band']) delete out[key];
  return out;
}

export function scoreSupportedFilters(schema, grain = 'content', fallback = CONTENT_FALLBACK_FILTERS) {
  const published = schemaGrain(schema, grain);
  const listed = Array.isArray(published?.filters)
    ? published.filters
    : Array.isArray(published?.lenses) ? published.lenses : [];
  return [...new Set(['kind', ...(listed.length ? listed : fallback)])].sort();
}

// The F refusal for these single-kind score sources. Runs before any score,
// series, entity or baseline read; the caption is untouched by the frame.
export function scoreApplicabilityRefusal({ panel, spec = {}, scope = {}, schema = null, grain = 'content', ignoredFilters = [] } = {}) {
  const fallback = grain === 'artifact' ? ARTIFACT_FALLBACK_FILTERS : CONTENT_FALLBACK_FILTERS;
  const applies = scoreSupportedFilters(schema, grain, fallback);
  return filterRefusal({
    panel: { ...panel, applies },
    spec: { ...spec, measures: ['score'] },
    scope: scoreFilterScope(scope),
    schema,
    ignoredFilters
  });
}

// The exact multi-kind refusal, rendered verbatim by the shared frame.
export function multiKindRefusal() {
  return {
    state: 'unsupported',
    missing: MULTI_KIND_REFUSAL,
    reason: '',
    source: '',
    nearest: null,
    applicability: true,
    labels: ['document kind'],
    unsupportedFilters: ['kind'],
    message: MULTI_KIND_REFUSAL
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
  return scorers && typeof scorers === 'object' ? Object.keys(scorers).sort() : [];
}

export function defaultCheck(checks = []) {
  if (checks.includes('clarity')) return 'clarity';
  return checks[0] || '';
}

// P5: the first lexical scorer with a positive baseline for the check, else the
// first lexical published scorer, else no scorer (the panel says unsupported).
export function resolveScorer(body = {}, check = '', requested = '') {
  const scorers = body?.scorers && typeof body.scorers === 'object' ? body.scorers : {};
  const names = Object.keys(scorers).sort();
  const entryFor = name => scorers[name]?.[check] || null;
  if (requested) {
    if (!Object.hasOwn(scorers, requested)) return { scorer: requested, entry: null, unknown: true };
    return { scorer: requested, entry: entryFor(requested), unknown: false };
  }
  const positive = names.find(name => Number(entryFor(name)?.n) > 0);
  if (positive) return { scorer: positive, entry: entryFor(positive), unknown: false };
  const named = names.find(name => entryFor(name));
  return { scorer: named || '', entry: named ? entryFor(named) : null, unknown: false, empty: !named };
}

// The baseline band is the scorer's p25–p75 over content versions. A missing or
// empty baseline is baseline unavailable, never unscored.
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
  rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return {
    rows,
    omittedGroups: entry?.omitted_groups ?? body?.omitted_groups ?? 0,
    omittedN: entry?.omitted_n ?? body?.omitted_n ?? 0,
    population: body?.population || entry?.population || null
  };
}

export function scoreRangeTableColumns() {
  return [
    'Group', 'Count (content versions)', 'Minimum', 'Lower quarter', 'Median', 'Upper quarter',
    '95th percentile', 'Maximum', 'Baseline lower quarter', 'Baseline median', 'Baseline upper quarter'
  ];
}

function cell(value) {
  return value === null || value === undefined ? '—' : String(value);
}

export function scoreRangeTableRows(rows = [], baseline = null) {
  return rows.map(row => [
    row.label,
    cell(row.n),
    ...['min', 'q1', 'median', 'q3', 'p95', 'max'].map(key => cell(row.values[key])),
    cell(baseline?.from),
    cell(baseline?.median),
    cell(baseline?.to)
  ]);
}

export async function fetchScoreCatalogue(transport, kind, options) {
  const { response, body } = await transport.get('scores', new URLSearchParams({ kind }), options);
  return { response, body, checks: catalogueChecks(body) };
}

export async function fetchContentBaselines(transport, { kind, check, scorer = '', tenant, signal, stateKey }) {
  const params = new URLSearchParams({ population: 'content', kind, check });
  if (scorer) params.set('scorer', scorer);
  if (tenant) params.set('tenant', tenant);
  return transport.request('baselines', { params, signal, stateKey });
}

function checkOptionLabel(value) {
  const text = humanCheck(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function checkOptions(checks = []) {
  return checks.map(value => ({ value, label: checkOptionLabel(value) }));
}

const SPLIT_LABELS = {
  harness: 'Harness',
  session_model: 'Session model',
  repo_id: 'Repository',
  plan: 'Plan',
  screen_verdict: 'Screen verdict'
};

export function splitOptions(splits = []) {
  return splits.map(value => ({
    value,
    label: SPLIT_LABELS[value] || value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())
  }));
}

function addField(doc, wrapper, labelText, options, value, onChange) {
  const label = doc.createElement('label');
  label.className = 'p10-chooser-field';
  label.append(doc.createTextNode(labelText));
  const control = doc.createElement('select');
  control.setAttribute('aria-label', labelText);
  const choices = options.length ? options : [{ value: '', label: labelText === 'Check' ? 'No checks published' : 'No scorers published', disabled: true }];
  for (const option of choices) {
    const node = doc.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    node.selected = option.value === value;
    node.disabled = Boolean(option.disabled);
    control.append(node);
  }
  if (!options.length) control.disabled = true;
  control.addEventListener('change', () => onChange(control.value));
  label.append(control);
  wrapper.append(label);
}

// P5 plus the panel's P2 Group by. A change writes `scope.check`, `scope.scorer`
// or `split` and dispatches one composed `spec` event; the app owns the router
// and reloads only this panel.
export function renderScoreControls({
  panelId, panel = null, spec = {}, doc = globalThis.document,
  check = '', checks = [], scorer = '', scorers = [], split = '', splits = [], includeSplit = false
} = {}) {
  const wrapper = doc.createElement('div');
  wrapper.className = 'p10-chooser';
  const dispatch = patch => {
    const scope = { ...(spec.scope || {}) };
    if (patch.check !== undefined) scope.check = patch.check;
    if (patch.scorer !== undefined) scope.scorer = patch.scorer;
    const next = canonicalPanelSpec({
      grain: spec.grain || panel?.grain || '',
      measures: (spec.measures && spec.measures.length) ? spec.measures : (panel?.measures?.slice(0, 1) || ['score']),
      split: patch.split !== undefined ? patch.split : spec.split,
      chart: spec.chart || panel?.charts?.[0] || '',
      scope
    });
    const host = doc.querySelector(`[data-panel="${panelId}"]`) || doc;
    host.dispatchEvent(new CustomEvent('spec', { bubbles: true, composed: true, detail: { spec: next } }));
  };

  const checkList = check && !checks.includes(check) ? [check, ...checks] : checks;
  addField(doc, wrapper, 'Check', checkOptions(checkList), check, value => dispatch({ check: value }));
  const scorerList = scorer && !scorers.includes(scorer) ? [scorer, ...scorers] : scorers;
  addField(doc, wrapper, 'Scorer', scorerList.map(value => ({ value, label: value })), scorer, value => dispatch({ scorer: value }));
  if (includeSplit) {
    const splitList = split && !splits.includes(split) ? [split, ...splits] : splits;
    addField(doc, wrapper, 'Group by', splitOptions(splitList), split, value => dispatch({ split: value }));
  }
  return wrapper;
}

export function installScoreControls(options = {}) {
  const { panelId, panel, spec, doc = globalThis.document } = options;
  whenPanelSlot(panelId, 'chooser', doc, slot => {
    slot.replaceChildren(renderScoreControls({ ...options, panelId, panel, spec, doc }));
  });
}

registerCaption('score-ranges', ({ spec = {}, scope = {} } = {}) => {
  const key = spec?.scope?.captionKey || 'G-scores';
  const resolved = scoreKind(scope, spec);
  const { check } = requestedScore(spec, scope);
  return scoreCaption(key, { kind: resolved.kind || 'design', check: check || 'clarity' });
});

export function contentPopulationText(population) {
  if (!population) return 'the server did not report a population';
  const returned = population.returned_n ?? 0;
  const eligible = population.eligible_n ?? population.scope_n ?? 0;
  return `${returned} of ${eligible} content versions`;
}

export async function load(context = {}) {
  const { scope = {}, spec = {}, transport, tenant = '', signal } = context;
  const doc = context.doc || globalThis.document;
  qualityStyles(doc);
  const resolvedKind = scoreKind(scope, spec);
  if (resolvedKind.multi) return multiKindRefusal();
  try {
    const schema = context.schema || (await transport.schema(tenant)).body;
    const panel = context.panel || SCORE_RANGES_PANEL;
    const refusal = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'content' });
    if (refusal) return refusal;
    const requested = requestedScore(spec, scope);
    const kind = resolvedKind.kind;
    const catalogue = await fetchScoreCatalogue(transport, kind, { tenant, signal, stateKey: 'score-ranges-catalogue' });
    if (!catalogue.response.ok) return errorState({ message: catalogue.body?.error || `The server returned ${catalogue.response.status}.`, code: catalogue.body?.code || String(catalogue.response.status || '') });
    if (!catalogue.checks.length) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, check: '', scorer: '', includeSplit: true, splits: contentSplits(schema) });
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no checks are catalogued for ${kind}`, clear: null }]);
    }
    if (requested.check && !catalogue.checks.includes(requested.check)) {
      return unsupportedState({
        measure: `check ${requested.check}`, reason: 'not in the score catalogue for this kind',
        source: 'server /scores', nearest: catalogue.checks[0]
      });
    }
    const check = requested.check || defaultCheck(catalogue.checks);
    const baselines = await fetchContentBaselines(transport, { kind, check, scorer: requested.scorer, tenant, signal, stateKey: 'score-ranges-baseline' });
    if (!baselines.response.ok) return errorState({ message: baselines.body?.error || `The server returned ${baselines.response.status}.`, code: baselines.body?.code || String(baselines.response.status || '') });
    const resolved = resolveScorer(baselines.body, check, requested.scorer);
    if (resolved.unknown) {
      return unsupportedState({
        measure: `scorer ${requested.scorer}`, reason: 'not in the content baseline for this check',
        source: 'server /baselines', nearest: scorerNames(baselines.body)[0] || null
      });
    }
    if (!resolved.scorer) {
      installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks: catalogue.checks, scorer: '', scorers: scorerNames(baselines.body), includeSplit: true, splits: contentSplits(schema) });
      return unsupportedState({
        measure: `a scorer for ${check}`, reason: 'no scorer is published for this check',
        source: 'server /baselines', nearest: null
      });
    }
    installScoreControls({ panelId: panel.id, panel, spec, doc, kind, check, checks: catalogue.checks, scorer: resolved.scorer, scorers: scorerNames(baselines.body), includeSplit: true, splits: contentSplits(schema) });
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
    const post = scoreApplicabilityRefusal({ panel, spec, scope, schema, grain: 'content', ignoredFilters: Array.isArray(body?.ignored_filters) ? body.ignored_filters.map(String) : [] });
    if (post) return post;
    const model = scoreRangeRows(body, check);
    if (!model.rows.length) {
      whenPanelBody(panel.id, doc, host => host.replaceChildren());
      return emptyState([{ kind: 'scope', label: `no ${check} content versions in window ${scope.win || 'all'}`, clear: null }]);
    }
    const band = baselineBand(resolved.entry);
    whenPanelBody(panel.id, doc, host => {
      const wrapper = doc.createElement('div');
      wrapper.className = 'p10-quality';
      const node = doc.createElement('yk-ranges');
      node.className = 'p10-quality-chart';
      node.spec = {
        chart: 'ranges', type: 'box', legend: 'entities',
        title: `${check} by ${split} (content versions)`,
        units: SCORE_UNIT,
        timeBasis: 'latest known score per content version; the window selects the artifact facts',
        series: [{ key: 'score', label: check, unit: SCORE_UNIT, kind: 'number' }],
        ...(band ? { baseline: band } : {})
      };
      node.data = model.rows;
      const tableNode = table(doc, {
        caption: `${check} ranges by ${split} (${SCORE_UNIT})`,
        columns: scoreRangeTableColumns().map((label, index) => ({ label, numeric: index >= 1 })),
        rows: scoreRangeTableRows(model.rows, band)
      });
      const views = mountPanelViews({
        panelId: panel.id, chart: node, table: tableNode, doc,
        defaultView: 'chart', label: 'Score ranges view'
      });
      views.element.removeAttribute('data-panel');
      const basis = doc.createElement('p');
      basis.className = 'p10-basis';
      basis.textContent = `Basis: ${check} over content versions by ${split}; scorer ${resolved.scorer}. ${BASELINE_LABEL}: ${band ? `p25 ${band.from} – p75 ${band.to} (n ${band.n}).` : 'baseline unavailable for this scorer and check.'} ${contentPopulationText(model.population)}.`;
      const note = doc.createElement('p');
      note.className = 'p10-note';
      note.textContent = [
        'Each content version counts once, however many files share its bytes.',
        model.omittedGroups ? `${model.omittedGroups} groups omitted (${model.omittedN} content versions).` : '',
        `Scores are a ${SCORE_UNIT}, never a percentage.`
      ].filter(Boolean).join(' ');
      wrapper.append(views.element, basis, note);
      host.replaceChildren(wrapper);
    });
    whenPanelSlot(panel.id, 'chooser', doc, slot => {
      slot.replaceChildren(renderScoreControls({
        panelId: panel.id, panel, spec, doc, kind, check, scorer: resolved.scorer,
        checks: catalogue.checks, scorers: scorerNames(baselines.body), split,
        splits: contentSplits(schema), includeSplit: true
      }));
    });
    return {
      state: 'ready', kind, check, scorer: resolved.scorer, split,
      baseline: band || 'baseline_unavailable',
      population: model.population,
      omittedGroups: model.omittedGroups, omittedN: model.omittedN,
      basis: `${check} content versions by ${split}; scorer ${resolved.scorer || 'none'}; ${band ? BASELINE_LABEL : 'baseline unavailable'}`,
      tableRows: scoreRangeTableRows(model.rows, band)
    };
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The score range query failed.' });
  }
}

export const SCORE_RANGES_PANEL = {
  id: 'score-ranges',
  title: 'Design scores by harness',
  grain: 'content',
  measures: ['score'],
  lenses: QUALITY_LENSES,
  charts: ['ranges'],
  requires: ['scores_by_lens'],
  caveats: 'Content-version weighted; the baseline is the selected scorer’s all-history p25–p75. A missing baseline is labelled, never unscored.',
  measureBasis: 'latest known score per content version, canonical representative',
  requests: () => [{ route: '/v1/analytics/scores', method: 'GET', params: { kind: 'design', check: 'clarity', dim: 'harness' } }],
  load
};

export default SCORE_RANGES_PANEL;
