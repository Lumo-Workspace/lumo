import { prisma } from '@/lib/db/prisma'

/**
 * Derive a short identifier from a workspace/team name.
 * Only ASCII letters are used; falls back to a random uppercase string if the
 * name contains no Latin characters (e.g. a Chinese-only workspace name).
 *
 * Examples: "Rework" → "REW", "My Team" → "MYT", "A B C D" → "ABC"
 *           "我的团队" → random e.g. "XKQ"
 */
export function generateIdentifier(name: string): string {
  const asciiWords = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.replace(/[^A-Za-z]/g, ''))
    .filter(w => w.length > 0)

  if (asciiWords.length === 0) {
    // No usable Latin letters — generate a random 3-char uppercase string
    return Array.from({ length: 3 }, () =>
      String.fromCharCode(65 + Math.floor(Math.random() * 26))
    ).join('')
  }

  if (asciiWords.length === 1) {
    return (asciiWords[0] ?? '').slice(0, 3).toUpperCase()
  }

  return asciiWords
    .slice(0, 3)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * Returns the default team for a workspace, or null if none exists.
 */
export async function getDefaultTeam(workspaceId: string) {
  return prisma.team.findFirst({
    where: { workspaceId, isDefault: true },
  })
}
