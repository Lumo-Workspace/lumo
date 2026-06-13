import { actorRepository } from '@/lib/repositories/actor.repository'

interface GithubUser {
  id: number
  login: string
  avatar_url: string
}

export const githubActorService = {
  /** Find-or-create a GITHUB_USER actor for an unmapped GitHub login. */
  async upsertPseudoActor(workspaceId: string, user: GithubUser) {
    const externalIdentity = `github:${user.login}`
    const existing = await actorRepository.findByExternalIdentity(
      workspaceId,
      externalIdentity
    )
    if (existing) return existing
    return actorRepository.createPseudoActor({
      workspaceId,
      externalIdentity,
      externalAvatarUrl: user.avatar_url,
    })
  },
}
