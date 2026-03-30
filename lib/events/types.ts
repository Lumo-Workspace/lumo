import type { AgentStatus, TaskStatus } from '@prisma/client'

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

export type DomainEvent = AgentStatusChangedEvent | TaskStatusChangedEvent

export type EventHandler = (event: DomainEvent) => Promise<void>
