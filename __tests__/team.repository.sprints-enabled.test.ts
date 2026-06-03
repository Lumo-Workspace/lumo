import { teamRepository } from '@/lib/repositories/team.repository'

const mockTeamFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: {
      findMany: (...args: any[]) => mockTeamFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('teamRepository.listSprintsEnabledIds', () => {
  it('returns ids of teams that have sprints enabled', async () => {
    mockTeamFindMany.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }])

    const result = await teamRepository.listSprintsEnabledIds()

    expect(mockTeamFindMany).toHaveBeenCalledWith({
      where: { sprintsEnabled: true },
      select: { id: true },
    })
    expect(result).toEqual(['t1', 't2'])
  })

  it('returns an empty array when no team has sprints enabled', async () => {
    mockTeamFindMany.mockResolvedValueOnce([])
    const result = await teamRepository.listSprintsEnabledIds()
    expect(result).toEqual([])
  })
})
