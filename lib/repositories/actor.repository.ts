import { prisma } from '@/lib/db/prisma'

export const actorRepository = {
  /**
   * `(id, externalIdentity)` for the GITHUB_USER actors among the given ids.
   * `externalIdentity` is stored as `"github:<login>"`. Used to label mirrored
   * review comments with the reviewer's GitHub handle without any Clerk call —
   * non-GITHUB_USER actors (e.g. a member who mapped to a Lumo user) are simply
   * omitted, and the todo renders without a `@handle`.
   */
  async findGithubIdentitiesByIds(actorIds: string[]) {
    if (actorIds.length === 0) return []
    return prisma.actor.findMany({
      where: { id: { in: actorIds }, type: 'GITHUB_USER' },
      select: { id: true, externalIdentity: true },
    })
  },

  /**
   * LUM-1232 G2: what a display label is built from, for the given actor ids
   * in one workspace — the member's Clerk id, the agent's name or the GitHub
   * handle. Ids from another workspace are not returned.
   */
  async findLabelFieldsByIds(workspaceId: string, actorIds: string[]) {
    if (actorIds.length === 0) return []
    return prisma.actor.findMany({
      where: { id: { in: actorIds }, workspaceId },
      select: {
        id: true,
        type: true,
        externalIdentity: true,
        member: { select: { clerkId: true } },
        agent: { select: { name: true } },
      },
    })
  },

  /** Look up an actor by the `(workspaceId, externalIdentity)` composite key. */
  async findByExternalIdentity(workspaceId: string, externalIdentity: string) {
    return prisma.actor.findUnique({
      where: {
        workspaceId_externalIdentity: { workspaceId, externalIdentity },
      },
    })
  },

  /** Create a GITHUB_USER pseudo-actor for an unmapped GitHub login. */
  async createPseudoActor(input: {
    workspaceId: string
    externalIdentity: string
    externalAvatarUrl: string
  }) {
    return prisma.actor.create({
      data: {
        workspaceId: input.workspaceId,
        type: 'GITHUB_USER',
        externalIdentity: input.externalIdentity,
        externalAvatarUrl: input.externalAvatarUrl,
      },
    })
  },
}
