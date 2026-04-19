import { sprintService } from '@/lib/services/sprint.service'
import { nextUtcMondayMidnight, addDays } from '@/lib/services/sprint.service'

const mockTeamFindUnique = jest.fn()
const mockSprintCreate = jest.fn()
const mockNextNumber = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: { findUnique: (...a: any[]) => mockTeamFindUnique(...a) },
  },
}))

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    nextNumberForTeam: (...a: any[]) => mockNextNumber(...a),
    create: (...a: any[]) => mockSprintCreate(...a),
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('sprintService.createDraft', () => {
  it('creates a DRAFT with next number, default name, and cadence-derived dates when team has cadence', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 'team-1',
      sprintCadenceDays: 14,
    })
    mockNextNumber.mockResolvedValueOnce(3)
    mockSprintCreate.mockResolvedValueOnce({
      id: 's1',
      number: 3,
      name: 'Sprint 3',
    })

    const startDate = new Date('2026-05-04T00:00:00Z')
    await sprintService.createDraft('team-1', { startDate }, {
      memberId: 'm1',
    } as any)

    expect(mockSprintCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        number: 3,
        name: 'Sprint 3',
        startDate,
        endDate: new Date('2026-05-18T00:00:00Z'),
      })
    )
  })

  it('throws 400 when team has no cadence and caller did not pass dates', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 'team-1',
      sprintCadenceDays: null,
    })
    await expect(
      sprintService.createDraft('team-1', {}, { memberId: 'm1' } as any)
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('nextUtcMondayMidnight', () => {
  it('returns next Monday 00:00 UTC, not today when today is Monday', () => {
    const thisMon = new Date('2026-04-13T12:34:56Z') // Monday
    const nextMon = nextUtcMondayMidnight(thisMon)
    expect(nextMon.toISOString()).toBe('2026-04-20T00:00:00.000Z')
  })
  it('handles a Sunday', () => {
    const sun = new Date('2026-04-19T09:00:00Z')
    expect(nextUtcMondayMidnight(sun).toISOString()).toBe(
      '2026-04-20T00:00:00.000Z'
    )
  })
})

describe('addDays', () => {
  it('adds N UTC days', () => {
    expect(addDays(new Date('2026-04-20T00:00:00Z'), 14).toISOString()).toBe(
      '2026-05-04T00:00:00.000Z'
    )
  })
})
