import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'
import {
  detectGitRejections,
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

/** The revertingSha already recorded as a GIT signal, if present in evidence. */
function existingRevertingSha(evidence: unknown): string | null {
  if (evidence && typeof evidence === 'object' && 'revertingSha' in evidence) {
    const v = (evidence as { revertingSha?: unknown }).revertingSha
    return typeof v === 'string' ? v : null
  }
  return null
}

export const gitOutcomeRecorder = {
  async recordGitRejections(
    input: RecordGitRejectionsInput
  ): Promise<RecordGitRejectionsResult> {
    const signals = detectGitRejections(input.delivery, input.run)

    const existing = await outcomeSignalRepository.listForTask(input.taskId)
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
        workspaceId: input.workspaceId,
        taskId: input.taskId,
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

    return { signals, inserted, skipped }
  },
}
