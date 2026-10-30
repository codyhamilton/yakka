import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import plugin from '../src/index.ts'

const named = 'event config dispose chat.message chat.params chat.headers permission.ask command.execute.before tool.execute.before tool.execute.after tool.definition shell.env experimental.chat.messages.transform experimental.chat.system.transform experimental.session.compacting experimental.compaction.autocontinue experimental.text.complete experimental.provider.small_model'.split(' ')
const bus = 'command.executed file.edited file.watcher.updated installation.updated lsp.client.diagnostics lsp.updated message.part.removed message.part.updated message.removed message.updated permission.asked permission.replied server.connected session.created session.compacted session.deleted session.diff session.error session.idle session.status session.updated todo.updated shell.env tool.execute.before tool.execute.after tui.prompt.append tui.command.execute tui.toast.show'.split(' ')
const removed = ['experimental.chat.system.transform', 'chat.params', 'chat.headers', 'shell.env', 'message.part.delta']
const spoolSh = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'hooklog', 'spool.sh')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Isolated env: temp HOME/queue/cache, stub YAKKA_BIN that records its args, no keys.
async function sandbox(extra = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'workflow-hooks-'))
  const saved = { ...process.env }
  const stub = path.join(tmp, 'stub.sh')
  const log = path.join(tmp, 'stub.log')
  await writeFile(stub, `#!/bin/sh\necho "$@" >> ${log}\n`)
  await chmod(stub, 0o755)
  Object.assign(process.env, {
    HOME: tmp, XDG_CACHE_HOME: path.join(tmp, 'cache'), YAKKA_QUEUE: path.join(tmp, 'queue'),
    YAKKA_BIN: stub, YAKKA_HOOKLOG: 'on', YAKKA_OPENCODE_SIGNALS: '0',
    YAKKA_HOOKLOG_KICK: '0', TYPESAFE_API_KEY: '', ...extra,
  })
  const calls = async () => { try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean) } catch { return [] } }
  const done = async () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
    await rm(tmp, { recursive: true, force: true })
  }
  return { tmp, queue: path.join(tmp, 'queue'), calls, done }
}
const evts = async (q) => (await readdir(q).catch(() => [])).filter(n => n.endsWith('.evt'))
const read = async (q, n) => { const [head, ...rest] = (await readFile(path.join(q, n), 'utf8')).split('\n'); return [JSON.parse(head), JSON.parse(rest.join('\n'))] }

test('18 callbacks and 28 bus types queue payloads, sessions and boundaries', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    assert.deepEqual(Object.keys(hooks).sort(), named.sort())
    const input = { sessionID: 's', tool: 'read', callID: 't', args: { path: 'a' } }
    const output = { status: 'ask', args: { path: 'a' }, parts: [{ type: 'text', text: 'prompt' }],
                     text: 'answer', output: 'result', title: 'read a', headers: { Authorization: 'x' },
                     env: { TOKEN: 'x' }, enabled: true }
    const hookNames = named.filter(n => !['event', 'dispose'].includes(n))
    for (const name of hookNames) {
      const before = JSON.stringify({ input, output })
      await hooks[name](input, output)
      assert.equal(JSON.stringify({ input, output }), before, name)
    }
    for (const type of bus) await hooks.event({ event: { type, properties: { info: { id: 's', directory: '/tmp/project' } } } })
    await hooks.event({ event: { type: 'message.part.updated', properties: { part: { id: 'part', sessionID: 's', type: 'step-finish' } } } })
    const cyclic = { sessionID: 's' }
    cyclic.properties = cyclic
    await hooks['chat.params'](cyclic, output)
    const idle = hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's' } } })
    await hooks.dispose()
    await idle
    const rows = []
    for (const n of await evts(sb.queue)) rows.push(await read(sb.queue, n))
    assert(rows.every(([env]) => env.harness === 'opencode'))
    assert(rows.every(([env]) => !removed.includes(env.event)))
    const hookEvents = new Set(rows.filter(([, p]) => p.source === 'hook').map(([env]) => env.event))
    assert.deepEqual(hookEvents, new Set(hookNames.filter(n => !removed.includes(n))))
    const busEvents = new Set(rows.filter(([, p]) => p.source === 'bus').map(([env]) => env.event))
    assert.deepEqual(busEvents, new Set(bus.filter(n => !removed.includes(n))))
    assert(rows.some(([env]) => env.event === 'PostToolBatch'))
    assert(rows.some(([env]) => env.event === 'Stop'))
    const ts = rows.map(([env]) => env.ts)
    assert(ts.every(t => typeof t === 'number'))
    // unwritable queue cannot throw into the hook chain
    await writeFile(path.join(sb.tmp, 'file'), 'x')
    process.env.YAKKA_QUEUE = path.join(sb.tmp, 'file')
    await hooks['permission.ask'](input, output)
    assert.equal(output.status, 'ask')
  } finally { await sb.done() }
})

