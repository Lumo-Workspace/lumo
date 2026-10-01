/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    gitHubIntegration: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    gitHubWebhook: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    pullRequest: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
    taskBranch: {
      upsert: jest.fn(),
    },
    task: {
      findFirst: jest.fn(),
    },
    workspace: {
      findUnique: jest.fn(),
    },
    team: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { githubRepository } from '@/lib/repositories/github.repository'

beforeEach(() => jest.clearAllMocks())

// ── findIntegration ─────────────────────────────────────────────────────

describe('githubRepository.findIntegration', () => {
  it('queries by compound key', async () => {
    const mock = prisma.gitHubIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({ id: 'int-1' })

    const result = await githubRepository.findIntegration('ws-1', 'mem-1')

    expect(mock).toHaveBeenCalledWith({
      where: {
        workspaceId_memberId: { workspaceId: 'ws-1', memberId: 'mem-1' },
      },
    })
    expect(result).toEqual({ id: 'int-1' })
  })
})

// ── findIntegrationStatus ───────────────────────────────────────────────

describe('githubRepository.findIntegrationStatus', () => {
  it('selects only status fields', async () => {
    const mock = prisma.gitHubIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({
      githubLogin: 'user',
      githubUserId: '123',
      repositories: ['org/repo'],
    })

    const result = await githubRepository.findIntegrationStatus('ws-1', 'mem-1')

    expect(mock).toHaveBeenCalledWith({
      where: {
        workspaceId_memberId: { workspaceId: 'ws-1', memberId: 'mem-1' },
      },
      select: { githubLogin: true, githubUserId: true, repositories: true },
    })
    expect(result?.githubLogin).toBe('user')
  })
})

// ── findIntegrationWithWebhooks ─────────────────────────────────────────

describe('githubRepository.findIntegrationWithWebhooks', () => {
  it('includes webhooks relation', async () => {
    const mock = prisma.gitHubIntegration.findUnique as jest.Mock
    mock.mockResolvedValue({ id: 'int-1', webhooks: [] })

    await githubRepository.findIntegrationWithWebhooks('ws-1', 'mem-1')

    expect(mock).toHaveBeenCalledWith({
      where: {
        workspaceId_memberId: { workspaceId: 'ws-1', memberId: 'mem-1' },
      },
      include: { webhooks: true },
    })
  })
})

// ── upsertIntegration ───────────────────────────────────────────────────

describe('githubRepository.upsertIntegration', () => {
  it('upserts with correct create/update shape', async () => {
    const mock = prisma.gitHubIntegration.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'int-1' })

    await githubRepository.upsertIntegration({
      workspaceId: 'ws-1',
      memberId: 'mem-1',
      accessToken: 'enc-token',
      tokenType: 'oauth',
      githubUserId: '123',
      githubLogin: 'user',
    })

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_memberId: { workspaceId: 'ws-1', memberId: 'mem-1' },
        },
        create: expect.objectContaining({
          workspaceId: 'ws-1',
          memberId: 'mem-1',
          repositories: [],
        }),
        update: expect.objectContaining({
          accessToken: 'enc-token',
          githubLogin: 'user',
        }),
      })
    )
  })
})

// ── deleteIntegration ───────────────────────────────────────────────────

describe('githubRepository.deleteIntegration', () => {
  it('deletes by id', async () => {
    const mock = prisma.gitHubIntegration.delete as jest.Mock
    mock.mockResolvedValue({ id: 'int-1' })

    await githubRepository.deleteIntegration('int-1')

    expect(mock).toHaveBeenCalledWith({ where: { id: 'int-1' } })
  })
})

// ── upsertWebhook ───────────────────────────────────────────────────────

describe('githubRepository.upsertWebhook', () => {
  it('upserts by integration + repo', async () => {
    const mock = prisma.gitHubWebhook.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'wh-1' })

    await githubRepository.upsertWebhook('int-1', 'org/repo', 42)

    expect(mock).toHaveBeenCalledWith({
      where: {
        integrationId_repo: { integrationId: 'int-1', repo: 'org/repo' },
      },
      create: { integrationId: 'int-1', repo: 'org/repo', githubHookId: 42 },
      update: { githubHookId: 42 },
    })
  })
})

// ── deleteWebhook ───────────────────────────────────────────────────────

describe('githubRepository.deleteWebhook', () => {
  it('deletes by compound key', async () => {
    const mock = prisma.gitHubWebhook.delete as jest.Mock
    mock.mockResolvedValue({ id: 'wh-1' })

    await githubRepository.deleteWebhook('int-1', 'org/repo')

    expect(mock).toHaveBeenCalledWith({
      where: {
        integrationId_repo: { integrationId: 'int-1', repo: 'org/repo' },
      },
    })
  })
})

// ── upsertPullRequest ───────────────────────────────────────────────────

