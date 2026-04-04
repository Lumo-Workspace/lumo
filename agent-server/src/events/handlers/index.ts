import type { EventHandlerRegistry } from '@lumo/shared'
import { handleAgentBroadcast, handleTaskBroadcast } from './broadcast.js'
import { handleNotifySpecReady } from './notify-spec-ready.js'
import { handleNotifyTaskInReview } from './notify-task-in-review.js'

export const registry: EventHandlerRegistry = {
  'agent:status_changed': [handleAgentBroadcast, handleNotifySpecReady],
  'task:status_changed': [handleTaskBroadcast, handleNotifyTaskInReview],
}
