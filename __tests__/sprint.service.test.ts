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

const mockTxTaskActivityCreate = jest.fn()

const txMock = {
  task: { findMany: (...a: any[]) => mockTxTaskFindMany(...a) },
  team: { findUnique: (...a: any[]) => mockTxTeamFindUnique(...a) },
  taskActivity: {
    createMany: (...a: any[]) => mockTxTaskActivityCreateMany(...a),
    create: (...a: any[]) => mockTxTaskActivityCreate(...a),
  },
  generationJob: { create: (...a: any[]) => mockTxGenerationJobCreate(...a) },
}

const mockTaskFindUnique = jest.fn()
const mockTeamUpdate = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: {
      findUnique: (...a: any[]) => mockTeamFindUnique(...a),
      update: (...a: any[]) => mockTeamUpdate(...a),
    },
    task: { findUnique: (...a: any[]) => mockTaskFindUnique(...a) },
    $transaction: (fn: (tx: any) => any) => fn(txMock),
  },
}))

const mockSprintRemove = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    nextNumberForTeam: (...a: any[]) => mockNextNumber(...a),
    create: (...a: any[]) => mockSprintCreate(...a),
    findById: (...a: any[]) => mockFindUnique(...a),
    lockForUpdate: (...a: any[]) => mockLockForUpdate(...a),
    findActiveByTeam: (...a: any[]) => mockFindActive(...a),
    update: (...a: any[]) => mockUpdate(...a),
    listByTeam: (...a: any[]) => mockListByTeam(...a),
    remove: (...a: any[]) => mockSprintRemove(...a),
  },
}))

const mockBulkUpdateSprint = jest.fn()

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    bulkUpdateSprint: (...a: any[]) => mockBulkUpdateSprint(...a),
  },
}))

