import { handleNotifySpecReady } from '@/lib/events/handlers/notify-spec-ready'
import type { AgentStatusChangedEvent } from '@/lib/events/types'

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/services/notification.service', () => ({
  notifyReviewerOrOwners: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { notifyReviewerOrOwners } from '@/lib/services/notification.service'

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
    from: 'WORKING',
    to: 'INPUT_REQUIRED',
    fields: ['agentStatus', 'spec'],
    patch: { agentStatus: 'INPUT_REQUIRED' },
  }

  it('notifies reviewer when agent transitions to INPUT_REQUIRED with spec_review reason', async () => {
    // First call: check inputReason; second call: fetch reviewer info
    mockTaskFindUnique
      .mockResolvedValueOnce({ inputReason: 'spec_review' })
      .mockResolvedValueOnce({
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

  it('skips notification when inputReason is not spec_review (e.g. clarify)', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({ inputReason: 'clarify' })

    await handleNotifySpecReady(specReviewEvent)

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('skips notification when task is not found', async () => {
    mockTaskFindUnique.mockResolvedValueOnce(null)

    await handleNotifySpecReady(specReviewEvent)

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('ignores non-INPUT_REQUIRED transitions', async () => {
    const runningEvent: AgentStatusChangedEvent = {
      ...specReviewEvent,
      to: 'WORKING',
    }

    await handleNotifySpecReady(runningEvent)

    expect(mockTaskFindUnique).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('passes null reviewerActorId when task has no reviewer', async () => {
    mockTaskFindUnique
      .mockResolvedValueOnce({ inputReason: 'spec_review' })
      .mockResolvedValueOnce({
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
