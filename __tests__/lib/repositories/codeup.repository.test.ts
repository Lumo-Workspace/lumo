/**
 * @jest-environment node
 *
 * LUM-1315 — Codeup repository: every PR / branch row it writes is a
 * `provider: 'codeup'` row keyed by the provider-aware unique keys.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    codeupConnection: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    codeupRepository: {
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    pullRequest: { upsert: jest.fn() },
    taskBranch: { upsert: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { codeupRepository } from '@/lib/repositories/codeup.repository'

const p = prisma as unknown as {
  codeupConnection: Record<string, jest.Mock>
  codeupRepository: Record<string, jest.Mock>
  pullRequest: Record<string, jest.Mock>
  taskBranch: Record<string, jest.Mock>
}

beforeEach(() => jest.clearAllMocks())

describe('connection', () => {
  it('finds the workspace connection with its repositories', async () => {
    p.codeupConnection.findUnique!.mockResolvedValue({ id: 'c1' })
    await codeupRepository.findConnectionByWorkspace('ws-1')
    expect(p.codeupConnection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1' } })
    )
  })

  it('upserts by workspace', async () => {
    await codeupRepository.upsertConnection({
      workspaceId: 'ws-1',
      organizationId: 'org',
      accessToken: 'enc',
      connectedBy: 'm1',
    })
    expect(p.codeupConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        update: {
          organizationId: 'org',
          accessToken: 'enc',
          connectedBy: 'm1',
        },
      })
    )
  })

  it('deletes by id', async () => {
    await codeupRepository.deleteConnection('c1')
    expect(p.codeupConnection.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    })
  })
})

describe('repositories', () => {
  it('upserts a confirmed repository by connection + repository id', async () => {
    const data = {
      connectionId: 'c1',
      repositoryId: 14,
      pathWithNamespace: 'o/r',
      webUrl: 'w',
      webhookId: 5,
      webhookTokenHash: 'h',
      confirmedAt: new Date(),
    }
    await codeupRepository.upsertRepository(data)
    expect(p.codeupRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_repositoryId: { connectionId: 'c1', repositoryId: 14 },
        },
        create: data,
      })
    )
  })

  it('unconfirms without dropping the token hash', async () => {
    await codeupRepository.markUnconfirmed('r1')
    expect(p.codeupRepository.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { confirmedAt: null, webhookId: null },
    })
  })

  it('flattens delivery candidates to their workspace', async () => {
    p.codeupRepository.findMany!.mockResolvedValue([
      {
        id: 'r1',
        repositoryId: 14,
        pathWithNamespace: 'o/r',
        webhookTokenHash: 'h',
        confirmedAt: null,
        connection: { workspaceId: 'ws-1' },
      },
    ])
    await expect(codeupRepository.findDeliveryCandidates(14)).resolves.toEqual([
      {
        id: 'r1',
        repositoryId: 14,
        pathWithNamespace: 'o/r',
        webhookTokenHash: 'h',
        confirmedAt: null,
        workspaceId: 'ws-1',
      },
    ])
  })

  it('lists other workspaces that confirmed the repository, once each', async () => {
    p.codeupRepository.findMany!.mockResolvedValue([
      { connection: { workspaceId: 'ws-2' } },
      { connection: { workspaceId: 'ws-2' } },
    ])
    await expect(
      codeupRepository.findOtherConfirmingWorkspaceIds(14, 'ws-1')
    ).resolves.toEqual(['ws-2'])
    expect(p.codeupRepository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          repositoryId: 14,
          confirmedAt: { not: null },
          connection: { workspaceId: { not: 'ws-1' } },
        },
      })
    )
  })
})

describe('merge requests and branches', () => {
  const mr = {
    workspaceId: 'ws-1',
    taskId: 't1',
    repo: 'org/group/repo',
    number: 3,
    title: 'T',
    url: 'u',
    state: 'open' as const,
    authorLogin: 'a',
    headBranch: 'lumo/LUM-1-x',
    headSha: null,
    baseBranch: 'master',
    isDraft: false,
    mergedAt: null,
    closedAt: null,
  }

  it('upserts a provider codeup PR row on the provider-aware key', async () => {
    await codeupRepository.upsertMergeRequest(mr)
    const arg = p.pullRequest.upsert!.mock.calls[0]![0]
    expect(arg.where).toEqual({
      workspaceId_provider_repo_number: {
        workspaceId: 'ws-1',
        provider: 'codeup',
        repo: 'org/group/repo',
        number: 3,
      },
    })
    expect(arg.create.provider).toBe('codeup')
    // No sha in this delivery: the update leaves a recorded one alone.
    expect(arg.update).not.toHaveProperty('headSha')
  })

  it('upserts a provider codeup task branch', async () => {
    await codeupRepository.upsertTaskBranch({
      taskId: 't1',
      repo: 'org/repo',
      branchName: 'b',
      lastCommitSha: 's',
    })
    expect(p.taskBranch.upsert).toHaveBeenCalledWith({
      where: {
        taskId_provider_repo_branchName: {
          taskId: 't1',
          provider: 'codeup',
          repo: 'org/repo',
          branchName: 'b',
        },
      },
      create: {
        taskId: 't1',
        provider: 'codeup',
        repo: 'org/repo',
        branchName: 'b',
        lastCommitSha: 's',
      },
      update: { lastCommitSha: 's' },
    })
  })
})