jest.mock('@/lib/services/sprint-summary.service', () => ({
  sprintSummaryService: {
    generate: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@/lib/services/sprint-notifications.service', () => ({
  dispatchSprintNotification: jest.fn().mockResolvedValue(undefined),
}))

beforeEach(() => jest.clearAllMocks())

describe('sprintService.createDraft', () => {
  it('creates a DRAFT with next number and the dates the caller provided', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 'team-1',
      sprintsEnabled: true,
    })
    mockNextNumber.mockResolvedValueOnce(3)
    mockSprintCreate.mockResolvedValueOnce({
      id: 's1',
      number: 3,
      name: 'Sprint 3',
    })

    const startDate = new Date('2026-05-04T00:00:00Z')
    const endDate = new Date('2026-05-18T00:00:00Z')
    await sprintService.createDraft('team-1', { startDate, endDate }, {
      memberId: 'm1',
    } as any)

    expect(mockSprintCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-1',
        number: 3,
        name: 'Sprint 3',
        startDate,
        endDate,
      })
    )
  })

  it('throws 409 when team has not enabled sprints', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 'team-1',
      sprintsEnabled: false,
    })
    await expect(
      sprintService.createDraft(
        'team-1',
        {
          startDate: new Date('2026-05-04T00:00:00Z'),
          endDate: new Date('2026-05-18T00:00:00Z'),
        },
        { memberId: 'm1' } as any
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('throws 400 when caller omits startDate or endDate', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      id: 'team-1',
      sprintsEnabled: true,
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

describe('sprintService.configureCadence', () => {
  it('updates only `sprintsEnabled` when no other fields are provided', async () => {
    mockTeamUpdate.mockResolvedValueOnce({ id: 'team-1' })
    await sprintService.configureCadence('team-1', { enabled: true }, {
      memberId: 'm1',
    } as any)
    expect(mockTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { sprintsEnabled: true },
    })
  })

  it('persists all cadence fields when provided', async () => {
    mockTeamUpdate.mockResolvedValueOnce({ id: 'team-1' })
    await sprintService.configureCadence(
      'team-1',
      {
        enabled: true,
        durationDays: 14,
        cooldownDays: 7,
        startWeekday: 1,
        autoCreate: 2,
      },
      { memberId: 'm1' } as any
    )
    expect(mockTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: {
        sprintsEnabled: true,
        sprintDurationDays: 14,
        sprintCooldownDays: 7,
        sprintStartWeekday: 1,
        sprintAutoCreate: 2,
      },
    })
  })
})

describe('sprintService.ensureFutureSprints', () => {
  const cadenceTeam = {
    id: 'team-1',
    sprintsEnabled: true,
    sprintDurationDays: 14,
    sprintCooldownDays: 0,
    sprintStartWeekday: 1,
    sprintAutoCreate: 2,
  }

  it('is a no-op when sprints are disabled', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      ...cadenceTeam,
      sprintsEnabled: false,
    })
    await sprintService.ensureFutureSprints('team-1')
    expect(mockSprintCreate).not.toHaveBeenCalled()
  })

  it('is a no-op when autoCreate is 0', async () => {
    mockTeamFindUnique.mockResolvedValueOnce({
      ...cadenceTeam,
      sprintAutoCreate: 0,
    })
    await sprintService.ensureFutureSprints('team-1')
    expect(mockSprintCreate).not.toHaveBeenCalled()
  })

  it('creates `autoCreate` sprints when the team has none, all starting on Monday', async () => {
    mockTeamFindUnique.mockResolvedValueOnce(cadenceTeam)
    mockListByTeam.mockResolvedValueOnce([])
    // autoCreate=2 ⇒ two calls to nextNumberForTeam + create.
    mockNextNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    mockSprintCreate.mockResolvedValue({ id: 'sx' })

    await sprintService.ensureFutureSprints(
      'team-1',
      new Date('2026-04-20T00:00:00Z') // Monday
    )
    expect(mockSprintCreate).toHaveBeenCalledTimes(2)
    expect(mockSprintCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        number: 1,
        // 14-day inclusive: Mon Apr 20 → Sun May 3.
        startDate: new Date('2026-04-20T00:00:00Z'),
        endDate: new Date('2026-05-03T00:00:00Z'),
      })
    )
    expect(mockSprintCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        number: 2,
        // Next Mon May 4 → Sun May 17.
        startDate: new Date('2026-05-04T00:00:00Z'),
        endDate: new Date('2026-05-17T00:00:00Z'),
      })
    )
  })

  it('does nothing when future sprints already meet the quota', async () => {
    mockTeamFindUnique.mockResolvedValueOnce(cadenceTeam)
    mockListByTeam.mockResolvedValueOnce([
      {
        id: 's1',
        number: 1,
        startDate: new Date('2026-04-20T00:00:00Z'),
        endDate: new Date('2026-05-03T00:00:00Z'),
      },
      {
        id: 's2',
        number: 2,
        startDate: new Date('2026-05-04T00:00:00Z'),
        endDate: new Date('2026-05-17T00:00:00Z'),
      },
    ])
    await sprintService.ensureFutureSprints(
      'team-1',
      new Date('2026-04-19T00:00:00Z')
    )
    expect(mockSprintCreate).not.toHaveBeenCalled()
  })

  it('tops up only the shortfall, chaining from the latest sprint', async () => {
    mockTeamFindUnique.mockResolvedValueOnce(cadenceTeam)
    mockListByTeam.mockResolvedValueOnce([
      {
        id: 's1',
        number: 1,
        startDate: new Date('2026-04-20T00:00:00Z'),
        endDate: new Date('2026-05-03T00:00:00Z'),
      },
    ])
    mockNextNumber.mockResolvedValueOnce(2)
    mockSprintCreate.mockResolvedValueOnce({ id: 's2' })

    await sprintService.ensureFutureSprints(
      'team-1',
      new Date('2026-04-19T00:00:00Z')
    )
    expect(mockSprintCreate).toHaveBeenCalledTimes(1)
    expect(mockSprintCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 2,
        startDate: new Date('2026-05-04T00:00:00Z'),
        endDate: new Date('2026-05-17T00:00:00Z'),
      })
    )
  })

  it('re-bootstraps from `now` when the only sprints on record are already closed in the past', async () => {
    // Team used sprints a month ago, stopped, then re-enables with autoCreate.
    // We must NOT chain off the stale CLOSED anchor (that would create
    // already-expired future sprints).
    mockTeamFindUnique.mockResolvedValueOnce({
      ...cadenceTeam,
      sprintAutoCreate: 1,
    })
    mockListByTeam.mockResolvedValueOnce([
      {
        id: 's-old',
        number: 3,
        startDate: new Date('2026-03-02T00:00:00Z'),
        endDate: new Date('2026-03-15T00:00:00Z'),
      },
    ])
    mockNextNumber.mockResolvedValueOnce(4)
    mockSprintCreate.mockResolvedValueOnce({ id: 's4' })

    await sprintService.ensureFutureSprints(
      'team-1',
      new Date('2026-04-20T00:00:00Z') // Monday, weeks after the old sprint ended.
    )
    expect(mockSprintCreate).toHaveBeenCalledTimes(1)
    expect(mockSprintCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 4,
        startDate: new Date('2026-04-20T00:00:00Z'),
        endDate: new Date('2026-05-03T00:00:00Z'),
      })
    )
  })

  it('bails out silently on P2002 concurrent-number race', async () => {
    mockTeamFindUnique.mockResolvedValueOnce(cadenceTeam)
    mockListByTeam.mockResolvedValueOnce([])
    mockNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockRejectedValueOnce(
      Object.assign(new Error('unique violation'), { code: 'P2002' })
    )
    await expect(
      sprintService.ensureFutureSprints(
        'team-1',
        new Date('2026-04-20T00:00:00Z')
      )
    ).resolves.toBeUndefined()
  })
})

