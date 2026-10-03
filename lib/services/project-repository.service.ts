import { projectRepository } from '@/lib/repositories'
import { requireConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'

/**
 * Repositories linked to a project. The default one is what the policy
 * pipeline, constitution reads and boundary re-judge fetch from GitHub, so a
 * repository can only be linked while it is on the workspace's confirmed list
 * (LUM-883) — otherwise any member could point those reads at a repository
 * the installation reaches but the workspace never confirmed.
 */
export const projectRepositoryService = {
  async addRepository(input: {
    projectId: string
    workspaceId: string
    fullName: string
    isDefault?: boolean | undefined
  }) {
    // Throws 403 repo_not_confirmed / 400 app_not_installed before any write.
    // LUM-889: stored under the confirmed list's spelling, not what was typed,
    // so `Acme/Web` and `acme/web` are one repository here as on GitHub.
    const { repository: fullName } = await requireConfirmedRepository(
      input.workspaceId,
      input.fullName
    )

    const name = fullName.split('/')[1] ?? fullName

    // If this is being set as default, clear existing defaults first
    if (input.isDefault) {
      await projectRepository.clearDefaultRepositories(input.projectId)
    }

    // If no repos exist yet, make first one default automatically
    const existingCount = await projectRepository.countRepositories(
      input.projectId
    )

    return projectRepository.createRepository({
      projectId: input.projectId,
      fullName,
      name,
      isDefault: input.isDefault ?? existingCount === 0,
    })
  },
}
