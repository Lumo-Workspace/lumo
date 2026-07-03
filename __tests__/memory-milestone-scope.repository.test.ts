/** @jest-environment node */
const mockFindMany = jest.fn()
const mockCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: {
      findMany: (...a: any[]) => mockFindMany(...a),
      create: (...a: any[]) => mockCreate(...a),
    },
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'

beforeEach(() => jest.clearAllMocks())

describe('memory MILESTONE scope repository (LUM-647)', () => {
  it('create persists a MILESTONE scope row with milestoneId and null taskId', async () => {
    mockCreate.mockResolvedValue({ id: 'mem_ms1' })
    const created = await memoryRepository.create({
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: null,
      milestoneId: 'ms_a',
      scope: 'MILESTONE',
      category: 'DECISION',
      content: { what: 'x', why: 'y' },
      sourceSessionId: null,
      createdByMemberId: null,
    })
    expect(created).toEqual({ id: 'mem_ms1' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          taskId: null,
          milestoneId: 'ms_a',
          scope: 'MILESTONE',
        }),
      })
    )
  })

  it('findActiveMilestoneMemories filters milestone scope MILESTONE and ACTIVE', async () => {
    mockFindMany.mockResolvedValue([{ id: 'm1' }])
    const rows = await memoryRepository.findActiveMilestoneMemories('ms_a')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { milestoneId: 'ms_a', scope: 'MILESTONE', status: 'ACTIVE' },
      })
    )
    expect(rows).toEqual([{ id: 'm1' }])
  })

  it('findActiveMilestoneScopeMemoriesByProject returns prior-milestone rows and excludes the current milestone', async () => {
    mockFindMany.mockResolvedValue([{ id: 'prior1' }])
    const rows =
      await memoryRepository.findActiveMilestoneScopeMemoriesByProject(
        'p1',
        'ms_current'
      )
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'p1',
          scope: 'MILESTONE',
          status: 'ACTIVE',
          NOT: { milestoneId: 'ms_current' },
        },
      })
    )
    expect(rows).toEqual([{ id: 'prior1' }])
  })

  it('findActiveMilestoneScopeMemoriesByProject omits the NOT filter when no milestone is excluded', async () => {
    mockFindMany.mockResolvedValue([])
    await memoryRepository.findActiveMilestoneScopeMemoriesByProject('p1')
    const arg = mockFindMany.mock.calls[0][0]
    expect(arg.where).toEqual({
      projectId: 'p1',
      scope: 'MILESTONE',
      status: 'ACTIVE',
    })
    expect('NOT' in arg.where).toBe(false)
  })
})
