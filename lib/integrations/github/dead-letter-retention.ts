/**
 * LUM-913 — PURE. What a dead-lettered PR comment sync job keeps once its
 * GitHub webhook payload is dropped. An inbound job's `payload.raw` is the
 * whole webhook body (comment text, `diff_hunk`, …); after the grace period
 * the row keeps only the fields someone troubleshooting a failed sync needs:
 * which operation / event it was, which task and PR it belonged to. The error
 * and timestamps live in their own columns and are untouched.
 */

/** Days a dead letter keeps its full payload after entering DEAD_LETTER. */
export const DEAD_LETTER_PAYLOAD_RETENTION_DAYS = 7

/** Top-level payload keys that never carry code or comment text. */
const KEPT_KEYS = [
  'op',
  'mirrorId',
  'event',
  'action',
  'reason',
  'workspaceId',
  'taskId',
  'pullRequestId',
  'commentId',
] as const

export type PurgedDeadLetterPayload = Record<string, string | number | true>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function scalar(v: unknown): string | number | undefined {
  if (typeof v === 'string') return v.slice(0, 200)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

/**
 * The metadata-only payload that replaces a dead letter's payload. Unknown
 * keys are dropped (allow-list, not deny-list), so a payload shape added later
 * cannot leak code past the purge.
 */
export function buildPurgedDeadLetterPayload(
  payload: unknown
): PurgedDeadLetterPayload {
  const out: PurgedDeadLetterPayload = { rawPurged: true }
  if (!isRecord(payload)) return out
  for (const key of KEPT_KEYS) {
    const v = scalar(payload[key])
    if (v !== undefined) out[key] = v
  }
  const raw = payload.raw
  if (isRecord(raw)) {
    const repository = raw.repository
    const repo = isRecord(repository) ? scalar(repository.full_name) : undefined
    if (repo !== undefined) out.repo = repo
    const pr = isRecord(raw.pull_request)
      ? raw.pull_request
      : isRecord(raw.issue)
        ? raw.issue
        : undefined
    const prNumber = pr ? scalar(pr.number) : undefined
    if (prNumber !== undefined) out.prNumber = prNumber
  }
  return out
}

/** Dead letters that entered DEAD_LETTER at or before this instant are due. */
export function deadLetterPurgeCutoff(now: Date): Date {
  return new Date(
    now.getTime() - DEAD_LETTER_PAYLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
}
