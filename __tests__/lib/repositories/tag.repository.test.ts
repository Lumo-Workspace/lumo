/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    tag: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    taskTag: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    documentTag: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({
        tag: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn(),
        },
        taskTag: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
        documentTag: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      })
    ),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { tagRepository } from '@/lib/repositories/tag.repository'

const mockFindMany = prisma.tag.findMany as jest.Mock
const mockFindUnique = prisma.tag.findUnique as jest.Mock
const mockCreate = prisma.tag.create as jest.Mock
const mockUpdate = prisma.tag.update as jest.Mock
const mockDelete = prisma.tag.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('tagRepository.findByWorkspace', () => {
  it('returns tags sorted by name', async () => {
    const tags = [
      { id: 't1', name: 'backend', color: null, workspaceId: 'ws-1' },
      { id: 't2', name: 'frontend', color: '#ff0000', workspaceId: 'ws-1' },
    ]
    mockFindMany.mockResolvedValue(tags)

    const result = await tagRepository.findByWorkspace('ws-1')

    expect(result).toEqual(tags)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        orderBy: { name: 'asc' },
      })
    )
  })
})

describe('tagRepository.findById', () => {
  it('returns tag when found', async () => {
    const tag = { id: 't1', name: 'backend', workspaceId: 'ws-1' }
    mockFindUnique.mockResolvedValue(tag)

    const result = await tagRepository.findById('t1')
    expect(result).toEqual(tag)
  })

  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await tagRepository.findById('nonexistent')
    expect(result).toBeNull()
  })
})

describe('tagRepository.create', () => {
  it('creates a tag with name and workspace', async () => {
    const tag = { id: 't1', name: 'backend', color: null, workspaceId: 'ws-1' }
    mockCreate.mockResolvedValue(tag)

    const result = await tagRepository.create({
      name: 'backend',
      workspaceId: 'ws-1',
    })

    expect(result).toEqual(tag)
    expect(mockCreate).toHaveBeenCalledWith({
      data: { name: 'backend', color: null, workspaceId: 'ws-1' },
    })
  })
})

describe('tagRepository.update', () => {
  it('updates tag name', async () => {
    const updated = { id: 't1', name: 'be', color: null }
    mockUpdate.mockResolvedValue(updated)

    const result = await tagRepository.update('t1', { name: 'be' })
    expect(result).toEqual(updated)
  })
})

describe('tagRepository.delete', () => {
  it('deletes a tag by id', async () => {
    mockDelete.mockResolvedValue({})
    await tagRepository.delete('t1')
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 't1' } })
  })
})

describe('tagRepository.findByTask', () => {
  it('returns tags for a task via taskTag join', async () => {
    const taskTags = [
      { tag: { id: 't1', name: 'backend' } },
      { tag: { id: 't2', name: 'frontend' } },
    ]
    ;(prisma.taskTag.findMany as jest.Mock).mockResolvedValue(taskTags)

    const result = await tagRepository.findByTask('task-1')

    expect(result).toEqual([
      { id: 't1', name: 'backend' },
      { id: 't2', name: 'frontend' },
    ])
  })
})

describe('tagRepository.findByDocument', () => {
  it('returns tags for a document via documentTag join', async () => {
    const docTags = [{ tag: { id: 't1', name: 'design' } }]
    ;(prisma.documentTag.findMany as jest.Mock).mockResolvedValue(docTags)

    const result = await tagRepository.findByDocument('doc-1')

    expect(result).toEqual([{ id: 't1', name: 'design' }])
  })
})
