import { sprintService } from '@/lib/services/sprint.service'
import { nextUtcMondayMidnight, addDays } from '@/lib/services/sprint.service'

const mockTeamFindUnique = jest.fn()
const mockSprintCreate = jest.fn()
const mockNextNumber = jest.fn()
const mockFindUnique = jest.fn()
const mockLockForUpdate = jest.fn()
const mockFindActive = jest.fn()
const mockUpdate = jest.fn()
const mockListByTeam = jest.fn()

// tx-level mocks for close()
const mockTxTaskFindMany = jest.fn()
const mockTxTeamFindUnique = jest.fn()
const mockTxTaskActivityCreateMany = jest.fn()
const mockTxGenerationJobCreate = jest.fn()

const txMock = {
  task: { findMany: (...a: any[]) => mockTxTaskFindMany(...a) },
  team: { findUnique: (...a: any[]) => mockTxTeamFindUnique(...a) },
  taskActivity: {
    createMany: (...a: any[]) => mockTxTaskActivityCreateMany(...a),
  },
  generationJob: { create: (...a: any[]) => mockTxGenerationJobCreate(...a) },
}

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: { findUnique: (...a: any[]) => mockTeamFindUnique(...a) },
    $transaction: (fn: (tx: any) => any) => fn(txMock),
  },
}))

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    nextNumberForTeam: (...a: any[]) => mockNextNumber(...a),
    create: (...a: any[]) => mockSprintCreate(...a),
    findById: (...a: any[]) => mockFindUnique(...a),
    lockForUpdate: (...a: any[]) => mockLockForUpdate(...a),
    findActiveByTeam: (...a: any[]) => mockFindActive(...a),
    update: (...a: any[]) => mockUpdate(...a),
    listByTeam: (...a: any[]) => mockListByTeam(...a),
  },
}))

const mockBulkUpdateSprint = jest.fn()

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    bulkUpdateSprint: (...a: any[]) => mockBulkUpdateSprint(...a),
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

describe('sprintService.start', () => {
  it('marks DRAFT sprint as ACTIVE, sets startedAt', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'DRAFT',
    })
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' })
    mockFindActive.mockResolvedValueOnce(null)
    mockUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })

    const result = await sprintService.start('s1', { memberId: 'm1' } as any)
    expect(mockUpdate).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'ACTIVE',
        startedAt: expect.any(Date),
      })
    )
    expect(result.status).toBe('ACTIVE')
  })

  it('409 when team already has ACTIVE', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'DRAFT',
    })
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' })
    mockFindActive.mockResolvedValueOnce({ id: 's-other' })
    await expect(
      sprintService.start('s1', { memberId: 'm1' } as any)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('409 when sprint is not DRAFT', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'CLOSED',
    })
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    await expect(
      sprintService.start('s1', { memberId: 'm1' } as any)
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('sprintService.close', () => {
  const activeSprint = {
    id: 's1',
    teamId: 'team-1',
    status: 'ACTIVE',
    endDate: new Date('2026-04-30T00:00:00Z'),
  }

  it('400 when decisions omit an unfinished task', async () => {
    mockFindUnique.mockResolvedValueOnce(activeSprint)
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    mockTxTaskFindMany.mockResolvedValueOnce([
      { id: 't1', status: 'TODO' },
      { id: 't2', status: 'IN_PROGRESS' },
    ])

    await expect(
      sprintService.close('s1', { t1: 'moveToNext' }, { memberId: 'm1' })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('409 when decisions contain a taskId not in unfinished set (stale)', async () => {
    mockFindUnique.mockResolvedValueOnce(activeSprint)
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    mockTxTaskFindMany.mockResolvedValueOnce([{ id: 't1', status: 'TODO' }])

    // t99 is in decisions but not in unfinished
    await expect(
      sprintService.close(
        's1',
        { t1: 'moveToNext', t99: 'backToBacklog' },
        { memberId: 'm1' }
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('moves tasks per decisions, creates next DRAFT when needed, sets CLOSED', async () => {
    mockFindUnique.mockResolvedValueOnce(activeSprint)
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    mockTxTaskFindMany.mockResolvedValueOnce([
      { id: 't1', status: 'TODO' },
      { id: 't2', status: 'IN_PROGRESS' },
    ])

    // no existing DRAFT sprint
    mockListByTeam.mockResolvedValueOnce([])
    // next sprint number
    mockNextNumber.mockResolvedValueOnce(4)
    // team cadence from tx
    mockTxTeamFindUnique.mockResolvedValueOnce({ sprintCadenceDays: 14 })
    // created next sprint
    mockSprintCreate.mockResolvedValueOnce({
      id: 's-next',
      teamId: 'team-1',
      number: 4,
    })

    mockBulkUpdateSprint.mockResolvedValue({ count: 1 })
    mockTxTaskActivityCreateMany.mockResolvedValueOnce({ count: 2 })
    mockUpdate.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    mockTxGenerationJobCreate.mockResolvedValueOnce({ id: 'job-1' })

    const result = await sprintService.close(
      's1',
      { t1: 'moveToNext', t2: 'backToBacklog' },
      { memberId: 'm1', id: 'actor-1' }
    )

    // bulkUpdateSprint called twice: toNext and toBacklog
    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(['t1'], 's-next')
    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(['t2'], null)

    // taskActivity.createMany called with 2 SPRINT_CHANGED entries
    expect(mockTxTaskActivityCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            taskId: 't1',
            type: 'SPRINT_CHANGED',
            payload: expect.objectContaining({
              toSprintId: 's-next',
              reason: 'spillover',
            }),
          }),
          expect.objectContaining({
            taskId: 't2',
            type: 'SPRINT_CHANGED',
            payload: expect.objectContaining({
              toSprintId: null,
              reason: 'spillover',
            }),
          }),
        ]),
      })
    )

    // sprint updated to CLOSED with closedAt
    expect(mockUpdate).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ status: 'CLOSED', closedAt: expect.any(Date) })
    )

    // generationJob enqueued
    expect(mockTxGenerationJobCreate).toHaveBeenCalledWith({
      data: { type: 'sprint', targetId: 's1', status: 'pending' },
    })

    expect(result).toMatchObject({ id: 's1', status: 'CLOSED' })
  })
})
