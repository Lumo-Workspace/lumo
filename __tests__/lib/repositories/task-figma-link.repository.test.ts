/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskFigmaLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'

const mockCreate = prisma.taskFigmaLink.create as jest.Mock
const mockFindMany = prisma.taskFigmaLink.findMany as jest.Mock
const mockFindUnique = prisma.taskFigmaLink.findUnique as jest.Mock
const mockUpdate = prisma.taskFigmaLink.update as jest.Mock
const mockDelete = prisma.taskFigmaLink.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskFigmaLinkRepository.create', () => {
  it('forwards input as create data', async () => {
    mockCreate.mockResolvedValue({ id: 'cfl_1' })
    const input = {
      taskId: 't1',
      workspaceId: 'w1',
      createdById: 'm1',
      url: 'https://www.figma.com/file/abc/F?node-id=1-2',
      fileKey: 'abc',
      nodeId: '1:2',
      fileName: 'F',
      frameName: 'Welcome',
    }
    await taskFigmaLinkRepository.create(input)
    expect(mockCreate).toHaveBeenCalledWith({ data: input })
  })
})

describe('taskFigmaLinkRepository.listByTask', () => {
  it('queries by taskId ordered by createdAt asc', async () => {
    mockFindMany.mockResolvedValue([])
    await taskFigmaLinkRepository.listByTask('t1')
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('taskFigmaLinkRepository.findByTaskAndKey', () => {
  it('uses the compound unique key', async () => {
    mockFindUnique.mockResolvedValue(null)
    await taskFigmaLinkRepository.findByTaskAndKey('t1', 'abc', '1:2')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        taskId_fileKey_nodeId: { taskId: 't1', fileKey: 'abc', nodeId: '1:2' },
      },
    })
  })

  it('uses "" sentinel for file-level lookup', async () => {
    mockFindUnique.mockResolvedValue(null)
    await taskFigmaLinkRepository.findByTaskAndKey('t1', 'abc', '')
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: {
        taskId_fileKey_nodeId: { taskId: 't1', fileKey: 'abc', nodeId: '' },
      },
    })
  })
})

describe('taskFigmaLinkRepository.update', () => {
  it('updates by id with the supplied data', async () => {
    mockUpdate.mockResolvedValue({ id: 'cfl_1' })
    await taskFigmaLinkRepository.update('cfl_1', {
      thumbnailUrl: 'https://x/y.png',
      lastSyncedAt: new Date(0),
    })
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'cfl_1' },
      data: { thumbnailUrl: 'https://x/y.png', lastSyncedAt: new Date(0) },
    })
  })
})

describe('taskFigmaLinkRepository.delete', () => {
  it('deletes by id', async () => {
    mockDelete.mockResolvedValue(undefined)
    await taskFigmaLinkRepository.delete('cfl_1')
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'cfl_1' } })
  })
})
