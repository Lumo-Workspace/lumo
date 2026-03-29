import { handleAgentComment } from '@/lib/agent/comment-handler'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), update: jest.fn() },
    comment: { create: jest.fn() },
    workspaceMember: { findFirst: jest.fn() },
    gitHubIntegration: { findUnique: jest.fn() },
    notification: { create: jest.fn() },
  },
}))
jest.mock('@/lib/agent/execute', () => ({
  executeAgent: jest.fn(),
}))
jest.mock('@/lib/agent/sandbox-health', () => ({
  isSandboxAlive: jest.fn(),
}))
jest.mock('@/lib/agent/clerk-cache', () => ({
  getClerkUser: jest.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { getClerkUser } from '@/lib/agent/clerk-cache'
import { isSandboxAlive } from '@/lib/agent/sandbox-health'
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
  })

  it('posts reply and returns early when task is Done', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'DONE',
      agentStatus: null,
      sandboxId: null,
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
        type: 'agent',
        body: expect.stringContaining('already done'),
      }),
    })
    expect(mockExecuteAgent).not.toHaveBeenCalled()
  })

  it('posts reply and returns when agent is running and sandbox is alive', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: 'running',
      sandboxId: 'sandbox-123',
      project: { workspaceId: 'ws-1' },
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
      agentStatus: 'running',
      sandboxId: 'sandbox-dead',
      project: { workspaceId: 'ws-1' },
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

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: { agentStatus: 'failed', sandboxId: null },
    })
    expect(mockExecuteAgent).toHaveBeenCalled()
  })

  it('posts reply when commenter is not a workspace member', async () => {
    mockTaskFindUnique.mockResolvedValue({
      id: 'task-1',
      status: 'IN_PROGRESS',
      agentStatus: null,
      sandboxId: null,
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
      sandboxId: null,
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
      sandboxId: null,
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
    })

    // Task should be updated with assigneeType
    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 'task-1' },
      data: expect.objectContaining({
        assigneeType: 'agent',
        assigneeId: null,
      }),
    })

    // Notification sent
    expect(mockNotificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'TASK_MENTIONED',
        recipientId: 'clerk_vincent',
      }),
    })
  })
})
