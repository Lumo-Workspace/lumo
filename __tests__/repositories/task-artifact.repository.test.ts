/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskArtifact: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
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
})