describe('githubRepository.upsertPullRequest', () => {
  it('upserts by repo + number', async () => {
    const mock = prisma.pullRequest.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'pr-1' })

    await githubRepository.upsertPullRequest({
      workspaceId: 'ws-1',
      taskId: 'task-1',
      integrationId: 'int-1',
      repo: 'org/repo',
      number: 42,
      title: 'Fix bug',
      url: 'https://github.com/org/repo/pull/42',
      state: 'open',
      authorLogin: 'user',
      headBranch: 'fix/bug',
      baseBranch: 'main',
      isDraft: false,
      mergedAt: null,
      closedAt: null,
    })

    expect(mock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_repo_number: {
            workspaceId: 'ws-1',
            repo: 'org/repo',
            number: 42,
          },
        },
        create: expect.objectContaining({ taskId: 'task-1', title: 'Fix bug' }),
        update: expect.objectContaining({ title: 'Fix bug', taskId: 'task-1' }),
      })
    )
  })
})

// ── updatePullRequestCiStatus ───────────────────────────────────────────

describe('githubRepository.updatePullRequestCiStatus', () => {
  it('updates CI status for matching PRs', async () => {
    const mock = prisma.pullRequest.updateMany as jest.Mock
    mock.mockResolvedValue({ count: 2 })

    await githubRepository.updatePullRequestCiStatus(
      'ws-1',
      'org/repo',
      [1, 2],
      'success'
    )

    expect(mock).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', repo: 'org/repo', number: { in: [1, 2] } },
      data: { ciStatus: 'success' },
    })
  })
})

// ── upsertTaskBranch ────────────────────────────────────────────────────

describe('githubRepository.upsertTaskBranch', () => {
  it('upserts with commit data', async () => {
    const mock = prisma.taskBranch.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'tb-1' })
    const now = new Date()

    await githubRepository.upsertTaskBranch({
      taskId: 'task-1',
      repo: 'org/repo',
      branchName: 'lumo/ENG-1-fix',
      lastCommitSha: 'abc123',
      lastCommitMessage: 'fix bug',
      lastCommitAuthor: 'dev',
      lastPushedAt: now,
    })

    expect(mock).toHaveBeenCalledWith({
      where: {
        taskId_repo_branchName: {
          taskId: 'task-1',
          repo: 'org/repo',
          branchName: 'lumo/ENG-1-fix',
        },
      },
      create: expect.objectContaining({
        taskId: 'task-1',
        repo: 'org/repo',
        branchName: 'lumo/ENG-1-fix',
        lastCommitSha: 'abc123',
      }),
      update: expect.objectContaining({ lastCommitSha: 'abc123' }),
    })
  })

  it('upserts branch with empty update when no commit data', async () => {
    const mock = prisma.taskBranch.upsert as jest.Mock
    mock.mockResolvedValue({ id: 'tb-1' })

    await githubRepository.upsertTaskBranch({
      taskId: 'task-1',
      repo: 'org/repo',
      branchName: 'fix/branch',
    })

    expect(mock).toHaveBeenCalledWith({
      where: {
        taskId_repo_branchName: {
          taskId: 'task-1',
          repo: 'org/repo',
          branchName: 'fix/branch',
        },
      },
      create: { taskId: 'task-1', repo: 'org/repo', branchName: 'fix/branch' },
      update: {},
    })
  })
})

// ── findTaskByIdentifier ────────────────────────────────────────────────

describe('githubRepository.findTaskByIdentifier', () => {
  it('queries by team identifier and number', async () => {
    const mock = prisma.task.findFirst as jest.Mock
    mock.mockResolvedValue({ id: 'task-1' })

    await githubRepository.findTaskByIdentifier('ENG', 123, 'ws-1')

    expect(mock).toHaveBeenCalledWith({
      where: {
        number: 123,
        team: { identifier: 'ENG', workspaceId: 'ws-1' },
      },
      include: {
        project: { select: { name: true, ownerId: true, workspaceId: true } },
        team: { select: { identifier: true } },
      },
    })
  })
})

// ── findOtherWorkspaceIdsWithTask ───────────────────────────────────────

describe('githubRepository.findOtherWorkspaceIdsWithTask', () => {
  it('returns the other workspaces whose team owns that task number', async () => {
    const mock = prisma.team.findMany as jest.Mock
    mock.mockResolvedValue([
      { workspaceId: 'ws-2' },
      { workspaceId: 'ws-3' },
      { workspaceId: 'ws-2' },
    ])

    const ids = await githubRepository.findOtherWorkspaceIdsWithTask(
      'LUM',
      123,
      'ws-1'
    )

    expect(ids).toEqual(['ws-2', 'ws-3'])
    expect(mock).toHaveBeenCalledWith({
      where: {
        identifier: 'LUM',
        workspaceId: { not: 'ws-1' },
        tasks: { some: { number: 123 } },
      },
      select: { workspaceId: true },
    })
  })
})
