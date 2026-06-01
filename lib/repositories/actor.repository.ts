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
}
