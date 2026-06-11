import type { TimelineEntry, TimelineActivityEntry } from '../../types'

/**
 * LUM-423: the acceptance mirror layer (LUM-343) renders one timeline row per
 * mirrored event — a 6-criterion draft is 6 rows, every verify round is one row
 * per criterion. That floods the timeline. This pure pass folds contiguous
 * same-transaction acceptance events into a single batch row, so the acceptance
 * category collapses to four milestone kinds: contract lock/revision, per-round
 * result, send-back, and the standalone escalation/final rows.
 *
 * Render-layer only — `verification_runs` + `TaskActivity` stay the sole fact
 * layer; this never reshapes data, it just groups it for display. Grouping is
 * over CONTIGUOUS entries (mirror events of one write transaction are written
 * back-to-back, so they arrive adjacent and share a wall-clock second), which
 * keeps two separate transactions of the same kind in separate rows.
 */

export type VerifierType = 'MACHINE' | 'HUMAN' | 'AGENT'

/** A passthrough row — rendered by the existing per-entry renderer. */
export interface EntryUnit {
  kind: 'entry'
  entry: TimelineEntry
}

/** A folded CRITERION_CHANGED batch: contract lock (AGENT_DRAFT) or revision. */
export interface CriterionBatchUnit {
  kind: 'criterion-batch'
  /** Stable key for React + adjacency grouping. */
  key: string
  createdAt: string
  actorId: string | null
  actor: Exclude<TimelineActivityEntry['actor'], undefined>
  /** AGENT_DRAFT = the locked initial draft; HUMAN_EDIT = a human revision. */
  source: string
  round: number | null
  total: number
  machineCount: number
  humanCount: number
  items: TimelineActivityEntry[]
}

/** A folded VERIFICATION_RUN_RECORDED batch, grouped by (round, verifierType). */
export interface VerificationBatchUnit {
  kind: 'verification-batch'
  key: string
  createdAt: string
  actorId: string | null
  actor: Exclude<TimelineActivityEntry['actor'], undefined>
  round: number | null
  verifierType: VerifierType
  total: number
  passed: number
  failed: number
  /** danger when any criterion in the round failed, else success. */
  tone: 'success' | 'danger'
  /** Send-back reason comment (LUM-422) — first non-null in the group. */
  commentId: string | null
  items: TimelineActivityEntry[]
}

export type RenderUnit = EntryUnit | CriterionBatchUnit | VerificationBatchUnit

const PASS_VERDICTS = new Set(['PASS', 'PASS_WITH_FOLLOWUP'])

function isActivity(e: TimelineEntry): e is TimelineActivityEntry {
  return e.kind === 'activity'
}

/** Wall-clock second bucket, so two transactions never merge by source alone. */
function secondBucket(createdAt: string): string {
  // ISO to second precision; falls back to the raw string if unparseable.
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return createdAt
  return new Date(t).toISOString().slice(0, 19)
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function readNumber(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function verifierOf(payload: Record<string, unknown> | null): VerifierType {
  // The machine path omits verifierType (implicit MACHINE); AGENT/HUMAN set it.
  const v = payload?.verifierType
  return v === 'HUMAN' || v === 'AGENT' ? v : 'MACHINE'
}

/** AGENT_DRAFT | HUMAN_EDIT — defaults to AGENT_DRAFT when absent. */
function sourceOf(payload: Record<string, unknown> | null): string {
  return readString(payload?.source) ?? 'AGENT_DRAFT'
}

/** Grouping key, or null for any entry that is not a foldable acceptance event. */
function batchKey(e: TimelineEntry): string | null {
  if (!isActivity(e)) return null
  if (e.type === 'CRITERION_CHANGED') {
    return `crit:${sourceOf(e.payload)}:${secondBucket(e.createdAt)}`
  }
  if (e.type === 'VERIFICATION_RUN_RECORDED') {
    const p = e.payload ?? {}
    return `ver:${readNumber(p.round) ?? '?'}:${verifierOf(e.payload)}`
  }
  return null
}

function criterionVerifier(
  e: TimelineActivityEntry
): 'MACHINE' | 'HUMAN' | null {
  const p = e.payload ?? {}
  const after = p.after as { verifierType?: unknown } | null
  const before = p.before as { verifierType?: unknown } | null
  const v = after?.verifierType ?? before?.verifierType
  return v === 'MACHINE' || v === 'HUMAN' ? v : null
}

function buildCriterionBatch(
  key: string,
  items: TimelineActivityEntry[]
): CriterionBatchUnit {
  const first = items[0]!
  let machineCount = 0
  let humanCount = 0
  for (const it of items) {
    const v = criterionVerifier(it)
    if (v === 'MACHINE') machineCount++
    else if (v === 'HUMAN') humanCount++
  }
  return {
    kind: 'criterion-batch',
    key,
    createdAt: first.createdAt,
    actorId: first.actorId,
    actor: first.actor ?? null,
    source: sourceOf(first.payload),
    round: readNumber(first.payload?.round),
    total: items.length,
    machineCount,
    humanCount,
    items,
  }
}

function buildVerificationBatch(
  key: string,
  items: TimelineActivityEntry[]
): VerificationBatchUnit {
  const first = items[0]!
  let passed = 0
  let failed = 0
  let commentId: string | null = null
  for (const it of items) {
    const verdict = readString(it.payload?.verdict)
    if (verdict && PASS_VERDICTS.has(verdict)) passed++
    else if (verdict === 'FAIL') failed++
    if (!commentId) commentId = readString(it.payload?.commentId)
  }
  return {
    kind: 'verification-batch',
    key,
    createdAt: first.createdAt,
    actorId: first.actorId,
    actor: first.actor ?? null,
    round: readNumber(first.payload?.round),
    verifierType: verifierOf(first.payload),
    total: items.length,
    passed,
    failed,
    tone: failed > 0 ? 'danger' : 'success',
    commentId,
    items,
  }
}

/**
 * Fold contiguous acceptance mirror events into batch units, passing every
 * other entry through untouched. Order is preserved. A batch is emitted even
 * for a single event so the acceptance category renders uniformly as milestone
 * rows (one row, expandable to the one item).
 */
export function aggregateTimeline(entries: TimelineEntry[]): RenderUnit[] {
  const units: RenderUnit[] = []
  let runKey: string | null = null
  let run: TimelineActivityEntry[] = []

  const flush = () => {
    if (run.length === 0 || runKey === null) return
    units.push(
      runKey.startsWith('crit:')
        ? buildCriterionBatch(runKey, run)
        : buildVerificationBatch(runKey, run)
    )
    run = []
    runKey = null
  }

  for (const entry of entries) {
    const key = batchKey(entry)
    if (key === null) {
      flush()
      units.push({ kind: 'entry', entry })
      continue
    }
    if (key !== runKey) {
      flush()
      runKey = key
    }
    run.push(entry as TimelineActivityEntry)
  }
  flush()

  return units
}