test('tool.execute.after writes one queue file named like spool.sh with the opencode envelope', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    await hooks['tool.execute.after']({ sessionID: 'ses/odd id', tool: 'write', callID: 'c1', args: { filePath: 'a.md' } }, { output: 'ok', title: 'w' })
    const names = await evts(sb.queue)
    assert.equal(names.length, 1)
    assert.match(names[0], /^ses_odd_id-\d+\.\d+-\d+-\d+\.evt$/)
    const [env, payload] = await read(sb.queue, names[0])
    assert.deepEqual(Object.keys(env), ['ts', 'harness', 'event'])
    assert.equal(env.harness, 'opencode')
    assert.equal(env.event, 'tool.execute.after')
    assert.equal(payload.tool_name, 'write')
    assert.equal(payload.tool_input.filePath, 'a.md')
    assert.equal((await readdir(path.join(sb.queue, 'tmp'))).length, 0)

    // spool.sh, same id, into a second queue: same prefix and envelope keys
    const q2 = path.join(sb.tmp, 'queue2')
    execFileSync('bash', [spoolSh, '--harness', 'opencode', '--event', 'tool.execute.after'], {
      input: JSON.stringify({ session_id: 'ses/odd id' }),
      env: { ...process.env, YAKKA_QUEUE: q2, YAKKA_HOOKLOG_KICK: '0' },
    })
    const ref = await evts(q2)
    assert.equal(ref.length, 1)
    assert.equal(ref[0].split('-')[0], names[0].split('-')[0])
    assert.match(ref[0], /^ses_odd_id-\d+\.\d+-\d+-\d+\.evt$/)
    const [refEnv] = await read(q2, ref[0]).catch(async () => [JSON.parse((await readFile(path.join(q2, ref[0]), 'utf8')).split('\n')[0])])
    assert.deepEqual(Object.keys(refEnv), Object.keys(env))
  } finally { await sb.done() }
})

test('a record without a sessionID is dropped', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    await hooks.event({ event: { type: 'server.connected', properties: {} } })
    await hooks.config({}, {})
    assert.equal((await evts(sb.queue)).length, 0)
  } finally { await sb.done() }
})

test('message.part.delta queues nothing while message.part.updated still queues', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    await hooks.event({ event: { type: 'message.part.delta', properties: { sessionID: 's', partID: 'p', field: 'text', delta: 'hi' } } })
    assert.equal((await evts(sb.queue)).length, 0)
    await hooks.event({ event: { type: 'message.part.updated', properties: { part: { id: 'part', sessionID: 's', type: 'text' } } } })
    const names = await evts(sb.queue)
    assert.equal(names.length, 1)
    const [env] = await read(sb.queue, names[0])
    assert.equal(env.event, 'message.part.updated')
  } finally { await sb.done() }
})

test('kick runs YAKKA_BIN drain at most once per 10 s', async () => {
  const sb = await sandbox({ YAKKA_HOOKLOG_KICK: '1' })
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    const ev = { sessionID: 'k', tool: 'write', callID: 'c', args: {} }
    await hooks['tool.execute.after'](ev, { output: 'a' })
    await hooks['tool.execute.after'](ev, { output: 'b' })
    for (let i = 0; i < 50 && (await sb.calls()).length < 1; i++) await sleep(100)
    const calls = await sb.calls()
    assert.equal(calls.filter(c => c === 'drain').length, 1, calls.join('|'))
    assert.equal(calls.filter(c => c === '--version').length, 0, calls.join('|'))
  } finally { await sb.done() }
})

