import {
  ColourRegistry, COHORTS, FIXED_KEYS, FIXED_NEUTRALS, HUES, STATUS, STORAGE_KEY, memoryStorage, paletteReport
} from '/js/charts/colour-registry.js';
import { badgeModel, createBadges } from '/js/charts/badges.js';
import { createLegend } from '/js/charts/legend.js';
import { createTable } from '/js/charts/table.js';
import { createTooltip, tooltipModel } from '/js/charts/tooltip.js';
import { adoptChartStyles, readToken, readTheme } from '/js/charts/styles.js';
import {
  BADGE_META, ENTITY_KEYS, SERIES, foundationsSpec, timeSeries
} from '/gallery/fixture.js';

const output = document.getElementById('intent-log');
function logIntent(detail) {
  output.dataset.lastIntent = JSON.stringify(detail);
  output.textContent = JSON.stringify(detail);
}

function makeSwatch({ cssVar, shape, pattern, label }) {
  const element = document.createElement('span');
  element.className = 'yk-swatch';
  element.dataset.token = cssVar;
  element.dataset.shape = shape || 'circle';
  if (pattern) element.dataset.pattern = pattern;
  element.style.setProperty('--yk-swatch', `var(${cssVar})`);
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label);
  element.title = label;
  return element;
}

function renderSwatches(id, styles) {
  const host = document.getElementById(id);
  host.replaceChildren(...styles.map(makeSwatch));
}

renderSwatches('hue-swatches', HUES.map(hue => ({ cssVar: hue.cssVar, shape: hue.shape, label: hue.name })));
renderSwatches('neutral-swatches', Object.values(FIXED_NEUTRALS).map(style => ({ cssVar: style.cssVar, shape: style.shape, pattern: style.pattern, label: style.label })));
renderSwatches('cohort-swatches', Object.values(COHORTS).map(style => ({ cssVar: style.cssVar, shape: style.shape, label: style.label })));
renderSwatches('status-swatches', Object.values(STATUS).map(style => ({ cssVar: style.cssVar, shape: 'circle', label: style.label })));

let storage;
try { storage = window.localStorage; } catch { storage = memoryStorage(); }
const registry = new ColourRegistry({ storage });
registry.register(ENTITY_KEYS);
document.getElementById('registry-key').textContent = `${STORAGE_KEY}: ${JSON.stringify(registry.toJSON())}`;

function slotRank(slot) {
  if (!slot) return 1e9;
  const hue = /^h(\d+)$/.exec(slot);
  if (hue) return Number(hue[1]);
  const neutral = /^n(\d+)$/.exec(slot);
  if (neutral) return 1000 + Number(neutral[1]);
  return 2000;
}

const registryHost = document.getElementById('registry-swatches');
const registryRows = ENTITY_KEYS
  .map(key => ({ key, style: registry.style(key) }))
  .sort((a, b) => slotRank(a.style.slot) - slotRank(b.style.slot));
registryHost.replaceChildren(...registryRows.map(({ key, style }) => {
  const item = document.createElement('span');
  item.className = 'yk-registry-item';
  item.dataset.key = key;
  item.dataset.slot = style.slot || '';
  item.append(makeSwatch({ cssVar: style.cssVar, shape: style.shape, pattern: style.pattern, label: `${key} (${style.label})` }));
  const label = document.createElement('span');
  label.textContent = key;
  item.append(label);
  return item;
}));

const tooltip = createTooltip(document);
document.body.append(tooltip.element);
const rows = timeSeries({ points: 8 });
const tooltipSpec = {
  series: SERIES.map(series => ({ ...series, ...registry.style(series.key) }))
};

function showTooltip(key, x, y) {
  const row = rows[0];
  const model = tooltipModel({
    spec: tooltipSpec,
    datum: { ...row, key, label: key, coverage: BADGE_META.coverage },
    key
  });
  tooltip.show(model, { x, y });
}

const hitgrid = document.getElementById('hitgrid');
for (const key of ENTITY_KEYS.slice(0, 6)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'yk-hit-target';
  button.dataset.key = key;
  button.textContent = key;
  const show = event => {
    const rect = button.getBoundingClientRect();
    showTooltip(key, event?.clientX ?? rect.left + 8, event?.clientY ?? rect.top + 8);
  };
  button.addEventListener('pointermove', show);
  button.addEventListener('focus', show);
  hitgrid.append(button);
}

const legend = createLegend(document, {
  series: SERIES.map(series => ({ ...series, ...registry.style(series.key) })),
  onIntent: logIntent
});
document.getElementById('legend-host').append(legend.element);

const badges = createBadges(document, badgeModel(BADGE_META));
document.getElementById('badges-host').append(badges.element);

const table = createTable(document, {
  spec: foundationsSpec(),
  data: rows,
  onSelect: logIntent
});
document.getElementById('table-host').append(table.element);

const themeSwitch = document.getElementById('theme-switch');
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeSwitch.setAttribute('aria-pressed', dark ? 'true' : 'false');
  themeSwitch.textContent = dark ? 'Switch to light theme' : 'Switch to dark theme';
  document.documentElement.dataset.themeName = theme;
}
themeSwitch.addEventListener('click', () => setTheme(readTheme(document) === 'dark' ? 'light' : 'dark'));

window.__foundations = {
  registry,
  tooltip,
  legend,
  badges,
  table,
  setTheme,
  readToken,
  palette: paletteReport(),
  spec: foundationsSpec()
};

const shadowHost = document.getElementById('shadow-host');
const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
try {
  await adoptChartStyles(shadowRoot);
  const probe = document.createElement('div');
  probe.className = 'yk-chart';
  probe.dataset.chart = 'shadow-probe';
  probe.dataset.state = 'ready';
  const swatch = document.createElement('span');
  swatch.className = 'yk-swatch';
  swatch.dataset.token = '--yk-cat-1';
  probe.append(swatch);
  shadowRoot.append(probe);
} catch (error) {
  console.error('foundations: chart stylesheet failed', error);
} finally {
  document.documentElement.dataset.idle = 'true';
}
