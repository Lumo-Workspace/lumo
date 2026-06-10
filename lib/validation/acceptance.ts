import { z } from 'zod'
import {
  AcceptanceCriterionSource,
  AcceptanceVerifierType,
  VerificationRejectionReason,
} from '@prisma/client'
import {
  isValidEvidencePointer,
  EVIDENCE_POINTER_FORMAT_HINT,
} from '../../shared/src/acceptance-evidence'

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
    return `${count} acceptance criteria is below the recommended minimum of ${ACCEPTANCE_CRITERIA_SOFT_MIN} — fine for a micro task (1–2 targeted criteria is a complete contract for single-session, small-blast-radius work); otherwise the contract may be under-specified`
  }
  return null
}

/**
 * Shared refinement: a MACHINE criterion must name its executable check — if
 * no checkpointer can be attached, the drafter demotes it to HUMAN instead of
 * submitting a MACHINE criterion the loop can never execute. By design this
 * REJECTS with guidance, never silently rewrites the type (LUM-341 review).
 */
const machineRequiresCheckpointer = (
  c: {
    verifierType: AcceptanceVerifierType
    checkpointer?: string | null | undefined
  },
  ctx: z.RefinementCtx
): void => {
  if (c.verifierType === 'MACHINE' && !c.checkpointer) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['checkpointer'],
      message:
        'A MACHINE criterion requires a checkpointer (executable check); draft it as HUMAN if no check can be attached',
    })
  }
}

/**
 * One acceptance criterion as submitted (agent draft, human edit, or
 * review-time addition).
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
  .superRefine(machineRequiresCheckpointer)

export type AcceptanceCriterionInput = z.infer<
  typeof acceptanceCriterionInputSchema
>

/**
 * One item of a whole-contract submission (`lumo task criteria set`). Unlike
 * acceptanceCriterionInputSchema it carries NO source/addedAtRound — the
 * server decides provenance from the submission mode. `id` references an
 * existing criterion to keep/update and is only meaningful for HUMAN_EDIT
 * revisions (the body-level schema rejects it on drafts).
 */
export const criteriaSetItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    statement: z.string().trim().min(1).max(2_000),
    verifierType: z.nativeEnum(AcceptanceVerifierType),
    checkpointer: z.string().trim().min(1).max(2_000).nullish(),
    evidenceRequired: z.boolean().optional(),
  })
  .strict()
  .superRefine(machineRequiresCheckpointer)

export type CriteriaSetItem = z.infer<typeof criteriaSetItemSchema>

/** Hard sanity ceiling for one submission — NOT the 3–7 soft cap (which only warns). */
export const CRITERIA_SET_HARD_MAX = 50

/**
 * Why the contract drifted (milestone rule 9). Lives in TaskActivity payloads
 * only — never a table column. First version is self-drafted and extends
 * additively; hardening waits for real drift-cause data (same route as the
 * rejection-reason enum, LUM-341).
 */
export const CRITERIA_CAUSE_TAGS = [
  'NEW_INFO',
  'SCOPE_CHANGE',
  'DRAFT_BLIND_SPOT',
  'GRANULARITY',
  'OTHER',
] as const

export type CriteriaCauseTag = (typeof CRITERIA_CAUSE_TAGS)[number]

/**
 * Body of PUT /api/tasks/[id]/criteria. AGENT_DRAFT = the initial contract
 * (rejected by the service once any criteria exist — the agent lock);
 * HUMAN_EDIT = a human contract revision, possibly transcribed by the agent
 * from a conversation, expressed as the desired final criteria list.
 * Transcribing the contract is allowed; transcribing a verdict is not — the
 * human-verdict write path lives elsewhere and stays closed to agents.
 */
export const criteriaSetBodySchema = z
  .object({
    source: z.enum(['AGENT_DRAFT', 'HUMAN_EDIT']),
    criteria: z.array(criteriaSetItemSchema).min(1).max(CRITERIA_SET_HARD_MAX),
    causeTag: z.enum(CRITERIA_CAUSE_TAGS).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.source === 'AGENT_DRAFT') {
      body.criteria.forEach((c, i) => {
        if (c.id !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['criteria', i, 'id'],
            message:
              'AGENT_DRAFT items cannot reference existing criteria ids — the draft is create-only',
          })
        }
      })
      if (body.causeTag !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['causeTag'],
          message:
            'causeTag annotates contract drift and only applies to HUMAN_EDIT revisions',
        })
      }
    }
  })

export type CriteriaSetBody = z.infer<typeof criteriaSetBodySchema>

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
    // Evidence is a pointer, not prose: an agent-authored free-text field on
    // a high-trust structured channel would be an injection side channel
    // (agent-containment absorption). Only the enumerated shapes pass.
    if (v.evidencePointer && !isValidEvidencePointer(v.evidencePointer)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidencePointer'],
        message: EVIDENCE_POINTER_FORMAT_HINT,
      })
    }
  })

export type MachineVerdictInput = z.infer<typeof machineVerdictInputSchema>

/**
 * Body of POST /api/tasks/[id]/human-verdict — the OTHER half of milestone
 * rule 5. This schema is only ever parsed behind the human-authenticated
 * route guard (Clerk browser session; bearer identities are refused before
 * parsing), and the service hard-codes verifierType HUMAN on write — the two
 * write paths can never express each other's verifierType.
 *
 * The verdict here is the full human three-state vocabulary, and it is
 * task-level: the human adjudicates the whole contract in one action (the
 * service fans it out to one row per criterion). FAIL must carry the
 * rejection-reason enum (the free-text note stays optional); the note is the
 * send-back reason on FAIL and the outstanding items on PASS_WITH_FOLLOWUP —
 * a clean PASS carries neither field.
 */
export const humanVerdictBodySchema = z
  .object({
    verdict: z.enum(['PASS', 'FAIL', 'PASS_WITH_FOLLOWUP']),
    rejectionReasonEnum: z.nativeEnum(VerificationRejectionReason).nullish(),
    note: z.string().trim().min(1).max(4_000).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.verdict === 'FAIL' && !v.rejectionReasonEnum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReasonEnum'],
        message: 'A FAIL verdict must carry a rejectionReasonEnum',
      })
    }
    if (v.verdict !== 'FAIL' && v.rejectionReasonEnum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rejectionReasonEnum'],
        message: 'rejectionReasonEnum only applies to a FAIL verdict',
      })
    }
    if (v.verdict === 'PASS' && v.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message:
          'A clean PASS carries no note — use FAIL for a send-back reason or PASS_WITH_FOLLOWUP for outstanding items',
      })
    }
  })

export type HumanVerdictBody = z.infer<typeof humanVerdictBodySchema>

/**
 * Body of POST /api/tasks/[id]/verify — one machine round, one verdict per
 * MACHINE criterion. The server (the judge) re-checks coverage against the
 * live contract; this schema only bounds the shape. Strict: a body smuggling
 * `verifierType` (or anything else) is rejected, not stripped.
 */
export const machineRoundBodySchema = z
  .object({
    results: z
      .array(machineVerdictInputSchema)
      .min(1)
      .max(CRITERIA_SET_HARD_MAX),
  })
  .strict()

export type MachineRoundBody = z.infer<typeof machineRoundBodySchema>
