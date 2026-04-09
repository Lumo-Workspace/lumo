import type { AgentStatus, TaskStatus } from '@prisma/client'
import type { TaskActivityEvent } from './types/task-activity'
export type { TaskActivityEvent } from './types/task-activity'

// ── Domain events emitted by state machines ─────────────────────────────────

export type AgentStatusChangedEvent = {
  type: 'agent:status_changed'
  taskId: string
  projectId: string
  from: AgentStatus | null
  to: AgentStatus | null
  /** DB fields updated alongside agentStatus */
  fields: string[]
  /** Patch payload forwarded to the broadcast handler */
  patch: Record<string, unknown>
}

export type TaskStatusChangedEvent = {
  type: 'task:status_changed'
  taskId: string
  projectId: string
  from: TaskStatus
  to: TaskStatus
}

export type DomainEvent =
  | AgentStatusChangedEvent
  | TaskStatusChangedEvent
  | TaskActivityEvent

// ── Typed handler signatures ────────────────────────────────────────────────

export type AgentEventHandler = (
  event: AgentStatusChangedEvent
) => Promise<void>
export type TaskEventHandler = (event: TaskStatusChangedEvent) => Promise<void>
export type TaskActivityEventHandler = (
  event: TaskActivityEvent
) => Promise<void>

/** Map from event type to the corresponding typed handler array */
export type EventHandlerRegistry = {
  'agent:status_changed': AgentEventHandler[]
  'task:status_changed': TaskEventHandler[]
  'task:activity': TaskActivityEventHandler[]
}
