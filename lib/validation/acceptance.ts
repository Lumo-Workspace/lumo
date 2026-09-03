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
import { TASK_REFERENT_KIND_DECLARABLE } from '../../shared/src/referent-kind'

/**
 * Soft warning (LUM-465) for HUMAN criteria with no judgeSteps — the
 * agent-drafted "where to look → what to do → ✓pass/✗send-back" guidance shown
 * on the human adjudication card. Like criteriaCountWarning it is a pure helper
 * that NEVER rejects: a HUMAN criterion without judgeSteps still stores fine,
 * the card just falls back to a "missing guidance" hint. MACHINE criteria are
 * judged by a checkpointer, never by hand, so they are exempt.
 */
export function humanJudgeStepsWarning(
  criteria: ReadonlyArray<{
    verifierType: 'MACHINE' | 'HUMAN'
    judgeSteps?: string | null
  }>
): string | null {
  const missing = criteria.filter(
    c => c.verifierType === 'HUMAN' && !c.judgeSteps
  ).length
  if (missing === 0) return null
  return `${missing} human-judgment ${missing === 1 ? 'criterion lacks' : 'criteria lack'} judging guidance — add judgeSteps (where to look → what to do → ✓pass/✗send-back) so the human adjudicator has steps, not just an assertion`
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
    // A criterion is checked by MACHINE or HUMAN — never AGENT (AGENT is a
    // verdict channel, LUM-422). Excluded here so the shared enum's new value
    // can't be smuggled onto a criterion draft.
    verifierType: z.enum(['MACHINE', 'HUMAN']),
    checkpointer: z.string().trim().min(1).max(2_000).nullish(),
    evidenceRequired: z.boolean().optional(),
    // Agent-drafted human-judging guidance (LUM-465); allowed on any criterion,
    // steered to HUMAN by the drafting guide. A missing one only warns.
    judgeSteps: z.string().trim().min(1).max(2_000).nullish(),
    source: z.nativeEnum(AcceptanceCriterionSource),
    addedAtRound: z.number().int().min(0).optional(),
    // LUM-733: OPTIONAL and advisory. The stored kind is DERIVED server-side
    // from the checkpointer (see deriveReferentKind); a declaration on a
    // MACHINE criterion is ignored, on a HUMAN criterion it is kept as-is.
    // PENDING_OUTCOME is no longer a task-criterion kind.
    referentKind: z.enum(TASK_REFERENT_KIND_DECLARABLE).nullish(),
  })
  .strict()
  .superRefine((c, ctx) => {
    machineRequiresCheckpointer(c, ctx)
  })

export type AcceptanceCriterionInput = z.infer<
  typeof acceptanceCriterionInputSchema
>

/**
 * One item of a whole-contract submission (`lumo task criteria set`). Unlike
 * acceptanceCriterionInputSchema it carries NO source/addedAtRound — the
 * server decides provenance from the submission mode. `id` references an
 * existing criterion to keep/update; originally only meaningful for HUMAN_EDIT
 * revisions, but as of LUM-437 it is also honored for after-start AGENT_DRAFT
 * edits (identity-preserving diff). The service decides semantics: first-TODO
 * AGENT_DRAFT ignores ids and full-replaces; after-start AGENT_DRAFT uses them.
 */
export const criteriaSetItemSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    statement: z.string().trim().min(1).max(2_000),
    // A criterion is checked by MACHINE or HUMAN — never AGENT (AGENT is a
    // verdict channel, LUM-422). Excluded here so the shared enum's new value
    // can't be smuggled onto a criterion draft.
    verifierType: z.enum(['MACHINE', 'HUMAN']),
    checkpointer: z.string().trim().min(1).max(2_000).nullish(),
    evidenceRequired: z.boolean().optional(),
    // Agent-drafted human-judging guidance (LUM-465). Part of the contract:
    // edits drift like any other field, a missing one on a HUMAN criterion warns.
    judgeSteps: z.string().trim().min(1).max(2_000).nullish(),
    // LUM-733: OPTIONAL and advisory. The stored kind is DERIVED server-side
    // from the checkpointer (see deriveReferentKind); a declaration on a
    // MACHINE criterion is ignored, on a HUMAN criterion it is kept as-is.
    // PENDING_OUTCOME is no longer a task-criterion kind.
    referentKind: z.enum(TASK_REFERENT_KIND_DECLARABLE).nullish(),
  })
  .strict()
  .superRefine((c, ctx) => {
    machineRequiresCheckpointer(c, ctx)
  })

export type CriteriaSetItem = z.infer<typeof criteriaSetItemSchema>

/** Hard sanity ceiling for one submission. */
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
 * The verdict here is the full human three-state vocabulary. By default it is
 * task-level: the human adjudicates the whole contract in one action (the
 * service fans it out to one row per criterion). `criterionIds` (LUM-425)
 * optionally narrows that fan-out to specific criteria so a human can pass one
 * criterion and send back another in separate clicks; omitted, the
 * whole-contract fan-out is preserved (backward compatible — the legacy
 * task-level verdict is the select-all special case). Membership of the ids in
 * the task is checked in the service, not here.
 *
 * LUM-422 de-enumeration: a human send-back carries ZERO structured burden —
 * there is no rejection-reason enum on the human path (the service stamps it
 * null and leaves enum classification to a downstream agent). FAIL's note is
 * a free-form markdown send-back reason (posted as a task comment so @mentions
 * and images come for free). A clean PASS carries no note. The note may be
 * rich-text HTML (the verdict bar reuses the comment editor), so the ceiling
 * is generous.
 */
export const humanVerdictBodySchema = z
  .object({
    verdict: z.enum(['PASS', 'FAIL']),
    note: z.string().trim().min(1).max(16_000).nullish(),
    criterionIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(CRITERIA_SET_HARD_MAX)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.verdict === 'PASS' && v.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message:
          'A clean PASS carries no note — use FAIL to send the task back with a reason',
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
    // LUM-597: the agent's required self-report ("我改了 X,因为 Y 可验收"),
    // persisted as the AGENT claim when the round flips the task to IN_REVIEW.
    // OPTIONAL at the schema layer (the NEW CLI enforces it client-side): an
    // old CLI that omits it still verifies — its claim degrades to the
    // SYNTHESIZED paraphrase, never a 4xx. It is a self-report, NOT a verdict —
    // `.strict()` still rejects any smuggled verifierType/verdict field.
    note: z.string().trim().min(1).max(4_000).nullish(),
  })
  .strict()

export type MachineRoundBody = z.infer<typeof machineRoundBodySchema>
