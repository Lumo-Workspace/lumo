import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/** Environment variables (a plain record, so tests can pass a literal). */
type EnvLike = Record<string, string | undefined>

/**
 * LUM-1240 — the last `lumo` command this agent session ran and how it
 * exited, so `lumo feedback create` (a separate process) can say which
 * command misbehaved.
 *
 * PRIVACY RED LINE: only the command PATH (`task testcase run`) and the NAMES
 * of the flags the caller gave (`--evidence-file`) are kept — never a flag's
 * value, a positional argument, the cwd or anything else from argv. Values
 * carry titles, file paths and sometimes secrets.
 *
 * Stored in `<config dir>/last-command.json`, one entry per agent session
 * (Claude Code / Codex session id, `_default` outside one) so parallel
 * sessions do not overwrite each other; at most {@link MAX_KEYS} entries.
 * Any failure is swallowed — recording must never change a command's exit.
 *
 * Each session keeps two slots: the last command, and the last one that
 * FAILED. Every run overwrites `last`, but only a failing run overwrites
 * `failed` — so the `lumo task show` or `lumo doctor` an agent runs after a
 * failure, before filing, does not hide the command that misbehaved.
 * `readLastCommand` prefers a failure from the last hour.
 */

export interface LastCommand {
  command: string
  flags: string[]
  exitCode: number
  /** ISO 8601 UTC. */
  at: string
}

/** Entries older than this are not sent with feedback. */
export const LAST_COMMAND_MAX_AGE_MS = 60 * 60_000
export const MAX_KEYS = 20
const FILE = 'last-command.json'
const DEFAULT_KEY = '_default'

/** Same shapes the server accepts (lib/validation/feedback.ts). */
const COMMAND_PATH_RE = /^[a-z][a-z-]*( [a-z][a-z-]*){0,3}$/
const FLAG_NAME_RE = /^--[a-z][a-z0-9-]{0,40}$/

/** Commands never recorded: they would hide the command that failed. */
function skipped(command: string): boolean {
  return ['feedback', 'staff', 'hook'].some(
    noun => command === noun || command.startsWith(`${noun} `)
  )
}

function configDir(env: EnvLike): string {
  return env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
}

/** The per-session key: Codex thread/session, Claude Code session, or `_default`. */
export function sessionKey(env: EnvLike = process.env): string {
  return (
    env.CODEX_THREAD_ID ||
    env.CODEX_SESSION_ID ||
    env.CLAUDE_CODE_SESSION_ID ||
    DEFAULT_KEY
  ).slice(0, 128)
}

/**
 * The entry to store for one run, or null when it must not be recorded.
 * `flags` are option long names; anything not shaped like a flag name is
 * dropped (so a value can never slip in).
 */
export function buildLastCommand(
  command: string | null,
  flags: readonly string[],
  exitCode: number,
  now: Date
): LastCommand | null {
  if (!command || !COMMAND_PATH_RE.test(command) || skipped(command))
    return null
  const names = [...new Set(flags.filter(f => FLAG_NAME_RE.test(f)))].slice(
    0,
    30
  )
  return {
    command,
    flags: names,
    exitCode: Math.max(0, Math.min(255, Math.trunc(exitCode))),
    at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
}

/** One session's slots. */
export interface SessionRecord {
  last: LastCommand
  /** The most recent run that exited non-zero, if any. */
  failed?: LastCommand
}

type Store = Record<string, SessionRecord>

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** A stored session value; a pre-split file held the bare entry. */
function toRecord(v: unknown): SessionRecord | null {
  if (!isObject(v)) return null
  if (isObject(v.last)) return v as unknown as SessionRecord
  if (typeof v.command === 'string') {
    const entry = v as unknown as LastCommand
    // Only a recorded non-zero exit is a failure (a malformed entry is not).
    return typeof entry.exitCode === 'number' && entry.exitCode !== 0
      ? { last: entry, failed: entry }
      : { last: entry }
  }
  return null
}

function readStore(file: string): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!isObject(parsed)) return {}
    const store: Store = {}
    for (const [key, value] of Object.entries(parsed)) {
      const record = toRecord(value)
      if (record) store[key] = record
    }
    return store
  } catch {
    return {}
  }
}

/** The next record for a session after `entry` ran. */
export function nextRecord(
  prev: SessionRecord | undefined,
  entry: LastCommand
): SessionRecord {
  const failed = entry.exitCode !== 0 ? entry : prev?.failed
  return failed ? { last: entry, failed } : { last: entry }
}

/** Record one run. Never throws. */
export function recordLastCommand(
  entry: LastCommand | null,
  env: EnvLike = process.env
): void {
  if (!entry) return
  try {
    const dir = configDir(env)
    const file = path.join(dir, FILE)
    const store = readStore(file)
    const key = sessionKey(env)
    store[key] = nextRecord(store[key], entry)
    const kept = Object.entries(store)
      .sort(([, a], [, b]) => (a.last.at < b.last.at ? 1 : -1))
      .slice(0, MAX_KEYS)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(kept)), {
      mode: 0o600,
    })
  } catch {
    // Recording is best-effort.
  }
}

/** One stored entry, re-validated; null when too old or malformed. */
function fresh(entry: unknown, now: Date): LastCommand | null {
  if (!isObject(entry) || typeof entry.at !== 'string') return null
  const at = Date.parse(entry.at)
  if (Number.isNaN(at) || now.getTime() - at > LAST_COMMAND_MAX_AGE_MS)
    return null
  // Re-validate: the file is local and could have been edited.
  return buildLastCommand(
    typeof entry.command === 'string' ? entry.command : null,
    Array.isArray(entry.flags)
      ? entry.flags.filter((f): f is string => typeof f === 'string')
      : [],
    typeof entry.exitCode === 'number' ? entry.exitCode : 0,
    new Date(at)
  )
}

/**
 * The command to report for this session: its last failure within the hour,
 * else its last command within the hour, else null.
 */
export function readLastCommand(
  env: EnvLike = process.env,
  now: Date = new Date()
): LastCommand | null {
  const record = readStore(path.join(configDir(env), FILE))[sessionKey(env)]
  if (!record) return null
  return fresh(record.failed, now) ?? fresh(record.last, now)
}
