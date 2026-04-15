import { handleAgentComment } from '@/lib/agent/comment-handler'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), update: jest.fn() },
    comment: { create: jest.fn() },
    workspaceMember: { findFirst: jest.fn() },
    gitHubIntegration: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
    actor: { findFirst: jest.fn(), findUnique: jest.fn() },
    agentRun: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/actor', () => ({
  getAgentActor: jest.fn().mockResolvedValue('agent-actor-1'),
  getHumanActorId: jest.fn().mockResolvedValue('human-actor-1'),
}))
jest.mock('@/lib/agent/execute', () => ({
  executeAgent: jest.fn(),
}))
jest.mock('@/lib/utils/markdown', () => ({
  markdownToHtml: jest.fn((md: string) =>
    /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
      md
    )
      ? md
      : `<p>${md}</p>`
  ),
  htmlToMarkdown: jest.fn((html: string) =>
    /<(?:p|div|span|br|h[1-6]|ul|ol|li|a\b|strong|em|code|pre|blockquote|table|img\b)[>\s/]/i.test(
      html
    )
      ? html
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : html
  ),
}))
jest.mock('@/lib/integrations/sandbox', () => ({
  isSandboxAlive: jest.fn(),
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  getClerkUser: jest.fn(),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushTaskEvent: jest.fn().mockReturnValue(Promise.resolve()),
  pushUserEvent: jest.fn().mockReturnValue(Promise.resolve()),
}))
jest.mock('@/lib/events/dispatcher', () => ({
  dispatchEvents: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '@/lib/db/prisma'
import { getClerkUser } from '@/lib/utils/clerk-helpers'
import { isSandboxAlive } from '@/lib/integrations/sandbox'
import { executeAgent } from '@/lib/agent/execute'

const mockTaskFindUnique = prisma.task.findUnique as jest.Mock
const mockTaskUpdate = prisma.task.update as jest.Mock
const mockCommentCreate = prisma.comment.create as jest.Mock
const mockMemberFindFirst = prisma.workspaceMember.findFirst as jest.Mock
const mockGhFindUnique = (prisma as any).gitHubIntegration
  .findUnique as jest.Mock
const mockNotificationCreate = prisma.notification.create as jest.Mock
const mockGetClerkUser = getClerkUser as jest.Mock
const mockIsSandboxAlive = isSandboxAlive as jest.Mock
const mockExecuteAgent = executeAgent as jest.Mock

describe('handleAgentComment', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockGetClerkUser.mockResolvedValue({
      name: 'Vincent Mou',
      email: 'vincent@example.com',
    })
    mockCommentCreate.mockResolvedValue({ id: 'comment-reply-1' })
    mockNotificationCreate.mockResolvedValue({})
    // Re-apply mocks after resetAllMocks clears them
    const pusher = require('@/lib/integrations/pusher')
    pusher.pushTaskEvent.mockReturnValue(Promise.resolve())
    pusher.pushUserEvent.mockReturnValue(Promise.resolve())
    const dispatcher = require('@/lib/events/dispatcher')
    dispatcher.dispatchEvents.mockResolvedValue(undefined)
    const actor = require('@/lib/actor')
    actor.getAgentActor.mockResolvedValue('agent-actor-1')
    actor.getHumanActorId.mockResolvedValue('human-actor-1')
  })

  it('posts reply and returns early when task is Done', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'DONE',
      agentStatus: null,

      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> fix the bug',
      actorClerkId: 'clerk_vincent',
    })

    expect(mockCommentCreate).toHaveBeenCalledTimes(1)
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 'task-1',
        parentId: 'comment-1',
        type: 'AGENT',
        body: expect.stringContaining('already done'),
      }),
    })
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('posts reply and returns when agent is running and sandbox is alive', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: 'WORKING',
      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    ;(prisma.agentRun.findFirst as jest.Mock).mockResolvedValue({
      sandboxId: 'sandbox-123',
    })
    mockIsSandboxAlive.mockResolvedValue(true)

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> fix it',
      actorClerkId: 'clerk_vincent',
    })

    expect(mockCommentCreate).toHaveBeenCalledTimes(1)
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: expect.stringContaining('already working'),
      }),
    })
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('cleans up stale state and continues when sandbox is dead', async () => {
    // First call: handleAgentComment's own findUnique
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: 'WORKING',
      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    ;(prisma.agentRun.findFirst as jest.Mock).mockResolvedValue({
      sandboxId: 'sandbox-dead',
    })
    // Second call: buildAgentSpec's findUnique
    mockTaskFindUnique.mockResolvedValueOnce({
      spec: null,
      description: null,
      branches: [],
      pullRequests: [],
    })
    mockIsSandboxAlive.mockResolvedValue(false)
    mockMemberFindFirst.mockResolvedValue({ id: 'member-1' })
    mockGhFindUnique.mockResolvedValue({ id: 'gh-1' })
    mockExecuteAgent.mockResolvedValue({
      outcome: 'done',
      prUrl: 'https://github.com/pr/1',
      prNumber: 1,
    })

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> fix it',
      actorClerkId: 'clerk_vincent',
    })

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          agentStatus: 'FAILED',
        }),
      })
    )
    expect(mockExecuteAgent).toHaveBeenCalled()
  })

  it('posts reply when commenter is not a workspace member', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: null,

      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    mockMemberFindFirst.mockResolvedValue(null)

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> fix it',
      actorClerkId: 'clerk_vincent',
    })

    expect(mockCommentCreate).toHaveBeenCalledTimes(1)
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: expect.stringContaining('connect your GitHub'),
      }),
    })
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('posts reply when commenter has no GitHub integration', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: null,

      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    mockMemberFindFirst.mockResolvedValue({ id: 'member-1' })
    mockGhFindUnique.mockResolvedValue(null)

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> fix it',
      actorClerkId: 'clerk_vincent',
    })

    expect(mockCommentCreate).toHaveBeenCalledTimes(1)
    expect(mockCommentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        body: expect.stringContaining('connect your GitHub'),
      }),
    })
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('posts "Got it", executes agent, and posts "Done" reply on success', async () => {
    // First call: handleAgentComment's own findUnique
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: null,

      projectId: 'proj-1',
      project: { workspaceId: 'ws-1' },
    })
    // Second call: buildAgentSpec's findUnique
    mockTaskFindUnique.mockResolvedValueOnce({
      spec: null,
      description: null,
      branches: [],
      pullRequests: [],
    })
    mockMemberFindFirst.mockResolvedValue({ id: 'member-1' })
    mockGhFindUnique.mockResolvedValue({ id: 'gh-1' })
    mockExecuteAgent.mockResolvedValue({
      outcome: 'done',
      prUrl: 'https://github.com/owner/repo/pull/4',
      prNumber: 4,
    })

    await handleAgentComment({
      taskId: 'task-1',
      commentId: 'comment-1',
      commentBody:
        '<span data-type="mention" data-id="__agent__">@agent</span> implement login',
      actorClerkId: 'clerk_vincent',
    })

    // "Got it" + "Done" = 2 comment creates
    expect(mockCommentCreate).toHaveBeenCalledTimes(2)
    expect(mockCommentCreate.mock.calls[0][0].data.body).toContain('Got it')
    expect(mockCommentCreate.mock.calls[1][0].data.body).toContain('PR #4')
    expect(mockCommentCreate.mock.calls[1][0].data.body).toContain(
      'https://github.com/owner/repo/pull/4'
    )

    expect(mockExecuteAgent).toHaveBeenCalledWith({
      taskId: 'task-1',
      actorClerkId: 'clerk_vincent',
      actorName: 'Vincent Mou',
      actorEmail: 'vincent@example.com',
      trigger: 'comment',
    })

    // Task should be updated with agent actor as assignee
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        assigneeActorId: 'agent-actor-1',
      }),
    })

    // Notification sent with Actor IDs
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'TASK_MENTIONED',
        recipientActorId: 'human-actor-1',
      }),
    })
  })
})
