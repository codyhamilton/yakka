import { decodeUrlState, encodeUrlState } from '../contract/url-state.js';
import { createScheduler } from './core/request-scheduler.js';
import { createTransport } from '../contract/transport.js';
import { legacyErrorMessage } from './core/legacy-error.js';

const root = document.querySelector('#app');
const scheduler = createScheduler({ onChange: ({ inFlight }) => {
  const status = document.querySelector('#request-status');
  status.dataset.inflight = String(inFlight);
  status.textContent = `${inFlight} requests in flight`;
} });
const transport = createTransport(scheduler);
const routeNames = new Map([
  ['/', 'Start'], ['/plans', 'Plans'], ['/artifact', 'Artifact'], ['/sessions', 'Sessions'], ['/ledger', 'Ledger'], ['/ops', 'Operations'],
  ['/login', 'Sign in'], ['/oauth/callback', 'Sign in callback'], ['/device', 'Device approval'], ['/profile', 'Profile'], ['/settings', 'Settings']
]);
const routeTitle = path => routeNames.get(path) || (/^\/b\/(pulse|trends|compare|scatter|quality|cost|tools|workflow)$/.test(path) ? `${path.slice(3,4).toUpperCase()}${path.slice(4)} board` : /^\/plans\/[^/]+\/[^/]+$/.test(path) || /^\/sessions\/[^/]+$/.test(path) ? 'Details' : '');
function render() {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const title = routeTitle(path);
  const state = decodeUrlState(location.search);
  root.replaceChildren();
  root.dataset.state = 'ready';
  root.dataset.idle = 'true';
  root.dataset.route = path;
  const heading = document.createElement('h1'); heading.textContent = title || 'Not found'; root.append(heading);
  if (!title) {
    const message = document.createElement('p'); message.textContent = `No workspace route matches ${path}.`; root.append(message);
  } else if (path === '/') {
    const intro = document.createElement('p'); intro.textContent = 'Explore the analytics supported by this server. Available views follow its capability schema.'; root.append(intro);
    const links = document.createElement('p');
    for (const [index, [label, href]] of [['Pulse', '/b/pulse'], ['Trends', '/b/trends'], ['Quality', '/b/quality'], ['Cost', '/b/cost']].entries()) {
      if (index) links.append(document.createTextNode(' · '));
      const link = document.createElement('a'); link.textContent = label; link.href = href; links.append(link);
    }
    root.append(links);
  } else {
    const notice = document.createElement('p'); notice.className = 'muted'; notice.textContent = 'This destination is part of the workspace shell. Its view is delivered in a later phase.'; root.append(notice);
  }
  const current = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'URL scope';
  const scope = document.createElement('code'); scope.textContent = encodeUrlState(state, location.search).toString() || 'win=30d';
  current.append(summary, scope); root.append(current);
}
document.querySelector('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.documentElement.dataset.themePreference = next;
  try { localStorage.setItem('yakka-analytics-theme', next); } catch {}
});
addEventListener('popstate', render);
render();
transport.schema().then(({ response, body }) => {
  const node = document.querySelector('#schema-status');
  if (!response.ok) { node.textContent = legacyErrorMessage(body); return; }
  node.textContent = `${Object.keys(body.features || {}).length} server capabilities detected`;
}).catch(() => { document.querySelector('#schema-status').textContent = 'Server capabilities unavailable; unsupported views stay unavailable.'; });
