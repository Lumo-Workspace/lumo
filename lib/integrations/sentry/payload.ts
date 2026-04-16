import type { TaskPriority } from '@prisma/client'
import type {
  ExtractedIssueFields,
  SentryIssueAlertPayload,
  SentryLevel,
  SentryStackFrame,
} from './types'

const DEFAULT_LEVEL: SentryLevel = 'info'

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

/**
 * Pull the issue-level fields we care about out of a Sentry webhook payload.
 * Throws if the two strictly-required identifiers (issue_id + project_slug)
 * are missing — those are the dedup key and routing key.
 */
export function extractIssueFields(
  payload: SentryIssueAlertPayload
): ExtractedIssueFields {
  const ev = payload.data.event

  const sentryIssueId = ev.issue_id
  if (!sentryIssueId) {
    throw new Error('Sentry payload missing data.event.issue_id')
  }
  const sentryProjectSlug = ev.project_slug
  if (!sentryProjectSlug) {
    throw new Error('Sentry payload missing data.event.project_slug')
  }

  const title = (ev.title ?? '(untitled Sentry issue)').slice(0, 200)
  const webUrl = ev.web_url ?? ev.issue_url ?? ''
  const level = (ev.level as SentryLevel | undefined) ?? DEFAULT_LEVEL

  const stackFrames: SentryStackFrame[] = (() => {
    const values = ev.entries?.find(e => e.type === 'exception')?.data?.values
    const frames = values?.[0]?.stacktrace?.frames
    return frames ?? []
  })()

  const eventCountRaw = ev.count
  const eventCount =
    typeof eventCountRaw === 'number'
      ? eventCountRaw
      : typeof eventCountRaw === 'string' && eventCountRaw.trim() !== ''
        ? Number.parseInt(eventCountRaw, 10) || null
        : null

  return {
    sentryIssueId,
    sentryProjectSlug,
    title,
    culprit: ev.culprit ?? null,
    level,
    webUrl,
    eventCount,
    firstSeen: ev.firstSeen ?? null,
    lastSeen: ev.lastSeen ?? null,
    stackFrames,
    triggeredRule: payload.data.triggered_rule ?? null,
  }
}
