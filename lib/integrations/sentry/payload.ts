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
 * Known levels keep their mapping (info / debug → LOW); an unknown or
 * missing level → NONE ("not assessed", LUM-1284) rather than a guess.
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
    case 'info':
    case 'debug':
      return 'LOW'
    default:
      return 'NONE'
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
  const reportedLevel =
    typeof ev.level === 'string' && ev.level !== '' ? ev.level : null
  const level = (reportedLevel as SentryLevel | null) ?? DEFAULT_LEVEL

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
    reportedLevel,
    webUrl,
    eventCount,
    firstSeen: ev.firstSeen ?? null,
    lastSeen: ev.lastSeen ?? null,
    stackFrames,
    triggeredRule: payload.data.triggered_rule ?? null,
  }
}

const MAX_STACK_FRAMES = 5
const MAX_LINE_LEN = 200

/**
 * Build a Markdown task description from extracted Sentry fields.
 */
export function buildTaskDescription(fields: ExtractedIssueFields): string {
  const lines: string[] = []

  lines.push(`**Sentry issue:** [${fields.title}](${fields.webUrl})`)
  lines.push('')

  if (fields.culprit) {
    lines.push(`**Culprit:** \`${fields.culprit}\``)
  }
  lines.push(`**Level:** \`${fields.level}\``)

  const meta: string[] = []
  if (fields.eventCount !== null) meta.push(`**Events:** ${fields.eventCount}`)
  if (fields.firstSeen) meta.push(`First seen: ${fields.firstSeen}`)
  if (fields.lastSeen) meta.push(`Last seen: ${fields.lastSeen}`)
  if (meta.length > 0) lines.push(meta.join(' · '))

  if (fields.stackFrames.length > 0) {
    lines.push('')
    lines.push('**Stack (top 5 frames):**')
    lines.push('```')
    const frames = [...fields.stackFrames].reverse().slice(0, MAX_STACK_FRAMES)
    for (const f of frames) {
      const fn = f.function ?? '<anonymous>'
      const file = f.filename ?? '<unknown>'
      const ln = f.lineno ?? 0
      let line = `  at ${fn} (${file}:${ln})`
      if (line.length > MAX_LINE_LEN) {
        line = line.slice(0, MAX_LINE_LEN - 3) + '...'
      }
      lines.push(line)
    }
    lines.push('```')
  }

  lines.push('')
  lines.push('_Created automatically from Sentry alert._')

  return lines.join('\n')
}
