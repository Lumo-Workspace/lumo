import type { TaskPriority } from '@prisma/client'
import type { SentryIssueAlertPayload } from './types'

/**
 * Map a Sentry level string to a Lumo TaskPriority.
 * Unknown / missing levels → LOW.
 */
export function mapLevelToPriority(
  level: string | undefined | null
): TaskPriority {
  switch (level) {
    case 'fatal':
      return 'URGENT'
    case 'error':
      return 'HIGH'
    case 'warning':
      return 'MEDIUM'
    default:
      return 'LOW'
  }
}

/**
 * Extract usable email candidates for assignee matching, in priority order:
 *   1. suggestedOwners entries whose owner.type === 'user' and have email
 *   2. fallback to the top-level actor.email (if present)
 */
export function pickSuggestedOwnerEmails(
  payload: SentryIssueAlertPayload
): string[] {
  const fromOwners = (payload.data.event.suggestedOwners ?? [])
    .filter(o => o.owner?.type === 'user' && !!o.owner?.email)
    .map(o => o.owner!.email!)

  if (fromOwners.length > 0) return fromOwners

  const actorEmail = payload.actor?.email
  return actorEmail ? [actorEmail] : []
}
