import type { DomainEvent, EventHandler } from '../types'
import { handleAgentBroadcast, handleTaskBroadcast } from './broadcast'
import { handleNotifySpecReady } from './notify-spec-ready'
import { handleNotifyTaskInReview } from './notify-task-in-review'

const registry: Record<DomainEvent['type'], EventHandler[]> = {
  'agent:status_changed': [handleAgentBroadcast, handleNotifySpecReady],
  'task:status_changed': [handleTaskBroadcast, handleNotifyTaskInReview],
}

export function getHandlers(type: DomainEvent['type']): EventHandler[] {
  return registry[type] ?? []
}
