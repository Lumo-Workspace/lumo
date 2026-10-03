/**
 * LUM-911 — how long a PR security scan keeps the customer code it quoted.
 * Pure (no Prisma, no I/O): the sweep, the zero-retention hook, the settings
 * API and the settings card share one definition.
 *
 * A scan is "used up" once its PR is merged or closed (no new push, no new
 * scan) and every scan of the PR is final (no hunt left to resume). The code
 * fields are scrubbed `retentionDays` after that; on a PR that stays open,
 * `SCAN_EVIDENCE_HARD_CAP_DAYS` after the scan finished. 0 = zero retention:
 * scrubbed as soon as the scan is final.
 */

/** OWNER-selectable retention tiers, in days. 0 = zero retention. */
export const SCAN_EVIDENCE_RETENTION_DAYS = [0, 7, 14, 30] as const

export type ScanEvidenceRetentionDays =
  (typeof SCAN_EVIDENCE_RETENTION_DAYS)[number]

export const DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS: ScanEvidenceRetentionDays = 7

/**
 * A scan on a PR that never closes still gives its code up this long after
 * it finished. Not below the longest tier: an OWNER's choice is never cut
 * short by the cap.
 */
export const SCAN_EVIDENCE_HARD_CAP_DAYS = 30

export function isScanEvidenceRetentionDays(
  value: unknown
): value is ScanEvidenceRetentionDays {
  return (SCAN_EVIDENCE_RETENTION_DAYS as readonly unknown[]).includes(value)
}

const DAY_MS = 24 * 60 * 60 * 1000

const FINAL_STATUSES = new Set(['CLEAN', 'FINDINGS', 'FAILED'])

export interface RetentionScan {
  status: string
  /** Per-layer outcome Json; any layer still PENDING means not final. */
  stages: unknown
  startedAt: Date
  finishedAt: Date | null
}

export interface RetentionPullRequest {
  state: string
  mergedAt: Date | null
  closedAt: Date | null
  updatedAt: Date
}

/** Final: the scan reached a terminal status and no layer is still pending (a hunt to resume). */
export function isScanFinal(scan: Pick<RetentionScan, 'status' | 'stages'>) {
  if (!FINAL_STATUSES.has(scan.status)) return false
  const stages = scan.stages
  if (stages === null || typeof stages !== 'object') return true
  return !Object.values(stages as Record<string, unknown>).includes('PENDING')
}

/** When the PR stopped taking pushes; null while it is open. */
export function pullRequestEndedAt(pr: RetentionPullRequest): Date | null {
  if (pr.state !== 'merged' && pr.state !== 'closed') return null
  // A row synced without GitHub's timestamps: updatedAt is when it was seen closed.
  return pr.mergedAt ?? pr.closedAt ?? pr.updatedAt
}

/**
 * LUM-914 — why a scan's code is due at `now`: `zero_retention` (the tier is
 * 0), `hard_cap` (finished `SCAN_EVIDENCE_HARD_CAP_DAYS` ago, PR open or
 * not), `pr_ended` (PR merged or closed and every scan of it final, the
 * tier's days ago). Null = not due. `isScanEvidenceExpired` is this ≠ null.
 */
export type ScanEvidenceExpiryReason =
  | 'zero_retention'
  | 'hard_cap'
  | 'pr_ended'

export function scanEvidenceExpiryReason(input: {
  scan: RetentionScan
  pullRequest: RetentionPullRequest
  allScansFinal: boolean
  retentionDays: number
  now: Date
}): ScanEvidenceExpiryReason | null {
  const { scan, pullRequest, allScansFinal, now } = input
  if (!isScanFinal(scan)) return null
  const days = isScanEvidenceRetentionDays(input.retentionDays)
    ? input.retentionDays
    : DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS
  if (days === 0) return 'zero_retention'

  const finishedAt = scan.finishedAt ?? scan.startedAt
  const cap = Math.max(SCAN_EVIDENCE_HARD_CAP_DAYS, days)
  if (now.getTime() >= finishedAt.getTime() + cap * DAY_MS) return 'hard_cap'

  const endedAt = pullRequestEndedAt(pullRequest)
  if (!endedAt || !allScansFinal) return null
  return now.getTime() >= endedAt.getTime() + days * DAY_MS ? 'pr_ended' : null
}

