import { taskRepository } from '@/lib/repositories/task.repository'

const mockTaskFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: (...args: any[]) => mockTaskFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.listUnfinishedIdsBySprint', () => {
  it('selects ids of non-DONE tasks on the sprint (no transaction)', async () => {
    mockTaskFindMany.mockResolvedValueOnce([{ id: 'k1' }, { id: 'k2' }])

    const result = await taskRepository.listUnfinishedIdsBySprint('s1')

    expect(mockTaskFindMany).toHaveBeenCalledWith({
      where: { sprintId: 's1', status: { notIn: ['DONE', 'CANCELED'] } },
      select: { id: true },
    })
    expect(result).toEqual([{ id: 'k1' }, { id: 'k2' }])
  })

  it('returns an empty array when all tasks are done', async () => {
    mockTaskFindMany.mockResolvedValueOnce([])
    const result = await taskRepository.listUnfinishedIdsBySprint('s1')
    expect(result).toEqual([])
  })
})
