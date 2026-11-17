// One formatting contract for every chart, tooltip, badge and table.
// A missing value is never formatted as zero.

const NUMBER = new Intl.NumberFormat('en-US');
const NUMBER_1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const NUMBER_2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const CURRENCY_SYMBOL = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$' };

export const TIME_BASES = {
  FACTS: 'artifact/event facts.ts',
  LATEST_KNOWN: 'latest known',
  EVALUATED_AT: 'evaluation timestamp',
  SERVER_AT: 'server at',
  RECEIVE_TIME: 'receive time',
  BASH_HOOK: 'Bash-hook time'
};

export const NULL_TEXT = '—';

export function isMissing(value) {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value));
}

function pluralUnit(unit, value) {
  if (!unit) return '';
  if (value === 1) return unit;
  if (/[^a-z]$/i.test(unit) || /s$/i.test(unit)) return unit;
  return `${unit}s`;
}

export function formatNumber(value, { compact = false, digits = null } = {}) {
  if (isMissing(value)) return NULL_TEXT;
  const number = Number(value);
  if (!Number.isFinite(number)) return NULL_TEXT;
  if (compact) return COMPACT.format(number);
  if (digits === 1) return NUMBER_1.format(number);
  if (digits === 2) return NUMBER_2.format(number);
  return NUMBER.format(number);
}

export function formatCount(value, { unit = '', plural = '', compact = false } = {}) {
  if (isMissing(value)) return NULL_TEXT;
  const formatted = formatNumber(value, { compact });
  if (!unit) return formatted;
  const label = Number(value) === 1 ? unit : (plural || pluralUnit(unit, Number(value)));
  return `${formatted} ${label}`;
}

export function formatPercent(ratio, { digits = 1 } = {}) {
  if (isMissing(ratio)) return NULL_TEXT;
  const number = Number(ratio);
  if (!Number.isFinite(number)) return NULL_TEXT;
  const formatter = digits === 0 ? NUMBER : NUMBER_1;
  return `${formatter.format(number * 100)}%`.replace(/\.0%$/, '%');
}

export function formatShare(part, whole, { digits = 1 } = {}) {
  if (isMissing(part) || isMissing(whole) || Number(whole) === 0) return NULL_TEXT;
  return formatPercent(Number(part) / Number(whole), { digits });
}

export function formatMoney(amount, { currency = 'USD', unpriced = 0, priced = null, lowerBound = false } = {}) {
  const unpricedCount = Number(unpriced) || 0;
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  if (isMissing(amount)) return 'unpriced';
  const number = Number(amount);
  if (!Number.isFinite(number)) return 'unpriced';
  if (priced === 0 && unpricedCount > 0) return 'unpriced';
  const money = `${symbol}${NUMBER_2.format(number)}`;
  if (unpricedCount > 0) return `${money}+ (${NUMBER.format(unpricedCount)} unpriced)`;
  if (lowerBound) return `${money}+`;
  return money;
}

export function formatSample(n, total) {
  if (isMissing(n) || isMissing(total)) return NULL_TEXT;
  return `sample of ${formatNumber(n)} of ${formatNumber(total)}`;
}

export function formatBasis(basis = {}) {
  if (typeof basis === 'string') return basis;
  const { clock, score, rejections, activity, note } = basis || {};
  const parts = [];
  if (clock) parts.push(`time basis ${clock}`);
  if (score) parts.push(`scores ${score}`);
  if (rejections) parts.push(`rejections ${rejections}`);
  if (activity) parts.push(`activity ${activity}`);
  if (note) parts.push(note);
  return parts.length > 0 ? parts.join('; ') : 'time basis not stated';
}

export const formatTimeBasis = formatBasis;

export function formatValue(value, options = {}) {
  const { kind = 'number', ...rest } = options;
  if (kind === 'money') return formatMoney(value, rest);
  if (kind === 'text') return isMissing(value) ? NULL_TEXT : String(value);
  if (isMissing(value)) return kind === 'money' ? 'unpriced' : NULL_TEXT;
  if (kind === 'percent') return formatPercent(value, rest);
  if (kind === 'share') return formatShare(value, rest.whole, rest);
  if (kind === 'count') return formatCount(value, rest);
  return formatNumber(value, rest);
}
