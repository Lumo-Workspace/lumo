/**
 * Single source of truth for the task-identifier pattern (LUM-419).
 *
 * Consumed by both sides so they cannot drift:
 *   - server: lib/integrations/github/branch.ts (webhook branch → task linking)
 *   - CLI:    cli/src/lib/git-task.ts (session-start git-suggest)
 *
 * A task identifier is `<TEAM>-<n>` where TEAM is the team's configured
 * prefix (`Team.identifier`, 1–10 letters) — e.g. LUM-419, SPEC-123. The
 * prefix is NOT hardcoded to any one team.
 */
export const TASK_IDENTIFIER_PATTERN = String.raw`\b([A-Za-z]{1,10}-\d+)\b`

/**
 * Acronym-number tokens that match the identifier shape but are never task
 * ids. Commit subjects routinely contain these ("fix UTF-8 handling",
 * "use SHA-256"), so the matcher skips them instead of suggesting a bogus
 * session attach. Compared against the uppercased prefix segment.
 */
const NON_TASK_PREFIXES: ReadonlySet<string> = new Set([
  'AES',
  'CVE',
  'GPT',
  'HTTP',
  'ISO',
  'RFC',
  'RSA',
  'SHA',
  'TLS',
  'UTF',
])

/**
 * Extract the first task identifier from arbitrary text (a branch name or a
 * commit subject), normalized to upper case. Tokens whose prefix is a known
 * non-task acronym (UTF-8, SHA-256, …) are skipped; later genuine matches in
 * the same text still win. Returns null when nothing matches.
 */
export function matchTaskIdentifier(text: string): string | null {
  const re = new RegExp(TASK_IDENTIFIER_PATTERN, 'g')
  for (const m of text.matchAll(re)) {
    const identifier = m[1]!.toUpperCase()
    const prefix = identifier.slice(0, identifier.lastIndexOf('-'))
    if (NON_TASK_PREFIXES.has(prefix)) continue
    return identifier
  }
  return null
}

/** Every task identifier in `text`, de-duplicated, upper-cased, in order (LUM-932). */
export function matchAllTaskIdentifiers(text: string): string[] {
  const re = new RegExp(TASK_IDENTIFIER_PATTERN, 'g')
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    const identifier = m[1]!.toUpperCase()
    const prefix = identifier.slice(0, identifier.lastIndexOf('-'))
    if (NON_TASK_PREFIXES.has(prefix) || out.includes(identifier)) continue
    out.push(identifier)
  }
  return out
}
