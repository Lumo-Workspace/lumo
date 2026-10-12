/**
 * @jest-environment node
 *
 * Tests for dispatchTaskUpdateNotifications self-skip behavior.
 * Regression coverage for the bug where Chao Li marking his own task
 * as DONE generated a self-notification (TASK_DONE used to bypass the
 * trigger-clerk-id self check via skipSelfCheck=true).
 */

jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
  sendDMNotification: jest.fn(),
  handleCommand: jest.fn(),
  slackAdapter: {},
  bot: {},
}))

jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/notifications/preferenceGate', () => ({
  shouldNotify: jest.fn().mockResolvedValue(true),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    actor: {
      findUnique: jest.fn(),
    },
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'noti-1' }),
    },
  },
}))

// Capture promises passed to waitUntil so we can flush them between assertions.
const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
  },
}))

async function flushWaitUntil() {
  // notifyActor enqueues a top-level waitUntil; inside it, a successful
  // notification.create then enqueues a pushUserEvent waitUntil. Loop until
  // the queue is drained.
  while (waitUntilPromises.length > 0) {
    await Promise.all(waitUntilPromises.splice(0))
  }
}

import { prisma } from '@/lib/db/prisma'
import {
  dispatchTaskUpdateNotifications,
  taskNotificationPayload,
} from '@/lib/notifications/notifyTaskChange'
import type { TaskNotificationCtx } from '@/lib/notifications/notifyTaskChange'

const mockActorFindUnique = prisma.actor.findUnique as jest.Mock
const mockNotificationCreate = prisma.notification.create as jest.Mock

const SELF_CLERK_ID = 'clerk_self'
const OTHER_CLERK_ID = 'clerk_other'
const SELF_ACTOR_ID = 'actor_self'

const baseCtx: TaskNotificationCtx = {
  workspaceId: 'ws-1',
  taskTitle: 'Some task',
  taskIdentifier: 'LUM-1',
  taskUrl: 'https://example.com/LUM-1',
  projectId: 'proj-1',
  triggerActorId: SELF_ACTOR_ID,
  triggerClerkId: SELF_CLERK_ID,
}

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
})

describe('dispatchTaskUpdateNotifications — TASK_DONE self-skip', () => {
  it('does NOT create a TASK_DONE notification when the trigger is the assignee', async () => {
    // Assignee resolves to the same clerkId as the trigger — i.e. user marked
    // their own task as DONE.
    mockActorFindUnique.mockResolvedValue({
      type: 'HUMAN',
      member: { clerkId: SELF_CLERK_ID },
    })

    dispatchTaskUpdateNotifications({
      ctx: baseCtx,
      taskId: 'task-1',
      oldStatus: 'IN_REVIEW',
      newStatus: 'DONE',
      oldAssigneeActorId: SELF_ACTOR_ID,
      newAssigneeActorId: SELF_ACTOR_ID,
      workspaceId: 'ws-1',
      triggerActorId: SELF_ACTOR_ID,
    })

    await flushWaitUntil()

    expect(mockNotificationCreate).not.toHaveBeenCalled()
  })

  it('DOES create a TASK_DONE notification when someone else marks the task as DONE', async () => {
    // Assignee resolves to a different clerkId than the trigger.
    mockActorFindUnique.mockResolvedValue({
      type: 'HUMAN',
      member: { clerkId: OTHER_CLERK_ID },
    })

    dispatchTaskUpdateNotifications({
      ctx: baseCtx,
      taskId: 'task-1',
      oldStatus: 'IN_REVIEW',
      newStatus: 'DONE',
      oldAssigneeActorId: 'actor_other',
      newAssigneeActorId: 'actor_other',
      workspaceId: 'ws-1',
      triggerActorId: SELF_ACTOR_ID,
    })

    await flushWaitUntil()

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1)
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'TASK_DONE',
          recipientActorId: 'actor_other',
          triggerActorId: SELF_ACTOR_ID,
        }),
      })
    )
  })
})

describe('taskNotificationPayload (LUM-1095)', () => {
  it('describes the task as the entity and carries the trigger as actor', () => {
    expect(taskNotificationPayload(baseCtx, 'task-1')).toEqual({
      entityKind: 'task',
      entityId: 'task-1',
      entityTitle: 'Some task',
      entityIdentifier: 'LUM-1',
      entityUrl: 'https://example.com/LUM-1',
      actorClerkId: SELF_CLERK_ID,
    })
  })

  it('omits the actor when there is no human trigger', () => {
    expect(
      taskNotificationPayload({ ...baseCtx, triggerClerkId: '' }, 'task-1')
        .actorClerkId
    ).toBeUndefined()
  })
})