describe('sprintService.start', () => {
  it('marks DRAFT sprint as ACTIVE, sets startedAt', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'DRAFT',
      team: { workspaceId: 'ws-1' },
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
    team: { workspaceId: 'ws-1' },
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

  it('moves tasks per decisions into the existing DRAFT and sets CLOSED', async () => {
    mockFindUnique.mockResolvedValueOnce(activeSprint)
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    mockTxTaskFindMany.mockResolvedValueOnce([
      { id: 't1', status: 'TODO' },
      { id: 't2', status: 'IN_PROGRESS' },
    ])

    // an existing DRAFT receives spillover (no auto-create anymore)
    mockListByTeam.mockResolvedValueOnce([
      { id: 's-next', teamId: 'team-1', number: 4 },
    ])

    mockBulkUpdateSprint.mockResolvedValue({ count: 1 })
    mockTxTaskActivityCreateMany.mockResolvedValueOnce({ count: 2 })
    mockUpdate.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    mockTxGenerationJobCreate.mockResolvedValueOnce({ id: 'job-1' })

    const result = await sprintService.close(
      's1',
      { t1: 'moveToNext', t2: 'backToBacklog' },
      { memberId: 'm1', id: 'actor-1' }
    )

    // bulkUpdateSprint called twice: toNext and toBacklog (tx is passed as 3rd arg)
    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(
      ['t1'],
      's-next',
      expect.anything()
    )
    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(
      ['t2'],
      null,
      expect.anything()
    )

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

describe('sprintService.addTaskToSprint', () => {
  it('adds task when team matches and sprint not CLOSED', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 't1',
      teamId: 'team-1',
      sprintId: null,
    })
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'DRAFT',
    })
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'DRAFT' })
    mockBulkUpdateSprint.mockResolvedValueOnce({ count: 1 })
    mockTxTaskActivityCreate.mockResolvedValueOnce({ id: 'act-1' })

    const result = await sprintService.addTaskToSprint('t1', 's1', {
      memberId: 'm1',
      id: 'a1',
    })

    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(
      ['t1'],
      's1',
      expect.anything()
    )
    expect(mockTxTaskActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 't1',
        actorId: 'a1',
        type: 'SPRINT_CHANGED',
        payload: expect.objectContaining({
          toSprintId: 's1',
          reason: 'planning',
        }),
      }),
    })
    expect(result).toEqual({ taskId: 't1', sprintId: 's1' })
  })

  it('400 when task.teamId != sprint.teamId', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 't1',
      teamId: 'team-OTHER',
      sprintId: null,
    })
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'DRAFT',
    })

    await expect(
      sprintService.addTaskToSprint('t1', 's1', { memberId: 'm1' })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('409 when target sprint is CLOSED', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({
      id: 't1',
      teamId: 'team-1',
      sprintId: null,
    })
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'CLOSED',
    })

    await expect(
      sprintService.addTaskToSprint('t1', 's1', { memberId: 'm1' })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('sprintService.removeTaskFromSprint', () => {
  it('sets sprintId=null and writes activity', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({ id: 't1', sprintId: 's1' })
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'ACTIVE',
    })
    mockLockForUpdate.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })
    mockBulkUpdateSprint.mockResolvedValueOnce({ count: 1 })
    mockTxTaskActivityCreate.mockResolvedValueOnce({ id: 'act-1' })

    const result = await sprintService.removeTaskFromSprint('t1', {
      memberId: 'm1',
      id: 'a1',
    })

    expect(mockBulkUpdateSprint).toHaveBeenCalledWith(
      ['t1'],
      null,
      expect.anything()
    )
    expect(mockTxTaskActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: 't1',
        type: 'SPRINT_CHANGED',
        payload: expect.objectContaining({
          fromSprintId: 's1',
          toSprintId: null,
          reason: 'planning',
        }),
      }),
    })
    expect(result).toEqual({ taskId: 't1', sprintId: null })
  })

  it('no-op when task has no sprintId', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({ id: 't1', sprintId: null })

    const result = await sprintService.removeTaskFromSprint('t1', {
      memberId: 'm1',
    })

    expect(mockBulkUpdateSprint).not.toHaveBeenCalled()
    expect(result).toEqual({ taskId: 't1', sprintId: null })
  })

  it('409 when current sprint is CLOSED', async () => {
    mockTaskFindUnique.mockResolvedValueOnce({ id: 't1', sprintId: 's1' })
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      teamId: 'team-1',
      status: 'CLOSED',
    })

    await expect(
      sprintService.removeTaskFromSprint('t1', { memberId: 'm1' })
    ).rejects.toMatchObject({ status: 409 })
  })
})

