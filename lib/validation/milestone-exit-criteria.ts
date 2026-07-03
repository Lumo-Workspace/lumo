import { z } from 'zod'
import { REFERENT_KIND_DECLARABLE } from '../../shared/src/referent-kind'

/**
 * LUM-643: milestone-level exit criteria — request schemas. The close
 * contract mirrors the task-level acceptance shapes where they transfer:
 * referentKind is REQUIRED on every item (the contract postdates the LUM-602
 * discipline — no legacy-null bucket), and there is no checkpointer / no
 * MACHINE verifier: milestone criteria are adjudicated (裁定), not
 * machine-verified.
 */
export const milestoneExitCriterionInputSchema = z.object({
  statement: z.string().trim().min(1).max(2000),
  referentKind: z.enum(REFERENT_KIND_DECLARABLE),
})

export const milestoneExitCriteriaSetBodySchema = z.object({
  /** AGENT_DRAFT = steward/agent draft; HUMAN_EDIT = transcribed human revision. */
  source: z.enum(['AGENT_DRAFT', 'HUMAN_EDIT']).default('AGENT_DRAFT'),
  criteria: z.array(milestoneExitCriterionInputSchema).max(50),
})

export type MilestoneExitCriteriaSetBody = z.infer<
  typeof milestoneExitCriteriaSetBodySchema
>

/**
 * Adjudication body. The grounding rules (MET + EXTERNAL_FACT requires
 * evidence, PENDING_OUTCOME can never be MET) are service-layer 422s — they
 * depend on the stored criterion, not on the body alone.
 */
export const milestoneExitVerdictBodySchema = z.object({
  verdict: z.enum(['MET', 'NOT_MET']),
  note: z.string().trim().min(1).max(2000).optional(),
  evidence: z.string().trim().min(1).max(2000).optional(),
})

export type MilestoneExitVerdictBody = z.infer<
  typeof milestoneExitVerdictBodySchema
>
