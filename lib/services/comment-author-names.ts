import { actorRepository } from '@/lib/repositories/actor.repository'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { logger } from '@/lib/logger'

/** The fields {@link actorLabel} reads (one row of `findLabelFieldsByIds`). */
export interface ActorLabelFields {
  type: string
  externalIdentity: string | null
  member: { clerkId: string } | null
  agent: { name: string } | null
}

/**
 * LUM-1232 G2: an actor's display name — the agent's name, `@login` for a
 * GitHub pseudo-actor, or the member's Clerk name. Null when none is known.
 */
export function actorLabel(
  a: ActorLabelFields,
  memberNames: Map<string, string>
): string | null {
  if (a.agent?.name) return a.agent.name
  if (a.externalIdentity?.startsWith('github:'))
    return `@${a.externalIdentity.slice('github:'.length)}`
  if (a.member) return memberNames.get(a.member.clerkId) ?? null
  return null
}

/** Actor id → display name for the given ids in one workspace (best effort). */
async function actorDisplayNames(
  workspaceId: string,
  actorIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (actorIds.length === 0) return out
  try {
    const rows = await actorRepository.findLabelFieldsByIds(
      workspaceId,
      actorIds
    )
    const clerkIds = rows.flatMap(r => (r.member ? [r.member.clerkId] : []))
    const memberNames = new Map<string, string>()
    if (clerkIds.length > 0) {
      for (const [id, p] of await lookupClerkProfiles(clerkIds)) {
        if (p.name) memberNames.set(id, p.name)
      }
    }
    for (const r of rows) {
      const label = actorLabel(r, memberNames)
      if (label) out.set(r.id, label)
    }
  } catch (error) {
    logger.warn('[comments] author name lookup failed', {
      error: (error as Error)?.message ?? String(error),
    })
  }
  return out
}

/**
 * LUM-1232 G2 / LUM-1238: a comment thread plus each author's display name
 * (`authorName`: member name, agent name or `@github-login`; null when
 * unknown) on every comment and reply, looked up in `workspaceId`. Best
 * effort — a failed lookup leaves every `authorName` null.
 */
export async function withAuthorNames<
  T extends {
    authorActorId: string | null
    replies?: { authorActorId: string | null }[]
  },
>(comments: T[], workspaceId: string) {
  const ids = [
    ...new Set(
      comments
        .flatMap(c => [c, ...(c.replies ?? [])])
        .map(c => c.authorActorId)
        .filter((id): id is string => typeof id === 'string')
    ),
  ]
  const names = await actorDisplayNames(workspaceId, ids)
  const withName = <U extends { authorActorId: string | null }>(c: U) => ({
    ...c,
    authorName: c.authorActorId ? (names.get(c.authorActorId) ?? null) : null,
  })
  return comments.map(c => ({
    ...withName(c),
    replies: ((c.replies ?? []) as NonNullable<T['replies']>).map(withName),
  }))
}