describe('sprintService.configureCadence', () => {
  it('flips sprintsEnabled to true', async () => {
    mockTeamUpdate.mockResolvedValueOnce({
      id: 'team-1',
      sprintsEnabled: true,
    })

    await sprintService.configureCadence(
      'team-1',
      { enabled: true },
      { memberId: 'm1' }
    )

    expect(mockTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { sprintsEnabled: true },
    })
  })

  it('flips sprintsEnabled to false', async () => {
    mockTeamUpdate.mockResolvedValueOnce({
      id: 'team-1',
      sprintsEnabled: false,
    })

    await sprintService.configureCadence(
      'team-1',
      { enabled: false },
      { memberId: 'm1' }
    )

    expect(mockTeamUpdate).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      data: { sprintsEnabled: false },
    })
  })
})

describe('sprintService.remove', () => {
  it('removes a sprint regardless of stored status', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 's1',
      status: 'ACTIVE',
      teamId: 'team-1',
    })
    mockSprintRemove.mockResolvedValueOnce({ id: 's1' })

    await sprintService.remove('s1', { memberId: 'm1' })

    expect(mockSprintRemove).toHaveBeenCalledWith('s1')
  })

  it('404 when the sprint is missing', async () => {
    mockFindUnique.mockResolvedValueOnce(null)

    await expect(
      sprintService.remove('s1', { memberId: 'm1' })
    ).rejects.toMatchObject({ status: 404 })
  })
})
