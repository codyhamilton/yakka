// `ops-footprint` tenant panel: the only panel that reads /v1/admin/status.
// It renders the server's point-in-time status exactly as returned, never
// infers administrator rights, and keeps every tenant separate. Pure
// formatters/mappers are exported for the node checks.

import { formatNumber } from '../charts/formatters.js';
import { cancelledState, errorState, unsupportedState } from '../core/panel-state.js';

export const FAILURE_CAP = 25;
export const STATE_KEY = 'ops-status';
export const STATUS_ROUTE = 'admin/status';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

function missing(value) {
  return value === null || value === undefined || value === '';
}

function asNumber(value) {
  if (missing(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asString(value) {
  return missing(value) ? null : String(value);
}

// Bytes with the unit named on the value itself, never a bare number.
export function formatBytes(value) {
  const number = asNumber(value);
  if (number === null) return 'not supplied';
  let amount = Math.max(0, number);
  let index = 0;
  while (amount >= 1024 && index < BYTE_UNITS.length - 1) { amount /= 1024; index += 1; }
  const rounded = index === 0 ? String(Math.round(amount)) : amount >= 100 ? amount.toFixed(0) : amount.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${BYTE_UNITS[index]}`;
}

// Unix seconds, displayed as UTC. Zero means "never" for a rescore time.
export function formatUnixSeconds(value) {
  const number = asNumber(value);
  if (number === null) return 'not supplied';
  if (number === 0) return 'never';
  return new Date(number * 1000).toISOString();
}

export function formatCount(value, unit) {
  const number = asNumber(value);
  if (number === null) return 'not supplied';
  const label = number === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit;
  return `${formatNumber(number)} ${label}`;
}

// The server caps the recent-failure list; label the cap rather than implying
// that the list is complete.
export function failureCapText(shown) {
  const count = asNumber(shown);
  if (count === null) return `recent screen failures; the server caps this list at ${FAILURE_CAP}`;
  return `${formatNumber(count)} shown; recent screen failures, the server caps this list at ${FAILURE_CAP}`;
}

export function rescoreProgress(rescore) {
  if (!rescore) return 'not supplied';
  const total = asNumber(rescore.total);
  const done = asNumber(rescore.done);
  const failed = asNumber(rescore.failed);
  const started = asNumber(rescore.started);
  if (!rescore.running && !started && !total) return 'never run';
  const status = rescore.running ? 'running' : 'finished';
  const head = `${status}: ${formatCount(done, 'content items')} of ${formatCount(total, 'content items')} scored`;
  return failed ? `${head}, ${formatCount(failed, 'failures')}` : head;
}

export function mapScoring(scoring) {
  if (!scoring || typeof scoring !== 'object') return null;
  return {
    scorer: Boolean(scoring.scorer),
    checks: Boolean(scoring.checks),
    rescorable: Boolean(scoring.rescorable)
  };
}

export function mapVolume(volume) {
  if (!volume || typeof volume !== 'object') return null;
  return { total_bytes: asNumber(volume.total_bytes), free_bytes: asNumber(volume.free_bytes) };
}

const FOOTPRINT_FIELDS = [
  ['ledger_bytes', 'Ledger'],
  ['wal_bytes', 'WAL'],
  ['archive_bytes', 'Archive'],
  ['blob_bytes', 'Blobs'],
  ['pending_bytes', 'Pending'],
  ['other_bytes', 'Other']
];

const FOOTPRINT_COUNTS = [
  ['archive_files', 'Archive files', 'files'],
  ['blobs', 'Blobs', 'blobs'],
  ['pending', 'Pending items', 'items']
];

export function mapTenant(tenant) {
  const source = tenant && typeof tenant === 'object' ? tenant : {};
  const footprint = source.footprint && typeof source.footprint === 'object'
    ? {
        bytes: FOOTPRINT_FIELDS.map(([key, label]) => ({ key, label, value: asNumber(source.footprint[key]) })),
        counts: FOOTPRINT_COUNTS.map(([key, label, unit]) => ({ key, label, unit, value: asNumber(source.footprint[key]) }))
      }
    : null;
  const screens = source.screens && typeof source.screens === 'object'
    ? {
        verdicts: Object.entries(source.screens.verdicts || {}).map(([verdict, count]) => ({ verdict, count: asNumber(count) })),
        scored_content: asNumber(source.screens.scored_content),
        score_rows: asNumber(source.screens.score_rows),
        rejections: Array.isArray(source.screens.rejections)
          ? source.screens.rejections.map(row => ({
              stage: asString(row?.stage),
              pattern: asString(row?.pattern),
              count: asNumber(row?.count),
              last: asNumber(row?.last)
            }))
          : null,
        total_rejections: asNumber(source.screens.total_rejections)
      }
    : null;
  return {
    id: asString(source.id),
    name: asString(source.name),
    error: asString(source.error) || '',
    facts: asNumber(source.facts),
    compaction: asString(source.compaction),
    footprint,
    screens,
    failuresSupplied: Array.isArray(source.failures),
    failures: Array.isArray(source.failures)
      ? source.failures.map(row => ({
          stage: asString(row?.stage),
          pattern: asString(row?.pattern),
          reason: asString(row?.reason),
          path: asString(row?.path),
          content_hash: asString(row?.content_hash),
          at: asNumber(row?.at)
        }))
      : [],
    rescore: source.rescore && typeof source.rescore === 'object'
      ? {
          running: Boolean(source.rescore.running),
          total: asNumber(source.rescore.total),
          done: asNumber(source.rescore.done),
          failed: asNumber(source.rescore.failed),
          started: asNumber(source.rescore.started),
          finished: asNumber(source.rescore.finished),
          error: asString(source.rescore.error) || ''
        }
      : null
  };
}

// 403 is the only honest "not for you" answer: the server decides, never a
// client-side role guess. 401 stays the shell's session gate; the panel shows
// the server's failure rather than inventing an administrator message.
export function mapStatusResponse({ status, body } = {}) {
  const payload = body && typeof body === 'object' ? body : {};
  if (status === 403) {
    return unsupportedState({
      feature: 'Administrator status',
      reason: 'administrator only',
      source: '/v1/admin/status'
    });
  }
  if (status === 401) {
    return errorState({ message: 'The session is not signed in.', code: '401' });
  }
  if (!status || status >= 400) {
    return errorState({
      message: payload.error || `The server returned ${status ?? 'no status'}.`,
      code: payload.code || (status ? String(status) : '')
    });
  }
  const tenantRows = Array.isArray(payload.tenants) ? payload.tenants.map(mapTenant) : [];
  return {
    state: 'ready',
    version: asString(payload.version),
    scoring: mapScoring(payload.scoring),
    volume: mapVolume(payload.volume),
    tenantsSupplied: Array.isArray(payload.tenants),
    tenants: tenantRows,
    basis: 'server status snapshot (point in time), not a historical series',
    population: { unit: 'tenant', returned_n: tenantRows.length, eligible_n: tenantRows.length }
  };
}

function el(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function block(doc, parent, title) {
  const section = el(doc, 'section', 'ops-block');
  if (title) section.append(el(doc, 'h3', 'ops-block-title', title));
  parent.append(section);
  return section;
}

function definitionList(doc, parent, pairs) {
  const list = el(doc, 'dl', 'ops-dl');
  for (const [term, value] of pairs) {
    list.append(el(doc, 'dt', '', term), el(doc, 'dd', '', value));
  }
  parent.append(list);
}

// A real table with a caption and scoped column headers.
function table(doc, parent, { caption, columns, rows, empty = 'none reported' }) {
  const node = el(doc, 'table', 'ops-table');
  node.append(el(doc, 'caption', '', caption));
  const head = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const column of columns) {
    const cell = el(doc, 'th', column.numeric ? 'numeric' : '', column.label);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);
  const body = doc.createElement('tbody');
  if (!rows.length) {
    const row = doc.createElement('tr');
    const cell = el(doc, 'td', '', empty);
    cell.colSpan = columns.length;
    row.append(cell);
    body.append(row);
  }
  for (const row of rows) {
    const tr = doc.createElement('tr');
    row.forEach((value, index) => tr.append(el(doc, 'td', columns[index]?.numeric ? 'numeric' : '', value)));
    body.append(tr);
  }
  node.append(head, body);
  parent.append(node);
}

function absentLine(doc, parent, labels) {
  if (!labels.length) return;
  parent.append(el(doc, 'p', 'ops-missing', `Not supplied by the server: ${labels.join(', ')}.`));
}

function renderTenant(doc, parent, tenant) {
  const section = el(doc, 'section', 'ops-tenant');
  if (tenant.id) section.dataset.tenant = tenant.id;
  const title = tenant.name || 'tenant';
  section.append(el(doc, 'h3', 'ops-tenant-title', tenant.id ? `${title} (${tenant.id})` : title));
  if (tenant.error) {
    section.append(el(doc, 'p', 'ops-tenant-error', `This tenant could not be read: ${tenant.error}. Other tenants are unaffected.`));
    parent.append(section);
    return;
  }
  const absent = [];

  const summary = block(doc, section, 'Ledger');
  if (tenant.facts === null) { absent.push('facts'); summary.append(el(doc, 'p', 'ops-missing', 'Facts: not supplied.')); }
  else definitionList(doc, summary, [['Facts', formatCount(tenant.facts, 'facts')]]);
  if (tenant.compaction === null) { absent.push('compaction'); summary.append(el(doc, 'p', 'ops-missing', 'Compaction: not supplied.')); }
  else definitionList(doc, summary, [['Compaction', tenant.compaction]]);

  const disk = block(doc, section, 'Disk footprint');
  if (!tenant.footprint) {
    absent.push('footprint');
    disk.append(el(doc, 'p', 'ops-missing', 'Footprint: not supplied.'));
  } else {
    table(doc, disk, {
      caption: 'Footprint by component (bytes)',
      columns: [{ label: 'Component' }, { label: 'Bytes', numeric: true }],
      rows: tenant.footprint.bytes.map(item => [item.label, formatBytes(item.value)]),
      empty: 'not supplied'
    });
    definitionList(doc, disk, tenant.footprint.counts.map(item => [item.label, formatCount(item.value, item.unit)]));
  }

  const screens = block(doc, section, 'Screens');
  if (!tenant.screens) {
    absent.push('screens');
    screens.append(el(doc, 'p', 'ops-missing', 'Screens: not supplied.'));
  } else {
    table(doc, screens, {
      caption: 'Screen verdicts',
      columns: [{ label: 'Verdict' }, { label: 'Screens', numeric: true }],
      rows: tenant.screens.verdicts.map(item => [item.verdict, formatCount(item.count, 'screens')]),
      empty: 'none reported'
    });
    definitionList(doc, screens, [
      ['Scored content', formatCount(tenant.screens.scored_content, 'content items')],
      ['Score rows', formatCount(tenant.screens.score_rows, 'rows')],
      ['Total rejections', formatCount(tenant.screens.total_rejections, 'rejections')]
    ]);
    if (tenant.screens.rejections === null) {
      screens.append(el(doc, 'p', 'ops-missing', 'Rejections by stage: not supplied.'));
    } else {
      table(doc, screens, {
        caption: 'Rejections by stage (the returned list, not a claimed total)',
        columns: [{ label: 'Stage' }, { label: 'Pattern' }, { label: 'Rejections', numeric: true }, { label: 'Last (UTC)' }],
        rows: tenant.screens.rejections.map(row => [row.stage ?? 'not supplied', row.pattern ?? 'not supplied', formatCount(row.count, 'rejections'), formatUnixSeconds(row.last)]),
        empty: 'none reported'
      });
    }
  }

  const failures = block(doc, section, 'Recent failures');
  if (!tenant.failuresSupplied) {
    absent.push('failures');
    failures.append(el(doc, 'p', 'ops-missing', 'Recent failures: not supplied.'));
  } else {
    table(doc, failures, {
      caption: `Recent screen failures (${failureCapText(tenant.failures.length)})`,
      columns: [
        { label: 'Stage' }, { label: 'Pattern' }, { label: 'Reason' }, { label: 'Path' },
        { label: 'Content hash' }, { label: 'At (UTC)' }
      ],
      rows: tenant.failures.map(row => [
        row.stage ?? 'not supplied', row.pattern ?? 'not supplied', row.reason ?? 'not supplied',
        row.path ?? 'not supplied', row.content_hash ?? 'not supplied', formatUnixSeconds(row.at)
      ]),
      empty: 'none reported'
    });
  }

  const rescore = block(doc, section, 'Rescore');
  if (!tenant.rescore) {
    absent.push('rescore');
    rescore.append(el(doc, 'p', 'ops-missing', 'Rescore: not supplied.'));
  } else {
    definitionList(doc, rescore, [
      ['Running', tenant.rescore.running ? 'yes' : 'no'],
      ['Progress', rescoreProgress(tenant.rescore)],
      ['Failed', formatCount(tenant.rescore.failed, 'failures')],
      ['Started (UTC)', formatUnixSeconds(tenant.rescore.started)],
      ['Finished (UTC)', formatUnixSeconds(tenant.rescore.finished)],
      ['Error', tenant.rescore.error || 'none']
    ]);
  }

  absentLine(doc, section, absent);
  parent.append(section);
}

// Render the whole snapshot into the frame's body. The body is owned by the
// explorer (the shared frame has no chart/table renderer); every value here is
// the response or an explicit "not supplied".
export function renderOpsStatus(container, result, doc = globalThis.document) {
  container.replaceChildren();
  if (!result || result.state !== 'ready') return container;
  const wrapper = el(doc, 'div', 'ops-status');
  wrapper.append(el(doc, 'p', 'ops-basis', 'Basis: server status snapshot (point in time), not a historical series.'));
  definitionList(doc, block(doc, wrapper, 'Server'), [
    ['Version', result.version || 'not supplied'],
    ...(result.scoring
      ? [
          ['Scorer', result.scoring.scorer ? 'configured' : 'not configured'],
          ['Checks', result.scoring.checks ? 'configured' : 'not configured'],
          ['Rescorable', result.scoring.rescorable ? 'yes' : 'no']
        ]
      : [['Scoring', 'not supplied']])
  ]);
  if (!result.scoring) wrapper.append(el(doc, 'p', 'ops-missing', 'Scoring: not supplied.'));

  const volume = block(doc, wrapper, 'Server volume');
  if (!result.volume) volume.append(el(doc, 'p', 'ops-missing', 'Server volume: not supplied.'));
  else {
    table(doc, volume, {
      caption: 'Server volume (bytes, all tenants together)',
      columns: [{ label: 'Measure' }, { label: 'Bytes', numeric: true }],
      rows: [['Total', formatBytes(result.volume.total_bytes)], ['Free', formatBytes(result.volume.free_bytes)]],
      empty: 'not supplied'
    });
  }

  if (!result.tenantsSupplied) {
    wrapper.append(el(doc, 'p', 'ops-missing', 'Tenants: not supplied by the server.'));
  } else if (!result.tenants.length) {
    wrapper.append(el(doc, 'p', 'ops-missing', 'The server returned no tenants.'));
  } else {
    for (const tenant of result.tenants) renderTenant(doc, wrapper, tenant);
  }
  container.append(wrapper);
  return container;
}

async function load({ transport, signal } = {}) {
  try {
    const { response, body } = await transport.request(STATUS_ROUTE, { signal, stateKey: STATE_KEY });
    return mapStatusResponse({ status: response.status, body });
  } catch (error) {
    if (error?.name === 'AbortError') return cancelledState();
    return errorState({ message: error?.message || 'The status request failed.' });
  }
}

export const OPS_PANEL = {
  id: 'ops-footprint',
  title: 'Tenant footprint',
  grain: 'tenant',
  measures: ['facts'],
  lenses: [],
  charts: ['bars'],
  requires: [],
  caveats: 'Administrator-only, point-in-time server status. Read-only: it never starts a rescore.',
  measureBasis: 'server status snapshot, point in time',
  requests: () => [{ route: `/v1/${STATUS_ROUTE}`, method: 'GET', session: true }],
  load
};

export default OPS_PANEL;
