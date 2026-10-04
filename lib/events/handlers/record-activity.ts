import type { TaskActivityType } from '@prisma/client'
import type { TaskActivityEvent } from '@/lib/events/types/task-activity'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { pushActivityEvent } from '@/lib/integrations/pusher'

type ActivityRecord = {
  type: TaskActivityType
  payload: Record<string, unknown>
}

function toActivityRecord(event: TaskActivityEvent): ActivityRecord {
  switch (event.type) {
    case 'task:created':
      return { type: 'TASK_CREATED', payload: {} }

    case 'task:status_changed_activity':
      return {
        type: 'STATUS_CHANGED',
        payload: { from: event.from, to: event.to },
      }

    case 'task:priority_changed':
      return {
        type: 'PRIORITY_CHANGED',
        payload: { from: event.from, to: event.to },
      }

    case 'task:title_changed':
      return {
        type: 'TITLE_CHANGED',
        payload: { from: event.from, to: event.to },
      }

    case 'task:description_changed':
      return { type: 'DESCRIPTION_CHANGED', payload: {} }

    case 'task:due_date_changed':
      return {
        type: 'DUE_DATE_CHANGED',
        payload: { from: event.from, to: event.to },
      }

    case 'task:assignee_changed':
      return {
        type: 'ASSIGNEE_CHANGED',
        payload: {
          fromActorId: event.fromActorId,
          toActorId: event.toActorId,
          toName: event.toName,
        },
      }

    case 'task:tags_changed':
      return {
        type: 'TAGS_CHANGED',
        payload: { added: event.added, removed: event.removed },
      }

    case 'task:comment_added':
      return { type: 'COMMENT_ADDED', payload: { commentId: event.commentId } }

    case 'task:comment_deleted':
      return {
        type: 'COMMENT_DELETED',
        payload: { commentId: event.commentId },
      }

    case 'task:spec_generated':
      return { type: 'SPEC_GENERATED', payload: {} }

    case 'task:pr_linked':
      return {
        type: 'PR_LINKED',
        payload: {
          prId: event.prId,
          prNumber: event.prNumber,
          prUrl: event.prUrl,
        },
      }

    case 'task:pr_unlinked':
      return {
        type: 'PR_UNLINKED',
        payload: { prId: event.prId, prNumber: event.prNumber },
      }

    case 'task:pr_created':
      return {
        type: 'PR_CREATED',
        payload: {
          prNumber: event.prNumber,
          prUrl: event.prUrl,
          prTitle: event.prTitle,
        },
      }

    case 'task:pr_merged':
      return {
        type: 'PR_MERGED',
        payload: { prNumber: event.prNumber, prUrl: event.prUrl },
      }

    case 'task:agent_run_started':
      return {
        type: 'AGENT_RUN_STARTED',
        payload: { runId: event.runId, runNumber: event.runNumber },
      }

    case 'task:agent_run_completed':
      return {
        type: 'AGENT_RUN_COMPLETED',
        payload: { runId: event.runId, runNumber: event.runNumber },
      }

    case 'task:agent_run_failed':
      return {
        type: 'AGENT_RUN_FAILED',
        payload: {
          runId: event.runId,
          runNumber: event.runNumber,
          errorCode: event.errorCode,
        },
      }

    case 'task:agent_input_required':
      return {
        type: 'AGENT_INPUT_REQUIRED',
        payload: { runId: event.runId, reason: event.reason },
      }
  }
}

export async function handleRecordActivity(
  event: TaskActivityEvent
): Promise<void> {
  const { type, payload } = toActivityRecord(event)

  const activity = await activityRepository.create({
    taskId: event.taskId,
    actorId: 'actorId' in event ? (event.actorId ?? null) : null,
    type,
    payload,
  })

  // Push realtime update (fire-and-forget)
  void pushActivityEvent(event.taskId, {
    id: activity.id,
    kind: 'activity',
    type: activity.type,
    payload: activity.payload,
    createdAt: activity.createdAt,
    actorId: activity.actorId,
  })
}
