/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      update: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockUpdate = prisma.pullRequest.update as jest.Mock
const mockFindMany = prisma.pullRequest.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('pullRequestRepository.listIdAndNumberByTask', () => {
  it('selects id + number for a task, newest first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'pr_1', number: 7 }])
    const r = await pullRequestRepository.listIdAndNumberByTask('tsk_1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'tsk_1' },
      select: { id: true, number: true },
      orderBy: { updatedAt: 'desc' },
    })
    expect(r).toEqual([{ id: 'pr_1', number: 7 }])
  })
})

describe('pullRequestRepository.updateState', () => {
  it('updates PR state and timestamps', async () => {
    const mergedAt = new Date('2026-04-07T10:00:00Z')
    mockUpdate.mockResolvedValue({ id: 'pr-1', state: 'merged' })

    await pullRequestRepository.updateState('pr-1', {
      state: 'merged',
      mergedAt,
      closedAt: null,
      isDraft: false,
    })

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { state: 'merged', mergedAt, closedAt: null, isDraft: false },
    })
  })
})

describe('pullRequestRepository.countTaskLinkedWorkspaces', () => {
  it('counts distinct task-linked workspaces for the repo and number', async () => {
    mockFindMany.mockResolvedValue([{ workspaceId: 'a' }, { workspaceId: 'b' }])
    const n = await pullRequestRepository.countTaskLinkedWorkspaces(
      'Acme-Inc/Web',
      7
    )
    expect(n).toBe(2)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        provider: 'github',
        repo: { equals: 'Acme-Inc/Web', mode: 'insensitive' },
        number: 7,
        taskId: { not: null },
      },
      select: { workspaceId: true },
      distinct: ['workspaceId'],
    })
  })
})

describe('pullRequestRepository.findForSecurityImport (LUM-1321)', () => {
  it('looks the GitHub PR up inside the caller workspace only', async () => {
    const findFirst = prisma.pullRequest.findFirst as jest.Mock
    findFirst.mockResolvedValue(null)
    await expect(
      pullRequestRepository.findForSecurityImport('ws1', 'acme/app', 7)
    ).resolves.toBeNull()
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws1',
        provider: 'github',
        repo: 'acme/app',
        number: 7,
      },
      select: {
        id: true,
        provider: true,
        repo: true,
        number: true,
        state: true,
        headSha: true,
      },
    })
  })
})
