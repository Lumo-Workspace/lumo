import { logger } from '@/lib/logger'
import { getMilestoneDistillInput } from './milestone-distill-input'
import {
  extractMilestoneDistillCandidates,
  buildMilestoneDistillSourceText,
} from './milestone-distill-extract'
import { groundCandidates } from './ground-candidates'
import { applyMilestoneDistillOperations } from './milestone-distill-apply'
import { aiDerivedContentService } from '@/lib/services/ai-derived-content.service'

export interface MilestoneDistillResult {
  added: number
  skipped: number
}

/**
 * LUM-647: milestone-close retro → MILESTONE-scope memory distillation.
 *
 * Runs after `milestoneSummaryService.generate` has saved the retro. Pipeline
 * mirrors Layer 2:
 *   getInput → extract candidates → ground (quote-or-discard, LUM-396) → apply.
 * The distilled memories carry scope=MILESTONE + this milestone's id, and are
 * injected at the next milestone's steward session start (a cross-milestone
 * learning unit).
 *
 * Fire-and-forget contract: `triggerForMilestoneClose` owns all error handling
 * and never throws — it is invoked from the summary-generation path and must not
 * break the retro save or the close response.
 */
export const milestoneDistillService = {
  async triggerForMilestoneClose(milestoneId: string): Promise<void> {
    try {
      // LUM-917: the workspace turned AI-derived content off.
      if (!(await aiDerivedContentService.isEnabled({ milestoneId }))) {
        logger.debug(
          `[memory.milestone-distill] skip milestone=${milestoneId} reason=ai-derived-off`
        )
        return
      }
      const result = await runForMilestone(milestoneId)
      if (result) {
        logger.debug(
          `[memory.milestone-distill] milestone=${milestoneId}`,
          result
        )
      }
    } catch (error) {
      console.error(
        `[memory.milestone-distill] unexpected error milestone=${milestoneId}:`,
        error
      )
    }
  },

  /**
   * Run the distillation once. Exposed for tests and any future manual
   * reprocess. Returns null when there is nothing to distil (milestone/project
   * missing, or no retro saved yet).
   */
  async runForMilestone(
    milestoneId: string
  ): Promise<MilestoneDistillResult | null> {
    return runForMilestone(milestoneId)
  },
}

async function runForMilestone(
  milestoneId: string
): Promise<MilestoneDistillResult | null> {
  const input = await getMilestoneDistillInput(milestoneId)
  if (!input) {
    logger.debug(
      `[memory.milestone-distill] skip milestone=${milestoneId} reason=no-input`
    )
    return null
  }

  const rawCandidates = await extractMilestoneDistillCandidates(input)
  if (rawCandidates.length === 0) {
    logger.debug(
      `[memory.milestone-distill] no-candidates milestone=${milestoneId}`
    )
    return { added: 0, skipped: 0 }
  }

  // Grounding gate (LUM-396): discard candidates with no basis in the retro
  // text. MUST use the exact same source string the extract pass read.
  const { kept } = await groundCandidates({
    sourceText: buildMilestoneDistillSourceText(input),
    candidates: rawCandidates,
    logTag: 'memory.milestone-distill',
  })
  if (kept.length === 0) {
    logger.debug(
      `[memory.milestone-distill] no-grounded-candidates milestone=${milestoneId}`
    )
    return { added: 0, skipped: 0 }
  }

  return applyMilestoneDistillOperations({
    candidates: kept,
    milestoneId: input.milestone.id,
    projectId: input.milestone.projectId,
    workspaceId: input.milestone.workspaceId,
    existingMilestoneMemories: input.existingMilestoneMemories,
  })
}
