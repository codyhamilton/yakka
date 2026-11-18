// Two release-matrix origins, both local and temporary.
//
// - `static`: the existing Pages-style harness serves web/ with the committed
//   first-party stub API. Its origin is all the matrix needs.
// - `embedded`: `tools/release/build.sh` embeds web/ into a local binary; the
//   binary serves those assets from its embedded filesystem. Its origin is
//   handed to the shared harness through YAKKA_RELEASE_STATIC_ORIGIN, which
//   proxies static reads while keeping the deterministic stub API local.
//
// Nothing here deploys, reads a tenant, or writes outside the worktree.

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../../../..');

export function scratchRoot() {
  const raw = process.env.TMPDIR || '.scratch/p13';
  const dir = resolve(repoRoot, raw);
  if (dir === '/tmp' || dir.startsWith('/tmp/')) throw new Error(`release-matrix scratch must stay in the worktree, got ${dir}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function hostTriple() {
  const os = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!arch) throw new Error(`release-matrix: unsupported arch ${process.arch}`);
  return `yakka-${os}-${arch}`;
}

export function binaryPath() {
  return join(scratchRoot(), 'release', 'dist', hostTriple());
}

// Builds once into the ignored scratch tree. build.sh restores the committed
// placeholder on exit, so the tracked tree is unchanged either way.
export function buildReleaseBinary() {
  const bin = binaryPath();
  if (existsSync(bin)) return bin;
  const scratch = scratchRoot();
  const dist = join(scratch, 'release', 'dist');
  mkdirSync(dist, { recursive: true });
  execFileSync('bash', [join(repoRoot, 'tools/release/build.sh')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      TMPDIR: scratch,
      OUT_DIR: dist,
      SUMS_FILE: join(scratch, 'release', 'SHA256SUMS'),
      GOTOOLCHAIN: 'auto'
    }
  });
  if (!existsSync(bin)) throw new Error(`build.sh did not produce ${bin}`);
  return bin;
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

// Starts the embedded binary in local mode over a temporary data directory.
// The directory is the throwaway local tenant; the API itself is not used by
// the browser matrix, which keeps the deterministic stub.
export async function startEmbeddedBinary() {
  const bin = buildReleaseBinary();
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const data = join(scratchRoot(), 'release', `data-${process.pid}-${port}`);
  rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  const child = spawn(bin, ['serve'], {
    cwd: repoRoot,
    stdio: 'ignore',
    env: {
      ...process.env,
      YAKKA_SERVE_ADDR: `127.0.0.1:${port}`,
      YAKKA_SERVE_DATA: data,
      YAKKA_CHECKS_DIR: join(repoRoot, 'packages/yakka/catalogue'),
      TYPESAFE_API_KEY: ''
    }
  });
  const stop = () => {
    child.kill('SIGTERM');
    rmSync(data, { recursive: true, force: true });
  };
  try {
    let up = false;
    for (let i = 0; i < 200 && !up; i += 1) {
      if (child.exitCode !== null) throw new Error(`embedded binary exited early (${child.exitCode})`);
      try { up = (await fetch(`${origin}/v1/health`)).ok; } catch { /* not listening yet */ }
      if (!up) await new Promise(done => setTimeout(done, 100));
    }
    if (!up) throw new Error(`embedded binary at ${origin} never became healthy`);
    const index = await fetch(`${origin}/`);
    const app = await fetch(`${origin}/js/app.js`);
    if (!index.ok || !/text\/html/.test(index.headers.get('content-type') || '')) {
      throw new Error(`embedded binary does not serve index.html (${index.status})`);
    }
    if (!app.ok) throw new Error(`embedded binary does not serve js/app.js (${app.status})`);
    return { origin, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
