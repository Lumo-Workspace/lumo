import {
  handleAgentBroadcast,
  handleTaskBroadcast,
} from '@/lib/events/handlers/broadcast'
import type {
  AgentStatusChangedEvent,
  TaskStatusChangedEvent,
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
    from: 'SUBMITTED',
    to: 'WORKING',
    fields: ['agentStatus', 'agentError'],
    patch: { agentStatus: 'WORKING' },
  }

  it('broadcasts agent status change to project channel', async () => {
    await handleAgentBroadcast(event)

    expect(mockPushProjectEvent).toHaveBeenCalledWith('proj-1', {
      type: 'task:updated',
      taskId: 'task-1',
      fields: ['agentStatus', 'agentError'],
      patch: { agentStatus: 'WORKING' },
    })
  })

  it('broadcasts clear (to=null) events', async () => {
    const clearEvent: AgentStatusChangedEvent = {
      ...event,
      to: null,
      fields: ['agentStatus'],
      patch: { agentStatus: null },
    }

    await handleAgentBroadcast(clearEvent)

    expect(mockPushProjectEvent).toHaveBeenCalledWith('proj-1', {
      type: 'task:updated',
      taskId: 'task-1',
      fields: ['agentStatus'],
      patch: { agentStatus: null },
    })
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
})
