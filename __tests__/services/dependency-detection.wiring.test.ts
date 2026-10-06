// __tests__/services/dependency-detection.wiring.test.ts
// LUM-172 Task 6: verify detectMentionEdges is wired into description update
// and comment create paths.
import { describe, it, expect, jest, beforeEach } from '@jest/globals'

// ── Mock variables (must be `mock`-prefixed for SWC factory rules) ───────────

const mockDetectMentionEdges = jest.fn() as jest.MockedFunction<
  (...args: any[]) => Promise<void>
>

const mockNotifyMentionDelta = jest.fn() as jest.MockedFunction<
  (...args: any[]) => Promise<unknown>
>

const mockDispatchEvents = jest.fn() as jest.MockedFunction<
  (...args: any[]) => Promise<unknown>
>

const mockPushTaskEvent = jest.fn() as jest.MockedFunction<
  (...args: any[]) => Promise<unknown>
>

const mockPushProjectEvent = jest.fn() as jest.MockedFunction<
  (...args: any[]) => Promise<unknown>
>

const mockBuildTaskNotificationCtx = jest.fn() as jest.MockedFunction<
  (...args: any[]) => any
>

const mockDispatchTaskUpdateNotifications = jest.fn() as jest.MockedFunction<
  (...args: any[]) => any
>

// Collect waitUntil promises so tests can flush background work before asserting
const mockBackgroundPromises: Array<Promise<unknown>> = []
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => {
    mockBackgroundPromises.push(Promise.resolve(p))
  },
}))

async function flushBackground() {
  await Promise.all(mockBackgroundPromises)
}

// ── Shared service mocks ─────────────────────────────────────────────────────
jest.mock('@/lib/services/dependency-detection.service', () => ({
  dependencyDetectionService: {
    detectMentionEdges: (...a: unknown[]) => mockDetectMentionEdges(...a),
  },
}))

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
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: (...a: unknown[]) => mockNotifyMentionDelta(...a),
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

