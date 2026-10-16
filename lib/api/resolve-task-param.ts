import type { TaskStatus } from '@prisma/client'
import { taskRepository } from '@/lib/repositories'

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

/**
 * Parse a "LUM-42"-style identifier into its components.
 * Returns null if the string doesn't match the pattern.
 */
function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

/**
 * Resolve a tasks/[id] route param to a task row, scoped to the caller's
 * workspace. Accepts both cuids and "LUM-N" identifiers. Returns null if the
 * segment does not resolve to a task inside `workspaceId` — critically, the
 * cuid branch verifies workspace ownership so a malicious caller cannot reach
 * a task in another workspace by passing its raw cuid.
 *
 * Single source for the tasks/[id] routes — extracted from their per-route
 * copies so the resolution contract can't drift between them.
 */
export async function resolveTaskParam(
  rawId: string,
  workspaceId: string
): Promise<{
  id: string
  number: number
  status: TaskStatus
  workStartedAt: Date | null
  team: { identifier: string }
} | null> {
  if (isLikelyCuid(rawId)) {
    return taskRepository.findByIdForMention(rawId, workspaceId)
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}
