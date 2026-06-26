import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import type { InsertOutcomeSignalInput } from '@/lib/repositories/outcome-signal.repository'

/**
 * LUM-598 — the post-hoc outcome well as a falsifier oracle.
 *
 * The well is the single external source of truth for correctness + fidelity:
 * it reads the real-world fate a delivery met *after* it shipped. Its defining
 * INVARIANT is that it is a falsifier, not a verifier — it can only ever say
 * "reality REJECTED this delivery" or "we have no rejection on record"
 * (INCONCLUSIVE). It never says "satisfied".
 *
 * Why no SATISFIED branch: the absence of a rejection signal is NOT evidence of
 * satisfaction. "N sprints and nobody touched it" is externally indistinguish-
 * able between genuinely-good, merely-tolerated, and never-noticed. Collapsing
 * that ambiguity into PASS is exactly the self-grading the well exists to
 * replace. So the verdict type below has exactly two members, by construction.
 */

/** The complete verdict space. There is deliberately no 'SATISFIED'/'PASS'. */
export const OUTCOME_VERDICTS = ['REJECTED', 'INCONCLUSIVE'] as const
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number]

/**
 * Kinds a human may record manually. Excludes REOPENED, which is owned by the
 * automatic lineage fold (reopen → REWORKED) — a human reopens the task, they
 * don't hand-file the signal for it.
 */
export const MANUAL_OUTCOME_KINDS = [
  'REVERTED',
  'ROLLED_BACK',
  'CI_REGRESSION',
  'DOWNSTREAM_REDIRECT',
  'BYPASSED',
  'MANUAL',
] as const
export type ManualOutcomeKind = (typeof MANUAL_OUTCOME_KINDS)[number]

export const outcomeWellService = {
  OUTCOME_VERDICTS,

  /**
   * The oracle. REJECTED iff the well holds ≥1 rejection signal for the task;
   * otherwise INCONCLUSIVE. The verdict is derived purely from signal presence
   * — never from any agent-supplied judgment, and never upgraded to a "pass".
   */
  async deriveVerdict(taskId: string): Promise<OutcomeVerdict> {
    const count = await outcomeSignalRepository.countForTask(taskId)
    return count > 0 ? 'REJECTED' : 'INCONCLUSIVE'
  },

  /**
   * Append one rejection signal (the manual / programmatic entry point). Always
   * an insert — re-recording adds a row, never mutates a prior one. Returns the
   * created signal.
   */
  async record(input: InsertOutcomeSignalInput) {
    return outcomeSignalRepository.insert(input)
  },

  /**
   * The human entry point (`lumo outcome record`). A human observed reality
   * reject the delivery and records it with a mandatory note (the referent).
   * Always source MANUAL; the note is frozen as evidence.
   */
  async recordManual(input: {
    workspaceId: string
    taskId: string
    kind: ManualOutcomeKind
    note: string
    occurredAt?: Date | null
    recordedByMemberId?: string | null
    sessionId?: string | null
  }) {
    return outcomeSignalRepository.insert({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      kind: input.kind,
      source: 'MANUAL',
      occurredAt: input.occurredAt ?? null,
      evidence: { note: input.note },
      recordedByMemberId: input.recordedByMemberId ?? null,
      sessionId: input.sessionId ?? null,
    })
  },

  /** Read the well for a task: the oracle verdict plus its backing signals. */
  async readWell(taskId: string) {
    const [verdict, signals] = await Promise.all([
      outcomeWellService.deriveVerdict(taskId),
      outcomeSignalRepository.listForTask(taskId),
    ])
    return { verdict, signals }
  },

  /**
   * Fold the existing "task reopened after MERGED" fact (the REWORKED lineage
   * transition) into the well as a first-class REOPENED rejection signal.
   *
   * This is a referent the agent cannot construct: the task was delivered, then
   * reality (a regression, a human reopen) sent it back to be redone. Resolves
   * the task's workspaceId via the lean auth projection. Returns null when the
   * task can't be resolved (caller is best-effort and swallows it).
   */
  async recordReopen(
    taskId: string,
    opts?: {
      sessionId?: string | null
      evidence?: InsertOutcomeSignalInput['evidence']
    }
  ) {
    const task = await taskRepository.findWithProjectWorkspaceId(taskId)
    if (!task) return null
    return outcomeSignalRepository.insert({
      workspaceId: task.project.workspaceId,
      taskId,
      kind: 'REOPENED',
      source: 'LINEAGE',
      occurredAt: new Date(),
      sessionId: opts?.sessionId ?? null,
      ...(opts?.evidence !== undefined ? { evidence: opts.evidence } : {}),
    })
  },
}
