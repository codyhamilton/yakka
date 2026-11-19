import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const web = resolve(import.meta.dirname, '../web');
test('shell directly supports known routes and an in-shell not-found view', async () => {
  const app = await readFile(resolve(web, 'js/app.js'), 'utf8');
  for (const route of ['/plans', '/artifact', '/sessions', '/ledger', '/ops', '/login', '/oauth/callback', '/device', '/profile', '/settings']) assert.ok(app.includes(route));
  assert.match(app, /Not found/);
  assert.match(app, /dataset\.idle = 'true'/);
});
test('theme bootstrap is external and precedes styles and module app', async () => {
  const html = await readFile(resolve(web, 'index.html'), 'utf8');
  assert.ok(html.indexOf('/js/theme-bootstrap.js') < html.indexOf('/css/app.css'));
  assert.ok(html.indexOf('/js/theme-bootstrap.js') < html.indexOf('/js/app.js'));
  assert.doesNotMatch(html, /<script[^>]*>[^<]+/);
  const bootstrap = await readFile(resolve(web, 'js/theme-bootstrap.js'), 'utf8');
  assert.match(bootstrap, /dataset\.theme/);
});
test('static bundle contains no retired framework build files or secret literals', async () => {
  const rootFiles = await readdir(resolve(web));
  assert.ok(!rootFiles.includes('404.html'));
  const packageFiles = await readdir(resolve(web, '..'));
  for (const retired of ['package.json', 'package-lock.json', 'vite.config.ts', 'svelte.config.js', 'tsconfig.json', 'src']) assert.ok(!packageFiles.includes(retired), `${retired} remains in the package`);
  assert.ok(packageFiles.includes('wrangler.toml'));
  const all = [];
  async function visit(path) { for (const entry of await readdir(path, { withFileTypes: true })) { const full = resolve(path, entry.name); if (entry.isDirectory()) await visit(full); else all.push(full); } }
  await visit(web);
  const contents = await Promise.all(all.map(path => readFile(path, 'utf8').catch(() => '')));
  const text = contents.join('\n');
  assert.doesNotMatch(text, /Bearer\s+[A-Za-z0-9._-]{16,}/i);
  assert.doesNotMatch(text, /sveltekit|vite\.config|npm run build/i);
});
