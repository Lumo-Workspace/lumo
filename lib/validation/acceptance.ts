import { z } from 'zod'
import {
  AcceptanceCriterionSource,
  AcceptanceVerifierType,
  VerificationRejectionReason,
} from '@prisma/client'

/**
 * 3–7 criteria is a SOFT range: outside it we warn, never reject. Hardening
 * (if any) waits for real criterion-churn data from Slice 1.
 */
export const ACCEPTANCE_CRITERIA_SOFT_MIN = 3
export const ACCEPTANCE_CRITERIA_SOFT_MAX = 7

/**
 * Soft-cap warning for a task's criterion count, or null when within range.
 * Pure helper for the service layer (LUM-342) — by design it cannot reject.
 */
export function criteriaCountWarning(count: number): string | null {
  if (count > ACCEPTANCE_CRITERIA_SOFT_MAX) {
    return `${count} acceptance criteria exceeds the recommended maximum of ${ACCEPTANCE_CRITERIA_SOFT_MAX} — consider folding related checks together`
  }
  if (count < ACCEPTANCE_CRITERIA_SOFT_MIN) {
    return `${count} acceptance criteria is below the recommended minimum of ${ACCEPTANCE_CRITERIA_SOFT_MIN} — the contract may be under-specified`
  }
  return null
}

/**
 * One acceptance criterion as submitted (agent draft, human edit, or
 * review-time addition). A MACHINE criterion must name its executable check —
 * if no checkpointer can be attached, the drafter demotes it to HUMAN instead
 * of submitting a MACHINE criterion the loop can never execute.
 */
export const acceptanceCriterionInputSchema = z
  .object({
    statement: z.string().trim().min(1).max(2_000),
    verifierType: z.nativeEnum(AcceptanceVerifierType),
    checkpointer: z.string().trim().min(1).max(2_000).nullish(),
    evidenceRequired: z.boolean().optional(),
    source: z.nativeEnum(AcceptanceCriterionSource),
    addedAtRound: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.verifierType === 'MACHINE' && !c.checkpointer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkpointer'],
        message:
          'A MACHINE criterion requires a checkpointer (executable check); draft it as HUMAN if no check can be attached',
      })
    }
  })

export type AcceptanceCriterionInput = z.infer<
  typeof acceptanceCriterionInputSchema
>

/**
 * RED LINE (milestone rule 5): an agent can never write a human verdict. This
 * agent-facing schema is the schema-layer lock — it has NO verifierType field
 * (the server hard-codes MACHINE on write) and no way to express one. Human
 * verdicts only ever enter through human-initiated paths (web UI / Slack
 * action, Slice 2), which use their own schema.
 *
 * Verdict is restricted to PASS | FAIL: the three-state verdict
 * (PASS_WITH_FOLLOWUP) is the human adjudication vocabulary, not the
 * machine's. A MACHINE PASS without an evidencePointer is illegal — a passing
 * check must point at its proof.
 */
export const machineVerdictInputSchema = z
  .object({
    criterionId: z.string().trim().min(1),
    verdict: z.enum(['PASS', 'FAIL']),
    evidencePointer: z.string().trim().min(1).max(2_000).nullish(),
    rejectionReason: z.string().trim().min(1).max(4_000).nullish(),
    rejectionReasonEnum: z.nativeEnum(VerificationRejectionReason).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.verdict === 'PASS' && !v.evidencePointer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidencePointer'],
        message: 'A MACHINE PASS verdict must carry an evidencePointer',
      })
    }
  })

export type MachineVerdictInput = z.infer<typeof machineVerdictInputSchema>
