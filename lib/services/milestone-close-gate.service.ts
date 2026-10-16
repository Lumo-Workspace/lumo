import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { countEvidence, deriveRunCeiling } from '@/lib/test-cases/provability'
import {
  countHeld,
  evaluateMilestoneGate,
  type MilestoneGateCase,
} from '@/lib/test-cases/milestone-gate'

export interface MilestoneCloseGate {
  /** Held milestone test cases. > 0 holds the derived completion. */
  held: number
  cases: MilestoneGateCase[]
}

/**
 * LUM-1135: IO half of the milestone close gate (rules in lib/test-cases/milestone-gate).
 * Throws on read failure — callers decide fail-closed behaviour (the rollup aborts,
 * read paths count it as held).
 */
export const milestoneCloseGateService = {
  async read(milestoneId: string): Promise<MilestoneCloseGate> {
    const [cases, runsByCase] = await Promise.all([
      testCaseRepository.listForMilestone(milestoneId),
      testCaseRepository.runsPerCaseForMilestone(milestoneId),
    ])
    const evaluated = evaluateMilestoneGate(
      cases.map(c => {
        const latest = (runsByCase.get(c.id) ?? [])[0]
        if (!latest)
          return { number: c.number, title: c.title, latestRun: null }
        const ceiling = deriveRunCeiling(
          {
            result: latest.result,
            environment: latest.environment,
            unprovenVerification: (latest.unprovenVerification ?? []) as Array<{
              index: number
              text: string
            }>,
            evidenceCount: countEvidence(latest.evidence),
            stepResults: latest.stepResults,
          },
          { requiredEnvironment: c.requiredEnvironment }
        )
        return {
          number: c.number,
          title: c.title,
          latestRun: {
            result: latest.result,
            failureAttribution: latest.failureAttribution,
            evidenceCount: countEvidence(latest.evidence),
            disposition: latest.disposition?.disposition ?? null,
            ceiling: ceiling.effective,
          },
        }
      })
    )
    return {
      held: countHeld(evaluated),
      cases: evaluated,
    }
  },

  async countHeld(milestoneId: string): Promise<number> {
    return (await milestoneCloseGateService.read(milestoneId)).held
  },
}
