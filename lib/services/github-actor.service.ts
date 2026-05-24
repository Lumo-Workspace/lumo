import { prisma } from '@/lib/db/prisma'

interface GithubUser {
  id: number
  login: string
  avatar_url: string
}

export const githubActorService = {
  /** Find-or-create a GITHUB_USER actor for an unmapped GitHub login. */
  async upsertPseudoActor(workspaceId: string, user: GithubUser) {
    const externalIdentity = `github:${user.login}`
    const existing = await prisma.actor.findUnique({
      where: {
        workspaceId_externalIdentity: { workspaceId, externalIdentity },
      },
    })
    if (existing) return existing
    return prisma.actor.create({
      data: {
        workspaceId,
        type: 'GITHUB_USER',
        externalIdentity,
        externalAvatarUrl: user.avatar_url,
      },
    })
  },
}
