// ECDF step-line mode over a numeric x domain. Samples are sorted per cohort
// or lens, the x grid is the union of sorted sample values, and each series
// reports the fraction of its samples at or below x. The plotted values and
// the table values are the same numbers; nothing is interpolated.

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function seriesList(spec, rows) {
  const declared = (spec.series || []).map((item, order) => ({
    ...item,
    key: String(item.key),
    label: item.label || String(item.key),
    order
  }));
  if (declared.length > 0) return declared;
  const groups = [...new Set(rows.map(row => row.group).filter(value => value != null).map(String))].sort();
  if (groups.length > 0) return groups.map((key, order) => ({ key, label: key, order }));
  return [{ key: 'value', label: spec.y?.label || 'Value', order: 0 }];
}

export function ecdfModel({ spec = {}, data = [] } = {}) {
  const rows = Array.isArray(data) ? data : [];
  const series = seriesList(spec, rows);
  const samples = new Map(series.map(item => [item.key, []]));

  for (const row of rows) {
    const group = row.group == null ? null : String(row.group);
    if (group !== null && samples.has(group)) {
      if (finite(row.x)) samples.get(group).push(row.x);
      continue;
    }
    let used = false;
    if (row.values && typeof row.values === 'object') {
      for (const item of series) {
        const value = row.values[item.key];
        if (finite(value)) { samples.get(item.key).push(value); used = true; }
      }
    }
    if (!used && series.length === 1 && finite(row.x)) samples.get(series[0].key).push(row.x);
  }

  const sorted = new Map();
  for (const item of series) {
    const values = samples.get(item.key).slice().sort((a, b) => a - b);
    sorted.set(item.key, values);
  }
  const xs = [...new Set(series.flatMap(item => sorted.get(item.key)))].sort((a, b) => a - b);

  const plotRows = xs.map(x => {
    const values = {};
    for (const item of series) {
      const valuesForSeries = sorted.get(item.key);
      if (valuesForSeries.length === 0) { values[item.key] = null; continue; }
      let count = 0;
      while (count < valuesForSeries.length && valuesForSeries[count] <= x) count += 1;
      values[item.key] = count / valuesForSeries.length;
    }
    return { key: `ecdf:${x}`, x, values, rawValues: values };
  });

  return {
    mode: 'absolute',
    type: 'ecdf',
    stacked: false,
    spec: {
      ...spec,
      type: 'ecdf',
      x: { label: 'Value', kind: 'number', ...(spec.x || {}) },
      y: { label: 'Fraction', kind: 'percent', unit: '%', min: 0, max: 1, ...(spec.y || {}) },
      series: series.map(item => ({ ...item, kind: 'percent', unit: '%' }))
    },
    bands: [],
    rows: plotRows,
    tableRows: plotRows.map(row => ({ ...row })),
    counts: Object.fromEntries(series.map(item => [item.key, sorted.get(item.key).length]))
  };
}
