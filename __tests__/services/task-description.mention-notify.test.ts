import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// next/jest uses SWC: factory closures may only reference `mock`-prefixed vars.
const mockNotifyMentionDelta = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockDispatchEvents = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockPushTaskEvent = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockPushProjectEvent = jest.fn<(...args: any[]) => Promise<unknown>>()
const mockBuildTaskNotificationCtx = jest.fn<(...args: any[]) => any>()
const mockDispatchTaskUpdateNotifications = jest.fn<(...args: any[]) => any>()

// Collect fire-and-forget promises so the test can await them before asserting
// (the notify resolution runs inside an async waitUntil callback).
const mockBackgroundPromises: Promise<unknown>[] = []
// LUM-1286: a title change schedules an embedding stamp; keep the AI SDK
// (needs TransformStream, absent in jsdom) out of this test.
jest.mock('@/lib/services/task-embedding.service', () => ({
  stampTaskTitleEmbedding: jest.fn(async () => undefined),
}))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockBackgroundPromises.push(Promise.resolve(p))
  },
}))

async function flushBackground() {
  await Promise.all(mockBackgroundPromises)
}

jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: (...a: unknown[]) => mockDispatchEvents(...a),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushTaskEvent: (...a: unknown[]) => mockPushTaskEvent(...a),
  pushProjectEvent: (...a: unknown[]) => mockPushProjectEvent(...a),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendChannelNotification: jest.fn(),
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findActorWithMember: jest.fn() },
}))
jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findNameAndSlug: jest.fn(async () => ({ name: 'WS', slug: 'ws' })),
  },
}))
jest.mock('@/lib/services/notification.service', () => ({
  buildTaskNotificationCtx: (...a: unknown[]) =>
    mockBuildTaskNotificationCtx(...a),
  dispatchTaskUpdateNotifications: (...a: unknown[]) =>
    mockDispatchTaskUpdateNotifications(...a),
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => mockNotifyMentionDelta(...a),
}))

async function getDispatcher() {
  const mod = await import('@/lib/services/task-notifications.service')
  return mod.dispatchUpdateTaskSideEffects
}

const span = (clerkId: string) =>
  `<span class="mention" data-mention-type="user" data-id="${clerkId}">@u</span>`

function buildOpts(overrides: {
  newDescription?: string
  oldDescription?: string
  changedFields?: string[]
}) {
  const newDescription = overrides.newDescription ?? span('u1')
  const oldDescription = overrides.oldDescription ?? ''
  const changedFields = overrides.changedFields ?? ['description']
  return {
    taskId: 'task1',
    input: { description: newDescription },
    result: {
      task: {
        id: 'task1',
        projectId: 'proj1',
        title: 'My Task',
        number: 42,
        status: 'TODO',
        priority: 'MEDIUM',
        assigneeActorId: null,
        teamIdentifier: 'LUM',
        team: { identifier: 'LUM' },
        tags: [],
      },
      changedFields,
      oldStatus: 'TODO',
      oldAssigneeActorId: null,
    },
    taskCheck: {
      project: {
        name: 'Lumo',
        workspaceId: 'ws1',
        workspace: { slug: 'ws-slug' },
      },
      projectId: 'proj1',
      number: 42,
      description: oldDescription,
    },
    actorId: 'actor1',
    actorClerkId: 'clerk-author',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBackgroundPromises.length = 0
  mockNotifyMentionDelta.mockResolvedValue(undefined)
  mockDispatchEvents.mockResolvedValue(undefined)
  mockPushTaskEvent.mockResolvedValue(undefined)
  mockPushProjectEvent.mockResolvedValue(undefined)
  mockBuildTaskNotificationCtx.mockReturnValue({})
  mockDispatchTaskUpdateNotifications.mockReturnValue(undefined)
})

describe('dispatchUpdateTaskSideEffects @mention notifications', () => {
  it('fires notifyMentionDelta with TASK_MENTIONED when description changes', async () => {
    const dispatch = await getDispatcher()
    dispatch(
      buildOpts({ newDescription: span('u1'), oldDescription: '' }) as never
    )
    await flushBackground()

    expect(mockNotifyMentionDelta).toHaveBeenCalledTimes(1)
    const arg = mockNotifyMentionDelta.mock.calls[0]![0] as Record<
      string,
      unknown
    >
    expect(arg).toMatchObject({
      notificationType: 'TASK_MENTIONED',
      ref: { taskId: 'task1' },
      oldHtml: '',
      newHtml: span('u1'),
      workspaceId: 'ws1',
      authorActorId: 'actor1',
      authorClerkId: 'clerk-author',
    })
  })

  it('does not fire when description is not part of the changed fields', async () => {
    const dispatch = await getDispatcher()
    dispatch(buildOpts({ changedFields: ['title'] }) as never)
    await flushBackground()
    expect(mockNotifyMentionDelta).not.toHaveBeenCalled()
  })
})
