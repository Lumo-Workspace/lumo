/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskArtifact: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskArtifactRepository } from '@/lib/repositories/task-artifact.repository'

const mockPrisma = prisma as unknown as {
  taskArtifact: {
    create: jest.Mock
    findMany: jest.Mock
    count: jest.Mock
    findFirst: jest.Mock
    deleteMany: jest.Mock
    updateMany: jest.Mock
  }
}

describe('taskArtifactRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('create passes input straight through', async () => {
    mockPrisma.taskArtifact.create.mockResolvedValue({ id: 'a1' })
    const input = {
      taskId: 't1',
      workspaceId: 'w1',
      kind: 'spec',
      title: 'Spec',
      content: '## Requirements',
      source: 'claude-code',
      agent: 'CLAUDE_CODE' as const,
      order: 0,
      createdById: 'm1',
    }
    const out = await taskArtifactRepository.create(input)
    expect(mockPrisma.taskArtifact.create).toHaveBeenCalledWith({ data: input })
    expect(out).toEqual({ id: 'a1' })
  })

  it('listByTask orders by order asc', async () => {
    mockPrisma.taskArtifact.findMany.mockResolvedValue([])
    await taskArtifactRepository.listByTask('t1')
    expect(mockPrisma.taskArtifact.findMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      orderBy: { order: 'asc' },
    })
  })

  it('countByTask counts rows for the task', async () => {
    mockPrisma.taskArtifact.count.mockResolvedValue(2)
    const n = await taskArtifactRepository.countByTask('t1')
    expect(mockPrisma.taskArtifact.count).toHaveBeenCalledWith({
      where: { taskId: 't1' },
    })
    expect(n).toBe(2)
  })

  it('findById scopes the lookup to (id, taskId)', async () => {
    mockPrisma.taskArtifact.findFirst.mockResolvedValue({ id: 'a1' })
    const out = await taskArtifactRepository.findById('a1', 't1')
    expect(mockPrisma.taskArtifact.findFirst).toHaveBeenCalledWith({
      where: { id: 'a1', taskId: 't1' },
    })
    expect(out).toEqual({ id: 'a1' })
  })

  it('findById returns null when nothing matches', async () => {
    mockPrisma.taskArtifact.findFirst.mockResolvedValue(null)
    const out = await taskArtifactRepository.findById('a1', 't1')
    expect(out).toBeNull()
  })

  it('deleteById returns deleted count', async () => {
    mockPrisma.taskArtifact.deleteMany.mockResolvedValue({ count: 1 })
    const n = await taskArtifactRepository.deleteById('a1', 't1')
    expect(mockPrisma.taskArtifact.deleteMany).toHaveBeenCalledWith({
      where: { id: 'a1', taskId: 't1' },
    })
    expect(n).toBe(1)
  })

  it('deleteById returns 0 when no row matches', async () => {
    mockPrisma.taskArtifact.deleteMany.mockResolvedValue({ count: 0 })
    const n = await taskArtifactRepository.deleteById('a1', 't1')
    expect(n).toBe(0)
  })

  it('updateById patches scoped to (id, taskId) and returns count', async () => {
    mockPrisma.taskArtifact.updateMany.mockResolvedValue({ count: 1 })
    const n = await taskArtifactRepository.updateById('a1', 't1', {
      kind: 'plan',
      source: 'spec-kit',
    })
    expect(mockPrisma.taskArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', taskId: 't1' },
      data: { kind: 'plan', source: 'spec-kit' },
    })
    expect(n).toBe(1)
  })

  it('updateById returns 0 when no row matches', async () => {
    mockPrisma.taskArtifact.updateMany.mockResolvedValue({ count: 0 })
    const n = await taskArtifactRepository.updateById('a1', 't1', {
      title: 'x',
    })
    expect(n).toBe(0)
  })

  it('updateById includes agent in the patch when provided', async () => {
    mockPrisma.taskArtifact.updateMany.mockResolvedValue({ count: 1 })
    await taskArtifactRepository.updateById('a1', 't1', { agent: 'CODEX' })
    expect(mockPrisma.taskArtifact.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', taskId: 't1' },
      data: { agent: 'CODEX' },
    })
  })
})
