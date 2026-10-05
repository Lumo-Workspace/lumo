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

describe('taskRepository.findManyForMentionStatus', () => {
  it('queries tasks in the workspace matching any (team identifier, number) pair, selecting status + PR state', async () => {
    mockTaskFindMany.mockResolvedValue([
      {
        number: 1,
        status: 'DONE',
        team: { identifier: 'LUM' },
        pullRequests: [],
      },
    ])

    const rows = await taskRepository.findManyForMentionStatus('ws-1', [
      { prefix: 'LUM', number: 1 },
      { prefix: 'ENG', number: 42 },
    ])

    expect(rows).toHaveLength(1)
    expect(mockTaskFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        OR: [
          { number: 1, team: { identifier: 'LUM' } },
          { number: 42, team: { identifier: 'ENG' } },
        ],
      },
      select: {
        number: true,
        status: true,
        team: { select: { identifier: true } },
        pullRequests: { select: { state: true } },
      },
    })
  })
})
