import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import {
  verificationRunRepository,
  type CreateVerificationRunInput,
} from '@/lib/repositories/verification-run.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
import { taskService } from '@/lib/services/task.service'
import { isValidTaskTransition } from '@/lib/task/state-machine'
import { sanitizeField } from '@/lib/utils/sanitize'
import type { MachineVerdictInput } from '@/lib/validation/acceptance'

/**
 * Hard ceiling on machine verification rounds (milestone spec). Round 1..3
 * may record; a round-3 outcome that still fails escalates to a human, and
 * any later machine round is refused. Derived state only — the task carries
 * no round column (milestone rule 8).
 */
export const VERIFICATION_MAX_ROUNDS = 3

export interface VerificationAttribution {
  /** WorkspaceMember id of the caller (CLI bearer → human member). */
  actorMemberId: string
  /** Clerk user id of the caller — needed by the status-transition fan-out. */
  actorClerkId: string
  /** Claude Code session that drove this round, when known. */
  sourceSessionId: string | null
}

export interface MachineRoundResult {
  criterionId: string
  statement: string
  verdict: 'PASS' | 'FAIL'
  evidencePointer: string | null
  rejectionReason: string | null
}

export interface MachineRoundOutcome {
  round: number
  maxRounds: number
  allPassed: boolean
  /** True when this round hit the cap with failures and a human was paged. */
  escalated: boolean
  /** Task status after this round (IN_REVIEW only on an all-pass round). */
  taskStatus: string
  results: MachineRoundResult[]
  /** Unmet criteria the agent should address next — empty on all-pass. */
  nextActions: Array<{
    criterionId: string
    statement: string
    checkpointer: string | null
    rejectionReason: string | null
  }>
}

const ACTIVITY_STATEMENT_MAX = 160
const ACTIVITY_EVIDENCE_MAX = 200

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** sanitize + trim a nullable free-text field; empty results collapse to null. */
function cleanNullable(value: string | null | undefined): string | null {
  if (value == null) return null
  const cleaned = sanitizeField(value).trim()
  return cleaned.length > 0 ? cleaned : null
}

