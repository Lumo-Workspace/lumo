import { sprintRepository } from '@/lib/repositories/sprint.repository'

const mockFindFirst = jest.fn()
const mockFindUnique = jest.fn()
const mockFindMany = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockCount = jest.fn()
const mockAggregate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    sprint: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
      aggregate: (...args: any[]) => mockAggregate(...args),
    },
    task: {
      count: (...args: any[]) => mockCount(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('sprintRepository.findActiveByTeam', () => {
  it('queries by teamId and ACTIVE status, returns single row', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    const result = await sprintRepository.findActiveByTeam('team-1')
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { teamId: 'team-1', status: 'ACTIVE' },
    })
    expect(result).toEqual({ id: 's1', status: 'ACTIVE' })
  })
})

describe('sprintRepository.nextNumberForTeam', () => {
  it('returns 1 when team has no sprints', async () => {
    mockAggregate.mockResolvedValueOnce({ _max: { number: null } })
    const n = await sprintRepository.nextNumberForTeam('team-1')
    expect(n).toBe(1)
  })
  it('returns max+1 otherwise', async () => {
    mockAggregate.mockResolvedValueOnce({ _max: { number: 7 } })
    expect(await sprintRepository.nextNumberForTeam('team-1')).toBe(8)
  })
})

describe('sprintRepository.listByTeam', () => {
  it('orders by number desc, applies limit, applies cursor with skip=1', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await sprintRepository.listByTeam('team-1', {
      limit: 5,
      cursor: 's-prev',
      status: 'CLOSED',
    })
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { teamId: 'team-1', status: 'CLOSED' },
      orderBy: { number: 'desc' },
      take: 5,
      cursor: { id: 's-prev' },
      skip: 1,
    })
  })
})

describe('sprintRepository.countTasks', () => {
  it('passes sprintId and optional status to prisma.task.count', async () => {
    mockCount.mockResolvedValueOnce(4)
    const n = await sprintRepository.countTasks('s1', { status: 'DONE' })
    expect(mockCount).toHaveBeenCalledWith({
      where: { sprintId: 's1', status: 'DONE' },
    })
    expect(n).toBe(4)
  })
})
