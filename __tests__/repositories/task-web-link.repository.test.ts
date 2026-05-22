/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskWebLink: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskWebLinkRepository } from '@/lib/repositories/task-web-link.repository'

const create = prisma.taskWebLink.create as jest.Mock
const findMany = prisma.taskWebLink.findMany as jest.Mock
const findUnique = prisma.taskWebLink.findUnique as jest.Mock
const update = prisma.taskWebLink.update as jest.Mock
const deleteFn = prisma.taskWebLink.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskWebLinkRepository', () => {
  it('create writes all columns', async () => {
    create.mockResolvedValue({ id: 'wl_1' })
    const input = {
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      url: 'https://example.com/',
      domain: 'example.com',
      title: 'T',
      description: 'D',
      note: null,
      imageUrl: 'https://example.com/img.png',
      faviconUrl: 'https://example.com/favicon.ico',
      fetchedAt: new Date('2026-05-22T10:00:00Z'),
      fetchError: null,
      createdById: 'mem_1',
    }
    await taskWebLinkRepository.create(input)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  it('listByTask orders by createdAt desc', async () => {
    findMany.mockResolvedValue([])
    await taskWebLinkRepository.listByTask('tsk_1')
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 'tsk_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('getById finds by id and joins task → project → workspaceId', async () => {
    findUnique.mockResolvedValue({ id: 'wl_1' })
    await taskWebLinkRepository.getById('wl_1')
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  })

  it('updateFetch on success overwrites OG fields and clears fetchError', async () => {
    update.mockResolvedValue({})
    await taskWebLinkRepository.updateFetch('wl_1', {
      ok: true,
      title: 'New T',
      description: 'New D',
      imageUrl: 'https://x/i.png',
      faviconUrl: 'https://x/f.ico',
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: {
        title: 'New T',
        description: 'New D',
        imageUrl: 'https://x/i.png',
        faviconUrl: 'https://x/f.ico',
        fetchedAt: expect.any(Date),
        fetchError: null,
      },
    })
  })

  it('updateFetch on failure writes fetchError, preserves OG fields + fetchedAt', async () => {
    update.mockResolvedValue({})
    await taskWebLinkRepository.updateFetch('wl_1', {
      ok: false,
      error: 'timeout',
    })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'wl_1' },
      data: { fetchError: 'timeout' },
    })
  })

  it('delete removes by id', async () => {
    deleteFn.mockResolvedValue({})
    await taskWebLinkRepository.delete('wl_1')
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'wl_1' } })
  })
})
