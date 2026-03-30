import {
  handleAgentBroadcast,
  handleTaskBroadcast,
} from '@/lib/events/handlers/broadcast'
import type {
  AgentStatusChangedEvent,
  TaskStatusChangedEvent,
  DomainEvent,
} from '@/lib/events/types'

jest.mock('@/lib/pusher/server', () => ({
  pushProjectEvent: jest.fn().mockResolvedValue(undefined),
}))

import { pushProjectEvent } from '@/lib/pusher/server'

const mockPushProjectEvent = pushProjectEvent as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── handleAgentBroadcast ──────────────────────────────────────────────────

describe('handleAgentBroadcast', () => {
  const event: AgentStatusChangedEvent = {
    type: 'agent:status_changed',
    taskId: 'task-1',
    projectId: 'proj-1',
    from: 'IDLE',
    to: 'RUNNING',
    fields: ['agentStatus', 'agentError'],
    patch: { agentStatus: 'RUNNING' },
  }

  it('broadcasts agent status change to project channel', async () => {
    await handleAgentBroadcast(event)

    expect(mockPushProjectEvent).toHaveBeenCalledWith('proj-1', {
      type: 'task:updated',
      taskId: 'task-1',
      fields: ['agentStatus', 'agentError'],
      patch: { agentStatus: 'RUNNING' },
    })
  })

  it('ignores task status changed events', async () => {
    const taskEvent: DomainEvent = {
      type: 'task:status_changed',
      taskId: 'task-1',
      projectId: 'proj-1',
      from: 'TODO',
      to: 'IN_PROGRESS',
    }

    await handleAgentBroadcast(taskEvent)

    expect(mockPushProjectEvent).not.toHaveBeenCalled()
  })
})

// ── handleTaskBroadcast ───────────────────────────────────────────────────

describe('handleTaskBroadcast', () => {
  const event: TaskStatusChangedEvent = {
    type: 'task:status_changed',
    taskId: 'task-1',
    projectId: 'proj-1',
    from: 'TODO',
    to: 'IN_REVIEW',
  }

  it('broadcasts task status change to project channel', async () => {
    await handleTaskBroadcast(event)

    expect(mockPushProjectEvent).toHaveBeenCalledWith('proj-1', {
      type: 'task:updated',
      taskId: 'task-1',
      fields: ['status'],
      patch: { status: 'IN_REVIEW' },
    })
  })

  it('ignores agent status changed events', async () => {
    const agentEvent: DomainEvent = {
      type: 'agent:status_changed',
      taskId: 'task-1',
      projectId: 'proj-1',
      from: 'IDLE',
      to: 'RUNNING',
      fields: ['agentStatus'],
      patch: { agentStatus: 'RUNNING' },
    }

    await handleTaskBroadcast(agentEvent)

    expect(mockPushProjectEvent).not.toHaveBeenCalled()
  })
})
