/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    worktree: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { worktreeRepository } from '@/lib/repositories/worktree.repository'

const mockUpsert = prisma.worktree.upsert as jest.Mock
const mockUpdateMany = prisma.worktree.updateMany as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('worktreeRepository.upsertWorktree', () => {
  it('creates with branch and revives removedAt on update', async () => {
    mockUpsert.mockResolvedValue({ id: 'wt_1' })

    const result = await worktreeRepository.upsertWorktree({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      branch: 'lumo/LUM-9-x',
    })

    expect(result).toEqual({ id: 'wt_1' })
    expect(mockUpsert).toHaveBeenCalledWith({
      where: {
        workspaceId_path: { workspaceId: 'ws_1', path: '/repo/.worktrees/x' },
      },
      create: {
        workspaceId: 'ws_1',
        path: '/repo/.worktrees/x',
        branch: 'lumo/LUM-9-x',
      },
      update: { branch: 'lumo/LUM-9-x', removedAt: null },
      select: { id: true },
    })
  })

  it('does not overwrite an existing branch with null on update', async () => {
    mockUpsert.mockResolvedValue({ id: 'wt_1' })

    await worktreeRepository.upsertWorktree({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      branch: null,
    })

    const arg = mockUpsert.mock.calls[0]![0]
    expect(arg.update).toEqual({ removedAt: null })
    expect(arg.create).toEqual({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      branch: null,
    })
  })
})

describe('worktreeRepository.markRemoved', () => {
  it('stamps removedAt for the matching workspace+path', async () => {
    const now = new Date('2026-06-01T12:00:00Z')
    mockUpdateMany.mockResolvedValue({ count: 1 })

    await worktreeRepository.markRemoved({
      workspaceId: 'ws_1',
      path: '/repo/.worktrees/x',
      now,
    })

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws_1', path: '/repo/.worktrees/x' },
      data: { removedAt: now },
    })
  })
})