/**
 * Is this scan's code due to be scrubbed at `now`? `allScansFinal` is over
 * every scan of the scan's PR: a merged PR whose newest scan still has a hunt
 * running keeps its older scans' code until that hunt ends.
 */
export function isScanEvidenceExpired(input: {
  scan: RetentionScan
  pullRequest: RetentionPullRequest
  allScansFinal: boolean
  retentionDays: number
  now: Date
}): boolean {
  return scanEvidenceExpiryReason(input) !== null
}

/** The cutoffs a sweep query can narrow candidates with before the exact check. */
export function retentionCutoffs(now: Date) {
  return {
    // Anything finished before this is past the hard cap whatever the tier.
    hardCap: new Date(now.getTime() - SCAN_EVIDENCE_HARD_CAP_DAYS * DAY_MS),
  }
}

// ── huntAudit → counts ──────────────────────────────────────────────────────

const REDACTED = 'redacted'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pick(source: Json, keys: readonly string[]): Json {
  const out: Json = {}
  for (const key of keys) if (key in source) out[key] = source[key]
  return out
}

/** Number-only objects (subgraph, diff, resolution…): copied as-is, anything else dropped. */
function numbersOnly(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (!isObject(value)) return undefined
  const out: Json = {}
  for (const [key, inner] of Object.entries(value)) {
    const kept = numbersOnly(inner)
    if (kept !== undefined) out[key] = kept
  }
  return out
}

const TOP_LEVEL_COUNTS = [
  'batch',
  'candidates',
  'resolution',
  'falsifierRejects',
  'subgraph',
  'diff',
  'overCap',
  'compress',
] as const

const TOP_LEVEL_LABELS = [
  'plannedBy',
  'taskContext',
  'sandbox',
  'egressDenied',
  'model',
] as const

const TASK_FIELDS = [
  'taskId',
  'category',
  'candidates',
  'tokens',
  'elapsedMs',
  'stopped',
  'sites',
  'model',
] as const

/**
 * The hunt audit with everything that can quote code removed — objectives,
 * starting points, rejected sinks and reasons, plan failure text, errors —
 * keeping the counts the readers still show: candidates, coverage per task
 * (`parseHuntCoverage`), the over-cap and oversized-diff facts, the
 * resolution tally. Same shape, so every reader keeps working; list lengths
 * are kept, their entries emptied to the closed `category` value.
 */
export function redactHuntAuditToCounts(raw: unknown): Json | null {
  if (!isObject(raw)) return null
  const out: Json = {}
  for (const key of TOP_LEVEL_COUNTS) {
    if (!(key in raw)) continue
    const kept = numbersOnly(raw[key])
    if (kept !== undefined) out[key] = kept
  }
  for (const key of TOP_LEVEL_LABELS) {
    const value = raw[key]
    if (typeof value === 'string' || typeof value === 'boolean')
      out[key] = value
  }
  for (const key of ['rejected', 'falsifierRejected', 'planned'] as const) {
    const list = raw[key]
    if (!Array.isArray(list)) continue
    out[key] = list.map(entry =>
      isObject(entry) && typeof entry.category === 'string'
        ? { category: entry.category }
        : {}
    )
  }
  // Pre-LUM-758 rows call the task list `categories`.
  for (const key of ['tasks', 'categories'] as const) {
    const rows = raw[key]
    if (!Array.isArray(rows)) continue
    out[key] = rows.filter(isObject).map(row => {
      const kept = pick(row, TASK_FIELDS)
      // Whether a task ended reads the wrap-up's `ran`, an error's presence
      // and the warning count — never their text.
      if (isObject(row.wrapUp)) {
        kept.wrapUp = {
          ran: row.wrapUp.ran === true,
          ...(row.wrapUp.error !== undefined ? { error: REDACTED } : {}),
        }
      }
      if (Array.isArray(row.wrapUpWarnings)) {
        kept.wrapUpWarnings = row.wrapUpWarnings.map(() => REDACTED)
      }
      return kept
    })
  }
  if (raw.error !== undefined) out.error = REDACTED
  return out
}
