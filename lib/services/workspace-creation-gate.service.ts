/**
 * LUM-1344 — workspace-creation gate. When WORKSPACE_CREATION_REQUIRES_APPROVAL
 * is on, a signed-in user may create a workspace only if they already belong
 * to one, were approved off the waitlist, or hold a pending workspace invite.
 * Anyone else is put on the waitlist and refused with 403.
 */
import { isTruthyFlag } from '@/lib/config/env-flag'
import { inviteRepository } from '@/lib/repositories/invite.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'

const FLAG_ENV = 'WORKSPACE_CREATION_REQUIRES_APPROVAL'

export function isWorkspaceApprovalRequired(
  env: Record<string, string | undefined> = process.env
): boolean {
  return isTruthyFlag(env[FLAG_ENV])
}

interface AssertMayCreateInput {
  userId: string
  verifiedEmails: string[]
  primaryEmail: string | null
  displayName: string | null
  now: Date
}

export const workspaceCreationGate = {
  async assertMayCreate(input: AssertMayCreateInput): Promise<void> {
    if (!isWorkspaceApprovalRequired()) return

    // findFirstByClerkId only returns active (non-deactivated) memberships.
    if (await memberRepository.findFirstByClerkId(input.userId)) return

    const emails = input.verifiedEmails.map(e => e.toLowerCase())
    if (emails.length > 0) {
      if (await miscRepository.findApprovedWaitlistEntryByEmails(emails)) return
      const invites = await inviteRepository.findPendingByEmails(
        emails,
        input.now
      )
      if (invites.length > 0) return
    }

    const primary = input.primaryEmail?.toLowerCase() ?? null
    const email = primary && emails.includes(primary) ? primary : emails[0]
    if (email) {
      await miscRepository.upsertBlockedWaitlistEntry({
        email,
        name: input.displayName,
      })
    }

    throw Object.assign(new Error('Workspace creation requires approval'), {
      status: 403,
      code: 'WORKSPACE_APPROVAL_REQUIRED',
    })
  },
}
