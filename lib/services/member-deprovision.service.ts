/**
 * LUM-906 PR2 — identity-provider deprovisioning.
 *
 * When a user is deleted or banned, that person loses every Lumo workspace:
 * each active membership is deactivated (API keys revoked first, authorship
 * and session history kept) and audited. Originally driven by Clerk's user
 * webhook (removed with Clerk, LUM-1077); historical rows keep the
 * CLERK_USER_* reasons.
 *
 * Last OWNER: a workspace is never left without an OWNER — the row stays,
 * but the person's API keys are revoked, audited and a warning logged.
 *
 * Idempotent by construction: a repeated run finds the memberships already
 * deactivated (or no live key) and changes nothing; if a personal
 * integration cleanup failed, the call fails and a retry finishes it.
 * Re-enabling a banned user restores nothing; only a new invite does.
 *
 * LUM-1071: an operator bans or removes a user through
 * lib/services/auth-user-admin.service.ts (reasons AUTH_USER_BANNED /
 * AUTH_USER_DELETED), which calls `deprovisionUser`.
 */
import { logger } from '@/lib/logger'
import type { MemberDeactivationReason } from '@/lib/members/deactivation'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { removeMemberIntegrationsSafely } from '@/lib/services/member-integrations.service'

/** A provider-neutral deprovisioning request (LUM-1071). */
export interface UserDeprovisionTrigger {
  /** The auth provider's user id — what WorkspaceMember.clerkId stores. */
  userId: string
  reason: Extract<
    MemberDeactivationReason,
    'AUTH_USER_DELETED' | 'AUTH_USER_BANNED'
  >
  /**
   * Audit metadata naming the trigger (the operator script…); merged after `reason` and `clerkUserId`. Never personal data.
   */
  auditMetadata: Record<string, string | null>
}

/** What deprovisioning would do to one membership (read-only plan). */
export interface DeprovisionPlanEntry {
  workspaceId: string
  memberId: string
  role: string
  action: 'deactivate' | 'keep_last_owner' | 'none'
}

export type DeprovisionOutcome =
  | {
      workspaceId: string
      memberId: string
      outcome: 'deactivated'
      apiKeysRevoked: number
    }
  | {
      workspaceId: string
      memberId: string
      outcome: 'last_owner_kept'
      apiKeysRevoked: number
    }
  | { workspaceId: string; memberId: string; outcome: 'already_deactivated' }

export const memberDeprovisionService = {
  /**
   * What `deprovisionUser` would do to each membership of `userId`, without
   * writing anything (the operator scripts' dry run). Same last-OWNER rule.
   */
  async planDeprovision(userId: string): Promise<DeprovisionPlanEntry[]> {
    const memberships =
      await memberRepository.findAllByClerkIdIncludingDeactivated(userId)
    const plan: DeprovisionPlanEntry[] = []
    for (const m of memberships) {
      const entry = { workspaceId: m.workspaceId, memberId: m.id, role: m.role }
      if (m.deactivatedAt !== null) {
        plan.push({ ...entry, action: 'none' })
      } else if (
        m.role === 'OWNER' &&
        (await memberRepository.countOwners(m.workspaceId)) <= 1
      ) {
        plan.push({ ...entry, action: 'keep_last_owner' })
      } else {
        plan.push({ ...entry, action: 'deactivate' })
      }
    }
    return plan
  },

  /**
   * Deactivate every active membership of `trigger.userId`, whichever auth
   * provider it comes from (see the module comment). Returns one outcome per
   * membership touched.
   */
  async deprovisionUser(
    trigger: UserDeprovisionTrigger,
    audit: AuditContext
  ): Promise<DeprovisionOutcome[]> {
    const memberships =
      await memberRepository.findAllByClerkIdIncludingDeactivated(
        trigger.userId
      )
    let cleanupFailed = false
    const outcomes: DeprovisionOutcome[] = []
    const base = {
      reason: trigger.reason,
      clerkUserId: trigger.userId,
      ...trigger.auditMetadata,
    }

    for (const m of memberships) {
      if (m.deactivatedAt !== null) {
        // Already deactivated (a redelivery, or earlier remove/leave): only
        // make sure no personal credentials are left. A no-op when clean.
        if (!(await removeMemberIntegrationsSafely(m.workspaceId, m.id, audit)))
          cleanupFailed = true
        outcomes.push({
          workspaceId: m.workspaceId,
          memberId: m.id,
          outcome: 'already_deactivated',
        })
        continue
      }
      if (m.role === 'OWNER') {
        const owners = await memberRepository.countOwners(m.workspaceId)
        if (owners <= 1) {
          const apiKeysRevoked = await memberRepository.revokeActiveApiKeys(
            m.id
          )
          logger.warn(
            '[deprovision] last OWNER kept in workspace; API keys revoked',
            {
              workspaceId: m.workspaceId,
              memberId: m.id,
              apiKeysRevoked,
              ...base,
            }
          )
          if (apiKeysRevoked > 0) {
            await recordAuditEvent({
              workspaceId: m.workspaceId,
              action: 'member.api_keys_revoked',
              target: { type: 'member', id: m.id },
              metadata: {
                ...base,
                role: m.role,
                apiKeysRevoked,
                lastOwner: true,
              },
              context: audit,
            })
          }
          outcomes.push({
            workspaceId: m.workspaceId,
            memberId: m.id,
            outcome: 'last_owner_kept',
            apiKeysRevoked,
          })
          continue
        }
      }

      // Security first: deactivate (API keys revoked) before touching the
      // integrations, so a failing integration cleanup can never leave the
      // person with access.
      const { deactivated, apiKeysRevoked } = await memberRepository.deactivate(
        m.id,
        trigger.reason
      )
      if (!deactivated) {
        outcomes.push({
          workspaceId: m.workspaceId,
          memberId: m.id,
          outcome: 'already_deactivated',
        })
        continue
      }
      await recordAuditEvent({
        workspaceId: m.workspaceId,
        action: 'member.deprovisioned',
        target: { type: 'member', id: m.id },
        metadata: { ...base, role: m.role, apiKeysRevoked },
        context: audit,
      })
      if (!(await removeMemberIntegrationsSafely(m.workspaceId, m.id, audit)))
        cleanupFailed = true
      outcomes.push({
        workspaceId: m.workspaceId,
        memberId: m.id,
        outcome: 'deactivated',
        apiKeysRevoked,
      })
    }
    if (cleanupFailed) {
      // Fail the call so the operator re-runs the script; the retry only
      // finishes the integration cleanup (deactivation is already done and
      // idempotent).
      throw Object.assign(
        new Error('Personal integration cleanup failed; will retry'),
        { status: 500 }
      )
    }
    return outcomes
  },
}
