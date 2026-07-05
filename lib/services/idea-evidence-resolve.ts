import { ideaRepository } from '@/lib/repositories/idea.repository'
import { getDefaultTeam } from '@/lib/team'

/**
 * Resolve an idea reference to its `{ ideaId, workspaceId, teamId }`, scoped
 * to the caller's default team. Mirrors `idea.service.ts`'s ref resolution
 * (see `updateStatus`): `ideaRef` is either the cuid `id` (web) or the human
 * `<TEAM>-I<n>` identifier / bare `<n>` (CLI). A ref that resolves outside the
 * caller's team is indistinguishable from a missing one — both throw 404 so
 * evidence entry points never leak cross-team existence.
 *
 * This is the single scope-establishing entry point for idea evidence
 * services: once an `ideaId` comes back here, downstream repo rows carry
 * their own denormalized `workspaceId`, so evidence-level scope checks
 * (refresh/unlink/fetchBody) compare against `row.workspaceId` directly
 * rather than re-deriving the idea's team/workspace via a join.
 *
 * Throws with `{ status }`: 404 when the workspace has no default team or the
 * idea isn't in it.
 */
export async function resolveIdeaRef(args: {
  workspaceId: string
  ideaRef: string
}): Promise<{ ideaId: string; workspaceId: string; teamId: string }> {
  const team = await getDefaultTeam(args.workspaceId)
  if (!team) {
    throw Object.assign(new Error('Idea not found'), { status: 404 })
  }

  // Resolve by team-scoped number when the ref looks like `<TEAM>-I<n>` / a
  // bare number (CLI), otherwise treat it as a cuid id (web).
  const number = parseIdeaNumber(args.ideaRef)
  const idea =
    number !== null
      ? await ideaRepository.findByNumber(team.id, number)
      : await ideaRepository.findByIdInTeam(args.ideaRef, team.id)
  if (!idea) {
    throw Object.assign(new Error('Idea not found'), { status: 404 })
  }

  return { ideaId: idea.id, workspaceId: args.workspaceId, teamId: team.id }
}

/**
 * Extract the team-scoped idea number from a reference. Accepts the full
 * `<TEAM>-I<n>` identifier (case-insensitive `I`) or a bare `<n>`. Returns
 * `null` for anything else (e.g. a cuid id, which the caller resolves by id).
 * Copied verbatim from `idea.service.ts`'s `parseIdeaNumber`.
 */
function parseIdeaNumber(ref: string): number | null {
  const trimmed = ref.trim()
  const withPrefix = trimmed.match(/-I(\d+)$/i)
  if (withPrefix) return Number(withPrefix[1])
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  return null
}
