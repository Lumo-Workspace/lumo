/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { draftRepository } from '@/lib/repositories/draft.repository'

const mockFindMany = prisma.draft.findMany as jest.Mock
const mockFindUnique = prisma.draft.findUnique as jest.Mock
const mockCreate = prisma.draft.create as jest.Mock
const mockUpdate = prisma.draft.update as jest.Mock
const mockDelete = prisma.draft.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('draftRepository.findByWorkspaceAndCreator', () => {
  it('returns drafts ordered by updatedAt desc', async () => {
    const mockDrafts = [
      {
        id: 'd1',
        type: 'TASK',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]
    mockFindMany.mockResolvedValue(mockDrafts)

    const result = await draftRepository.findByWorkspaceAndCreator(
      'ws-1',
      'actor-1'
    )

    expect(result).toEqual(mockDrafts)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', creatorId: 'actor-1' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        type: true,
        data: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })
})

describe('draftRepository.findById', () => {
  it('returns draft when found', async () => {
    const draft = { id: 'd1', creatorId: 'actor-1' }
    mockFindUnique.mockResolvedValue(draft)

    const result = await draftRepository.findById('d1')

    expect(result).toEqual(draft)
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })

  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await draftRepository.findById('nonexistent')

    expect(result).toBeNull()
  })
})

describe('draftRepository.create', () => {
  it('creates a draft with select', async () => {
    const input = {
      workspaceId: 'ws-1',
      creatorId: 'actor-1',
      type: 'TASK',
      data: { title: 'Test' },
    }
    const created = {
      id: 'd1',
      type: 'TASK',
      data: { title: 'Test' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockCreate.mockResolvedValue(created)

    const result = await draftRepository.create(input)

    expect(result).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith({
      data: input,
      select: {
        id: true,
        type: true,
        data: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })
})

describe('draftRepository.update', () => {
  it('updates a draft with select', async () => {
    const updated = {
      id: 'd1',
      type: 'PROJECT',
      data: { name: 'New' },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    mockUpdate.mockResolvedValue(updated)

    const result = await draftRepository.update('d1', {
      type: 'PROJECT',
      data: { name: 'New' },
    })

    expect(result).toEqual(updated)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { type: 'PROJECT', data: { name: 'New' } },
      select: {
        id: true,
        type: true,
        data: true,
        createdAt: true,
        updatedAt: true,
      },
    })
  })
})

describe('draftRepository.delete', () => {
  it('deletes a draft by ID', async () => {
    mockDelete.mockResolvedValue({ id: 'd1' })

    await draftRepository.delete('d1')

    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })
})
