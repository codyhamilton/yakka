// Per-panel capability drawer: the panel's queries (route and parameters, as
// provenance, never navigation), grain, units, time basis, budgets, coverage,
// caveats and any missing capability with its source. It reads the panel's
// requests() metadata and /schema; it never invents a route or issues a request.

import { chooserOptions } from '../panels/registry.js';

function featureAvailable(schema, name) {
  const features = schema?.features || {};
  if (name === 'activity') return Boolean(features.activity || features.analytics_activity);
  return Boolean(features[name]);
}

function requestsOf(panel) {
  const value = typeof panel?.requests === 'function' ? panel.requests() : panel?.requests;
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(Boolean).map(item => {
    if (typeof item === 'string') return { route: item, params: {} };
    return { route: item.route || '', params: item.params || item.parameters || {} };
  });
}

function paramText(params) {
  const entries = Object.entries(params || {});
  return entries.length ? entries.map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : value}`).join(' & ') : 'no parameters';
}

function sourceOf(panel, feature) {
  return panel?.capabilitySources?.[feature]
    || panel?.requiresSource?.[feature]
    || panel?.capabilitySource
    || 'this plan\'s server phases';
}

function text(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function list(doc, className) {
  const node = doc.createElement('ul');
  node.className = className;
  return node;
}

export function capabilityModel({ panel = {}, spec = {}, schema = null } = {}) {
  const offered = chooserOptions(panel, schema || {});
  const nearest = { measure: offered.measures[0], lens: offered.lenses[0], chart: offered.charts[0] };
  return {
    requests: requestsOf(panel),
    grain: panel.grain || spec.grain || '',
    units: (spec.measures?.length ? spec.measures : panel.measures || []).map(name => {
      const mapped = schema?.measure_metadata?.[name] || {};
      const measure = (Array.isArray(schema?.measures) ? schema.measures : []).find(item => (typeof item === 'string' ? item : item?.name) === name);
      return { name, unit: mapped.unit || measure?.unit || 'unit not published' };
    }),
    basis: panel.measureBasis || spec.timeBasis || panel.timeBasis || '',
    budgets: Object.entries(schema?.budgets || {}),
    coverage: Object.entries(schema?.coverage || {}),
    caveats: panel.caveats || '',
    missing: (panel.requires || [])
      .filter(feature => !featureAvailable(schema, feature))
      .map(feature => ({ feature, source: sourceOf(panel, feature) })),
    unsupported: offered.unsupported.map(item => ({
      ...item,
      nearest: nearest[item.kind] ? `${item.kind} ${nearest[item.kind]}` : 'no supported choice for this kind'
    }))
  };
}

export function createCapabilityInspector({ doc = globalThis.document, panel = {}, spec = {}, schema = null } = {}) {
  const element = doc.createElement('details');
  element.className = 'capability-inspector';
  element.dataset.grain = panel.grain || spec.grain || '';
  element.append(text(doc, 'summary', 'capability-summary', 'Capability'));

  const body = doc.createElement('div');
  body.className = 'capability-body';
  const model = capabilityModel({ panel, spec, schema });

  body.append(text(doc, 'h3', 'capability-heading', 'Queries'));
  const queries = list(doc, 'capability-queries');
  if (!model.requests.length) queries.append(text(doc, 'li', 'capability-empty', 'No query metadata is published by this panel.'));
  for (const request of model.requests) {
    const item = doc.createElement('li');
    item.dataset.route = request.route;
    item.append(text(doc, 'span', 'capability-route', request.route || 'unnamed route'), doc.createTextNode(` · ${paramText(request.params)}`));
    queries.append(item);
  }
  body.append(queries);

  body.append(text(doc, 'p', 'capability-grain', `grain: ${model.grain || 'not stated'}`));
  const units = list(doc, 'capability-units');
  for (const unit of model.units) units.append(text(doc, 'li', '', `${unit.name}: ${unit.unit}`));
  body.append(text(doc, 'p', 'capability-basis', `time basis: ${model.basis || 'not stated'}`), units, text(doc, 'p', 'capability-caveat', model.caveats || 'No panel caveat is declared.'));

  const budgets = list(doc, 'capability-budgets');
  if (!model.budgets.length) budgets.append(text(doc, 'li', 'capability-empty', 'No budgets are published.'));
  for (const [key, value] of model.budgets) {
    budgets.append(text(doc, 'li', '', `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`));
  }
  body.append(text(doc, 'h3', 'capability-heading', 'Budgets'), budgets);

  const coverage = list(doc, 'capability-coverage');
  if (!model.coverage.length) coverage.append(text(doc, 'li', 'capability-empty', 'No coverage is published.'));
  for (const [key, value] of model.coverage) coverage.append(text(doc, 'li', '', `${key}: ${value === null || value === undefined ? '—' : value}`));
  body.append(text(doc, 'h3', 'capability-heading', 'Coverage'), coverage);

  const missing = list(doc, 'capability-missing');
  if (!model.missing.length && !model.unsupported.length) missing.append(text(doc, 'li', 'capability-empty', 'Nothing this panel needs is missing.'));
  for (const item of model.missing) {
    const node = doc.createElement('li');
    node.dataset.feature = item.feature;
    node.textContent = `${item.feature} is not supported; supplied by ${item.source}.`;
    missing.append(node);
  }
  for (const item of model.unsupported) {
    const node = doc.createElement('li');
    node.dataset.kind = item.kind;
    node.dataset.name = item.name;
    node.textContent = `${item.kind} ${item.name} is not supported (${item.reason || 'not offered'}); nearest supported choice: ${item.nearest}.`;
    missing.append(node);
  }

  body.append(text(doc, 'h3', 'capability-heading', 'Missing capabilities'), missing);
  element.append(body);
  return { element, model };
}
