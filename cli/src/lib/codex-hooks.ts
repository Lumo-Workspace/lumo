import * as fs from 'fs'
import * as path from 'path'
import { CODEX_HOOK_EVENTS, isLumoHookCommand } from './hooks-template'
import { resolveInstallRoot } from './repo-root'

/**
 * LUM-1051: Codex runs a hook only after the user trusts it — per entry, in
 * the desktop app's Hooks settings or `/hooks` in the CLI — and re-asks after
 * the entry changes. An untrusted hook is skipped silently (no error, no
 * prompt), so Lumo looks installed while recording nothing. The hook commands
 * are kept byte-stable (`lumo hook <slug> --agent codex`) so a CLI upgrade
 * never re-triggers the review.
 */

/** Where `lumo init` writes Codex hooks: `<root>/.codex/hooks.json`. */
export function codexHooksPath(root: string): string {
  return path.join(root, '.codex', 'hooks.json')
}

/** Printed by setup after writing the hooks, and by the self-check below. */
export function codexTrustInstructions(hooksPath: string): string {
  return (
    `⚠ Codex runs these hooks only after you trust them — until then Lumo records nothing, silently.\n` +
    `  Codex app: Settings → Hooks → Trust each "lumo hook …" entry. Codex CLI: run /hooks and trust them.\n` +
    `  (File: ${hooksPath}. Editing an entry asks for trust again.)`
  )
}

/**
 * The self-check: a Codex session whose hooks run has events on the server by
 * the time any `lumo` command runs (the command's own PreToolUse fired first).
 * Zero events → the hooks are not installed or not trusted.
 */
export function codexHooksSilentWarning(): string {
  return (
    'lumo: no hook events have reached Lumo from this Codex session — its Lumo hooks are not installed or not trusted yet.\n' +
    '  Run `lumo init --agent codex`, then trust the "lumo hook …" entries (Codex app: Settings → Hooks; Codex CLI: /hooks).\n' +
    '  Until then this session is not recorded (no timeline, boundary checks or token usage).'
  )
}

/** PreToolUse -> pre_tool_use, the form Codex uses in config.toml keys. */
export function codexEventKey(event: string): string {
  return event.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Snake-case events that have a `[hooks.state."<hooksJson>:<event>:…"]`
 * section carrying a `trusted_hash` line. Plain text scan — no TOML parser,
 * and the hash itself is not verified.
 */
export function codexTrustedEvents(
  toml: string,
  hooksJsonPath: string
): Set<string> {
  const trusted = new Set<string>()
  const prefix = `${hooksJsonPath}:`
  let current: string | null = null
  for (const line of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      // Header line, tolerating surrounding whitespace and a trailing comment.
      const m =
        /^\s*\[\s*hooks\.state\."((?:[^"\\]|\\.)*)"\s*\]\s*(?:#.*)?$/.exec(line)
      current =
        m && m[1]!.startsWith(prefix)
          ? (m[1]!.slice(prefix.length).split(':')[0] ?? null)
          : null
      continue
    }
    if (current && /^\s*trusted_hash\s*=/.test(line)) trusted.add(current)
  }
  return trusted
}

/**
 * `codexTrustedEvents` for a hooks file keyed by the path as given or by its
 * realpath — Codex keys trust by the absolute path it resolved, which may be
 * the realpath of a symlinked dir (/tmp vs /private/tmp).
 */
export function codexTrustedEventsForFile(
  toml: string,
  hooksJsonPath: string
): Set<string> {
  const trusted = codexTrustedEvents(toml, hooksJsonPath)
  let real = hooksJsonPath
  try {
    real = fs.realpathSync(hooksJsonPath)
  } catch {
    // keep the given path
  }
  if (real !== hooksJsonPath)
    for (const e of codexTrustedEvents(toml, real)) trusted.add(e)
  return trusted
}

/** Lumo events (CamelCase) with a `lumo hook <slug>` entry in a Codex hooks file. */
function lumoEventsIn(hooksJsonPath: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'))
  } catch {
    return []
  }
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  const hooks = (
    root.hooks && typeof root.hooks === 'object' ? root.hooks : root
  ) as Record<string, unknown>
  return CODEX_HOOK_EVENTS.filter(([event, slug]) => {
    const groups = hooks[event]
    if (!Array.isArray(groups)) return false
    return groups.some(g => {
      const list = (g as { hooks?: unknown } | null)?.hooks
      return (
        Array.isArray(list) &&
        list.some(h => {
          const c = (h as { command?: unknown } | null)?.command
          return typeof c === 'string' && isLumoHookCommand(c, slug)
        })
      )
    })
  }).map(([event]) => event)
}

