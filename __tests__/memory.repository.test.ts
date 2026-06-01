/** @jest-environment node */
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()
const mockFindUnique = jest.fn()
const mockCreate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: {
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
      findUnique: (...a: any[]) => mockFindUnique(...a),
      create: (...a: any[]) => mockCreate(...a),
    },
  },
}))

import { memoryRepository } from '@/lib/repositories/memory.repository'

beforeEach(() => jest.clearAllMocks())

describe('memoryRepository.listForProject', () => {
  it('filters by projectId + scope PROJECT, newest first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'm1' }])
    const rows = await memoryRepository.listForProject('p1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', scope: 'PROJECT' },
        orderBy: { createdAt: 'desc' },
      })
    )
    expect(rows).toEqual([{ id: 'm1' }])
  })
})

describe('memoryRepository.listForTask', () => {
  it('filters by taskId, newest first', async () => {
    mockFindMany.mockResolvedValue([])
    await memoryRepository.listForTask('t1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 't1' },
        orderBy: { createdAt: 'desc' },
      })
    )
  })
})

describe('memoryRepository.update', () => {
  it('applies content + scope + taskId together', async () => {
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryRepository.update('m1', {
      content: { rule: 'x', scope: 'y' },
      scope: 'PROJECT',
      taskId: null,
    })
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: {
          content: { rule: 'x', scope: 'y' },
          scope: 'PROJECT',
          task: { disconnect: true },
        },
      })
    )
  })

  it('omits undefined fields from the data payload', async () => {
    mockUpdate.mockResolvedValue({ id: 'm1' })
    await memoryRepository.update('m1', { content: { rule: 'x', scope: 'y' } })
    const arg = mockUpdate.mock.calls[0][0]
    expect(arg.data).toEqual({ content: { rule: 'x', scope: 'y' } })
    expect('scope' in arg.data).toBe(false)
    expect('task' in arg.data).toBe(false)
  })
})

describe('memoryRepository.findByIdWithWorkspace', () => {
  it('selects the auth-relevant fields', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'm1',
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: 't1',
      scope: 'TASK',
      category: 'TRAP',
    })
    const row = await memoryRepository.findByIdWithWorkspace('m1')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { id: 'm1' },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        taskId: true,
        scope: true,
        category: true,
      },
    })
    expect(row?.workspaceId).toBe('w1')
  })
})

describe('memoryRepository.create', () => {
  it('forwards an explicit agent', async () => {
    mockCreate.mockResolvedValue({ id: 'm1' })
    await memoryRepository.create({
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: 't1',
      scope: 'TASK',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      sourceSessionId: null,
      createdByMemberId: null,
      agent: 'CODEX',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ agent: 'CODEX' }),
      })
    )
  })

  it('omits agent when not provided (DB default applies)', async () => {
    mockCreate.mockResolvedValue({ id: 'm2' })
    await memoryRepository.create({
      workspaceId: 'w1',
      projectId: 'p1',
      taskId: 't1',
      scope: 'TASK',
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      sourceSessionId: null,
      createdByMemberId: null,
    })
    const callArg = mockCreate.mock.calls[0][0]
    expect(callArg.data).not.toHaveProperty('agent')
  })
})

describe('memoryRepository.listForTask agent select', () => {
  it('listForTask selects agent', async () => {
    mockFindMany.mockResolvedValue([])
    await memoryRepository.listForTask('t1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ agent: true }),
      })
    )
  })
})
