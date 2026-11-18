// The pure narrowing and inspection model shared by the chips, the selection
// tray and the inspector. It owns the Boolean predicate grammar, canonical
// JSON, the cohort definition and its budget validation, and the selection
// object {grain, predicate, unit, counts, sampled}. No DOM and no fetch, so the
// tray's data model is unit-testable without a browser.

export const COHORT_SLOTS = ['A', 'B', 'C', 'D'];
export const COHORT_KEYS = ['ca', 'cb', 'cc', 'cd'];
export const PREDICATE_BUDGETS = {
  leaves: 64,
  values: 64,
  depth: 8,
  cohorts: 4,
  bytes: 8192,
  scope_elements: 64,
  scope_values: 64,
  value_bytes: 256,
  id_value_bytes: 1024
};

const NODE_KINDS = new Set(['and', 'or', 'not', 'range', 'in', 'is_null']);
const OPS = new Set(['include', 'exclude']);

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

function numberText(value) {
  const number = Number(value);
  return Object.is(number, -0) ? 0 : number;
}

function sortedUnique(values) {
  return [...new Set(values.map(value => String(value)))].sort();
}

// Canonical JSON: object keys sorted lexically at every depth, numbers
// normalised, array order preserved (commutative owners sort before this).
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const key of keys) {
      if (value[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  if (typeof value === 'number') return String(numberText(value));
  return JSON.stringify(value);
}

export function canonicalPredicate(node) {
  if (!isObject(node)) throw new Error('predicate node must be an object');
  const keys = Object.keys(node);
  if (keys.length !== 1 || !NODE_KINDS.has(keys[0])) {
    throw new Error('predicate node must be exactly one of and, or, not, range, in or is_null');
  }
  const kind = keys[0];
  const value = node[kind];
  if (kind === 'and' || kind === 'or') {
    if (!Array.isArray(value)) throw new Error(`${kind} children must be an array`);
    const children = value.map(canonicalPredicate).sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
    return { [kind]: children };
  }
  if (kind === 'not') return { not: canonicalPredicate(value) };
  if (kind === 'range') {
    if (!isObject(value) || typeof value.measure !== 'string' || !value.measure) throw new Error('range needs a measure');
    const lo = value.lo === null || value.lo === undefined ? null : numberText(value.lo);
    const hi = value.hi === null || value.hi === undefined ? null : numberText(value.hi);
    if (lo !== null && !Number.isFinite(lo)) throw new Error('range lo must be a number or null');
    if (hi !== null && !Number.isFinite(hi)) throw new Error('range hi must be a number or null');
    return { range: { hi, lo, measure: value.measure } };
  }
  if (kind === 'in') {
    if (!isObject(value) || typeof value.lens !== 'string' || !value.lens) throw new Error('in needs a lens');
    if (!Array.isArray(value.values) || value.values.length === 0) throw new Error('in needs at least one value');
    return { in: { lens: value.lens, values: sortedUnique(value.values) } };
  }
  if (!isObject(value) || typeof value.measure !== 'string' || !value.measure) throw new Error('is_null needs a measure');
  return { is_null: { measure: value.measure } };
}

export function normalisePredicate(node) {
  return canonicalPredicate(node);
}

export function predicateLeaves(node) {
  if (!isObject(node)) return 0;
  const kind = Object.keys(node)[0];
  if (kind === 'and' || kind === 'or') return (node[kind] || []).reduce((total, child) => total + predicateLeaves(child), 0);
  if (kind === 'not') return predicateLeaves(node.not);
  return 1;
}

export function predicateDepth(node) {
  if (!isObject(node)) return 0;
  const kind = Object.keys(node)[0];
  if (kind === 'and' || kind === 'or') return 1 + Math.max(0, ...(node[kind] || []).map(predicateDepth));
  if (kind === 'not') return 1 + predicateDepth(node.not);
  return 1;
}

export function predicateInValues(node) {
  if (!isObject(node)) return 0;
  const kind = Object.keys(node)[0];
  if (kind === 'and' || kind === 'or') return Math.max(0, ...(node[kind] || []).map(predicateInValues));
  if (kind === 'not') return predicateInValues(node.not);
  return kind === 'in' ? (node.in.values || []).length : 0;
}

// A selection predicate from explicit mark keys. Identities are never inferred
// from a sample; include is the positive set and exclude is the Alt-subtracted
// set, exactly as charts/selection.js keeps them.
export function selectionPredicate({ include = [], exclude = [] } = {}) {
  const positive = sortedUnique(include);
  const negative = sortedUnique(exclude).filter(key => !positive.includes(key));
  if (!positive.length && !negative.length) return null;
  const parts = [];
  if (positive.length) parts.push({ in: { lens: 'id', values: positive } });
  if (negative.length) parts.push({ not: { in: { lens: 'id', values: negative } } });
  return parts.length === 1 ? canonicalPredicate(parts[0]) : canonicalPredicate({ and: parts });
}

export function encodePick({ include = [], exclude = [] } = {}) {
  const positive = sortedUnique(include);
  const negative = sortedUnique(exclude).filter(key => !positive.includes(key));
  if (!positive.length && !negative.length) return '';
  return `${positive.join(',')}|${negative.join(',')}`;
}

export function decodePick(text = '') {
  const raw = String(text || '');
  if (!raw) return { include: [], exclude: [] };
  const [include, exclude] = raw.split('|');
  return {
    include: include ? sortedUnique(include.split(',').filter(Boolean)) : [],
    exclude: exclude ? sortedUnique(exclude.split(',').filter(Boolean)) : []
  };
}

export function pickIsEmpty(pick = {}) {
  return !(pick.include?.length) && !(pick.exclude?.length);
}

// The tray-facing selection object. `counts` and `sampled` are read from the
// panel's typed population; this module never invents a count.
export function selectionObject({ grain = '', predicate = null, unit = 'row', counts = {}, sampled = null } = {}) {
  return {
    grain,
    predicate: predicate ? canonicalPredicate(predicate) : null,
    unit,
    counts: { ...counts },
    sampled: sampled ?? null
  };
}

// A time cohort's frozen source: the two plotted measures (plus an optional
// size) and the response's effective bucket grid. The client never derives a
// different bucket or step, and never sends one the response did not report.
export function timeCohortSource(body = {}, fields = []) {
  const names = [...new Set((Array.isArray(fields) ? fields : []).filter(Boolean))];
  const bucket = body?.bucket ?? body?.effective?.bucket ?? '';
  if (!names.length || !bucket) return null;
  const raw = body?.bucket_step ?? body?.effective?.bucket_step ?? 1;
  const step = Number(raw);
  return { fields: names, bucket, bucket_step: Number.isFinite(step) && step > 0 ? step : 1 };
}

// Association counts always reconcile in their own unit. `total_n` is the sum
// of associated, missing and orphan rejections; none of them is a session.
export function associationTotals(associations = []) {
  const totals = {
    total_n: 0, associated_n: 0, no_conversation_id: 0, orphan_conversation_id: 0
  };
  for (const item of Array.isArray(associations) ? associations : []) {
    totals.total_n += Number(item?.total_n) || 0;
    totals.associated_n += Number(item?.associated_n) || 0;
    totals.no_conversation_id += Number(item?.missing_by_reason?.no_conversation_id) || 0;
    totals.orphan_conversation_id += Number(item?.missing_by_reason?.orphan_conversation_id) || 0;
  }
  return totals;
}

// Each association side is its own line with its own unit and treatment. A
// `side:"source"` line is meaningful only when the frozen source fields
// include `rejections`; a target line is always shown beside the target
// population. Missing and orphan rejections are never folded into a session
// count.
export function associationLines(associations = [], { sourceFields = [] } = {}) {
  const lines = [];
  for (const item of Array.isArray(associations) ? associations : []) {
    const side = item?.side || 'target';
    if (side === 'source' && !(sourceFields || []).includes('rejections')) continue;
    const missing = Number(item?.missing_by_reason?.no_conversation_id) || 0;
    const orphan = Number(item?.missing_by_reason?.orphan_conversation_id) || 0;
    const associated = Number(item?.associated_n) || 0;
    const total = Number(item?.total_n) || 0;
    lines.push(
      `${side} ${item?.contributor || 'rejection'} associations: ${associated.toLocaleString('en-US')} associated, ` +
      `${missing.toLocaleString('en-US')} missing (no_conversation_id), ` +
      `${orphan.toLocaleString('en-US')} orphan (orphan_conversation_id); ` +
      `${total.toLocaleString('en-US')} ${item?.unit || 'rejection'} total; treatment ${item?.treatment || 'kept'}`
    );
  }
  return lines;
}

export function canonicalScope(scope = {}) {
  return {
    exclude: scope.exclude === undefined ? [] : canonicalElements(scope.exclude),
    from: scope.from ?? null,
    include: scope.include === undefined ? [] : canonicalElements(scope.include),
    to: scope.to ?? null,
    tz: scope.tz ?? null
  };
}

export function canonicalElements(list) {
  if (!Array.isArray(list)) throw new Error('scope list must be an array');
  const byLens = new Map();
  for (const element of list) {
    if (!isObject(element) || typeof element.lens !== 'string' || !element.lens) throw new Error('scope element needs a lens');
    if (!Array.isArray(element.values) || element.values.length === 0) throw new Error('scope element needs values');
    const values = byLens.get(element.lens) || new Set();
    for (const value of element.values) {
      if (typeof value !== 'string') throw new Error('scope values must be strings');
      values.add(value);
    }
    byLens.set(element.lens, values);
  }
  return [...byLens.keys()].sort().map(lens => ({ lens, values: [...byLens.get(lens)].sort() }));
}

export function cohortDefinition({ grain, scope = {}, predicate, op = 'include', source } = {}) {
  if (typeof grain !== 'string' || !grain) throw new Error('cohort needs a grain');
  if (!OPS.has(op)) throw new Error('cohort op must be include or exclude');
  const cohort = {
    grain,
    op,
    predicate: canonicalPredicate(predicate),
    scope: canonicalScope(scope),
    v: 1
  };
  if (source !== undefined) cohort.source = source;
  return cohort;
}

export function canonicalCohort(cohort) {
  const normal = cohortDefinition({
    grain: cohort?.grain,
    scope: cohort?.scope,
    predicate: cohort?.predicate,
    op: cohort?.op || 'include',
    source: cohort?.source
  });
  return JSON.parse(canonicalJson(normal));
}

export function encodeCohort(cohort) {
  return canonicalJson(canonicalCohort(cohort));
}

export function decodeCohort(text) {
  if (typeof text !== 'string' || !text) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  try { return canonicalCohort(parsed); } catch { return null; }
}

// Budget validation in the contract's order. The first failure names its
// reason; the caller leaves the scope unchanged and offers nothing.
export function validateCohort(cohort, { budgets = PREDICATE_BUDGETS } = {}) {
  if (!isObject(cohort) || cohort.v !== 1) return { ok: false, reason: 'cohort_invalid' };
  if (typeof cohort.grain !== 'string' || !cohort.grain) return { ok: false, reason: 'cohort_invalid' };
  if (!OPS.has(cohort.op || 'include')) return { ok: false, reason: 'cohort_invalid' };
  const scope = cohort.scope;
  if (!isObject(scope) || !Array.isArray(scope.include) || !Array.isArray(scope.exclude)) return { ok: false, reason: 'cohort_invalid' };
  let predicate;
  try { predicate = canonicalPredicate(cohort.predicate); } catch { return { ok: false, reason: 'cohort_invalid' }; }

  if (predicateLeaves(predicate) > (budgets.leaves ?? PREDICATE_BUDGETS.leaves)) return { ok: false, reason: 'leaves' };
  if (predicateInValues(predicate) > (budgets.values ?? PREDICATE_BUDGETS.values)) return { ok: false, reason: 'values' };
  if (predicateDepth(predicate) > (budgets.depth ?? PREDICATE_BUDGETS.depth)) return { ok: false, reason: 'depth' };

  for (const side of [scope.include, scope.exclude]) {
    if (side.length > (budgets.scope_elements ?? PREDICATE_BUDGETS.scope_elements)) return { ok: false, reason: 'scope_elements' };
    for (const element of side) {
      if (!isObject(element) || typeof element.lens !== 'string' || !element.lens || !Array.isArray(element.values) || element.values.length === 0) return { ok: false, reason: 'cohort_invalid' };
      if (element.values.length > (budgets.scope_values ?? PREDICATE_BUDGETS.scope_values)) return { ok: false, reason: 'scope_values' };
      const limit = element.lens === 'id'
        ? (budgets.id_value_bytes ?? PREDICATE_BUDGETS.id_value_bytes)
        : (budgets.value_bytes ?? PREDICATE_BUDGETS.value_bytes);
      for (const value of element.values) if (byteLength(value) > limit) return { ok: false, reason: 'value_bytes' };
    }
  }

  if (byteLength(encodeCohort(cohort)) > (budgets.bytes ?? PREDICATE_BUDGETS.bytes)) return { ok: false, reason: 'bytes' };
  return { ok: true, reason: '' };
}

export function validateCohorts(cohorts = {}, options = {}) {
  const names = Object.keys(cohorts).filter(key => cohorts[key]);
  if (names.length > PREDICATE_BUDGETS.cohorts) return { ok: false, reason: 'cohorts' };
  for (const name of names) {
    const result = validateCohort(cohorts[name], options);
    if (!result.ok) return result;
  }
  return { ok: true, reason: '' };
}

export function fitsViewUrl(search = '', limit = PREDICATE_BUDGETS.bytes) {
  return byteLength(search) <= limit;
}

function pluralUnit(unit, value) {
  if (!unit) return '';
  if (value === 1) return unit;
  if (/[^a-z]$/i.test(unit) || /s$/i.test(unit)) return unit;
  return `${unit}s`;
}

// "2 sessions of 1,880 in scope; 38 sampled marks visible". Counts come from
// the selection and the panel's typed population, never from summing a page.
export function formatSelection({ unit = 'row', selected = 0, scope = null, sampled = null } = {}) {
  const count = Number(selected) || 0;
  let text = `${count.toLocaleString('en-US')} ${pluralUnit(unit, count)}`.trim();
  if (scope !== null && scope !== undefined) text += ` of ${(Number(scope) || 0).toLocaleString('en-US')} in scope`;
  if (sampled !== null && sampled !== undefined) text += `; ${(Number(sampled) || 0).toLocaleString('en-US')} sampled marks visible`;
  return text;
}