/**
 * LUM-1112: Lumo Codex hook events that look untrusted — installed in the
 * user (`~/.codex/hooks.json`) or repo (`<repo>/.codex/hooks.json`) hooks file
 * but with no trust entry for that file in `~/.codex/config.toml`. An event
 * installed in both files counts as trusted when either one is.
 *
 * `null` when it cannot be told: no Lumo hooks file, or not a single Lumo
 * event looks trusted (the text scan then likely misses Codex's key format —
 * e.g. a project file — and listing every event would be noise). The same
 * holds per file: events of a file with no readable trust are never listed. Callers use
 * it only once events have arrived, so at least one hook does run.
 */
export function codexLikelyUntrustedEvents(args: {
  home: string
  cwd: string
}): string[] | null {
  const files = [codexHooksPath(args.home)]
  const resolved = resolveInstallRoot(args.cwd, args.home)
  const root = resolved.ok ? resolved.root : null
  if (root) files.push(codexHooksPath(root))
  let toml = ''
  try {
    toml = fs.readFileSync(
      path.join(args.home, '.codex', 'config.toml'),
      'utf8'
    )
  } catch {
    // no config.toml: nothing is trusted yet
  }
  const installed = new Set<string>()
  // Events that are, or may be, trusted. A file where not one Lumo event
  // matches a trust key is one the scan cannot read (e.g. a project file
  // Codex keys differently): its events may be trusted, so none is reported.
  const covered = new Set<string>()
  let readable = false
  for (const file of files) {
    const events = lumoEventsIn(file)
    if (events.length === 0) continue
    const keys = codexTrustedEventsForFile(toml, file)
    const fileTrusted = events.filter(e => keys.has(codexEventKey(e)))
    if (fileTrusted.length > 0) readable = true
    for (const e of events) installed.add(e)
    for (const e of fileTrusted.length > 0 ? fileTrusted : events)
      covered.add(e)
  }
  if (!readable) return null
  return CODEX_HOOK_EVENTS.map(([e]) => e).filter(
    e => installed.has(e) && !covered.has(e)
  )
}

/** LUM-1112: some Lumo hook events arrive, these look untrusted. */
export function codexUntrustedEventsWarning(events: readonly string[]): string {
  return (
    `lumo: these Lumo hook events may not be trusted in Codex: ${events.join(', ')}\n` +
    '  Other events reach Lumo, so these were likely added or changed since you last trusted the hooks.\n' +
    '  Trust them in Codex (app: Settings → Hooks; CLI: /hooks). The check reads ~/.codex/config.toml and does not verify hashes, so it can be wrong.'
  )
}

/**
 * GET the session and report whether the server has seen any hook event for
 * it. `null` when that cannot be told (network error, older server) — the
 * caller then stays silent rather than warn on a guess.
 */
export async function codexSessionHasEvents(args: {
  base: string
  token: string
  sessionId: string
}): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${args.base}/api/sessions/${encodeURIComponent(args.sessionId)}`,
      { headers: { Authorization: `Bearer ${args.token}` } }
    )
    if (res.status === 404) return false
    if (!res.ok) return null
    const body = (await res.json()) as { eventCount?: unknown }
    return typeof body.eventCount === 'number' ? body.eventCount > 0 : null
  } catch {
    return null
  }
}

/**
 * `memory sync` / `memory push` write and read Claude Code's memory store
 * (`~/.claude/projects/<enc>/memory`), which Codex never loads. In a Codex
 * shell they refuse instead of writing files nothing reads; `--dir` still
 * targets a directory explicitly.
 */
export function codexMemoryStoreError(command: string): string {
  return (
    `Error: \`${command}\` syncs Claude Code's local memory store, which Codex does not read.\n` +
    '  In Codex, team memory reaches you through `lumo task show <LUM-N> --full` (and the session-start hook).\n' +
    `  To write the files anyway, pass --dir <path>.`
  )
}
