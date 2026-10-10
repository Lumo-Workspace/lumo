/**
 * LUM-1063 — deterministic de-prose of a shell command: drop heredoc bodies
 * and empty quoted-literal contents. Pure. Moved verbatim out of
 * `action-confirm.ts` (which re-exports it): the core's dependency-install
 * matcher (`install-sources.ts`) reads commands through it too, and the core
 * must not import the plugin's LLM confirmation module to get it.
 */

// --- deterministic de-prose (Stage 1 helper) ---------------------------------

/**
 * Drop heredoc BODIES (keep the `<<EOF` intro line) so a forbidden token written
 * into a heredoc-fed commit message (`git commit -F - <<EOF … EOF`) is removed.
 * Line-based and best-effort: handles `<<EOF`, `<<-EOF`, and quoted delimiters.
 */
export function stripHeredocBodies(cmd: string): string {
  const lines = cmd.split('\n')
  const out: string[] = []
  let delimiter: string | null = null
  for (const line of lines) {
    if (delimiter !== null) {
      // Inside a heredoc body — drop lines until the closing delimiter line.
      if (line.trim() === delimiter) delimiter = null
      continue
    }
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1/)
    if (m) {
      delimiter = m[2] as string
      out.push(line) // keep the intro itself; only the body is prose
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Empty the CONTENTS of single- and double-quoted string literals (keep the
 * delimiters), so a forbidden token that lived only inside a quoted argument
 * (a `-m`/`--body`/`echo` string) is removed while the command structure around
 * it survives. Backtick / `$(…)` command substitutions are LEFT INTACT —
 * their contents are actually executed, so a real `` `git push origin main` ``
 * must stay matchable (recall over precision; the LLM is the backstop, not this).
 */
export function stripQuotedLiterals(cmd: string): string {
  let out = ''
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === '\\' && i + 1 < cmd.length) {
      // Escaped char outside quotes — copy both verbatim.
      out += c + cmd[i + 1]
      i += 2
      continue
    }
    if (c === "'") {
      // Single quotes: no escapes inside. Drop everything to the next `'`.
      out += "'"
      i++
      while (i < cmd.length && cmd[i] !== "'") i++
      if (i < cmd.length) {
        out += "'"
        i++
      }
      continue
    }
    if (c === '"') {
      // Double quotes: drop to the next unescaped `"` (respecting `\"`). Inner
      // backtick/$() substitutions are dropped too — a real action hidden inside
      // a double-quoted substitution is exotic, and dropping it only routes it to
      // the LLM (which keeps it on uncertainty), never silently clears it.
      out += '"'
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          i += 2
          continue
        }
        i++
      }
      if (i < cmd.length) {
        out += '"'
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Prose-strip a command: drop heredoc bodies, then empty quoted-literal
 * contents. Pure. The service re-runs the deterministic matchers on the result
 * — a forbidden category that survives is a real action (certain); one that
 * vanishes matched only prose and is sent to the LLM to confirm.
 */
export function stripProse(cmd: string): string {
  return stripQuotedLiterals(stripHeredocBodies(cmd))
}
