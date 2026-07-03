import { runInTransaction } from '@/lib/db/transaction'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  verificationRunRepository,
  type CreateVerificationRunInput,
} from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskService } from '@/lib/services/task.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'
import {
  postSendBackComment,
  summarizeSendBackNote,
} from '@/lib/services/sendback-comment.service'
import type { AgentVerdictBody } from '@/lib/validation/acceptance'

export interface AgentVerdictAttribution {
  /** WorkspaceMember id of the caller (CLI bearer → human member). */
  actorMemberId: string
  /** Clerk user id of the caller — drives the status fan-out + comment author. */
  actorClerkId: string
  /** LUM-640: the originating Claude Code session (X-Lumo-Session-Id header),
   *  stamped on the FAIL rows so a send-back from a STEWARD (governance)
   *  session stays attributable to that session. Null for older CLIs / no header. */
  sourceSessionId?: string | null
}

export interface AgentVerdictOutcome {
  round: number
  /** Always FAIL — the agent path has no passing verdict (red line). */
  verdict: 'FAIL'
  /** Task status after the send-back's transition was applied. */
  taskStatus: string
  /** Criteria the send-back fanned out to. */
  criterionIds: string[]
  /** The send-back narrative comment, when one was posted. */
  commentId: string | null
}

const ACTIVITY_STATEMENT_MAX = 160

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export const taskAgentVerdictService = {
  /**
   * Record an agent send-back of a task's acceptance contract (LUM-422) — the
   * THIRD verdict channel and the only agent-facing one that writes a real
   * verdict row (the machine round belongs to the verify loop).
   *
   * RED LINE (milestone rule 5, narrowed): no passing data row is ever
   * agent-produced. This service hard-codes verdict=FAIL and
   * verifierType=AGENT; the input schema can't express PASS at all. The AGENT
   * channel is distinct from HUMAN so "machine all-pass but human FAIL" stays
   * an uncontaminated Slice-3 signal.
   *
   * Behaviour mirrors a human FAIL: fans out one VerificationRun per addressed
   * criterion at round = current max (NOT incremented — a send-back reviews the
   * rounds that ran, it is not a new machine round), posts the note as a task
   * comment (commentId carried in the mirror activity payload), and reverts the
   * task to IN_PROGRESS so the agent picks the work back up via nextActions.
   * `criterionIds` optionally narrows the send-back; omitted, it fans out to
   * the whole contract.
   */
  async recordAgentVerdict(
    taskId: string,
    input: AgentVerdictBody,
    attribution: AgentVerdictAttribution
  ): Promise<AgentVerdictOutcome> {
    const allCriteria = await acceptanceCriterionRepository.listByTask(taskId)
    if (allCriteria.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no acceptance criteria — there is no contract to send back'
        ),
        { status: 400 }
      )
    }

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

    // Round = current max, never incremented (same semantics as a human
    // verdict). Floored at 1 so a send-back before any machine round still
    // lands on a valid 1-based round.
    const maxRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    const round = Math.max(1, maxRound)

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    // Post the narrative comment BEFORE the verdict transaction so its id can be
    // mirrored into the activity payload (FAIL row → commentId → comment text).
    // Best-effort: a comment failure must never sink the send-back itself.
    let commentId: string | null = null
    if (input.note && actorId) {
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
    const summary = summarizeSendBackNote(input.note)

    await runInTransaction(async tx => {
      const rows: CreateVerificationRunInput[] = criteria.map(c => ({
        taskId,
        criterionId: c.id,
        round,
        verifierType: 'AGENT',
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: summary,
        rejectionReasonEnum: input.rejectionReasonEnum,
        // LUM-640: session provenance — a steward's send-back names its session.
        sourceSessionId: attribution.sourceSessionId ?? null,
      }))
      await verificationRunRepository.createMany(rows, tx)

      // Mirror events born inside the write transaction (LUM-296).
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
              verdict: 'FAIL',
              verifierType: 'AGENT',
              evidencePointer: null,
              rejectionReasonEnum: input.rejectionReasonEnum,
              commentId,
            },
          },
          tx
        )
      }
    })

    // Send the task back to IN_PROGRESS, same as a human FAIL. No-op when it is
    // already there; if the current status can't reach IN_PROGRESS the verdict
    // still stands and the DONE gate (LUM-422 ④) keeps the FAIL blocking.
    const detail = await taskService.getTaskDetail(taskId)
    if (!detail) {
      throw Object.assign(new Error('Task not found'), { status: 404 })
    }
    const currentStatus = (detail as { status?: string }).status ?? ''
    let taskStatus = currentStatus || 'IN_PROGRESS'
    if (
      currentStatus !== 'IN_PROGRESS' &&
      isValidTaskTransition(
        currentStatus as Parameters<typeof isValidTaskTransition>[0],
        'IN_PROGRESS'
      )
    ) {
      await taskService.updateTaskWithSideEffects(
        taskId,
        { status: 'IN_PROGRESS' },
        detail,
        actorId,
        attribution.actorClerkId,
        null
      )
      taskStatus = 'IN_PROGRESS'
    }

    return {
      round,
      verdict: 'FAIL',
      taskStatus,
      criterionIds: criteria.map(c => c.id),
      commentId,
    }
  },
}
