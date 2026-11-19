// One cached loader for the chart kit's stylesheets. The CSS is fetched from
// the page origin and becomes a constructable stylesheet adopted by every
// chart's shadow root; no <style> element and no style= attribute is created.

export const STYLE_SOURCES = ['/css/charts.css', '/vendor/uplot-1.6.32/uPlot.min.css'];

let cached = null;

export function resetChartStyles() {
  cached = null;
}

export function loadChartStyles({ fetchImpl = globalThis.fetch, base = '' } = {}) {
  if (cached) return cached;
  cached = (async () => {
    const texts = await Promise.all(STYLE_SOURCES.map(async source => {
      const response = await fetchImpl(`${base}${source}`);
      if (!response.ok) throw new Error(`chart stylesheet ${source} returned ${response.status}`);
      return response.text();
    }));
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(texts.join('\n'));
    return sheet;
  })().catch(error => {
    cached = null;
    throw error;
  });
  return cached;
}

export async function adoptChartStyles(root, options = {}) {
  if (!root) return null;
  const sheet = await loadChartStyles(options);
  const current = root.adoptedStyleSheets ? [...root.adoptedStyleSheets] : [];
  if (!current.includes(sheet)) root.adoptedStyleSheets = [...current, sheet];
  return sheet;
}

export function readTheme(doc = globalThis.document) {
  return doc?.documentElement?.dataset.theme || 'light';
}

export function readToken(element, name) {
  if (!element) return '';
  return getComputedStyle(element).getPropertyValue(name).trim();
}

export function watchTheme(callback, { doc = globalThis.document } = {}) {
  if (!doc || typeof MutationObserver === 'undefined') return () => {};
  const observer = new MutationObserver(() => callback(readTheme(doc)));
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
