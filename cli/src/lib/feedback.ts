/**
 * LUM-1092 — the one shape for CLI success lines and inline hints.
 *
 * Success lines read `<Verb> <kind> <ref> "<title>"  <id|url>`; every part
 * after the verb is optional, and the trailing id/url is separated by two
 * spaces so it stays easy to cut off the end of the line. The first lines of
 * `task create` / `task update` / `doc create` predate this helper and are
 * parsed by agents, so they keep their own formatters (byte-identical).
 *
 * Hints are one line, `Hint: <text>`. Advice with a command to run belongs in
 * the `Next:` block (`lib/next-steps.ts`) instead; inside hint prose a command
 * is written as {@link cmd} (backticked). A caveat about how far a number can
 * be trusted (not something to do) is a `Note: <text>` instead — see {@link note}.
 *
 * `✓` prefix rule (LUM-1088, user ruling 2026-10-13): the `✓` icon
 * (`icons.success` in `lib/ui.ts`) marks ENVIRONMENT / FLOW confirmations only
 * — auth login, init / install, worktree ready, crossing rulings, memory push
 * and the like. Resource create / update / delete success lines built by
 * {@link successLine} never carry it: their first word is already the verb.
 *
 * No colour here: these strings are printed to agents as-is.
 */

import { sanitizeField } from './sanitize'

export interface SuccessLineParts {
  /** Past-tense verb, e.g. `Created`, `Removed`. */
  verb: string
  /** Resource kind, e.g. `milestone`, `tag`, `dependency`. */
  kind?: string
  /** Short handle, e.g. `LUM-42`, `#3`, `[a1b2c3d4]`. Not sanitized. */
  ref?: string
  /** Human title; sanitized and double-quoted with `"` escaped. */
  title?: string
  /** Trailing id or URL, after two spaces. Not sanitized. */
  id?: string
  /** Free text appended after a single space (e.g. a parenthetical). */
  suffix?: string
}

/** Quote a title the way the task / doc success lines do. */
export function quoteTitle(title: string): string {
  return `"${sanitizeField(title).replace(/"/g, '\\"')}"`
}

/** `<Verb> <kind> <ref> "<title>"  <id|url>` — see the module comment. */
export function successLine(parts: SuccessLineParts): string {
  const head = [
    parts.verb,
    parts.kind,
    parts.ref,
    parts.title === undefined ? undefined : quoteTitle(parts.title),
    parts.suffix,
  ]
    .filter((p): p is string => p !== undefined && p !== '')
    .join(' ')
  return parts.id ? `${head}  ${parts.id}` : head
}

export const HINT_PREFIX = 'Hint:'

/** `Hint: <text>` — the single prefix for inline advice (no `Tip:`). */
export function hint(text: string): string {
  return `${HINT_PREFIX} ${text}`
}

/** A command referenced inside prose: `` `lumo …` ``. */
export function cmd(command: string): string {
  return `\`${command}\``
}

export const NOTE_PREFIX = 'Note:'

/**
 * `Note: <text>` — a precision caveat on what was just printed (e.g. "this
 * attribution is heuristic"), as opposed to a {@link hint}, which suggests
 * something to do. Not for warnings: those use `warn()` from `lib/errors.ts`.
 */
export function note(text: string): string {
  return `${NOTE_PREFIX} ${text}`
}
