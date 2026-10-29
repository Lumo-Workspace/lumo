/**
 * LUM-1335 — what `LUMO_MODE=local` sets up for its one account, so a
 * try-out needs no onboarding and no API-key copy-paste:
 *
 * - a workspace ("My workspace") on the first sign-in, when the account has
 *   none — an ordinary workspace the account owns — with one project ("My
 *   project"), so tasks can be filed right away (`lumo task create` needs a
 *   project);
 * - an API key for `lumo auth login --url …`, issued without a browser.
 *
 * Which account that is — the instance's single one, created when there is
 * none, refused when there are several — is decided by the local-mode
 * endpoints (lib/auth/better-auth/local-mode.ts).
 */
import { memberRepository } from '@/lib/repositories/member.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { apiKeyService } from '@/lib/services/api-key.service'
import { workspaceService } from '@/lib/services/workspace.service'
import { projectService } from '@/lib/services/project.service'
import type { AuditContext } from '@/lib/services/audit.service'

export const LOCAL_WORKSPACE_NAME = 'My workspace'
export const LOCAL_WORKSPACE_SLUG = 'my-workspace'
export const LOCAL_PROJECT_NAME = 'My project'
export const LOCAL_CLI_KEY_LABEL = 'lumo CLI (local mode)'

export interface LocalWorkspace {
  workspaceId: string
  memberId: string
  slug: string
}

async function findWorkspace(userId: string): Promise<LocalWorkspace | null> {
  const [member] = await memberRepository.findByClerkId(userId)
  if (!member) return null
  return {
    workspaceId: member.workspaceId,
    memberId: member.id,
    slug: member.workspace.slug,
  }
}

export const localModeService = {
  /**
   * The user's workspace, creating "My workspace" (with "My project") when
   * they have none. Its slug is `my-workspace`; only when another account's
   * workspace already holds that slug does it take a suffixed one. Two first
   * uses at once (the browser and the CLI) both try the same slug, so the
   * unique index fails the second create, which then returns the workspace
   * the first one made — never a second workspace.
   */
  async ensureWorkspace(userId: string): Promise<LocalWorkspace> {
    const existing = await findWorkspace(userId)
    if (existing) return existing
    const slugs = [
      LOCAL_WORKSPACE_SLUG,
      `${LOCAL_WORKSPACE_SLUG}-${userId.slice(-6).toLowerCase()}`,
    ]
    let created: Awaited<
      ReturnType<typeof workspaceService.createWorkspace>
    > | null = null
    for (const slug of slugs) {
      try {
        created = await workspaceService.createWorkspace(userId, {
          name: LOCAL_WORKSPACE_NAME,
          slug,
        })
        break
      } catch (err) {
        const raced = await findWorkspace(userId)
        if (raced) return raced
        // Not a lost race: try the next slug only when this one is taken.
        if (await workspaceRepository.isSlugUnique(slug)) throw err
        if (slug === slugs[slugs.length - 1]) throw err
      }
    }
    if (!created) throw new Error('could not create the local workspace')
    // Only with the workspace it made: a project deleted later stays gone.
    // Outside the create's error handling, so a failure here is not mistaken
    // for a lost race.
    await projectService.createProject(
      created.workspace.id,
      created.workspace.slug,
      created.member.id,
      { name: LOCAL_PROJECT_NAME }
    )
    return {
      workspaceId: created.workspace.id,
      memberId: created.member.id,
      slug: created.workspace.slug,
    }
  },

  /** A new full API key for the account, in its workspace (created if needed). */
  async issueCliKey(userId: string, audit?: AuditContext) {
    const workspace = await this.ensureWorkspace(userId)
    // The request carries no credential: the key is recorded as the account's.
    const context: AuditContext | undefined = audit && {
      ...audit,
      actor: {
        type: 'MEMBER',
        clerkId: userId,
        memberId: workspace.memberId,
      },
    }
    const created = await apiKeyService.create(
      { workspaceId: workspace.workspaceId, memberId: workspace.memberId },
      { label: LOCAL_CLI_KEY_LABEL, scope: null },
      context
    )
    return { key: created.key, workspaceSlug: workspace.slug }
  },
}
