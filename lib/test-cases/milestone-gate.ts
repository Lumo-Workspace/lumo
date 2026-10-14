/**
 * LUM-1135: the milestone close gate over milestone test cases — **positive
 * proof** (user ruling). A case opens the gate only when its latest run passed
 * (an UNPROVEN pass still opens, flagged), or when it proved an implementation
 * defect that a human dispositioned KNOWN_DEFECT ("ship it anyway").
 *
 * Everything else holds, including NOT_A_DEFECT: that ruling explains a
 * failure, it does not make the case pass — re-run or rewrite the case.
 *
 * Pure: no prisma / repository imports. IO lives in
 * `lib/services/milestone-close-gate.service.ts`.
 */
export type MilestoneGateReason =
  | 'NOT_RUN'
  | 'PROVEN_DEFECT'
  | 'FAILING'
  | 'BLOCKED'

export interface MilestoneGateCaseInput {
  number: number
  title: string
  latestRun: null | {
    result: 'PASS' | 'FAIL' | 'BLOCKED'
    failureAttribution: string | null
    evidenceCount: number
    disposition: 'KNOWN_DEFECT' | 'NOT_A_DEFECT' | null
    /** `deriveRunCeiling(...).effective` for this run. */
    ceiling: 'PASS' | 'UNPROVEN' | 'FAIL' | 'BLOCKED'
  }
}

export interface MilestoneGateCase {
  number: number
  title: string
  state: 'open' | 'held'
  reason: MilestoneGateReason | null
  /** Open on a PASS the provability ceiling capped to UNPROVEN — advisory only. */
  unprovenPass: boolean
}

function judge(
  run: MilestoneGateCaseInput['latestRun']
): Pick<MilestoneGateCase, 'state' | 'reason' | 'unprovenPass'> {
  const held = (reason: MilestoneGateReason) => ({
    state: 'held' as const,
    reason,
    unprovenPass: false,
  })
  if (!run) return held('NOT_RUN')
  if (run.result === 'PASS') {
    return {
      state: 'open',
      reason: null,
      unprovenPass: run.ceiling === 'UNPROVEN',
    }
  }
  if (run.result === 'BLOCKED') return held('BLOCKED')
  const proven =
    run.failureAttribution === 'IMPLEMENTATION_DEFECT' && run.evidenceCount > 0
  if (proven && run.disposition === 'KNOWN_DEFECT') {
    return { state: 'open', reason: null, unprovenPass: false }
  }
  if (proven && run.disposition === null) return held('PROVEN_DEFECT')
  return held('FAILING')
}

export function evaluateMilestoneGate(
  cases: MilestoneGateCaseInput[]
): MilestoneGateCase[] {
  return cases.map(c => ({
    number: c.number,
    title: c.title,
    ...judge(c.latestRun),
  }))
}

export function countHeld(cases: MilestoneGateCase[]): number {
  return cases.filter(c => c.state === 'held').length
}
