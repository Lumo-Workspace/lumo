import { prisma } from '@/lib/db/prisma'

/**
 * Derive a short identifier from a workspace/team name.
 * Examples: "Rework" → "REW", "My Team" → "MYT", "A B C D" → "ABC"
 */
export function generateIdentifier(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 1) {
    return (words[0] ?? '').slice(0, 3).toUpperCase()
  }
  return words
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
