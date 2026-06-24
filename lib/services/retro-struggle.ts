import type {
  StruggleTrail,
  MachineVerificationSummary,
} from '@/lib/services/task-verification.service'

/**
 * The per-task slice the cross-task retro aggregator consumes — a strict subset
 * of {@link TaskAcceptanceStatus} (LUM-561/456). Typed against the same source
 * the per-task report reads so a milestone/sprint retro cannot drift from
 * `lumo task status`: the negative-class numbers are rolled up, never
 * re-derived from a parallel query.
 */
export interface RetroStruggleInput {
  task: { identifier: string; title: string }
  struggleTrail: StruggleTrail
  machineVerification: MachineVerificationSummary
}

/** Per-task detail for the hard tasks — lets the retro name *where* the work
 *  was hard instead of only reporting a milestone-wide count. */
export interface HardTaskDetail {
  identifier: string
  title: string
  reworkRounds: number
  openSendBacks: number
  reopens: number
  extraPrCycles: number
  humanOverridden: number
}

/**
 * The milestone/sprint-level rollup of the negative-class struggle signals
 * (LUM-506). Every field aggregates the per-task struggleTrail / machine-
 * verification source so the retro reports the rework, send-backs, reopens and
 * human overrides a clean all-green title list would otherwise wipe. An
 * all-zero aggregate is a legitimate (honest) state — the renderer must still
 * state the basis ("N tasks, M rounds, 0 FAIL") rather than dropping the
 * section.
 */
export interface RetroStruggleAggregate {
  /** Tasks the aggregate covers. */
  tasksConsidered: number
  /** Tasks carrying ≥1 negative signal (rework / send-back / reopen /
   *  follow-up / extra PR cycle / human override). */
  tasksWithStruggle: number
  /** Σ verification rounds that recorded ≥1 FAIL across tasks. */
  reworkRounds: number
  /** Σ individual FAIL verdicts across those rounds. */
  failedVerdicts: number
  /** Send-backs still unresolved at close. */
  openSendBacks: number
  /** Send-backs that were raised and later resolved. */
  resolvedSendBacks: number
  /** Σ status reopens (review/done → in-progress/todo). */
  reopens: number
  /** Σ criteria that passed but left follow-up work behind. */
  followUps: number
  /** Σ PR cycles beyond the first per task (>1 PR is the churn signal). */
  extraPrCycles: number
  /** Σ MACHINE criteria genuinely passed by a checkpointer. */
  machineVerified: number
  /** Σ MACHINE criteria passing only via a human override. */
  humanOverridden: number
  /** Σ active MACHINE criteria across tasks. */
  machineTotal: number
  /** The struggling tasks, with per-task detail, for naming the hard work. */
  hardTasks: HardTaskDetail[]
}

/**
 * Roll up the per-task struggle signals into the milestone/sprint aggregate.
 * Pure (no IO) so it is fully unit-testable; the services feed it the result of
 * {@link taskVerificationService.statusForTask} per task. A task counts as
 * "struggling" when any negative signal is present — including a human override
 * with no FAIL, which is itself a 声称-vs-核验 gap worth surfacing.
 */
export function aggregateRetroStruggle(
  statuses: RetroStruggleInput[]
): RetroStruggleAggregate {
  const agg: RetroStruggleAggregate = {
    tasksConsidered: statuses.length,
    tasksWithStruggle: 0,
    reworkRounds: 0,
    failedVerdicts: 0,
    openSendBacks: 0,
    resolvedSendBacks: 0,
    reopens: 0,
    followUps: 0,
    extraPrCycles: 0,
    machineVerified: 0,
    humanOverridden: 0,
    machineTotal: 0,
    hardTasks: [],
  }

  for (const s of statuses) {
    const st = s.struggleTrail
    const reworkRounds = st.reworkRounds.length
    const failedVerdicts = st.reworkRounds.reduce((n, r) => n + r.failed, 0)
    const openSendBacks = st.sendBacks.filter(b => b.status === 'open').length
    const resolvedSendBacks = st.sendBacks.filter(
      b => b.status === 'resolved'
    ).length
    const reopens = st.reopens.length
    const followUps = st.followUps.length
    const extraPrCycles = Math.max(0, st.pullRequests.length - 1)
    const humanOverridden = s.machineVerification.humanOverridden

    agg.reworkRounds += reworkRounds
    agg.failedVerdicts += failedVerdicts
    agg.openSendBacks += openSendBacks
    agg.resolvedSendBacks += resolvedSendBacks
    agg.reopens += reopens
    agg.followUps += followUps
    agg.extraPrCycles += extraPrCycles
    agg.machineVerified += s.machineVerification.machineVerified
    agg.humanOverridden += humanOverridden
    agg.machineTotal += s.machineVerification.total

    const struggling =
      reworkRounds > 0 ||
      openSendBacks > 0 ||
      resolvedSendBacks > 0 ||
      reopens > 0 ||
      followUps > 0 ||
      extraPrCycles > 0 ||
      humanOverridden > 0
    if (struggling) {
      agg.tasksWithStruggle += 1
      agg.hardTasks.push({
        identifier: s.task.identifier,
        title: s.task.title,
        reworkRounds,
        openSendBacks,
        reopens,
        extraPrCycles,
        humanOverridden,
      })
    }
  }

  return agg
}
