import {
  sendEmail,
  isEmailDelivered,
  buildWorkspaceDeletionEmail,
} from '@/lib/integrations/email'
import { lookupUserProfiles } from '@/lib/auth/user-profiles'
import { logger } from '@/lib/logger'
import { resolveAppUrl } from '@/lib/config/public-config'

export interface DeletionNotice {
  kind: 'scheduled' | 'cancelled'
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  actorClerkId: string
  ownerClerkIds: readonly string[]
  requestedAt: Date
  executeAt: Date
}

/**
 * LUM-918: email every OWNER about a scheduled / cancelled workspace deletion.
 * Best-effort: a send failure is logged and counted, never thrown — the
 * deletion state change it reports has already committed.
 */
export async function sendDeletionNotice(
  notice: DeletionNotice
): Promise<{ sent: number; failed: number }> {
  const profiles = await lookupUserProfiles([
    ...new Set([...notice.ownerClerkIds, notice.actorClerkId]),
  ])
  const actor = profiles.get(notice.actorClerkId)
  const actorName = actor?.name ?? actor?.email ?? 'A workspace owner'
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  const { subject, html } = buildWorkspaceDeletionEmail({
    kind: notice.kind,
    workspaceName: notice.workspaceName,
    actorName,
    executeAt: notice.executeAt,
    settingsUrl: `${appUrl}/workspace/${notice.workspaceSlug}/settings/workspace`,
  })

  let sent = 0
  let failed = 0
  for (const clerkId of notice.ownerClerkIds) {
    const email = profiles.get(clerkId)?.email
    if (!email) {
      failed++
      continue
    }
    const result = await sendEmail(
      { to: [email], subject, html },
      {
        idempotencyKey: `workspace-deletion/${notice.workspaceId}/${notice.kind}/${notice.requestedAt.getTime()}/${clerkId}`,
      }
    )
    // A duplicate of a SENT key: this owner already got this notice
    // (LUM-1041); one still in flight elsewhere counts as not delivered.
    if (isEmailDelivered(result)) sent++
    else failed++
  }
  if (failed > 0) {
    logger.warn('[workspace-deletion] owner notice not delivered to all', {
      workspaceId: notice.workspaceId,
      kind: notice.kind,
      sent,
      failed,
    })
  }
  return { sent, failed }
}
