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
  return (
    command === 'feedback' ||
    command.startsWith('feedback ') ||
    command.startsWith('hook ') ||
    command === 'hook'
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

type Store = Record<string, LastCommand>

function readStore(file: string): Store {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Store)
      : {}
  } catch {
    return {}
  }
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
    store[sessionKey(env)] = entry
    const kept = Object.entries(store)
      .sort(([, a], [, b]) => (a.at < b.at ? 1 : -1))
      .slice(0, MAX_KEYS)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(kept)), {
      mode: 0o600,
    })
  } catch {
    // Recording is best-effort.
  }
}

/** This session's last command, or null when none / too old / malformed. */
export function readLastCommand(
  env: EnvLike = process.env,
  now: Date = new Date()
): LastCommand | null {
  const entry = readStore(path.join(configDir(env), FILE))[sessionKey(env)]
  if (!entry || typeof entry !== 'object') return null
  const at = Date.parse(entry.at)
  if (Number.isNaN(at) || now.getTime() - at > LAST_COMMAND_MAX_AGE_MS)
    return null
  // Re-validate: the file is local and could have been edited.
  return buildLastCommand(
    typeof entry.command === 'string' ? entry.command : null,
    Array.isArray(entry.flags)
      ? entry.flags.filter(f => typeof f === 'string')
      : [],
    typeof entry.exitCode === 'number' ? entry.exitCode : 0,
    new Date(at)
  )
}
