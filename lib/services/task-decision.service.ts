import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  isDecisionNumberCollision,
  taskDecisionRepository,
} from '@/lib/repositories/task-decision.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { runInTransaction } from '@/lib/db/transaction'
import { resolvePublicUrl } from '@/lib/utils/public-url'

/**
 * LUM-1303: task decisions live in their own table and on the task's
 * Decisions tab. (LUM-970 appended them to the description instead.) Every
 * write records a DECISION_* Activity entry in the same transaction, carrying
 * the text so the task's history keeps it after a delete.
 */

/** Attempts at the next number before a concurrent-write race gives up. */
const NUMBER_RETRIES = 5

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

function normalizeRationale(rationale: string | null | undefined) {
  const trimmed = rationale?.trim()
  return trimmed ? trimmed : null
}

/** The Activity actor for a member (null when the member has no actor row). */
async function actorIdOf(memberId: string | null): Promise<string | null> {
  if (!memberId) return null
  const actor = await memberRepository.findActorByMemberId(memberId)
  return actor?.id ?? null
}

async function listForTask(taskId: string, workspaceId: string) {
  return taskDecisionRepository.listByTask(taskId, workspaceId)
}

async function create(args: {
  taskId: string
  workspaceId: string
  text: string
  rationale?: string | null | undefined
  createdById: string | null
  sourceSessionId?: string | null | undefined
}) {
  const actorId = await actorIdOf(args.createdById)
  const record = () =>
    runInTransaction(async tx => {
      const decision = await taskDecisionRepository.createNumbered(
        {
          taskId: args.taskId,
          workspaceId: args.workspaceId,
          text: args.text.trim(),
          rationale: normalizeRationale(args.rationale),
          createdById: args.createdById,
          sourceSessionId: args.sourceSessionId ?? null,
        },
        tx
      )
      await activityRepository.create(
        {
          taskId: args.taskId,
          actorId,
          type: 'DECISION_ADDED',
          payload: {
            decisionId: decision.id,
            number: decision.number,
            text: decision.text,
            rationale: decision.rationale,
          },
        },
        tx
      )
      return decision
    })
  // Two writes racing for the same number: one loses on the unique key, and
  // its whole transaction (row + Activity) is retried with a fresh number.
  for (let attempt = 1; ; attempt++) {
    try {
      return await record()
    } catch (e) {
      if (!isDecisionNumberCollision(e) || attempt >= NUMBER_RETRIES) throw e
    }
  }
}

/** The decision, or 404 unless it is one of `taskId` in `workspaceId`. */
async function findOnTask(
  decisionId: string,
  taskId: string,
  workspaceId: string
) {
  const found = await taskDecisionRepository.findById(decisionId, workspaceId)
  if (!found || found.taskId !== taskId) {
    throw httpError(404, 'Decision not found')
  }
  return found
}

async function update(args: {
  decisionId: string
  taskId: string
  workspaceId: string
  actorMemberId: string
  text?: string | undefined
  rationale?: string | null | undefined
}) {
  const before = await findOnTask(
    args.decisionId,
    args.taskId,
    args.workspaceId
  )
  const actorId = await actorIdOf(args.actorMemberId)
  return runInTransaction(async tx => {
    const after = await taskDecisionRepository.update(
      args.decisionId,
      args.workspaceId,
      {
        ...(args.text !== undefined ? { text: args.text.trim() } : {}),
        ...(args.rationale !== undefined
          ? { rationale: normalizeRationale(args.rationale) }
          : {}),
      },
      tx
    )
    // A save that changed nothing leaves no trail.
    if (after.text !== before.text || after.rationale !== before.rationale) {
      await activityRepository.create(
        {
          taskId: args.taskId,
          actorId,
          type: 'DECISION_UPDATED',
          payload: {
            decisionId: args.decisionId,
            number: before.number,
            before: { text: before.text, rationale: before.rationale },
            after: { text: after.text, rationale: after.rationale },
          },
        },
        tx
      )
    }
    return after
  })
}

async function remove(args: {
  decisionId: string
  taskId: string
  workspaceId: string
  actorMemberId: string
}) {
  const existing = await findOnTask(
    args.decisionId,
    args.taskId,
    args.workspaceId
  )
  const actorId = await actorIdOf(args.actorMemberId)
  await runInTransaction(async tx => {
    await taskDecisionRepository.softDelete(
      args.decisionId,
      args.workspaceId,
      tx
    )
    await activityRepository.create(
      {
        taskId: args.taskId,
        actorId,
        type: 'DECISION_REMOVED',
        payload: {
          decisionId: args.decisionId,
          number: existing.number,
          text: existing.text,
          rationale: existing.rationale,
        },
      },
      tx
    )
  })
}

/** `lumo task decide <id> "<text>" [--why "<reason>"]` (bearer-authed). */
async function recordFromCli(args: {
  workspaceId: string
  workspaceSlug: string
  callerClerkId: string
  identifier: string
  text: string
  rationale?: string | null | undefined
  sourceSessionId?: string | null
}) {
  const resolved = await taskService.resolveIdentifier(
    args.workspaceId,
    args.identifier
  )
  if (!resolved) throw httpError(404, `Task ${args.identifier} not found`)
  const member = await memberRepository.findByWorkspaceAndClerkId(
    args.workspaceId,
    args.callerClerkId
  )
  if (!member) throw httpError(403, 'Caller is not a member of this workspace')
  const decision = await create({
    taskId: resolved.id,
    workspaceId: args.workspaceId,
    // CLIs before LUM-1303 prefix the local date; the row's createdAt has it.
    text: args.text.trim().replace(/^\d{4}-\d{2}-\d{2}\s+(?=\S)/, ''),
    rationale: args.rationale,
    createdById: member.id,
    sourceSessionId: args.sourceSessionId,
  })
  return {
    task: {
      identifier: resolved.identifier,
      title: resolved.title,
      url: `${resolvePublicUrl()}/workspace/${args.workspaceSlug}/my-tasks/${resolved.identifier}/decisions`,
    },
    decision,
  }
}

export const taskDecisionService = {
  listForTask,
  create,
  update,
  remove,
  recordFromCli,
}
