const RESERVED = new Set(['win', 'from', 'to', 'tz', 'exclude', 'ca', 'cb', 'cc', 'cd', 'pick', 'sel', 'hide', 'cmp', 'v']);
const PANEL = /^p\d+$/;
const VALID_WINDOW = /^(?:all|\d+[hdwmy])$/;
const FILTERS = new Set(['repo_id', 'harness', 'kind', 'plan', 'norm_event', 'event', 'tool', 'model', 'source', 'conversation_id']);

export function decodeUrlState(search = '') {
  const params = new URLSearchParams(search);
  const rawWin = params.get('win');
  const state = {
    win: rawWin && VALID_WINDOW.test(rawWin) ? rawWin : '30d',
    from: params.get('from') || '', to: params.get('to') || '', tz: params.get('tz') || '',
    exclude: params.getAll('exclude'), cohorts: Object.fromEntries(['ca', 'cb', 'cc', 'cd'].map(k => [k, params.get(k) || ''])),
    pick: params.get('pick') || '', sel: params.get('sel') || '', hide: params.getAll('hide'),
    cmp: ['off', 'cohorts', 'period'].includes(params.get('cmp')) ? params.get('cmp') : 'off',
    view: params.get('v') || '', panels: {}, filters: {}, unknown: {}
  };
  if (state.from || state.to) state.win = '';
  for (const [key, value] of params) {
    if (RESERVED.has(key) || PANEL.test(key)) continue;
    if (FILTERS.has(key)) (state.filters[key] ??= []).push(value);
    else (state.unknown[key] ??= []).push(value);
  }
  for (const [key, value] of params) if (PANEL.test(key)) state.panels[key] = value;
  return state;
}

export function encodeUrlState(state, current = '') {
  const out = new URLSearchParams();
  const prior = current instanceof URLSearchParams ? current : new URLSearchParams(current);
  for (const [key, value] of prior) {
    if (!RESERVED.has(key) && !PANEL.test(key) && !(key in (state.filters || {})) && !(key in (state.unknown || {}))) out.append(key, value);
  }
  if (state.from || state.to) { if (state.from) out.set('from', state.from); if (state.to) out.set('to', state.to); }
  else out.set('win', VALID_WINDOW.test(state.win || '') ? state.win : '30d');
  if (state.tz) out.set('tz', state.tz);
  for (const [key, values] of Object.entries(state.filters || {})) for (const value of values) out.append(key, value);
  for (const [key, values] of Object.entries(state.unknown || {})) for (const value of values) out.append(key, value);
  for (const value of state.exclude || []) out.append('exclude', value);
  for (const key of ['ca', 'cb', 'cc', 'cd']) if (state.cohorts?.[key]) out.set(key, state.cohorts[key]);
  if (state.pick) out.set('pick', state.pick);
  if (state.sel) out.set('sel', state.sel);
  for (const value of state.hide || []) out.append('hide', value);
  if (state.cmp && state.cmp !== 'off') out.set('cmp', state.cmp);
  if (state.view) out.set('v', state.view);
  for (const [key, value] of Object.entries(state.panels || {})) if (PANEL.test(key)) out.set(key, value);
  return out;
}
