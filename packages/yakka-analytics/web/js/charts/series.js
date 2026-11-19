// Mode transforms for <yk-chart>: absolute, cumulative (running sum) and
// share (per-bucket 100 percent), plus stacking for columns. Pure data: no
// DOM, no fetch, no invented values for missing points.

export const MODES = ['absolute', 'cumulative', 'share'];
export const TYPES = ['line', 'area', 'columns'];

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normaliseSpec(spec = {}) {
  const mode = MODES.includes(spec.mode) ? spec.mode : 'absolute';
  const type = TYPES.includes(spec.type) ? spec.type : 'line';
  const series = (spec.series || []).map((item, order) => ({
    ...item,
    key: String(item.key),
    label: item.label || String(item.key),
    order
  }));
  return {
    ...spec,
    mode,
    type,
    series,
    stacked: type === 'columns' && spec.stacked !== false
  };
}

export function seriesKeys(spec = {}) {
  return (spec.series || []).map(item => String(item.key));
}

/**
 * Transform rows for the plot and for the table. Missing points stay null in
 * both: cumulative does not carry a value forward, and share does not make a
 * missing series zero.
 */
export function transformSeriesData({ spec = {}, data = [] } = {}) {
  const normal = normaliseSpec(spec);
  const rows = Array.isArray(data) ? data : [];
  const plotValues = rows.map(() => ({}));
  const tableValues = rows.map(() => ({}));
  const running = new Map(normal.series.map(item => [item.key, 0]));

  for (let index = 0; index < rows.length; index += 1) {
    const values = rows[index].values || {};
    let bucketTotal = 0;
    for (const item of normal.series) {
      const value = values[item.key];
      if (finite(value)) bucketTotal += value;
    }
    for (const item of normal.series) {
      const value = values[item.key];
      let plotted = null;
      if (normal.mode === 'cumulative') {
        if (finite(value)) {
          const total = running.get(item.key) + value;
          running.set(item.key, total);
          plotted = total;
        }
      } else if (normal.mode === 'share') {
        plotted = finite(value) && bucketTotal !== 0 ? value / bucketTotal : null;
      } else {
        plotted = finite(value) ? value : null;
      }
      plotValues[index][item.key] = plotted;
      tableValues[index][item.key] = plotted;
    }

    if (normal.stacked) {
      let carried = 0;
      for (const item of normal.series) {
        const value = plotValues[index][item.key];
        if (value === null) continue;
        carried += value;
        plotValues[index][item.key] = carried;
        if (normal.mode === 'absolute') tableValues[index][item.key] = finite(values[item.key]) ? values[item.key] : null;
      }
    }
  }

  const effectiveSeries = normal.mode === 'share'
    ? normal.series.map(item => ({ ...item, kind: 'percent', unit: '%' }))
    : normal.series;

  return {
    mode: normal.mode,
    type: normal.type,
    stacked: normal.stacked,
    spec: { ...normal, series: effectiveSeries },
    bands: normal.stacked ? stackBands(effectiveSeries.length) : [],
    rows: rows.map((row, index) => ({ ...row, values: plotValues[index], rawValues: row.values || {} })),
    tableRows: rows.map((row, index) => ({ ...row, values: tableValues[index], rawValues: row.values || {} }))
  };
}

/**
 * uPlot bands for stacked columns. Each series after the first is drawn from
 * the previous series' cumulative top, so the visible stack follows series
 * order and the last series sits on the zero line.
 */
export function stackBands(count = 0) {
  const bands = [];
  for (let seriesIndex = 2; seriesIndex <= count; seriesIndex += 1) {
    bands.push({ series: [seriesIndex, seriesIndex - 1] });
  }
  return bands;
}

export function visibleSeries(spec = {}, hidden = []) {
  const hiddenKeys = new Set(hidden);
  return normaliseSpec(spec).series.filter(item => !hiddenKeys.has(item.key));
}