// ── comment.service deps ─────────────────────────────────────────────────────
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories', () => ({
  memberRepository: {
    findByWorkspaceAndClerkIds: jest.fn(),
  },
  notificationRepository: { createMany: jest.fn() },
  taskRepository: {
    updateCommentsSummary: jest.fn(),
    findForComment: jest.fn(),
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildDispatchOpts(overrides: {
  newDescription?: string
  oldDescription?: string
  changedFields?: string[]
}) {
  const newDescription =
    overrides.newDescription ??
    '<span data-mention-type="task" data-id="task-b">LUM-2</span>'
  const oldDescription = overrides.oldDescription ?? ''
  const changedFields = overrides.changedFields ?? ['description']
  return {
    taskId: 'task-a',
    input: { description: newDescription },
    result: {
      task: {
        id: 'task-a',
        projectId: 'proj1',
        title: 'Task A',
        number: 1,
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
      number: 1,
      description: oldDescription,
    },
    actorId: 'actor1',
    actorClerkId: 'clerk-author',
  }
}

const baseCommentInput = {
  taskId: 'task-a',
  authorActorId: 'actor1',
  body: '<p>See <span data-mention-type="task" data-id="task-b">LUM-2</span></p>',
  parentId: null,
  quotedCommentId: null,
  authorClerkId: 'clerk1',
  workspaceId: 'ws1',
  projectId: 'proj1',
  taskTitle: 'Task A',
  taskNumber: 1,
  teamIdentifier: 'LUM',
  workspaceSlug: 'ws-slug',
  projectName: 'Lumo',
  waitUntil: (p: Promise<unknown>) => {
    mockBackgroundPromises.push(Promise.resolve(p))
  },
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  jest.clearAllMocks()
  mockBackgroundPromises.length = 0
  mockDetectMentionEdges.mockResolvedValue(undefined)
  mockNotifyMentionDelta.mockResolvedValue(undefined)
  mockDispatchEvents.mockResolvedValue(undefined)
  mockPushTaskEvent.mockResolvedValue(undefined)
  mockPushProjectEvent.mockResolvedValue(undefined)
  mockBuildTaskNotificationCtx.mockReturnValue({})
  mockDispatchTaskUpdateNotifications.mockReturnValue(undefined)
  // Set up member repo to return empty array (no user mentions to notify)
  const { memberRepository } = await import('@/lib/repositories')

  ;(memberRepository.findByWorkspaceAndClerkIds as any).mockResolvedValue([])
})

// ────────────────────────────────────────────────────────────────────────────
// 1. Description path
// ────────────────────────────────────────────────────────────────────────────

describe('dispatchUpdateTaskSideEffects → detectMentionEdges (description path)', () => {
  async function getDispatcher() {
    const mod = await import('@/lib/services/task-notifications.service')
    return mod.dispatchUpdateTaskSideEffects
  }

  it('calls detectMentionEdges with surface:description when description changes', async () => {
    const dispatch = await getDispatcher()
    const html = '<span data-mention-type="task" data-id="task-b">LUM-2</span>'
    dispatch(
      buildDispatchOpts({
        newDescription: html,
        changedFields: ['description'],
      }) as never
    )
    await flushBackground()

    expect(mockDetectMentionEdges).toHaveBeenCalledTimes(1)
    expect(mockDetectMentionEdges).toHaveBeenCalledWith({
      taskId: 'task-a',
      workspaceId: 'ws1',
      html,
      surface: 'description',
    })
  })

  it('does NOT call detectMentionEdges when description is not in changedFields', async () => {
    const dispatch = await getDispatcher()
    dispatch(buildDispatchOpts({ changedFields: ['title'] }) as never)
    await flushBackground()

    expect(mockDetectMentionEdges).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. Comment path
// ────────────────────────────────────────────────────────────────────────────

describe('createCommentWithSideEffects → detectMentionEdges (comment path)', () => {
  async function getCommentService() {
    const mod = await import('@/lib/services/comment.service')
    return mod.commentService
  }

  async function getCommentRepo() {
    const { commentRepository } =
      await import('@/lib/repositories/comment.repository')
    return commentRepository
  }

  it('calls detectMentionEdges with surface:comment on every comment create', async () => {
    const svc = await getCommentService()
    const repo = await getCommentRepo()

    ;(repo.create as any).mockResolvedValue({ id: 'c1' })
    ;(repo.listAllForTask as any).mockResolvedValue([])

    await svc.createCommentWithSideEffects({ ...baseCommentInput } as any)
    await flushBackground()

    expect(mockDetectMentionEdges).toHaveBeenCalledTimes(1)
    expect(mockDetectMentionEdges).toHaveBeenCalledWith({
      taskId: 'task-a',
      workspaceId: 'ws1',
      html: baseCommentInput.body,
      surface: 'comment',
    })
  })

  it('calls detectMentionEdges even when the body has zero user @-mentions (guards early-return in notifyMentions)', async () => {
    const svc = await getCommentService()
    const repo = await getCommentRepo()

    ;(repo.create as any).mockResolvedValue({ id: 'c2' })
    ;(repo.listAllForTask as any).mockResolvedValue([])

    // Body contains only a task-mention chip — no user mention
    const taskOnlyBody =
      '<p>Blocked by <span data-mention-type="task" data-id="task-b">LUM-2</span></p>'
    await svc.createCommentWithSideEffects({
      ...baseCommentInput,
      body: taskOnlyBody,
    } as any)
    await flushBackground()

    expect(mockDetectMentionEdges).toHaveBeenCalledTimes(1)
    expect(mockDetectMentionEdges).toHaveBeenCalledWith({
      taskId: 'task-a',
      workspaceId: 'ws1',
      html: taskOnlyBody,
      surface: 'comment',
    })
  })
})
