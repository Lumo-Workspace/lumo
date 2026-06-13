import { runInTransaction } from '@/lib/db/transaction'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  verificationRunRepository,
  isPassVerdict,
  type CreateVerificationRunInput,
} from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import {
  createTask,
  createFromAutomation,
} from '@/lib/services/task-creation.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'
import { sanitizeField } from '@/lib/utils/sanitize'
import {
  postSendBackComment,
  summarizeSendBackNote,
} from '@/lib/services/sendback-comment.service'
import type { HumanVerdictBody } from '@/lib/validation/acceptance'

export interface HumanVerdictAttribution {
  /** WorkspaceMember id of the adjudicating human. */
  actorMemberId: string
  /** Clerk user id of the adjudicating human — drives the status fan-out. */
  actorClerkId: string
}

export interface HumanVerdictOutcome {
  round: number
  verdict: HumanVerdictBody['verdict']
  /** Task status after the verdict's transition was applied. */
  taskStatus: string
  /** Criteria this verdict fanned out to — the whole live contract when
   *  criterionIds was omitted, otherwise just the selected criteria (LUM-425). */
  criterionIds: string[]
  /** The derived task a PASS_WITH_FOLLOWUP opened, null otherwise. */
  followUpTask: { id: string; number: number; title: string } | null
  /** The send-back narrative comment a FAIL posted, null otherwise (LUM-422). */
  commentId: string | null
}

const ACTIVITY_STATEMENT_MAX = 160

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** sanitize + trim a nullable free-text field; empty results collapse to null. */
function cleanNullable(value: string | null | undefined): string | null {
  if (value == null) return null
  const cleaned = sanitizeField(value).trim()
  return cleaned.length > 0 ? cleaned : null
}

/** Title prefix of the derived task a PASS_WITH_FOLLOWUP opens. */
export const FOLLOW_UP_TITLE_PREFIX = 'follow-up: '

