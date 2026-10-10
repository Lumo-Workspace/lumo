/**
 * LUM-775 — pure classification for the finding-queue report: every
 * `disposition: null` row lands in exactly one bucket, and each row still in
 * the queue says why it is there. `report.ts` reads the rows; this file only
 * sorts them, with the same predicate every product surface uses
 * (`lib/security-scan/queue-exit.ts`), so the report and the reminders can
 * never disagree about what "open" means.
 */
import type { QueueExitReason } from '@/shared/src/security-scan'
import { QUEUE_EXIT_REASONS } from '@/shared/src/security-scan'
import {
  explainQueueExit,
  queueExitContext,
  type QueueExitContext,
} from '@/ee/security/security-scan/queue-exit'
import {
  isBlockingUnderPolicy,
  type SecurityPolicy,
} from '@/ee/security/security-scan/policy'
import type { SecurityBaseline } from '@/ee/security/security-scan/types'

export type QueueBucket =
  | 'SUPERSEDED_SCAN'
  | 'PERSISTING'
  | QueueExitReason
  | 'OPEN'

export const QUEUE_BUCKETS: readonly QueueBucket[] = [
  'SUPERSEDED_SCAN',
  'PERSISTING',
  ...QUEUE_EXIT_REASONS,
  'OPEN',
]

export interface QueueFindingRow {
  id: string
  kind: string
  ruleId: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
  filePath: string
  fingerprint: string
  persisting: boolean
  scan: {
    id: string
    pullRequestId: string
    workspaceId: string
    pullRequest: {
      number: number
      state: string
      repo: string
      mergedAt: Date | null
    }
  }
}

export interface QueueInputs {
  /** Every undispositioned finding row. */
  rows: QueueFindingRow[]
  /** pullRequestId → id of that PR's newest scan (by startedAt). */
  latestScanIdByPr: ReadonlyMap<string, string>
  /** `${workspaceId}:${repo}` → the repo's default-branch baseline (null = never scanned). */
  baselines: ReadonlyMap<string, SecurityBaseline | null>
  /** workspaceId → parsed security policy. */
  policies: ReadonlyMap<string, SecurityPolicy>
  /** Fallback policy for a workspace not in `policies`. */
  defaultPolicy: SecurityPolicy
}

export interface OpenRow {
  id: string
  pr: number
  prState: string
  kind: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  blocking: boolean
  why: string
}

export interface QueueStats {
  total: number
  buckets: Record<QueueBucket, number>
  /** Rows by `PullRequest.state` (raw, before bucketing). */
  byPrState: Record<string, number>
  /** Distinct (ruleId × filePath) over every row — the task's "182". */
  dedupAll: number
  /** Distinct (ruleId × filePath) over OPEN rows. */
  dedupOpen: number
  /** OPEN rows by kind. */
  openByKind: Record<string, number>
  /** OPEN rows by their "why" sentence. */
  openByWhy: Record<string, number>
  open: OpenRow[]
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1
}

export function classifyQueue(inputs: QueueInputs): QueueStats {
  const buckets = Object.fromEntries(QUEUE_BUCKETS.map(b => [b, 0])) as Record<
    QueueBucket,
    number
  >
  const byPrState: Record<string, number> = {}
  const openByKind: Record<string, number> = {}
  const openByWhy: Record<string, number> = {}
  const open: OpenRow[] = []
  const dedupAll = new Set<string>()
  const dedupOpen = new Set<string>()
  const contexts = new Map<string, QueueExitContext>()
  const contextFor = (key: string): QueueExitContext => {
    let ctx = contexts.get(key)
    if (!ctx) {
      ctx = queueExitContext(inputs.baselines.get(key) ?? null)
      contexts.set(key, ctx)
    }
    return ctx
  }

  for (const row of inputs.rows) {
    const pr = row.scan.pullRequest
    bump(byPrState, pr.state)
    dedupAll.add(`${row.ruleId}|${row.filePath}`)
    let bucket: QueueBucket
    let why: string
    if (inputs.latestScanIdByPr.get(row.scan.pullRequestId) !== row.scan.id) {
      bucket = 'SUPERSEDED_SCAN'
      why = 'a newer scan of the same PR replaced this one'
    } else if (row.persisting) {
      bucket = 'PERSISTING'
      why = 'already on the default branch when the PR was scanned'
    } else {
      const policy =
        inputs.policies.get(row.scan.workspaceId) ?? inputs.defaultPolicy
      const explained = explainQueueExit(
        { ...row, disposition: null },
        { state: pr.state, mergedAt: pr.mergedAt },
        contextFor(`${row.scan.workspaceId}:${pr.repo}`),
        policy
      )
      bucket = explained.exit ?? 'OPEN'
      why = explained.why
    }
    buckets[bucket] += 1
    if (bucket !== 'OPEN') continue
    const policy =
      inputs.policies.get(row.scan.workspaceId) ?? inputs.defaultPolicy
    dedupOpen.add(`${row.ruleId}|${row.filePath}`)
    bump(openByKind, row.kind)
    bump(openByWhy, why)
    open.push({
      id: row.id,
      pr: pr.number,
      prState: pr.state,
      kind: row.kind,
      ruleId: row.ruleId,
      severity: row.severity,
      provenance: row.provenance,
      filePath: row.filePath,
      blocking: isBlockingUnderPolicy({ ...row, disposition: null }, policy),
      why,
    })
  }
  open.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      a.pr - b.pr ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.filePath.localeCompare(b.filePath)
  )
  return {
    total: inputs.rows.length,
    buckets,
    byPrState,
    dedupAll: dedupAll.size,
    dedupOpen: dedupOpen.size,
    openByKind,
    openByWhy,
    open,
  }
}

/** The numbers the task description was written against, for the side-by-side. */
export const TASK_START_REFERENCE = {
  rows: 985,
  dedup: 182,
  needingCode: 1,
} as const

export function renderQueueReport(stats: QueueStats): string {
  const lines: string[] = []
  lines.push('=== LUM-775 finding queue ===')
  lines.push(
    `undispositioned rows: ${stats.total} (task start: ${TASK_START_REFERENCE.rows})`
  )
  lines.push(
    `distinct rule×file, all rows: ${stats.dedupAll} (task start: ${TASK_START_REFERENCE.dedup})`
  )
  lines.push(`by PR state: ${JSON.stringify(stats.byPrState)}`)
  lines.push('')
  lines.push('buckets (each row in exactly one):')
  for (const b of QUEUE_BUCKETS)
    lines.push(`  ${b.padEnd(18)} ${stats.buckets[b]}`)
  lines.push('')
  lines.push(
    `OPEN — the current real queue: ${stats.buckets.OPEN} rows · ${stats.dedupOpen} distinct rule×file (task start needing code: ${TASK_START_REFERENCE.needingCode})`
  )
  lines.push(`  by kind: ${JSON.stringify(stats.openByKind)}`)
  lines.push(`  by reason: ${JSON.stringify(stats.openByWhy)}`)
  for (const r of stats.open) {
    lines.push(
      `  - PR #${r.pr} (${r.prState}) [${r.severity}] ${r.provenance} ${r.ruleId} — ${r.filePath} · ${r.blocking ? 'blocks DONE' : 'advisory'} · ${r.why}`
    )
  }
  lines.push('')
  return lines.join('\n')
}
