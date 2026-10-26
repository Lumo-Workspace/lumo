/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    pullRequest: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

const mockFindMany = prisma.pullRequest.findMany as jest.Mock
const mockFindUnique = prisma.pullRequest.findUnique as jest.Mock
const mockUpdate = prisma.pullRequest.update as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('pullRequestRepository.searchByWorkspace', () => {
  it('searches by PR number when query is numeric', async () => {
    mockFindMany.mockResolvedValue([])
    await pullRequestRepository.searchByWorkspace('ws-1', '42', 20)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'ws-1', number: 42 }),
      })
    )
  })

  it('searches by title when query is non-numeric', async () => {
    mockFindMany.mockResolvedValue([])
    await pullRequestRepository.searchByWorkspace('ws-1', 'fix login', 20)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws-1',
          title: { contains: 'fix login', mode: 'insensitive' },
        }),
      })
    )
  })

  it('respects limit parameter', async () => {
    mockFindMany.mockResolvedValue([])
    await pullRequestRepository.searchByWorkspace('ws-1', 'test', 5)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    )
  })
})

describe('pullRequestRepository.findByRepoAndNumber', () => {
  it('finds PR by compound key', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'pr-1',
      repo: 'org/repo',
      number: 42,
    })
    const result = await pullRequestRepository.findByRepoAndNumber(
      'ws-1',
      'org/repo',
      42
    )
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_provider_repo_number: {
          workspaceId: 'ws-1',
          provider: 'github',
          repo: 'org/repo',
          number: 42,
        },
      },
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            team: { select: { identifier: true } },
          },
        },
      },
    })
    expect(result).toEqual({ id: 'pr-1', repo: 'org/repo', number: 42 })
  })

  it('returns null when PR not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await pullRequestRepository.findByRepoAndNumber(
      'ws-1',
      'org/repo',
      999
    )
    expect(result).toBeNull()
  })
})

describe('pullRequestRepository.updateTaskId', () => {
  it('updates taskId on a PR', async () => {
    mockUpdate.mockResolvedValue({ id: 'pr-1', taskId: 'task-1' })
    await pullRequestRepository.updateTaskId('pr-1', 'task-1')
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { taskId: 'task-1' },
    })
  })

  it('sets taskId to null for unlink', async () => {
    mockUpdate.mockResolvedValue({ id: 'pr-1', taskId: null })
    await pullRequestRepository.updateTaskId('pr-1', null)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'pr-1' },
      data: { taskId: null },
    })
  })
})
