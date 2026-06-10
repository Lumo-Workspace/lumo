import { matchTaskIdentifier } from '../../../shared/src/task-identifier'

/**
 * Extracts a Lumo task identifier from a Git branch name.
 *
 * Supported patterns (case-insensitive):
 *   lumo/ENG-123-fix-bug   → "ENG-123"
 *   feature/ENG-123-fix    → "ENG-123"
 *   eng-123-fix-bug        → "ENG-123"
 *   ENG-123                → "ENG-123"
 *
 * Pattern lives in shared/src/task-identifier.ts, shared with the CLI's
 * git-suggest detection (LUM-419) so the two sides cannot drift.
 * Returns null if no identifier is found.
 */
export function parseBranchIdentifier(branch: string): string | null {
  return matchTaskIdentifier(branch)
}

/**
 * Splits "ENG-123" into { teamIdentifier: "ENG", number: 123 }.
 * Returns null if the format is invalid.
 */
export function splitIdentifier(
  identifier: string
): import('./types').SplitIdentifier | null {
  const idx = identifier.lastIndexOf('-')
  if (idx === -1) return null
  const teamIdentifier = identifier.slice(0, idx).toUpperCase()
  const number = parseInt(identifier.slice(idx + 1), 10)
  if (!teamIdentifier || isNaN(number)) return null
  return { teamIdentifier, number }
}

/**
 * Generates a Lumo-convention branch name from a task identifier and title.
 *
 * Format: `lumo/ENG-123-fix-the-bug`
 *
 * - Title is lowercased, special chars removed, spaces → hyphens
 * - Title slug capped at 40 chars to keep branch names reasonable
 * - If title is empty or produces no slug, branch is just `lumo/IDENTIFIER`
 */
export function generateBranchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '')
  return slug ? `lumo/${identifier}-${slug}` : `lumo/${identifier}`
}
