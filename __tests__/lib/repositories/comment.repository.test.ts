/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    notification: {
      createMany: jest.fn(),
    },
    workspaceMember: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { commentRepository } from '@/lib/repositories/comment.repository'

const mockFindMany = prisma.comment.findMany as jest.Mock
const mockFindUnique = prisma.comment.findUnique as jest.Mock
const mockCreate = prisma.comment.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('commentRepository.findByTaskId', () => {
  it('returns top-level comments with replies', async () => {
    const mockComments = [
      { id: 'c1', body: 'Hello', replies: [{ id: 'r1', body: 'Reply' }] },
    ]
    mockFindMany.mockResolvedValue(mockComments)

    const result = await commentRepository.findByTaskId('task-1')

    expect(result).toEqual(mockComments)
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', parentId: null },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    })
  })
})

describe('commentRepository.findById', () => {
  it('returns comment when found', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'c1',
      taskId: 'task-1',
      parentId: null,
    })
    const result = await commentRepository.findById('c1')
    expect(result).toEqual({ id: 'c1', taskId: 'task-1', parentId: null })
  })
})

describe('commentRepository.create', () => {
  it('creates comment with all fields', async () => {
    const input = {
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Test comment',
      parentId: null,
      quotedCommentId: null,
    }
    mockCreate.mockResolvedValue({ id: 'c1', ...input })
    const result = await commentRepository.create(input)
    expect(result).toEqual({ id: 'c1', ...input })
    expect(mockCreate).toHaveBeenCalledWith({ data: input })
  })
})
