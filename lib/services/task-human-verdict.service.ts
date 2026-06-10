import { prisma } from '@/lib/db/prisma'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  verificationRunRepository,
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
  /** Criteria the verdict fanned out to (the whole live contract). */
  criterionIds: string[]
  /** The derived task a PASS_WITH_FOLLOWUP opened, null otherwise. */
  followUpTask: { id: string; number: number; title: string } | null
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
   * The verdict is task-level and fans out to one VerificationRun row per
   * criterion of the live contract at round = the current max round, never
   * incremented: a human adjudication reviews the machine rounds that already
   * ran, it is not a new machine round. That stamping keeps "machine all-pass
   * but human FAIL" derivable from VerificationRun rows alone (Slice 3
   * aggregates it with zero extra schema), finally gives HUMAN-verifier
   * criteria a verdict, and lets the LUM-344 status read model surface the
   * send-back reason in nextActions with no changes.
   *
   * Status semantics (all through the existing state machine):
   * - PASS / PASS_WITH_FOLLOWUP → DONE; PASS_WITH_FOLLOWUP additionally opens
   *   a `follow-up:`-prefixed derived task referencing the origin and the
   *   outstanding items, bound to no sprint.
   * - FAIL → back to IN_PROGRESS; the note (sanitized) lands as the
   *   rejectionReason the agent reads back via `lumo task status`.
   */
  async recordHumanVerdict(
    taskId: string,
    input: HumanVerdictBody,
    attribution: HumanVerdictAttribution
  ): Promise<HumanVerdictOutcome> {
    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    if (criteria.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no acceptance criteria — there is no contract to adjudicate'
        ),
        { status: 400 }
      )
    }

    // Round = current max round, never incremented (a human adjudication is a
    // review of the rounds that ran, not a new round). Floored at 1 so a
    // contract adjudicated before any machine round still lands on a valid
    // 1-based round.
    const maxRound = (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    const round = Math.max(1, maxRound)

    const note = cleanNullable(input.note)
    const rejectionReasonEnum =
      input.verdict === 'FAIL' ? (input.rejectionReasonEnum ?? null) : null

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    await prisma.$transaction(async tx => {
      const rows: CreateVerificationRunInput[] = criteria.map(c => ({
        taskId,
        criterionId: c.id,
        round,
        verifierType: 'HUMAN',
        verdict: input.verdict,
        evidencePointer: null,
        rejectionReason: input.verdict === 'PASS' ? null : note,
        rejectionReasonEnum,
      }))
      await verificationRunRepository.createMany(rows, tx)

      // Mirror events are born inside the write transaction (LUM-296), same
      // shape as the machine path plus the verifierType discriminator.
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
              rejectionReasonEnum,
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
        `Outstanding items: ${note ?? '(none recorded — see the origin task)'}`,
      ].join('\n')
      const priority =
        origin.priority as Parameters<typeof createTask>[1]['priority']
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

    const targetStatus = input.verdict === 'FAIL' ? 'IN_PROGRESS' : 'DONE'
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
    }
  },
}
