// Accessible table view built from the same spec and data as the chart.
// Plotted values, units and entity keys; native checkbox per row; keyboard
// operable from the row itself. Selection is emitted as intent only.

import { formatValue, formatBasis, NULL_TEXT } from './formatters.js';

export function tableModel({ spec = {}, data = [] } = {}) {
  const series = spec.series || [];
  const x = spec.x || { label: 'Time', kind: 'number' };
  return {
    caption: spec.title || 'Plotted values',
    basis: spec.timeBasis ? formatBasis(spec.timeBasis) : '',
    columns: [
      { key: '__entity', label: spec.table?.keyLabel || 'Entity' },
      { key: '__x', label: x.label || 'Time', unit: x.unit || '' },
      ...series.map(item => ({ key: item.key, label: item.label || item.key, unit: item.unit || '' }))
    ],
    rows: data.map(datum => ({
      key: datum.key,
      x: formatValue(datum.x, { kind: x.kind || 'number', ...x.format }),
      values: series.map(item => formatValue(datum.values?.[item.key], { kind: item.kind || 'number', ...item.format })),
      raw: datum.values || {}
    }))
  };
}

export function createTable(doc, { spec = {}, data = [], onSelect = null, onInspect = null } = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'yk-table-wrap';
  const table = doc.createElement('table');
  table.className = 'yk-table';
  wrap.append(table);
  let model = tableModel({ spec, data });
  render();

  return { element: wrap, table, update };

  function update(nextData = data) {
    data = nextData;
    model = tableModel({ spec, data });
    render();
    return model;
  }

  function render() {
    table.replaceChildren();
    const caption = doc.createElement('caption');
    caption.textContent = model.basis ? `${model.caption} — ${model.basis}` : model.caption;
    table.append(caption);

    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    for (const column of model.columns) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = column.unit ? `${column.label} (${column.unit})` : column.label;
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);

    const tbody = doc.createElement('tbody');
    for (const row of model.rows) {
      const tr = doc.createElement('tr');
      tr.tabIndex = 0;
      tr.dataset.entityKey = row.key;
      tr.addEventListener('keydown', event => onKey(event, row, tr));

      const selectCell = doc.createElement('th');
      selectCell.scope = 'row';
      const checkbox = doc.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'yk-table-select';
      checkbox.dataset.key = row.key;
      checkbox.setAttribute('aria-label', `Select ${row.key}`);
      checkbox.addEventListener('change', event => emitSelect(row.key, event.target.checked, event));
      const key = doc.createElement('span');
      key.className = 'yk-table-key';
      key.textContent = row.key;
      selectCell.append(checkbox, key);
      tr.append(selectCell);

      const xCell = doc.createElement('td');
      xCell.className = 'yk-table-x';
      xCell.textContent = row.x;
      tr.append(xCell);

      for (const value of row.values) {
        const td = doc.createElement('td');
        td.className = 'yk-table-value';
        td.textContent = value === undefined ? NULL_TEXT : value;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
  }

  function emitSelect(key, selected, event) {
    const detail = { type: 'select', key, selected, additive: Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey), exclude: Boolean(event?.altKey) };
    if (typeof onSelect === 'function') onSelect(detail);
    wrap.dispatchEvent(new CustomEvent('yk-table-select', { bubbles: true, detail }));
    return detail;
  }

  function onKey(event, row, tr) {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      const checkbox = tr.querySelector('input[type="checkbox"]');
      checkbox.checked = !checkbox.checked;
      emitSelect(row.key, checkbox.checked, event);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const detail = { type: 'inspect', key: row.key };
      if (typeof onInspect === 'function') onInspect(detail);
      wrap.dispatchEvent(new CustomEvent('yk-table-inspect', { bubbles: true, detail }));
      return;
    }
    const rows = [...table.querySelectorAll('tbody tr')];
    const index = rows.indexOf(tr);
    if (event.key === 'ArrowDown' && index < rows.length - 1) {
      event.preventDefault();
      rows[index + 1].focus();
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      rows[index - 1].focus();
    }
  }
}
