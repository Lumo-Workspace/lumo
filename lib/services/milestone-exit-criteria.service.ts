import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import {
  milestoneExitCriterionRepository,
  type MilestoneExitCriterionRow,
} from '@/lib/repositories/milestone-exit-criterion.repository'
import { projectService } from '@/lib/services/project.service'
import type {
  MilestoneExitCriteriaSetBody,
  MilestoneExitVerdictBody,
} from '@/lib/validation/milestone-exit-criteria'

/**
 * LUM-643: milestone-level exit criteria (the close contract) — drafted and
 * adjudicated by the milestone's steward (LUM-640) or a human. Unlike the
 * task-level contract there is no checkpointer and no machine verification
 * loop: each criterion carries a two-valued adjudication (MET | NOT_MET,
 * null = pending). The status→COMPLETED close gate reads this contract
 * (see milestone.service / milestone-rollup) and refuses to close while any
 * active criterion is not MET, unless a human overrides explicitly.
 *
 * referentKind grounding is reused from LUM-602/605, adapted to the
 * adjudication shape: a MET on EXTERNAL_FACT must carry an evidence pointer
 * (the external fact it was read from), and PENDING_OUTCOME can never be
 * adjudicated MET at close time — both rejected with 422, so milestone-level
 * self-confirming green cannot be laundered as verified external fact.
 */
export interface ExitCriteriaAttribution {
  actorMemberId: string
  /** Originating Claude Code session (X-Lumo-Session-Id header), FK-less. */
  sourceSessionId: string | null
}

async function authorizeMilestone(milestoneId: string, memberId: string) {
  const milestone = await milestoneRepository.findById(milestoneId)
  if (!milestone) {
    throw Object.assign(new Error('Milestone not found'), { status: 404 })
  }
  // Membership check — throws 403/404 for a non-member.
  await projectService.getProject(milestone.projectId, memberId)
  return milestone
}

function assertContractEditable(milestone: {
  archivedAt: Date | null
  completedAt: Date | null
}) {
  if (milestone.archivedAt) {
    throw Object.assign(
      new Error('Milestone is archived; unarchive it before editing'),
      { status: 409 }
    )
  }
  if (milestone.completedAt !== null) {
    throw Object.assign(
      new Error(
        'Milestone is completed — the exit-criteria contract is locked. Reopen it (move a task back off DONE) to change the contract.'
      ),
      { status: 409 }
    )
  }
}

export const milestoneExitCriteriaService = {
  /** The milestone's active contract + how many rows hold the gate shut. */
  async listForMilestone(
    milestoneId: string,
    memberId: string
  ): Promise<{
    criteria: MilestoneExitCriterionRow[]
    unresolvedCount: number
  }> {
    await authorizeMilestone(milestoneId, memberId)
    const criteria =
      await milestoneExitCriterionRepository.listByMilestone(milestoneId)
    const unresolvedCount = criteria.filter(c => c.verdict !== 'MET').length
    return { criteria, unresolvedCount }
  },

  /**
   * Submit the whole contract (full-group replace, mirroring the task-level
   * pre-work shape). Adjudicated rows are tombstoned so their verdict trail
   * survives; verdict-free rows are hard-deleted. Locked once the milestone
   * is COMPLETED.
   */
  async setCriteria(
    milestoneId: string,
    body: MilestoneExitCriteriaSetBody,
    attribution: ExitCriteriaAttribution
  ): Promise<{ criteria: MilestoneExitCriterionRow[] }> {
    const milestone = await authorizeMilestone(
      milestoneId,
      attribution.actorMemberId
    )
    assertContractEditable(milestone)

    const existing =
      await milestoneExitCriterionRepository.listByMilestone(milestoneId)
    for (const row of existing) {
      if (row.verdict !== null) {
        await milestoneExitCriterionRepository.softDelete(row.id)
      } else {
        await milestoneExitCriterionRepository.delete(row.id)
      }
    }
    await milestoneExitCriterionRepository.createMany(
      body.criteria.map(c => ({
        milestoneId,
        statement: c.statement,
        referentKind: c.referentKind,
        source: body.source,
        sourceSessionId: attribution.sourceSessionId,
      }))
    )
    const criteria =
      await milestoneExitCriterionRepository.listByMilestone(milestoneId)
    return { criteria }
  },

  /**
   * Adjudicate (裁定) one criterion — the steward's verdict, stamped with
   * who/when/session provenance. Re-adjudication overwrites in place.
   * Grounding gate (422, see module doc): MET + EXTERNAL_FACT requires
   * evidence; MET + PENDING_OUTCOME is never accepted.
   */
  async adjudicate(
    milestoneId: string,
    criterionId: string,
    body: MilestoneExitVerdictBody,
    attribution: ExitCriteriaAttribution
  ): Promise<{ criterion: MilestoneExitCriterionRow }> {
    const milestone = await authorizeMilestone(
      milestoneId,
      attribution.actorMemberId
    )
    assertContractEditable(milestone)

    const criterion =
      await milestoneExitCriterionRepository.findById(criterionId)
    if (
      !criterion ||
      criterion.milestoneId !== milestoneId ||
      criterion.deletedAt !== null
    ) {
      throw Object.assign(new Error('Exit criterion not found'), {
        status: 404,
      })
    }

    if (body.verdict === 'MET') {
      if (criterion.referentKind === 'PENDING_OUTCOME') {
        throw Object.assign(
          new Error(
            'A PENDING_OUTCOME criterion cannot be adjudicated MET — its truth lands post-delivery. Record what reality did in the outcome well, or re-declare the criterion.'
          ),
          { status: 422 }
        )
      }
      if (criterion.referentKind === 'EXTERNAL_FACT' && !body.evidence) {
        throw Object.assign(
          new Error(
            'MET on an EXTERNAL_FACT criterion requires an evidence pointer to the external fact it was read from (URL, commit SHA, CI run, DB probe …). Provide --evidence, or honestly re-declare the criterion AGENT_CONSTRUCTED_STATE.'
          ),
          { status: 422 }
        )
      }
    }

    const updated = await milestoneExitCriterionRepository.setVerdict(
      criterionId,
      {
        verdict: body.verdict,
        verdictNote: body.note ?? null,
        verdictEvidence: body.evidence ?? null,
        verdictByMemberId: attribution.actorMemberId,
        verdictSessionId: attribution.sourceSessionId,
        verdictAt: new Date(),
      }
    )
    return { criterion: updated }
  },
}

export type MilestoneExitCriteriaService = typeof milestoneExitCriteriaService
