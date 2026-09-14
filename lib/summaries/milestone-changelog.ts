import { fromSample, noBaseline } from '@/lib/baseline/adapters'
import { MIN_BASELINE_SAMPLE, type BaselineStat } from '@/lib/baseline/types'
import {
  milestoneState,
  type MilestoneState,
} from '@/lib/summaries/milestone-state'

/**
 * LUM-649 — automatic milestone changelog. A pure fold over pre-fetched rows
 * (mirrors the LUM-632 `computeMilestoneDeliveryStats` pattern), so the honest
 * assembly is unit-testable without a database. No LLM, no I/O — deterministic
 * assembly of a milestone's DONE tasks + their merged PRs + frozen
 * claimSnapshot into a structured changelog.
 *
 * Honesty invariants (the acceptance contract):
 * - one entry per DONE task; a task with no merged PR is kept with an empty
 *   `prs` list, never silently dropped;
 * - claim provenance is three-state fail-closed: a synthesized-but-empty claim
 *   (`claimSnapshotAt` set, text null) is an explicit `empty` "no material",
 *   distinct from a never-synthesized `unsynthesized` claim;
 * - headline counts carry a LUM-508 baseline: a real `base` only with
 *   >= MIN_BASELINE_SAMPLE prior milestones, else an honest no-baseline —
 *   never a naked number, never a fabricated thin baseline.
 */

/** One merged PR assembled onto a changelog entry. */
export interface ChangelogPr {
  repo: string
  number: number
  title: string
  mergeCommitSha: string | null
}

/**
 * Claim provenance on an entry — three honest states:
 * - `present` — the frozen claim text plus its source/session pointer;
 * - `empty` — synthesized watermark set but the claim text is null
 *   (authoritative "no material", fail-closed — NOT "never synthesized");
 * - `unsynthesized` — no watermark yet (claim was never frozen).
 */
export type ChangelogClaim =
  | {
      status: 'present'
      text: string
      source: string | null
      sessionId: string | null
    }
  | { status: 'empty' }
  | { status: 'unsynthesized' }

/** One DONE task in the changelog. */
export interface ChangelogEntry {
  identifier: string
  title: string
  /** Merged PRs for this task; empty = explicit "no merged PR", never dropped. */
  prs: ChangelogPr[]
  claim: ChangelogClaim
}

/** A DONE task row as pre-fetched by the service (already filtered + ordered). */
export interface ChangelogTaskRow {
  id: string
  identifier: string
  title: string
  claimSnapshot: string | null
  claimSnapshotSource: string | null
  claimSnapshotSessionId: string | null
  claimSnapshotAt: Date | null
}

/** A merged PR row as pre-fetched by the service, joined to its task by id. */
export interface ChangelogPrRow {
  taskId: string
  repo: string
  number: number
  title: string
  mergeCommitSha: string | null
}

export interface BuildChangelogInput {
  milestone: {
    name: string
    completedAt: Date | null
    archivedAt: Date | null
    startDate: Date | null
    targetDate: Date | null
  }
  /** DONE tasks only — the service filters + orders (newest delivery first). */
  doneTasks: ChangelogTaskRow[]
  /** Merged PRs across those DONE tasks. */
  mergedPrs: ChangelogPrRow[]
  /**
   * Prior completed milestones' delivery counts (same project), the reference
   * class for the headline baselines. Length < MIN_BASELINE_SAMPLE → no base.
   */
  priorMilestoneCounts: Array<{ doneTaskCount: number; mergedPrCount: number }>
}

export type { MilestoneState }

export interface MilestoneChangelog {
  milestone: {
    name: string
    state: MilestoneState
    startDate: string | null
    targetDate: string | null
  }
  headline: {
    tasksShipped: BaselineStat
    prsMerged: BaselineStat
  }
  entries: ChangelogEntry[]
}

function toClaim(task: ChangelogTaskRow): ChangelogClaim {
  if (task.claimSnapshot !== null) {
    return {
      status: 'present',
      text: task.claimSnapshot,
      source: task.claimSnapshotSource,
      sessionId: task.claimSnapshotSessionId,
    }
  }
  // Text is null: distinguish an authoritative empty snapshot (watermark set,
  // fail-closed "no material") from one that was never synthesized.
  return task.claimSnapshotAt !== null
    ? { status: 'empty' }
    : { status: 'unsynthesized' }
}

/**
 * Baseline a headline count against the prior-milestone sample, but ONLY when
 * the sample reaches MIN_BASELINE_SAMPLE — below that we fall back to an honest
 * no-baseline rather than a thin, misleading `base` (fromSample would populate
 * `base` off a single prior; the >=3 gate is the honest floor LUM-508's view
 * enforces at render, applied here at assembly).
 */
function baselineCount(current: number, sample: number[]): BaselineStat {
  return sample.length >= MIN_BASELINE_SAMPLE
    ? fromSample(current, sample, 'magnitude')
    : noBaseline(current)
}

export function buildMilestoneChangelog(
  input: BuildChangelogInput
): MilestoneChangelog {
  const { milestone, doneTasks, mergedPrs, priorMilestoneCounts } = input

  // Group merged PRs by task, preserving fetch order (service orders them).
  const prsByTask = new Map<string, ChangelogPr[]>()
  for (const pr of mergedPrs) {
    const list = prsByTask.get(pr.taskId) ?? []
    list.push({
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      mergeCommitSha: pr.mergeCommitSha,
    })
    prsByTask.set(pr.taskId, list)
  }

  const entries: ChangelogEntry[] = doneTasks.map(task => ({
    identifier: task.identifier,
    title: task.title,
    prs: prsByTask.get(task.id) ?? [],
    claim: toClaim(task),
  }))

  const tasksShipped = baselineCount(
    doneTasks.length,
    priorMilestoneCounts.map(c => c.doneTaskCount)
  )
  const prsMerged = baselineCount(
    mergedPrs.length,
    priorMilestoneCounts.map(c => c.mergedPrCount)
  )

  return {
    milestone: {
      name: milestone.name,
      state: milestoneState(milestone),
      startDate: milestone.startDate?.toISOString() ?? null,
      targetDate: milestone.targetDate?.toISOString() ?? null,
    },
    headline: { tasksShipped, prsMerged },
    entries,
  }
}
