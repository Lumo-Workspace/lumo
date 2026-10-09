import * as path from 'path'

/**
 * LUM-1051: Codex runs a hook only after the user trusts it — per entry, in
 * the desktop app's Hooks settings or `/hooks` in the CLI — and re-asks after
 * the entry changes. An untrusted hook is skipped silently (no error, no
 * prompt), so Lumo looks installed while recording nothing. The hook commands
 * are kept byte-stable (`lumo hook <slug> --agent codex`) so a CLI upgrade
 * never re-triggers the review.
 */

/** Where `lumo init --agent codex` writes hooks: `<root>/.codex/hooks.json`. */
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
    '  In Codex, team memory reaches you through `lumo task context <LUM-N>` (and the session-start hook).\n' +
    `  To write the files anyway, pass --dir <path>.`
  )
}
