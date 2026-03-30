import { handleNotifyTaskInReview } from '@/lib/events/handlers/notify-task-in-review'
import type { TaskStatusChangedEvent, DomainEvent } from '@/lib/events/types'

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    actor: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/notifications/notifyTaskInReview', () => ({
  notifyTaskInReview: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'

const mockTaskFindUnique = prisma.task.findUnique as jest.Mock
const mockActorFindUnique = (prisma as any).actor.findUnique as jest.Mock
const mockNotify = notifyTaskInReview as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('handleNotifyTaskInReview', () => {
  const inReviewEvent: TaskStatusChangedEvent = {
    type: 'task:status_changed',
    taskId: 'task-1',
    projectId: 'proj-1',
    from: 'IN_PROGRESS',
    to: 'IN_REVIEW',
  }

  it('notifies reviewer when task transitions to IN_REVIEW', async () => {
    mockTaskFindUnique.mockResolvedValue({
      reviewerActorId: 'actor-reviewer',
      project: { workspaceId: 'ws-1', defaultReviewerId: null },
    })

    await handleNotifyTaskInReview(inReviewEvent)

    expect(mockNotify).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      taskId: 'task-1',
      reviewerActorId: 'actor-reviewer',
      defaultReviewerActorId: null,
      triggerActorId: null,
    })
  })

  it('resolves defaultReviewerId to actor ID when no task reviewer', async () => {
    mockTaskFindUnique.mockResolvedValue({
      reviewerActorId: null,
      project: { workspaceId: 'ws-1', defaultReviewerId: 'member-default' },
    })
    mockActorFindUnique.mockResolvedValue({ id: 'actor-default' })

    await handleNotifyTaskInReview(inReviewEvent)

    expect(mockActorFindUnique).toHaveBeenCalledWith({
      where: { memberId: 'member-default' },
      select: { id: true },
    })
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerActorId: null,
        defaultReviewerActorId: 'actor-default',
      })
    )
  })

  it('passes null defaultReviewerActorId when actor not found', async () => {
    mockTaskFindUnique.mockResolvedValue({
      reviewerActorId: null,
      project: { workspaceId: 'ws-1', defaultReviewerId: 'member-gone' },
    })
    mockActorFindUnique.mockResolvedValue(null)

    await handleNotifyTaskInReview(inReviewEvent)

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ defaultReviewerActorId: null })
    )
  })

  it('skips notification when task is not found', async () => {
    mockTaskFindUnique.mockResolvedValue(null)

    await handleNotifyTaskInReview(inReviewEvent)

    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('ignores non-IN_REVIEW transitions', async () => {
    const doneEvent: TaskStatusChangedEvent = {
      ...inReviewEvent,
      to: 'DONE',
    }

    await handleNotifyTaskInReview(doneEvent)

    expect(mockTaskFindUnique).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
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

    await handleNotifyTaskInReview(agentEvent)

    expect(mockTaskFindUnique).not.toHaveBeenCalled()
  })
})
