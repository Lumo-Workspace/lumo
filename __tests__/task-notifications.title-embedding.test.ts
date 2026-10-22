/**
 * @jest-environment node
 */
// LUM-1286 step 2: creating a task, or renaming it, stamps its title embedding
// after the response (fire-and-forget).

jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn().mockResolvedValue(undefined),
  sendDMNotification: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: jest.fn().mockResolvedValue(undefined),
  pushTaskEvent: jest.fn().mockResolvedValue(undefined),
  pushProjectEvent: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/notification.service', () => ({
  buildTaskNotificationCtx: jest.fn(),
  dispatchTaskUpdateNotifications: jest.fn().mockResolvedValue(undefined),
  shouldNotify: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/dependency-detection.service', () => ({
  dependencyDetectionService: { detectForTask: jest.fn().mockResolvedValue(undefined) },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findActorWithMember: jest.fn().mockResolvedValue(null) },
}))
jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: { create: jest.fn(), createMany: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {},
}))
jest.mock('@/lib/services/task-embedding.service', () => ({
  stampTaskTitleEmbedding: jest.fn().mockResolvedValue(undefined),
}))
const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(Promise.resolve(p).catch(() => undefined))
  },
}))

import { stampTaskTitleEmbedding } from '@/lib/services/task-embedding.service'
import {
  dispatchCreateTaskSideEffects,
  scheduleTitleEmbeddingOnUpdate,
} from '@/lib/services/task-notifications.service'

const mockStamp = stampTaskTitleEmbedding as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  waitUntilPromises.length = 0
})

const settle = () => Promise.all(waitUntilPromises)

describe('title embedding scheduling (LUM-1286)', () => {
  it('stamps the new task title on create', async () => {
    dispatchCreateTaskSideEffects({
      task: { id: 't-1', title: 'Add Google OAuth login', teamIdentifier: 'LUM', number: 1 },
      projectId: 'p-1',
      projectName: 'Lumo',
      workspaceId: 'ws-1',
      workspaceSlug: 'lumo',
      actorId: 'a-1',
      actorClerkId: 'c-1',
      assigneeActorId: null,
    })
    await settle()

    expect(mockStamp).toHaveBeenCalledWith('t-1', 'Add Google OAuth login')
  })

  it('re-stamps when an update changed the title', async () => {
    scheduleTitleEmbeddingOnUpdate('t-1', ['title', 'status'], 'Renamed task')
    await settle()

    expect(mockStamp).toHaveBeenCalledWith('t-1', 'Renamed task')
  })

  it('does nothing when the title did not change', async () => {
    scheduleTitleEmbeddingOnUpdate('t-1', ['status'], 'Same title')
    await settle()

    expect(mockStamp).not.toHaveBeenCalled()
  })
})
