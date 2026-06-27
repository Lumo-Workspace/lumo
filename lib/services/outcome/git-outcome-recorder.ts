import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  detectGitRejections,
  parseRevertTrailers,
  type DeliveryRef,
  type GitRejectionSignal,
  type GitRunner,
} from '@/lib/services/outcome/git-referent-detector'

/**
 * LUM-601 — wire the git-topology detector into the outcome well. Runs the
 * detector against a local checkout and records each rejection as a source=GIT
 * OutcomeSignal, carrying the concrete reverting/reverted SHAs as the (agent-
 * unforgeable) evidence.
 *
 * Idempotent: a GIT signal is keyed by its revertingSha, so re-running over the
 * same history never double-inserts. The well stays append-only — this only ever
 * adds genuinely new rejections.
 *
 * The agent is NOT in the write loop: the only inputs are git commit topology
 * (detector) and the task's delivery shas. There is deliberately no field by
 * which a process/agent could self-report "this turned out fine/bad".
 */

export interface RecordGitRejectionsInput {
  workspaceId: string
  taskId: string
  delivery: DeliveryRef
  /** Injected in tests; defaults to real git inside the detector. */
  run?: GitRunner
}

export interface RecordGitRejectionsResult {
  signals: GitRejectionSignal[]
  inserted: number
  skipped: number
}

/** One commit from a push payload — sha + full message (the trailer source). */
export interface PushCommit {
  sha: string
  message: string
}

export interface RecordRevertsFromPushInput {
  workspaceId: string
  /** The pushed ref, e.g. `refs/heads/main`. */
  ref: string
  /** The repo's default branch name, e.g. `main`. */
  defaultBranch: string
  commits: PushCommit[]
}

export interface RecordRevertsFromPushResult {
  signals: GitRejectionSignal[]
  inserted: number
  skipped: number
}

/** The revertingSha already recorded as a GIT signal, if present in evidence. */
function existingRevertingSha(evidence: unknown): string | null {
  if (evidence && typeof evidence === 'object' && 'revertingSha' in evidence) {
    const v = (evidence as { revertingSha?: unknown }).revertingSha
    return typeof v === 'string' ? v : null
  }
  return null
}

/**
 * Append every not-yet-recorded signal for one task, deduping by revertingSha
 * against the task's existing GIT signals. Shared by both feeds (backfill
 * detector + webhook push), so a revert seen by both is recorded once — the
 * well stays append-only and duplicate-free regardless of which path saw it.
 */
async function persistNewSignals(
  workspaceId: string,
  taskId: string,
  signals: GitRejectionSignal[]
): Promise<{ inserted: number; skipped: number }> {
  const existing = await outcomeSignalRepository.listForTask(taskId)
  const seen = new Set(
    existing
      .filter(s => s.source === 'GIT')
      .map(s => existingRevertingSha(s.evidence))
      .filter((v): v is string => v !== null)
  )

  let inserted = 0
  let skipped = 0
  for (const sig of signals) {
    if (seen.has(sig.revertingSha)) {
      skipped++
      continue
    }
    await outcomeSignalRepository.insert({
      workspaceId,
      taskId,
      kind: sig.kind,
      source: 'GIT',
      occurredAt: null,
      evidence: {
        mechanism: sig.mechanism,
        revertingSha: sig.revertingSha,
        revertedSha: sig.revertedSha,
      },
    })
    seen.add(sig.revertingSha)
    inserted++
  }
  return { inserted, skipped }
}

export const gitOutcomeRecorder = {
  async recordGitRejections(
    input: RecordGitRejectionsInput
  ): Promise<RecordGitRejectionsResult> {
    const signals = detectGitRejections(input.delivery, input.run)
    const { inserted, skipped } = await persistNewSignals(
      input.workspaceId,
      input.taskId,
      signals
    )
    return { signals, inserted, skipped }
  },

  /**
   * LUM-607 — the webhook forward feed. Records REVERTED signals from a `push`
   * to the default branch, WITHOUT a git checkout: the `This reverts commit
   * <sha>` trailer is read straight from each commit message in the payload,
   * and a trailer's sha is mapped back to a known delivery (a merged PR on a
   * DONE task) by exact membership. No trailer / unknown sha / non-default
   * branch → nothing recorded (573 red line: sha topology, never wording).
   *
   * Same well rows as the backfill script (source=GIT, evidence shape, keyed by
   * revertingSha), so the steady-state feed and a one-time backfill never
   * double-count the same revert.
   */
  async recordRevertsFromPush(
    input: RecordRevertsFromPushInput
  ): Promise<RecordRevertsFromPushResult> {
    if (input.ref !== `refs/heads/${input.defaultBranch}`) {
      return { signals: [], inserted: 0, skipped: 0 }
    }

    // Group detected signals per delivered task (one revert can only map to one
    // delivery, but a single push may revert several).
    const byTask = new Map<string, GitRejectionSignal[]>()
    const all: GitRejectionSignal[] = []
    for (const commit of input.commits) {
      for (const revertedSha of parseRevertTrailers(commit.message)) {
        const delivery =
          await pullRequestRepository.findMergedDeliveryByMergeCommitSha(
            input.workspaceId,
            revertedSha
          )
        if (!delivery?.taskId) continue
        const sig: GitRejectionSignal = {
          kind: 'REVERTED',
          mechanism: 'revert-commit',
          revertingSha: commit.sha,
          revertedSha,
        }
        all.push(sig)
        const list = byTask.get(delivery.taskId) ?? []
        list.push(sig)
        byTask.set(delivery.taskId, list)
      }
    }

    let inserted = 0
    let skipped = 0
    for (const [taskId, signals] of byTask) {
      const res = await persistNewSignals(input.workspaceId, taskId, signals)
      inserted += res.inserted
      skipped += res.skipped
    }
    return { signals: all, inserted, skipped }
  },
}