export const taskHumanVerdictService = {
  /**
   * Record a human adjudication of a task's acceptance contract — the
   * human-only half of milestone rule 5 (the route guard refuses bearer
   * identities; this service hard-codes verifierType HUMAN on write).
   *
   * The verdict fans out to one VerificationRun row per addressed criterion at
   * round = the current max round, never incremented: a human adjudication
   * reviews the machine rounds that already ran, it is not a new machine round.
   * That stamping keeps "machine all-pass but human FAIL" derivable from
   * VerificationRun rows alone (Slice 3 aggregates it with zero extra schema),
   * finally gives HUMAN-verifier criteria a verdict, and lets the LUM-344 status
   * read model surface the send-back reason in nextActions with no changes.
   *
   * `input.criterionIds` (LUM-425) optionally narrows the fan-out to specific
   * criteria so a human can pass one and send back another in separate clicks;
   * omitted, it fans out to the whole contract (the legacy task-level verdict is
   * the select-all special case). The resulting task status is recomputed from
   * EVERY criterion's latest verdict across the whole contract — not just the
   * ones this action touched:
   * - any latest verdict is a FAIL → back to IN_PROGRESS (send-back blocks DONE);
   * - every criterion met (latest verdict is a pass) → DONE;
   * - some met with no FAIL → stays IN_REVIEW.
   * The select-all case reduces to the old behaviour (all-PASS → DONE,
   * all-FAIL → IN_PROGRESS) by construction.
   *
   * PASS_WITH_FOLLOWUP additionally opens a `follow-up:`-prefixed derived task
   * referencing the origin and the outstanding items, bound to no sprint. A FAIL
   * note (sanitized) lands as the rejectionReason the agent reads back via
   * `lumo task status`, and as a task comment for the @mention/image trail.
   */
  async recordHumanVerdict(
    taskId: string,
    input: HumanVerdictBody,
    attribution: HumanVerdictAttribution
  ): Promise<HumanVerdictOutcome> {
    const allCriteria = await acceptanceCriterionRepository.listByTask(taskId)
    if (allCriteria.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no acceptance criteria — there is no contract to adjudicate'
        ),
        { status: 400 }
      )
    }

    // Narrow the fan-out to the selected criteria when criterionIds is present;
    // reject any id that isn't on this task (no cross-task or unknown-id write).
    let criteria = allCriteria
    if (input.criterionIds && input.criterionIds.length > 0) {
      const byId = new Map(allCriteria.map(c => [c.id, c]))
      const unknown = input.criterionIds.filter(id => !byId.has(id))
      if (unknown.length > 0) {
        throw Object.assign(
          new Error(`Criterion(s) not on this task: ${unknown.join(', ')}`),
          { status: 400 }
        )
      }
      const wanted = new Set(input.criterionIds)
      criteria = allCriteria.filter(c => wanted.has(c.id))
    }

    // LUM-456: a PASS-type human verdict must not silently impersonate machine
    // verification. A MACHINE criterion is only genuinely passed when a
    // checkpointer ran-and-passed it (its latest MACHINE verdict is a PASS).
    // The bulk / whole-contract gesture (criterionIds omitted) therefore DROPS
    // un-machine-passed MACHINE criteria — a human "pass all" approves the human
    // judgement and the machine results that already passed, it does not quietly
    // overturn an unverified check. Passing such a criterion is still allowed,
    // but only as a deliberate, explicit per-criterion action (criterionIds
    // names it): that path keeps it and records override provenance on its
    // mirror so the override is auditable (no schema change — the read model
    // also derives it from the absent machine pass).
    const isPass = isPassVerdict(input.verdict)
    const isBulk = !(input.criterionIds && input.criterionIds.length > 0)
    const overriddenIds = new Set<string>()
    if (isPass) {
      const machinePassed =
        await verificationRunRepository.machinePassedCriteria(taskId)
      const isUnMachinePassed = (c: (typeof allCriteria)[number]) =>
        c.verifierType === 'MACHINE' && !machinePassed.has(c.id)
      if (isBulk) {
        criteria = criteria.filter(c => !isUnMachinePassed(c))
      } else {
        for (const c of criteria) {
          if (isUnMachinePassed(c)) overriddenIds.add(c.id)
        }
      }
    }

    // Round = current max round, never incremented (a human adjudication is a
    // review of the rounds that ran, not a new round). Floored at 1 so a
    // contract adjudicated before any machine round still lands on a valid
    // 1-based round.
    const maxRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    const round = Math.max(1, maxRound)

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    // LUM-422 ① de-enumeration: the human send-back carries no rejection-reason
    // enum (left null — a downstream agent classifies it). A FAIL's note is a
    // markdown/rich send-back reason posted as a task comment (@mentions and
    // images for free); the row keeps a plain-text summary and the mirror
    // activity carries the commentId so the FAIL row → comment link is
    // traceable with zero schema. PASS_WITH_FOLLOWUP's note stays plain text —
    // it seeds the follow-up task below, not a comment.
    const isFail = input.verdict === 'FAIL'
    const followUpNote =
      input.verdict === 'PASS_WITH_FOLLOWUP' ? cleanNullable(input.note) : null

    let commentId: string | null = null
    if (isFail && input.note && actorId) {
      try {
        commentId = await postSendBackComment({
          taskId,
          rawNote: input.note,
          authorActorId: actorId,
          authorClerkId: attribution.actorClerkId,
        })
      } catch {
        commentId = null
      }
    }
    const failSummary = isFail ? summarizeSendBackNote(input.note) : null

    // Snapshot the contract's latest verdicts BEFORE writing this action's rows.
    // The post-write state is this snapshot with the selected criteria overlaid
    // by the new verdict — that drives the whole-contract status recompute below
    // (a per-criterion verdict must not flip the task on its selection alone).
    const priorLatest =
      await verificationRunRepository.latestRunsByCriterion(taskId)

    await runInTransaction(async tx => {
      const rows: CreateVerificationRunInput[] = criteria.map(c => ({
        taskId,
        criterionId: c.id,
        round,
        verifierType: 'HUMAN',
        verdict: input.verdict,
        evidencePointer: null,
        rejectionReason: isFail ? failSummary : followUpNote,
        rejectionReasonEnum: null,
      }))
      await verificationRunRepository.createMany(rows, tx)

      // Mirror events are born inside the write transaction (LUM-296), same
      // shape as the machine path plus the verifierType discriminator and the
      // send-back commentId (LUM-422).
      for (const c of criteria) {
        await activityRepository.create(
          {
            taskId,
            actorId,
            type: 'VERIFICATION_RUN_RECORDED',
            payload: {
              criterionId: c.id,
              statement: truncate(c.statement, ACTIVITY_STATEMENT_MAX),
              round,
              verdict: input.verdict,
              verifierType: 'HUMAN',
              evidencePointer: null,
              rejectionReasonEnum: null,
              commentId,
              // LUM-456: true when this PASS overrides a MACHINE criterion no
              // checkpointer has passed — a deliberate human override, not a
              // machine result. Audit breadcrumb; zero schema (JSON payload).
              override: overriddenIds.has(c.id),
            },
          },
          tx
        )
      }
    })

    const detail = await taskService.getTaskDetail(taskId)
    if (!detail) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    const currentStatus = (detail as { status?: string }).status ?? ''

    // PASS_WITH_FOLLOWUP opens the derived task before the status flip so a
    // transition hiccup can't swallow the recorded outstanding items.
    let followUpTask: HumanVerdictOutcome['followUpTask'] = null
    if (input.verdict === 'PASS_WITH_FOLLOWUP') {
      const origin = detail as {
        projectId: string
        title: string
        number: number
        teamIdentifier: string
        priority: string
        assigneeActorId?: string | null
      }
      const identifier = `${origin.teamIdentifier}-${origin.number}`
      const description = [
        `Follow-up from ${identifier} "${origin.title}" — human verdict PASS_WITH_FOLLOWUP.`,
        '',
        `Outstanding items: ${followUpNote ?? '(none recorded — see the origin task)'}`,
      ].join('\n')
      const priority = origin.priority as Parameters<
        typeof createTask
      >[1]['priority']
      const title = `${FOLLOW_UP_TITLE_PREFIX}${origin.title}`
      // Deliberately unbound: no sprint (and no milestone) — the follow-up is
      // groomed like any new TODO. The automation path covers the degenerate
      // case of an adjudicator without an Actor row (no activity to attribute).
      const created = actorId
        ? await createTask(
            origin.projectId,
            {
              title,
              description,
              status: 'TODO',
              priority,
              assigneeActorId: origin.assigneeActorId ?? null,
              sprintId: null,
            },
            actorId,
            attribution.actorClerkId
          )
        : await createFromAutomation(origin.projectId, {
            title,
            description,
            priority,
            assigneeActorId: origin.assigneeActorId ?? null,
            tagIds: [],
          })
      followUpTask = {
        id: created.task.id,
        number: created.task.number,
        title: created.task.title,
      }
    }

    // Recompute the task status from EVERY criterion's latest verdict across
    // the whole contract: the prior snapshot with the selected criteria
    // overlaid by this action's verdict. A per-criterion send-back blocks DONE;
    // DONE requires every criterion met; otherwise the task waits in IN_REVIEW.
    const selectedIds = new Set(criteria.map(c => c.id))
    const effectiveVerdict = (criterionId: string) =>
      selectedIds.has(criterionId)
        ? input.verdict
        : priorLatest.get(criterionId)?.verdict
    const anyFail = allCriteria.some(c => effectiveVerdict(c.id) === 'FAIL')
    const allMet = allCriteria.every(c => isPassVerdict(effectiveVerdict(c.id)))
    const targetStatus = anyFail ? 'IN_PROGRESS' : allMet ? 'DONE' : 'IN_REVIEW'

    let taskStatus = currentStatus || targetStatus
    if (
      currentStatus !== targetStatus &&
      isValidTaskTransition(
        currentStatus as Parameters<typeof isValidTaskTransition>[0],
        targetStatus
      )
    ) {
      await taskService.updateTaskWithSideEffects(
        taskId,
        { status: targetStatus },
        detail,
        actorId,
        attribution.actorClerkId,
        null
      )
      taskStatus = targetStatus
    }

    return {
      round,
      verdict: input.verdict,
      taskStatus,
      criterionIds: criteria.map(c => c.id),
      followUpTask,
      commentId,
    }
  },
}
