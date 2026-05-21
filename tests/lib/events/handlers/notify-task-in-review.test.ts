import { handleNotifyTaskInReview } from '@/lib/events/handlers/notify-task-in-review'
import type { TaskStatusChangedEvent } from '@/lib/events/types'

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
  },
}))

jest.mock('@/lib/services/notification.service', () => ({
  notifyTaskInReview: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { notifyTaskInReview } from '@/lib/services/notification.service'

const mockTaskFindUnique = prisma.task.findUnique as jest.Mock
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

  it('notifies workspace owners when task transitions to IN_REVIEW', async () => {
    mockTaskFindUnique.mockResolvedValue({
      project: { workspaceId: 'ws-1' },
    })

    await handleNotifyTaskInReview(inReviewEvent)

    expect(mockNotify).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      taskId: 'task-1',
      triggerActorId: null,
    })
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
})
