/**
 * LUM-1335 — what `LUMO_MODE=local` sets up for its one account, so a
 * try-out needs no onboarding and no API-key copy-paste:
 *
 * - a workspace ("My workspace") on the first sign-in, when the account has
 *   none — an ordinary workspace the account owns;
 * - an API key for `lumo auth login --url …`, issued without a browser.
 *
 * Both run only for the instance's single account: with several, local mode
 * refuses (the same rule as the local sign-in).
 */
import { authUserRepository } from '@/lib/repositories/auth-user.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { apiKeyService } from '@/lib/services/api-key.service'
import { workspaceService } from '@/lib/services/workspace.service'
import type { AuditContext } from '@/lib/services/audit.service'

export const LOCAL_WORKSPACE_NAME = 'My workspace'
export const LOCAL_WORKSPACE_SLUG = 'my-workspace'
export const LOCAL_CLI_KEY_LABEL = 'lumo CLI (local mode)'

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

export interface LocalWorkspace {
  workspaceId: string
  memberId: string
  slug: string
}

export const localModeService = {
  /**
   * The user's workspace, creating "My workspace" when they have none. Its
   * slug is `my-workspace`, or with a short suffix when that is taken.
   */
  async ensureWorkspace(userId: string): Promise<LocalWorkspace> {
    const [existing] = await memberRepository.findByClerkId(userId)
    if (existing) {
      return {
        workspaceId: existing.workspaceId,
        memberId: existing.id,
        slug: existing.workspace.slug,
      }
    }
    const slug = (await workspaceRepository.isSlugUnique(LOCAL_WORKSPACE_SLUG))
      ? LOCAL_WORKSPACE_SLUG
      : `${LOCAL_WORKSPACE_SLUG}-${userId.slice(-6).toLowerCase()}`
    const created = await workspaceService.createWorkspace(userId, {
      name: LOCAL_WORKSPACE_NAME,
      slug,
    })
    return {
      workspaceId: created.workspace.id,
      memberId: created.member.id,
      slug: created.workspace.slug,
    }
  },

  /**
   * A new full API key for the instance's one account (in its workspace,
   * created if needed). 409 when the instance has no account yet (open the
   * app once first) or several (local mode does not run then).
   */
  async issueCliKey(audit?: AuditContext) {
    const accounts = await authUserRepository.findMany({ limit: 2 })
    if (accounts.length > 1) {
      throw httpError(
        409,
        'LUMO_MODE=local only runs while this instance has at most one account, and it has several'
      )
    }
    const [account] = accounts
    if (!account) {
      throw httpError(
        409,
        'No account yet: open Lumo in a browser once, then run lumo auth login again'
      )
    }
    const workspace = await this.ensureWorkspace(account.id)
    // The request carries no credential: the key is recorded as the account's.
    const context: AuditContext | undefined = audit && {
      ...audit,
      actor: {
        type: 'MEMBER',
        clerkId: account.id,
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
