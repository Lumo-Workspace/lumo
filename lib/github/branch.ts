/**
 * Extracts a Lumo task identifier from a Git branch name.
 *
 * Supported patterns (case-insensitive):
 *   lumo/ENG-123-fix-bug   → "ENG-123"
 *   feature/ENG-123-fix    → "ENG-123"
 *   eng-123-fix-bug        → "ENG-123"
 *   ENG-123                → "ENG-123"
 *
 * Returns null if no identifier is found.
 */
const IDENTIFIER_RE = /\b([A-Za-z]{1,10}-\d+)\b/

export function parseBranchIdentifier(branch: string): string | null {
  const m = IDENTIFIER_RE.exec(branch)
  return m ? m[1]!.toUpperCase() : null
}

/**
 * Splits "ENG-123" into { teamIdentifier: "ENG", number: 123 }.
 * Returns null if the format is invalid.
 */
export function splitIdentifier(
  identifier: string
): { teamIdentifier: string; number: number } | null {
  const idx = identifier.lastIndexOf('-')
  if (idx === -1) return null
  const teamIdentifier = identifier.slice(0, idx).toUpperCase()
  const number = parseInt(identifier.slice(idx + 1), 10)
  if (!teamIdentifier || isNaN(number)) return null
  return { teamIdentifier, number }
}
