/**
 * LUM-906 PR2 — identity-provider deprovisioning.
 *
 * When Clerk deletes a user, or bans one (what Directory Sync does on IdP
 * deprovisioning), that person loses every Lumo workspace: each active
 * membership is deactivated (API keys revoked first, authorship and session
 * history kept) and audited with a WEBHOOK actor carrying the delivery's
 * svix-id. Never on `locked`: that is Clerk's temporary password lockout,
 * which a third party can trigger by failing sign-ins.
 *
 * Last OWNER: a workspace is never left without an OWNER — the row stays,
 * but the person's API keys are revoked, audited and a warning logged.
 *
 * Idempotent by construction: a redelivered event finds no active
 * membership (or no live key) and changes nothing. Re-enabling a banned user
 * restores nothing; only a new invite does.
 */
import { logger } from '@/lib/logger'
import type { MemberDeactivationReason } from '@/lib/members/deactivation'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

export interface ClerkDeprovisionTrigger {
  clerkUserId: string
  reason: Extract<
    MemberDeactivationReason,
    'CLERK_USER_DELETED' | 'CLERK_USER_BANNED'
  >
  /** The delivery's svix-id, recorded in the audit metadata. */
  webhookId: string | null
}

/** The fields of a verified Clerk webhook event this module reads. */
export interface ClerkUserEventLike {
  type: string
  data: unknown
}

/**
 * The deprovisioning a verified Clerk event asks for, or null when it asks
 * for none: `user.deleted`, and `user.updated` with `banned: true`. Every
 * other event — including `locked` and un-banning — is ignored.
 */
export function deprovisionTriggerFromClerkEvent(
  event: ClerkUserEventLike,
  webhookId: string | null
): ClerkDeprovisionTrigger | null {
  const data = (event.data ?? {}) as { id?: unknown; banned?: unknown }
  const clerkUserId = typeof data.id === 'string' && data.id ? data.id : null
  if (!clerkUserId) return null
  if (event.type === 'user.deleted') {
    return { clerkUserId, reason: 'CLERK_USER_DELETED', webhookId }
  }
  if (event.type === 'user.updated' && data.banned === true) {
    return { clerkUserId, reason: 'CLERK_USER_BANNED', webhookId }
  }
  return null
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
   * Deactivate every active membership of a Clerk user (see the module
   * comment). Returns one outcome per membership touched.
   */
  async deprovisionClerkUser(
    trigger: ClerkDeprovisionTrigger,
    audit: AuditContext
  ): Promise<DeprovisionOutcome[]> {
    const memberships = await memberRepository.findByClerkId(
      trigger.clerkUserId
    )
    const outcomes: DeprovisionOutcome[] = []
    const base = {
      reason: trigger.reason,
      clerkUserId: trigger.clerkUserId,
      webhookId: trigger.webhookId,
    }

    for (const m of memberships) {
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
      outcomes.push({
        workspaceId: m.workspaceId,
        memberId: m.id,
        outcome: 'deactivated',
        apiKeysRevoked,
      })
    }
    return outcomes
  },
}
