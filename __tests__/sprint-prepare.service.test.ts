import { sprintPrepareService } from '@/lib/services/sprint-prepare.service'

const mockTeamFindMany = jest.fn()
const mockTeamFindUnique = jest.fn()
const mockListByTeam = jest.fn()
const mockCreateDraft = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: {
      findMany: (...a: any[]) => mockTeamFindMany(...a),
      findUnique: (...a: any[]) => mockTeamFindUnique(...a),
    },
  },
}))
jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    listByTeam: (...a: any[]) => mockListByTeam(...a),
  },
}))
jest.mock('@/lib/services/sprint.service', () => {
  const actual = jest.requireActual('@/lib/services/sprint.service')
  return {
    ...actual,
    sprintService: { createDraft: (...a: any[]) => mockCreateDraft(...a) },
  }
})

beforeEach(() => jest.clearAllMocks())

describe('sprintPrepareService.prepareNextDraft', () => {
  it('no-op when team has no cadence', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 't',
      sprintCadenceDays: null,
      sprintAutoPrepare: true,
    })
    await sprintPrepareService.prepareNextDraft('t')
    expect(mockCreateDraft).not.toHaveBeenCalled()
  })

  it('no-op when autoPrepare is false', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 't',
      sprintCadenceDays: 14,
      sprintAutoPrepare: false,
    })
    await sprintPrepareService.prepareNextDraft('t')
    expect(mockCreateDraft).not.toHaveBeenCalled()
  })

  it('is idempotent — skips when a DRAFT already exists', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 't',
      sprintCadenceDays: 14,
      sprintAutoPrepare: true,
    })
    mockListByTeam.mockResolvedValueOnce([
      { id: 'draft-existing', status: 'DRAFT' },
    ])
    await sprintPrepareService.prepareNextDraft('t')
    expect(mockCreateDraft).not.toHaveBeenCalled()
  })

  it('creates DRAFT using prior sprint.endDate as start when one exists', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 't',
      sprintCadenceDays: 14,
      sprintAutoPrepare: true,
    })
    mockListByTeam
      .mockResolvedValueOnce([]) // DRAFT search
      .mockResolvedValueOnce([
        { id: 'latest', endDate: new Date('2026-04-20T00:00:00Z') },
      ]) // latest
    await sprintPrepareService.prepareNextDraft('t')
    expect(mockCreateDraft).toHaveBeenCalledWith(
      't',
      expect.objectContaining({
        startDate: new Date('2026-04-20T00:00:00Z'),
        endDate: new Date('2026-05-04T00:00:00Z'),
      }),
      expect.anything()
    )
  })

  it('creates DRAFT using next-Monday start when no prior sprint exists', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 't',
      sprintCadenceDays: 7,
      sprintAutoPrepare: true,
    })
    mockListByTeam
      .mockResolvedValueOnce([]) // DRAFT search
      .mockResolvedValueOnce([]) // latest search
    await sprintPrepareService.prepareNextDraft('t')
    expect(mockCreateDraft).toHaveBeenCalledTimes(1)
    // startDate will be a future Monday 00:00 UTC; endDate = start + 7 days
  })
})

describe('sprintPrepareService.prepareAll', () => {
  it('iterates cadence-enabled teams and returns count', async () => {
    mockTeamFindMany.mockResolvedValueOnce([
      { id: 'team-1', sprintCadenceDays: 14, sprintAutoPrepare: true },
      { id: 'team-2', sprintCadenceDays: 7, sprintAutoPrepare: true },
    ])
    // Both teams have existing DRAFT so no createDraft calls
    mockTeamFindUnique
      .mockResolvedValueOnce({
        id: 'team-1',
        sprintCadenceDays: 14,
        sprintAutoPrepare: true,
      })
      .mockResolvedValueOnce({
        id: 'team-2',
        sprintCadenceDays: 7,
        sprintAutoPrepare: true,
      })
    mockListByTeam.mockResolvedValue([{ id: 'draft-exists' }])

    const result = await sprintPrepareService.prepareAll()
    expect(mockTeamFindMany).toHaveBeenCalledWith({
      where: { sprintCadenceDays: { not: null }, sprintAutoPrepare: true },
      select: { id: true, sprintCadenceDays: true, sprintAutoPrepare: true },
    })
    expect(result).toEqual({ processed: 2, failures: [] })
  })

  it('swallows per-team errors without stopping the loop', async () => {
    mockTeamFindMany.mockResolvedValueOnce([
      { id: 'team-1', sprintCadenceDays: 14, sprintAutoPrepare: true },
      { id: 'team-2', sprintCadenceDays: 7, sprintAutoPrepare: true },
    ])
    mockTeamFindUnique
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        id: 'team-2',
        sprintCadenceDays: 7,
        sprintAutoPrepare: true,
      })
    mockListByTeam.mockResolvedValue([{ id: 'draft-exists' }])

    const result = await sprintPrepareService.prepareAll()
    expect(result.processed).toBe(2)
    expect(result.failures).toEqual([{ teamId: 'team-1', error: 'boom' }])
  })
})
