/**
 * OpenCode workflow soft signals — approximates Claude PostToolBatch via
 * tool.execute.after buffering and flush on message.updated / session.idle.
 *
 * Advisory only: never blocks the agent loop. Gate + log via Python helper.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import { mkdir, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import { fileURLToPath } from "node:url"
import path from "node:path"

type PendingCall = { tool: string; callID: string; title: string; output: string }

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

function defaultRepoRoot(ctxDir: string): string {
  return path.join(packageRoot(), "..", "..")
}

function flushHelperPath(): string {
  if (process.env.YAKKA_BATCH_FLUSH_CLI) {
    return process.env.YAKKA_BATCH_FLUSH_CLI
  }
  return path.join(packageRoot(), "python", "batch_flush_cli.py")
}

// Queue capture: one file per event in the shared queue, same name and envelope as packages/hooklog/spool.sh's queue branch
// (<conversation>-<ts>-<pid>-<rand>.evt, written under tmp/ then renamed); `python3 plugins/yakka/client/yakka.py drain` ingests it.
function queueDir(): string {
  return process.env.YAKKA_QUEUE || path.join(os.homedir(), ".local", "share", "yakka", "queue")
}

// package location: src/ -> package -> packages -> repo root
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
}

function spawnBin(args: string[]): void {
  try {
    const bin = process.env.YAKKA_BIN
    const child = bin
      ? spawn(bin, args, { detached: true, stdio: "ignore" })
      : args.length === 1 && args[0] === "drain"
        ? spawn("python3", [path.join(repoRoot(), "plugins", "yakka", "client", "yakka.py"), "drain"], { detached: true, stdio: "ignore" })
        : spawn("bash", [path.join(repoRoot(), "plugins", "yakka", "bin", "yakka"), ...args], { detached: true, stdio: "ignore" })
    child.on("error", () => {})
    child.unref()
  } catch {
    // advisory — never throw into the hook chain
  }
}

const kickEnabled = () => process.env.YAKKA_HOOKLOG_KICK !== "0"
let lastKick = 0

function kickDrain(): void {
  if (!kickEnabled()) return
  const now = Date.now()
  if (now - lastKick < 10_000) return
  lastKick = now
  spawnBin(["drain"])
}

let lastSpoolTs = 0

// Providers/config can contain cycles; capture a snapshot without touching live objects.
function snapshotOf(payload: Record<string, unknown>): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(payload, (_key, value) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  })
}

// Secret-bearing or redundant events are never forwarded. Mirrored by the Go policy; a test asserts equality.
// remove-list:begin
const REMOVE_EVENTS = ["experimental.chat.system.transform", "chat.params", "chat.headers", "shell.env", "message.part.delta", "message.part.updated", "session.status", "session.updated", "session.diff"] as const
// remove-list:end

// Events whose payload carries dead weight: OpenCode repeats the session's cumulative patches in
// info.summary.diffs on every update, and artifact versions and commits already cover them. The
// path is trimmed before spooling and again by the server. Mirrored by the Go policy; a test asserts equality.
// trim-list:begin
const TRIM_EVENTS = ["message.updated"] as const
// trim-list:end

// trimmed returns payload without event.properties.info.summary.diffs for a TRIM_EVENTS event. It
// copies the objects on that path rather than mutating the live event.
function trimmed(payload: Record<string, unknown>): Record<string, unknown> {
  if (!(TRIM_EVENTS as readonly string[]).includes(String(payload.hook_event_name || ""))) return payload
  const ev = payload.event as { properties?: { info?: { summary?: Record<string, unknown> } } } | undefined
  const summary = ev?.properties?.info?.summary
  if (!summary || typeof summary !== "object" || !("diffs" in summary)) return payload
  const { diffs: _diffs, ...rest } = summary
  return { ...payload, event: { ...ev, properties: { ...ev!.properties, info: { ...ev!.properties!.info, summary: rest } } } }
}

async function recordHooklog(payload: Record<string, unknown>): Promise<void> {
  if (/^(0|off|false)$/i.test(process.env.YAKKA_HOOKLOG || "")) return
  if ((REMOVE_EVENTS as readonly string[]).includes(String(payload.hook_event_name || ""))) return
  try {
    const sid = typeof payload.session_id === "string" ? payload.session_id.replace(/[^A-Za-z0-9._-]/g, "_") : ""
    if (!sid) return
    const snapshot = snapshotOf(trimmed(payload))
    // ts is when the hook fired and must stay strictly increasing: the drain orders and turn-counts by it.
    lastSpoolTs = Math.max(Date.now() / 1000, lastSpoolTs + 1e-6)
    const ts = lastSpoolTs.toFixed(6)
    const name = `${ts}-${process.pid}-${Math.floor(Math.random() * 32768)}`
    const dir = queueDir()
    await mkdir(path.join(dir, "tmp"), { recursive: true, mode: 0o700 })
    const tmp = path.join(dir, "tmp", name)
    const event = String(payload.hook_event_name || "").replace(/[^A-Za-z0-9._-]/g, "")
    await writeFile(tmp, `${JSON.stringify({ ts: Number(ts), harness: "opencode", event })}\n${snapshot}`, { mode: 0o600 })
    await rename(tmp, path.join(dir, `${sid}-${name}.evt`))
    kickDrain()
  } catch {
    // capture is advisory — never throw into the hook chain
  }
}

function flushBatch(sessionID: string, ctxDir: string, transcriptPath: string | undefined, pendingBySession: Map<string, PendingCall[]>) {
  const batch = pendingBySession.get(sessionID)
  if (!batch?.length) return
  pendingBySession.set(sessionID, [])

  const helper = flushHelperPath()
  const payload = {
    session_id: sessionID,
    transcript_path: transcriptPath || "",
    cwd: ctxDir,
    tool_calls: batch.map((c) => ({
      tool_name: c.tool,
      tool_use_id: c.callID,
      tool_input: {},
      tool_response: c.output.slice(0, 500),
    })),
  }

  const python = process.env.PYTHON || process.env.YAKKA_PYTHON || "python3"
  const env = {
    ...process.env,
    YAKKA_REPO_ROOT: process.env.YAKKA_REPO_ROOT || defaultRepoRoot(ctxDir),
    YAKKA_INSTALL_MODE: process.env.YAKKA_INSTALL_MODE || "opencode",
  }

  try {
    const child = spawn(python, [helper], {
      stdio: ["pipe", "ignore", "ignore"],
      env,
    })
    child.on("error", () => {})
    child.stdin?.on("error", () => {})
    const stdin = child.stdin
    if (stdin) {
      stdin.write(JSON.stringify(payload))
      stdin.end()
    }
  } catch {
    // advisory — never throw into hook chain
  }
}

// Session IDs live at different depths for message, part and session lifecycle events.
function sessionId(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (!value || typeof value !== "object") return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  const v = value as Record<string, unknown>
  for (const key of ["sessionID", "session_id"]) {
    if (typeof v[key] === "string") return v[key] as string
  }
  for (const key of ["properties", "part", "info", "message"]) {
    const nested = v[key] as Record<string, unknown> | undefined
    const found = sessionId(nested, seen)
    if (found) return found
    // Session objects use `id`; message/part IDs must never become session IDs.
    if (key === "info" && typeof nested?.id === "string" && nested.directory) return nested.id
  }
  return undefined
}

export const YakkaSignalsPlugin: Plugin = async (ctx) => {
  const enabled = process.env.YAKKA_OPENCODE_SIGNALS !== "0"
  const ctxDir = ctx.directory
  const pendingBySession = new Map<string, PendingCall[]>()
  const callsThisStep = new Map<string, string[]>()
  // Serial writes retain callback/marker order even when the bus dispatches concurrently.
  let writes = Promise.resolve()
  const record = (...payloads: Record<string, unknown>[]) => {
    writes = writes.then(async () => {
      for (const payload of payloads) await recordHooklog({ cwd: ctxDir, ...payload })
    }).catch(() => {})
    return writes
  }
  const observe = (name: string) => async (input?: unknown, output?: unknown) => {
    await record({ hook_event_name: name, session_id: sessionId(input) || sessionId(output),
                   source: "hook", input, output })
  }

  return {
    config: observe("config"),
    dispose: async () => {
      await observe("dispose")()
      pendingBySession.clear()
      callsThisStep.clear()
    },
    "chat.params": observe("chat.params"),
    "chat.headers": observe("chat.headers"),
    "permission.ask": observe("permission.ask"),
    "command.execute.before": observe("command.execute.before"),
    "tool.definition": observe("tool.definition"),
    "shell.env": observe("shell.env"),
    "experimental.chat.messages.transform": observe("experimental.chat.messages.transform"),
    "experimental.chat.system.transform": observe("experimental.chat.system.transform"),
    "experimental.session.compacting": observe("experimental.session.compacting"),
    "experimental.compaction.autocontinue": observe("experimental.compaction.autocontinue"),
    "experimental.provider.small_model": observe("experimental.provider.small_model"),
    "experimental.text.complete": async (input, output) => {
      await record({ hook_event_name: "experimental.text.complete", session_id: input.sessionID,
                     source: "hook", text: output.text, input, output })
    },
    "chat.message": async (input, output) => {
      const text = (output.parts || [])
        .filter((p: { type?: string }) => p.type === "text")
        .map((p: { text?: string }) => p.text || "")
        .join("\n")
      await record({ hook_event_name: "chat.message", session_id: input.sessionID,
                     source: "hook", prompt: text, input, output })
    },
    "tool.execute.before": async (input, output) => {
      await record({ hook_event_name: "tool.execute.before", session_id: input.sessionID,
                     source: "hook", tool_name: input.tool, tool_use_id: input.callID,
                     tool_input: output.args, input, output })
    },
    "tool.execute.after": async (input, output) => {
      const payload = {
        hook_event_name: "tool.execute.after", session_id: input.sessionID, source: "hook",
        tool_name: input.tool, tool_use_id: input.callID, tool_input: input.args ?? {},
        tool_response: output.output ?? output.title ?? "", input, output,
      }
      await record(payload)
      callsThisStep.set(input.sessionID, [...(callsThisStep.get(input.sessionID) || []), input.callID])
      if (!enabled) return
      const list = pendingBySession.get(input.sessionID) || []
      list.push({ tool: input.tool, callID: input.callID, title: output.title ?? "", output: output.output ?? "" })
      pendingBySession.set(input.sessionID, list)
    },
    event: async ({ event }) => {
      // Catch all 28 catalog bus types, plus future/undocumented types without a whitelist.
      const sid = sessionId(event)
      const rows: Record<string, unknown>[] = [{ hook_event_name: event.type, session_id: sid, source: "bus", event }]
      const e = event as { type: string; properties?: { part?: { type?: string } } }
      if (sid && e.type === "message.part.updated" && e.properties?.part?.type === "step-finish") {
        rows.push({ hook_event_name: "PostToolBatch", session_id: sid, source: "derived",
                       tool_calls: (callsThisStep.get(sid) || []).map((id) => ({ tool_use_id: id })) })
        callsThisStep.set(sid, [])
      } else if (sid && e.type === "session.idle") {
        rows.push({ hook_event_name: "Stop", session_id: sid, source: "derived" })
      }
      await record(...rows)  // queue derived markers before teardown can drain the queue
      if (enabled && sid && (event.type === "message.updated" || event.type === "session.idle")) {
        flushBatch(sid, ctxDir, undefined, pendingBySession)
      }
    },
  }
}

export default YakkaSignalsPlugin
