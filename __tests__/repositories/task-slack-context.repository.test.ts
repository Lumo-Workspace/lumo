/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskSlackContext: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskSlackContextRepository } from '@/lib/repositories/task-slack-context.repository'

const create = prisma.taskSlackContext.create as jest.Mock
const findMany = prisma.taskSlackContext.findMany as jest.Mock
const findUnique = prisma.taskSlackContext.findUnique as jest.Mock
const update = prisma.taskSlackContext.update as jest.Mock
const deleteFn = prisma.taskSlackContext.delete as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskSlackContextRepository', () => {
  it('create writes all columns', async () => {
    create.mockResolvedValue({ id: 'ctx_1' })
    const input = {
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
      slackTeamId: 'T1',
      slackChannelId: 'C9',
      slackChannelName: 'design',
      rootTs: '1700000000.000100',
      threadTs: null,
      isThread: false,
      snapshot: { messages: [] },
      snapshotAt: new Date('2026-05-19T10:00:00Z'),
      createdById: 'mem_1',
    }
    await taskSlackContextRepository.create(input)
    expect(create).toHaveBeenCalledWith({ data: input })
  })

  it('listByTask orders by createdAt desc', async () => {
    findMany.mockResolvedValue([])
    await taskSlackContextRepository.listByTask('tsk_1')
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 'tsk_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('getById finds by id', async () => {
    findUnique.mockResolvedValue({ id: 'ctx_1' })
    await taskSlackContextRepository.getById('ctx_1')
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'ctx_1' } })
  })

  it('updateSnapshot writes snapshot, snapshotAt, refreshError', async () => {
    update.mockResolvedValue({})
    const snap = { messages: [] }
    await taskSlackContextRepository.updateSnapshot('ctx_1', snap, null)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ctx_1' },
      data: {
        snapshot: snap,
        snapshotAt: expect.any(Date),
        refreshError: null,
      },
    })
  })

  it('updateSnapshot writes refreshError when supplied (preserves old snapshot)', async () => {
    update.mockResolvedValue({})
    await taskSlackContextRepository.updateSnapshot(
      'ctx_1',
      null,
      'not_in_channel'
    )
    expect(update).toHaveBeenCalledWith({
      where: { id: 'ctx_1' },
      data: { refreshError: 'not_in_channel' },
    })
  })

  it('delete removes by id', async () => {
    deleteFn.mockResolvedValue({})
    await taskSlackContextRepository.delete('ctx_1')
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'ctx_1' } })
  })
})