test('KICK=0 disables kick', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    await hooks['tool.execute.after']({ sessionID: 'k', tool: 'write', callID: 'c', args: {} }, { output: 'a' })
    await sleep(400)
    assert.deepEqual(await sb.calls(), [])
  } finally { await sb.done() }
})

test('no legacy submit helper spawn under any event', async () => {
  const sb = await sandbox({ YAKKA_LEGACY: '1' })
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    const output = { title: 'written', output: 'preserved' }
    await hooks['tool.execute.after']({ sessionID: 'a', tool: 'write', callID: 'w', args: { filePath: 'docs/plans/x/DESIGN.md' } }, output)
    assert.equal(output.output, 'preserved')
    const [, payload] = await read(sb.queue, (await evts(sb.queue))[0])
    assert.equal(payload.tool_name, 'write')
    assert.deepEqual(await sb.calls(), [])
    const src = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')
    assert(!/artifact.submit|runPythonHook/i.test(src))
  } finally { await sb.done() }
})

test('remove list block in src/index.ts is the stable source for the Go equality test', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')
  const m = src.match(/\/\/ remove-list:begin\n([\s\S]*?)\/\/ remove-list:end/)
  assert(m, 'markers present')
  assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]), removed)
})

test('message.updated is spooled without info.summary.diffs and the live event is untouched', async () => {
  const sb = await sandbox()
  try {
    const hooks = await plugin({ directory: '/tmp/project' })
    const diffs = [{ file: 'a.ts', patch: 'x'.repeat(1000) }]
    const event = { type: 'message.updated', properties: { info: { id: 'm', sessionID: 's', summary: { title: 't', diffs } } } }
    await hooks.event({ event })
    assert.equal(event.properties.info.summary.diffs, diffs)
    const rows = []
    for (const n of await evts(sb.queue)) rows.push(await read(sb.queue, n))
    const [env, payload] = rows.find(([e]) => e.event === 'message.updated')
    assert.equal(env.harness, 'opencode')
    assert.deepEqual(payload.event.properties.info.summary, { title: 't' })
    assert.equal(payload.event.properties.info.id, 'm')
  } finally { await sb.done() }
})

test('trim list block in src/index.ts is the stable source for the Go equality test', () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.ts'), 'utf8')
  const m = src.match(/\/\/ trim-list:begin\n([\s\S]*?)\/\/ trim-list:end/)
  assert(m, 'markers present')
  assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]), ['message.updated'])
})

test('unset YAKKA_BIN drain kick spawns python3 on the client script', async () => {
  await sleep(10_100) // spawnBin kickDrain shares a 10 s module cooldown with earlier tests
  const sb = await sandbox({ YAKKA_HOOKLOG_KICK: '1' })
  try {
    const pyBin = path.join(sb.tmp, 'bin')
    const pyLog = path.join(sb.tmp, 'py.log')
    await mkdir(pyBin, { recursive: true })
    const fakePy = path.join(pyBin, 'python3')
    await writeFile(fakePy, `#!/bin/sh\necho "$@" >> ${pyLog}\n`)
    await chmod(fakePy, 0o755)
    delete process.env.YAKKA_BIN
    process.env.PATH = `${pyBin}${path.delimiter}${process.env.PATH || ''}`
    const hooks = await plugin({ directory: '/tmp/project' })
    await hooks['tool.execute.after']({ sessionID: 'k', tool: 'write', callID: 'c', args: {} }, { output: 'a' })
    let line = ''
    for (let i = 0; i < 50; i++) {
      line = await readFile(pyLog, 'utf8').catch(() => '')
      if (line) break
      await sleep(100)
    }
    assert.match(line, /plugins\/yakka\/client\/yakka\.py/)
    assert.match(line, /\bdrain\b/)
  } finally { await sb.done() }
})
