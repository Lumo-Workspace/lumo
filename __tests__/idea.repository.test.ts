const mockAggregate = jest.fn()
const mockCreate = jest.fn()
const mockFindMany = jest.fn()
const mockUpdateMany = jest.fn()
const mockFindUnique = jest.fn()
const mockFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    // Run the callback with a tx exposing the idea delegate.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        idea: {
          aggregate: (...a: unknown[]) => mockAggregate(...a),
          create: (...a: unknown[]) => mockCreate(...a),
        },
      }),
    idea: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      updateMany: (...a: unknown[]) => mockUpdateMany(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
    },
  },
}))

import { ideaRepository } from '@/lib/repositories/idea.repository'

const INPUT = {
  teamId: 'team-1',
  workspaceId: 'w1',
  statement: 'ship it',
  sourceContext: null,
  sourceSessionId: null,
  sourceTaskId: null,
  proposedByMemberId: 'm1',
}

beforeEach(() => jest.clearAllMocks())

describe('ideaRepository.createCaptured', () => {
  it('assigns number = max + 1 for the team', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: 7 } })
    mockCreate.mockResolvedValue({ id: 'i1', number: 8 })

    const idea = await ideaRepository.createCaptured(INPUT)

    expect(idea.number).toBe(8)
    expect(mockAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'team-1' } })
    )
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ number: 8, teamId: 'team-1' }),
      })
    )
  })

  it('starts numbering at 1 when the team has no ideas yet', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: null } })
    mockCreate.mockResolvedValue({ id: 'i1', number: 1 })

    const idea = await ideaRepository.createCaptured(INPUT)

    expect(idea.number).toBe(1)
  })

  it('retries on a P2002 race, then succeeds with a fresh number', async () => {
    mockAggregate
      .mockResolvedValueOnce({ _max: { number: 4 } })
      .mockResolvedValueOnce({ _max: { number: 5 } })
    const p2002 = Object.assign(new Error('unique violation'), {
      code: 'P2002',
    })
    mockCreate
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({ id: 'i1', number: 6 })

    const idea = await ideaRepository.createCaptured(INPUT)

    expect(idea.number).toBe(6)
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('rethrows a non-unique error immediately', async () => {
    mockAggregate.mockResolvedValue({ _max: { number: 0 } })
    mockCreate.mockRejectedValue(new Error('connection lost'))

    await expect(ideaRepository.createCaptured(INPUT)).rejects.toThrow(
      'connection lost'
    )
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('ideaRepository.updateStatementInTeam', () => {
  it('updates within the team filter and returns the refreshed pool row', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindUnique.mockResolvedValue({ id: 'i1', statement: 'edited' })

    const row = await ideaRepository.updateStatementInTeam({
      ideaId: 'i1',
      teamId: 'team-1',
      statement: 'edited',
    })

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i1', teamId: 'team-1' },
      data: { statement: 'edited' },
    })
    expect(row).toEqual({ id: 'i1', statement: 'edited' })
  })

  it('returns null (no re-read) when the id is not in the team', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const row = await ideaRepository.updateStatementInTeam({
      ideaId: 'not-in-team',
      teamId: 'team-1',
      statement: 'edited',
    })

    expect(row).toBeNull()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})

describe('ideaRepository.listCapturedByTeam', () => {
  it('queries only CAPTURED ideas for the given team, oldest first', async () => {
    mockFindMany.mockResolvedValue([{ id: 'i1', number: 1 }])

    const rows = await ideaRepository.listCapturedByTeam('team-1')

    expect(rows).toHaveLength(1)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: 'team-1', status: 'CAPTURED' },
        orderBy: { number: 'asc' },
      })
    )
  })
})

describe('ideaRepository.findByNumber', () => {
  it('resolves by the team-scoped compound unique key', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'i8',
      number: 8,
      status: 'CAPTURED',
    })

    const row = await ideaRepository.findByNumber('team-1', 8)

    expect(row).toMatchObject({ id: 'i8', status: 'CAPTURED' })
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId_number: { teamId: 'team-1', number: 8 } },
      })
    )
  })

  it('returns null when the number is not in the team', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await ideaRepository.findByNumber('team-1', 99)).toBeNull()
  })
})

describe('ideaRepository.findByIdInTeam', () => {
  it('resolves by { id, teamId } so it can never cross teams', async () => {
    mockFindFirst.mockResolvedValue({ id: 'i8', number: 8, status: 'CAPTURED' })

    const row = await ideaRepository.findByIdInTeam('i8', 'team-1')

    expect(row).toMatchObject({ id: 'i8', status: 'CAPTURED' })
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'i8', teamId: 'team-1' } })
    )
  })

  it('returns null when the id is not in the team', async () => {
    mockFindFirst.mockResolvedValue(null)
    expect(await ideaRepository.findByIdInTeam('nope', 'team-1')).toBeNull()
  })
})

describe('ideaRepository.updateStatusInTeam', () => {
  it('writes the status within the team filter and returns the refreshed pool row', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindUnique.mockResolvedValue({ id: 'i8', status: 'DROPPED' })

    const row = await ideaRepository.updateStatusInTeam({
      ideaId: 'i8',
      teamId: 'team-1',
      status: 'DROPPED',
    })

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'i8', teamId: 'team-1' },
      data: { status: 'DROPPED' },
    })
    expect(row).toEqual({ id: 'i8', status: 'DROPPED' })
  })

  it('returns null (no re-read) when the id is not in the team', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })

    const row = await ideaRepository.updateStatusInTeam({
      ideaId: 'not-in-team',
      teamId: 'team-1',
      status: 'DROPPED',
    })

    expect(row).toBeNull()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })
})
