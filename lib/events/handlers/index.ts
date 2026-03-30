import type { EventHandlerRegistry } from '../types'
import { handleAgentBroadcast } from './broadcast'
import { handleNotifySpecReady } from './notify-spec-ready'
import { handleTaskBroadcast } from './broadcast'
import { handleNotifyTaskInReview } from './notify-task-in-review'

export const registry: EventHandlerRegistry = {
  'agent:status_changed': [handleAgentBroadcast, handleNotifySpecReady],
  'task:status_changed': [handleTaskBroadcast, handleNotifyTaskInReview],
}
