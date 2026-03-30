import { handleNotifySpecReady } from '@/lib/events/handlers/notify-spec-ready'
import type { AgentStatusChangedEvent } from '@/lib/events/types'

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/notifications/notifyReviewerOrOwners', () => ({
  notifyReviewerOrOwners: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { notifyReviewerOrOwners } from '@/lib/notifications/notifyReviewerOrOwners'

const mockTaskFindUnique = prisma.task.findUnique as jest.Mock
const mockNotify = notifyReviewerOrOwners as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('handleNotifySpecReady', () => {
  const specReviewEvent: AgentStatusChangedEvent = {
    type: 'agent:status_changed',
    taskId: 'task-1',
    projectId: 'proj-1',
    from: 'RUNNING',
    to: 'SPEC_REVIEW',
    fields: ['agentStatus', 'spec'],
    patch: { agentStatus: 'SPEC_REVIEW' },
  }

  it('notifies reviewer when agent transitions to SPEC_REVIEW', async () => {
    mockTaskFindUnique.mockResolvedValue({
      reviewerActorId: 'actor-reviewer',
      project: { workspaceId: 'ws-1', defaultReviewerId: 'member-default' },
    })

    await handleNotifySpecReady(specReviewEvent)

    expect(mockNotify).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      taskId: 'task-1',
      type: 'TASK_SPEC_READY',
      reviewerActorId: 'actor-reviewer',
      defaultReviewerMemberId: 'member-default',
      triggerActorId: null,
    })
  })

  it('skips notification when task is not found', async () => {
    mockTaskFindUnique.mockResolvedValue(null)

    await handleNotifySpecReady(specReviewEvent)

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('ignores non-SPEC_REVIEW transitions', async () => {
    const runningEvent: AgentStatusChangedEvent = {
      ...specReviewEvent,
      to: 'RUNNING',
    }

    await handleNotifySpecReady(runningEvent)

    expect(mockTaskFindUnique).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('passes null reviewerActorId when task has no reviewer', async () => {
    mockTaskFindUnique.mockResolvedValue({
      reviewerActorId: null,
      project: { workspaceId: 'ws-1', defaultReviewerId: null },
    })

    await handleNotifySpecReady(specReviewEvent)

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerActorId: null,
        defaultReviewerMemberId: null,
      })
    )
  })
})