export const taskVerificationService = {
  /**
   * Record one machine verification round — the server-side judge of the
   * loop (执行在客户端，裁判在服务端). The CLI ran every MACHINE
   * checkpointer locally and reports structured verdicts; this method:
   *
   * 1. checks coverage — one verdict per MACHINE criterion of the live
   *    contract, no extras, no duplicates;
   * 2. assigns the round number (previous max + 1) and refuses to run past
   *    the cap once an escalation round has been recorded (409);
   * 3. appends one VerificationRun per criterion (verifierType hard-coded
   *    MACHINE — the human-verdict write path does not exist here, milestone
   *    rule 5) plus a mirroring VERIFICATION_RUN_RECORDED TaskActivity in the
   *    same transaction (born with the event, never backfilled — LUM-296);
   * 4. on all-pass, transitions the task to IN_REVIEW through the existing
   *    state machine so the TASK_IN_REVIEW fan-out fires; on a round-3 fail,
   *    escalates exactly once (AGENT_VERIFY, requiresAction) — rounds are
   *    strictly increasing, so the escalation round is unrepeatable.
   */
  async recordMachineRound(
    taskId: string,
    workspaceId: string,
    results: MachineVerdictInput[],
    attribution: VerificationAttribution
  ): Promise<MachineRoundOutcome> {
    const criteria = await acceptanceCriterionRepository.listByTask(taskId)
    const machine = criteria.filter(c => c.verifierType === 'MACHINE')
    if (machine.length === 0) {
      throw Object.assign(
        new Error(
          'This task has no MACHINE acceptance criteria to verify — nothing for the machine loop to run'
        ),
        { status: 400 }
      )
    }

    const machineById = new Map(machine.map(c => [c.id, c]))
    const seen = new Set<string>()
    for (const r of results) {
      if (seen.has(r.criterionId)) {
        throw Object.assign(
          new Error(`Duplicate verdict for criterion ${r.criterionId}`),
          { status: 400 }
        )
      }
      seen.add(r.criterionId)
      if (!machineById.has(r.criterionId)) {
        throw Object.assign(
          new Error(
            `Criterion ${r.criterionId} is not a MACHINE criterion of this task`
          ),
          { status: 400 }
        )
      }
    }
    const missing = machine.filter(c => !seen.has(c.id))
    if (missing.length > 0) {
      throw Object.assign(
        new Error(
          `A machine round must cover every MACHINE criterion — missing verdicts for: ${missing
            .map(c => c.id)
            .join(', ')}`
        ),
        { status: 400 }
      )
    }

    const currentRound =
      (await verificationRunRepository.maxRoundByTask(taskId)) ?? 0
    if (currentRound >= VERIFICATION_MAX_ROUNDS) {
      throw Object.assign(
        new Error(
          `Machine verification is capped at ${VERIFICATION_MAX_ROUNDS} rounds and this task has used them — it has been escalated to a human; stop and wait for their adjudication`
        ),
        { status: 409 }
      )
    }
    const round = currentRound + 1

    const callerActor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    const actorId = callerActor?.id ?? null

    // Clean the agent-authored free text before it can reach storage or any
    // renderer (LUM-346 口径); the pointer format is already regex-bound.
    const cleaned: MachineRoundResult[] = results.map(r => {
      const c = machineById.get(r.criterionId)!
      return {
        criterionId: r.criterionId,
        statement: c.statement,
        verdict: r.verdict,
        evidencePointer: cleanNullable(r.evidencePointer),
        rejectionReason: cleanNullable(r.rejectionReason),
      }
    })
    const rejectionEnumByCriterion = new Map(
      results.map(r => [r.criterionId, r.rejectionReasonEnum ?? null])
    )

    await prisma.$transaction(async tx => {
      const rows: CreateVerificationRunInput[] = cleaned.map(r => ({
        taskId,
        criterionId: r.criterionId,
        round,
        verifierType: 'MACHINE',
        verdict: r.verdict,
        evidencePointer: r.evidencePointer,
        rejectionReason: r.rejectionReason,
        rejectionReasonEnum: rejectionEnumByCriterion.get(r.criterionId) ?? null,
      }))
      await verificationRunRepository.createMany(rows, tx)

      // Mirror events are born inside the write transaction — a cron can
      // never backfill what wasn't recorded at birth (LUM-296).
      for (const r of cleaned) {
        await activityRepository.create(
          {
            taskId,
            actorId,
            type: 'VERIFICATION_RUN_RECORDED',
            payload: {
              criterionId: r.criterionId,
              statement: truncate(r.statement, ACTIVITY_STATEMENT_MAX),
              round,
              verdict: r.verdict,
              evidencePointer: r.evidencePointer
                ? truncate(r.evidencePointer, ACTIVITY_EVIDENCE_MAX)
                : null,
              rejectionReasonEnum:
                rejectionEnumByCriterion.get(r.criterionId) ?? null,
            },
          },
          tx
        )
      }
    })

    const failed = cleaned.filter(r => r.verdict === 'FAIL')

    if (failed.length === 0) {
      let taskStatus = 'IN_REVIEW'
      const detail = await taskService.getTaskDetail(taskId)
      if (detail) {
        const status = (detail as { status?: string }).status ?? ''
        if (status === 'IN_REVIEW' || status === 'DONE') {
          // Re-verification of an already-reviewable/closed task — judging
          // recorded above; the status owner is now the human.
          taskStatus = status
        } else if (
          isValidTaskTransition(
            status as Parameters<typeof isValidTaskTransition>[0],
            'IN_REVIEW'
          )
        ) {
          await taskService.updateTaskWithSideEffects(
            taskId,
            { status: 'IN_REVIEW' },
            detail,
            actorId,
            attribution.actorClerkId,
            attribution.sourceSessionId
          )
        } else {
          taskStatus = status || taskStatus
        }
      }
      return {
        round,
        maxRounds: VERIFICATION_MAX_ROUNDS,
        allPassed: true,
        escalated: false,
        taskStatus,
        results: cleaned,
        nextActions: [],
      }
    }

    // FAIL round: status untouched (stays wherever it was, typically
    // IN_PROGRESS); unmet criteria become the agent's next actions.
    const escalate = round >= VERIFICATION_MAX_ROUNDS
    if (escalate) {
      // Synchronous like the mirror events — the escalation must exist the
      // moment the cap is hit. triggerActorId stays null: the escalation is
      // machine-triggered, and a non-null trigger would exclude a sole owner
      // from their own page.
      await activityRepository.create({
        taskId,
        actorId,
        type: 'VERIFICATION_ESCALATED',
        payload: {
          round,
          maxRounds: VERIFICATION_MAX_ROUNDS,
          failedCriterionIds: failed.map(r => r.criterionId),
        },
      })
      await notifyWorkspaceOwners({
        workspaceId,
        taskId,
        type: 'AGENT_VERIFY',
        triggerActorId: null,
        requiresAction: true,
      })
    }

    const currentStatus = await taskRepository.findStatus(taskId)

    return {
      round,
      maxRounds: VERIFICATION_MAX_ROUNDS,
      allPassed: false,
      escalated: escalate,
      taskStatus: currentStatus?.status ?? 'IN_PROGRESS',
      results: cleaned,
      nextActions: failed.map(r => ({
        criterionId: r.criterionId,
        statement: r.statement,
        checkpointer: machineById.get(r.criterionId)?.checkpointer ?? null,
        rejectionReason: r.rejectionReason,
      })),
    }
  },
}
