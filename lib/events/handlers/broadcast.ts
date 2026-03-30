import { pushProjectEvent } from '@/lib/pusher/server'
import type { DomainEvent } from '../types'

/** Broadcast agent status change to project channel (board / sidebar). */
export async function handleAgentBroadcast(event: DomainEvent): Promise<void> {
  if (event.type !== 'agent:status_changed') return

  await pushProjectEvent(event.projectId, {
    type: 'task:updated',
    taskId: event.taskId,
    fields: event.fields,
    patch: event.patch,
  })
}

/** Broadcast task status change to project channel. */
export async function handleTaskBroadcast(event: DomainEvent): Promise<void> {
  if (event.type !== 'task:status_changed') return

  await pushProjectEvent(event.projectId, {
    type: 'task:updated',
    taskId: event.taskId,
    fields: ['status'],
    patch: { status: event.to },
  })
}
