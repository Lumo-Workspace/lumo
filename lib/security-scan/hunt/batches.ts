/**
 * LUM-832 — a diff too big for one hunt is hunted in batches, across runs,
 * until every touched source file has been in a batch.
 *
 * `HUNT_OVERSIZED_SOURCE_FILES` was a ceiling on ONE run: past it, the tasks
 * covered "a corner" of the diff and the layer said so. It is a cost decision
 * per run, not a capability limit, and the machinery to spend TIME instead of
 * one run's space already existed (resumable runs, `huntAttempts`, the claim
 * CAS). Once agents write the code, a 100-file PR is the ordinary case, and
 * "split your PR" is not advice a customer can follow.
 *
 * So the diff is cut into batches of at most that many files, riskiest first
 * (the files carrying the most, and the most dangerous, signal sites stage A
 * already located), and each batch is one hunt run. The plan is a pure
 * function of the job, so a retry or a resumed run recomputes the same plan.
 *
 * Pure: no I/O, safe inside the deterministic workflow body.
 */
import {
  HUNT_OVERSIZED_SOURCE_FILES,
  type HuntJob,
} from '@/lib/services/security-hunt.config'
import type { HuntSignalSite } from './trigger'

/** How much a lit site says about a file's risk: sinks over entries over the rest. */
function siteWeight(rule: string): number {
  if (rule.startsWith('sink:')) return 3
  if (rule.startsWith('entry:')) return 2
  if (rule.startsWith('control:')) return 0
  return 1
}

/**
 * The files ordered riskiest first and cut into batches of `size`, or null
 * when one run covers the whole diff (the ordinary, un-batched hunt). Ties
 * break on the path, so the plan never depends on input order.
 */
export function planHuntBatches(
  paths: ReadonlyArray<string>,
  sites: ReadonlyArray<HuntSignalSite>,
  size: number = HUNT_OVERSIZED_SOURCE_FILES
): string[][] | null {
  const files = [...new Set(paths)]
  if (files.length <= size) return null
  const score = new Map<string, number>()
  for (const site of sites) {
    score.set(site.path, (score.get(site.path) ?? 0) + siteWeight(site.rule))
  }
  files.sort(
    (a, b) =>
      (score.get(b) ?? 0) - (score.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)
  )
  const batches: string[][] = []
  for (let i = 0; i < files.length; i += size) {
    batches.push(files.slice(i, i + size))
  }
  return batches
}

/**
 * The job one batch's run plans and hunts with: its files, and only the
 * signal sites inside them. Everything else — scan id, attempt fence, the
 * reasons stage A computed for the whole PR — is the job's own.
 */
export function scopeJobToBatch(
  job: HuntJob,
  files: ReadonlyArray<string>
): HuntJob {
  const inBatch = new Set(files)
  return {
    ...job,
    touchedSourcePaths: [...files],
    ...(job.signalSites
      ? { signalSites: job.signalSites.filter(s => inBatch.has(s.path)) }
      : {}),
  }
}

export interface HuntBatchProgress {
  coveredFiles: number
  totalFiles: number
}

/**
 * Covered / total for a batched hunt, read off the stored `huntJob` (the job
 * of the batch currently running or last run) and the layer's state. null
 * for an un-batched hunt — a single run needs no ratio, and a row from before
 * LUM-832 has no plan to read.
 *
 * While the layer is PENDING, the batches before the running one are
 * covered; once it settled (RAN / PARTIAL / FAILED / SKIPPED) the last batch
 * ran too, so every file was in a batch.
 */
export function huntBatchProgress(
  huntJob: unknown,
  huntStage: string | undefined
): HuntBatchProgress | null {
  if (!huntJob || typeof huntJob !== 'object') return null
  const { batches, batchIndex } = huntJob as {
    batches?: unknown
    batchIndex?: unknown
  }
  if (!Array.isArray(batches) || batches.length < 2) return null
  const sizes = batches.map(b => (Array.isArray(b) ? b.length : 0))
  const totalFiles = sizes.reduce((a, b) => a + b, 0)
  if (huntStage !== 'PENDING') return { coveredFiles: totalFiles, totalFiles }
  const index =
    typeof batchIndex === 'number' && batchIndex >= 0 ? batchIndex : 0
  const coveredFiles = sizes.slice(0, index).reduce((a, b) => a + b, 0)
  return { coveredFiles, totalFiles }
}

/**
 * The layer's state across batches: one PARTIAL batch makes the whole hunt
 * PARTIAL, one RAN batch beats SKIPPED ones (an empty plan for batch 2 does
 * not undo batch 1's hunt).
 */
export function mergeBatchStage(
  carried: 'RAN' | 'PARTIAL' | 'SKIPPED' | undefined,
  current: 'RAN' | 'PARTIAL' | 'SKIPPED'
): 'RAN' | 'PARTIAL' | 'SKIPPED' {
  const rank = { SKIPPED: 0, RAN: 1, PARTIAL: 2 } as const
  if (carried === undefined) return current
  return rank[carried] >= rank[current] ? carried : current
}
