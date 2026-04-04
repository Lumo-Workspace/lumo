import { pushProjectEvent } from '../../pusher/server.js'
import type {
  AgentStatusChangedEvent,
  TaskStatusChangedEvent,
} from '@lumo/shared'

/** Broadcast agent status change to project channel (board / sidebar). */
export async function handleAgentBroadcast(
  event: AgentStatusChangedEvent
): Promise<void> {
  await pushProjectEvent(event.projectId, {
    type: 'task:updated',
    taskId: event.taskId,
    fields: event.fields,
    patch: event.patch,
  })
}

/** Broadcast task status change to project channel. */
export async function handleTaskBroadcast(
  event: TaskStatusChangedEvent
): Promise<void> {
  await pushProjectEvent(event.projectId, {
    type: 'task:updated',
    taskId: event.taskId,
    fields: ['status'],
    patch: { status: event.to },
  })
}
