// Accessible table view built from the same spec and data as the chart.
// Plotted values, units and entity keys; native checkbox per row; keyboard
// operable from the row itself. Selection is emitted as intent only.

import { formatValue, formatBasis, NULL_TEXT } from './formatters.js';

function explicitColumns(columns = []) {
  return columns.map((column, index) => ({
    key: column.key || column.name || `column_${index}`,
    label: column.label || column.key || column.name || '',
    unit: column.unit || '',
    numeric: column.numeric === true
  }));
}

function cellValue(datum, column) {
  if (datum && Object.prototype.hasOwnProperty.call(datum, column.key)) return datum[column.key];
  if (datum?.raw && Object.prototype.hasOwnProperty.call(datum.raw, column.key)) return datum.raw[column.key];
  if (datum?.cells && Object.prototype.hasOwnProperty.call(datum.cells, column.key)) return datum.cells[column.key];
  return undefined;
}

export function tableModel({ spec = {}, data = [], columns = null } = {}) {
  if (Array.isArray(columns) && columns.length) {
    const model = explicitColumns(columns);
    return {
      caption: spec.title || 'Plotted values',
      basis: spec.timeBasis ? formatBasis(spec.timeBasis) : '',
      mode: 'columns',
      columns: model,
      rows: data.map((datum, index) => ({
        key: datum?.key ?? datum?.__key ?? String(index),
        cells: model.map(column => ({ key: column.key, value: cellValue(datum, column), numeric: column.numeric })),
        raw: datum
      }))
    };
  }
  const series = spec.series || [];
  const x = spec.x || { label: 'Time', kind: 'number' };
  return {
    caption: spec.title || 'Plotted values',
    basis: spec.timeBasis ? formatBasis(spec.timeBasis) : '',
    mode: 'series',
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

export function createTable(doc, { spec = {}, data = [], columns = null, select = true, onSelect = null, onInspect = null } = {}) {
  const wrap = doc.createElement('div');
  wrap.className = 'yk-table-wrap';
  const table = doc.createElement('table');
  table.className = 'yk-table';
  wrap.append(table);
  let model = tableModel({ spec, data, columns });
  render();

  return { element: wrap, table, update };

  function update(nextData = data) {
    data = nextData;
    model = tableModel({ spec, data, columns });
    render();
    return model;
  }

  function render() {
    table.replaceChildren();
    const caption = doc.createElement('caption');
    caption.textContent = model.basis ? `${model.caption} — ${model.basis}` : model.caption;
    table.append(caption);

    const showSelect = select !== false;
    const thead = doc.createElement('thead');
    const headRow = doc.createElement('tr');
    if (model.mode === 'columns' && showSelect) {
      const th = doc.createElement('th');
      th.scope = 'col';
      th.textContent = spec.table?.keyLabel || 'Select';
      headRow.append(th);
    }
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

      if (model.mode === 'columns') {
        if (showSelect) tr.append(selectCell(row));
        for (const cell of row.cells) {
          const td = doc.createElement('td');
          td.className = cell.numeric ? 'yk-table-value yk-table-number' : 'yk-table-cell';
          td.textContent = cell.value === undefined || cell.value === null ? NULL_TEXT : String(cell.value);
          tr.append(td);
        }
        tbody.append(tr);
        continue;
      }

      tr.append(selectCell(row));
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

  function selectCell(row) {
    const cell = doc.createElement('th');
    cell.scope = 'row';
    const key = doc.createElement('span');
    key.className = 'yk-table-key';
    key.textContent = row.key;
    if (!select) {
      key.textContent = row.key;
      cell.append(key);
      return cell;
    }
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'yk-table-select';
    checkbox.dataset.key = row.key;
    checkbox.setAttribute('aria-label', `Select ${row.key}`);
    checkbox.addEventListener('change', event => emitSelect(row.key, event.target.checked, event));
    cell.append(checkbox, key);
    return cell;
  }

  function emitSelect(key, selected, event) {
    const detail = { type: 'select', key, selected, additive: Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey), exclude: Boolean(event?.altKey) };
    if (typeof onSelect === 'function') onSelect(detail);
    wrap.dispatchEvent(new CustomEvent('yk-table-select', { bubbles: true, detail }));
    return detail;
  }

  function onKey(event, row, tr) {
    if ([' ', 'Spacebar', 'Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation();
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
