import {
  sprintService,
  nextUtcMondayMidnight,
  addDays,
} from '@/lib/services/sprint.service'

// ── Repository mocks ─────────────────────────────────────────────────────────

const mockFindSprintGating = jest.fn()
const mockFindSprintCadence = jest.fn()
const mockUpdateSprintCadence = jest.fn()

const mockSprintFindById = jest.fn()
const mockSprintNextNumber = jest.fn()
const mockSprintCreate = jest.fn()
const mockSprintUpdate = jest.fn()
const mockSprintListByTeam = jest.fn()
const mockSprintRemove = jest.fn()
const mockStartAtomically = jest.fn()
const mockCloseAtomically = jest.fn()
const mockAddTaskAtomically = jest.fn()
const mockRemoveTaskAtomically = jest.fn()

jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: {
    findSprintGatingConfig: (...a: any[]) => mockFindSprintGating(...a),
    findSprintCadenceConfig: (...a: any[]) => mockFindSprintCadence(...a),
    updateSprintCadence: (...a: any[]) => mockUpdateSprintCadence(...a),
  },
}))

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: any[]) => mockSprintFindById(...a),
    nextNumberForTeam: (...a: any[]) => mockSprintNextNumber(...a),
    create: (...a: any[]) => mockSprintCreate(...a),
    update: (...a: any[]) => mockSprintUpdate(...a),
    listByTeam: (...a: any[]) => mockSprintListByTeam(...a),
    remove: (...a: any[]) => mockSprintRemove(...a),
    startAtomically: (...a: any[]) => mockStartAtomically(...a),
    closeAtomically: (...a: any[]) => mockCloseAtomically(...a),
    addTaskAtomically: (...a: any[]) => mockAddTaskAtomically(...a),
    removeTaskAtomically: (...a: any[]) => mockRemoveTaskAtomically(...a),
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

const ACTOR = { id: 'actor-x', memberId: 'm1' }

// ── createDraft ─────────────────────────────────────────────────────────────

describe('sprintService.createDraft', () => {
  it('creates DRAFT with next number and caller dates', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: true,
    })
    mockSprintNextNumber.mockResolvedValueOnce(5)
    mockSprintCreate.mockResolvedValueOnce({ id: 's1' })

    const start = new Date('2026-05-01')
    const end = new Date('2026-05-15')
    await sprintService.createDraft(
      't1',
      { startDate: start, endDate: end },
      ACTOR
    )

    expect(mockSprintCreate).toHaveBeenCalledWith({
      teamId: 't1',
      number: 5,
      name: 'Sprint 5',
      startDate: start,
      endDate: end,
    })
  })

  it('respects a custom name when trimmed non-empty', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: true,
    })
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockResolvedValueOnce({})
    await sprintService.createDraft(
      't1',
      {
        name: '  Release Candidate  ',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-15'),
      },
      ACTOR
    )
    expect(mockSprintCreate.mock.calls[0]![0].name).toBe('Release Candidate')
  })

  it('throws 404 when team does not exist', async () => {
    mockFindSprintGating.mockResolvedValueOnce(null)
    await expect(
      sprintService.createDraft('tX', {}, ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 409 when team has not enabled sprints', async () => {
    mockFindSprintGating.mockResolvedValueOnce({
      id: 't1',
      sprintsEnabled: false,
    })
    await expect(
      sprintService.createDraft('t1', {}, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('throws 400 when startDate or endDate is missing', async () => {
    mockFindSprintGating.mockResolvedValue({ id: 't1', sprintsEnabled: true })
    await expect(
      sprintService.createDraft(
        't1',
        { endDate: new Date('2026-05-01') },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      sprintService.createDraft(
        't1',
        { startDate: new Date('2026-05-01') },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
  })
})

// ── start ───────────────────────────────────────────────────────────────────

describe('sprintService.start', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    team: { workspaceId: 'ws1' },
  }

  it('delegates to startAtomically and returns its result', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockResolvedValueOnce({ id: 's1', status: 'ACTIVE' })

    const result = await sprintService.start('s1', ACTOR)

    expect(mockStartAtomically).toHaveBeenCalledWith('s1')
    expect(result).toEqual({ id: 's1', status: 'ACTIVE' })
  })

  it('throws 404 when sprint not found', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.start('sX', ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockStartAtomically).not.toHaveBeenCalled()
  })

  it('fires SPRINT_STARTED notification after successful start', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockResolvedValueOnce({ id: 's1' })
    const { dispatchSprintNotification } = jest.requireMock(
      '@/lib/services/sprint-notifications.service'
    )

    await sprintService.start('s1', ACTOR)

    expect(dispatchSprintNotification).toHaveBeenCalledWith(
      's1',
      't1',
      'ws1',
      'SPRINT_STARTED',
      'actor-x'
    )
  })

  it('propagates repo-thrown 409 for already-ACTIVE team', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockRejectedValueOnce(
      Object.assign(new Error('team already has ACTIVE sprint'), {
        status: 409,
      })
    )
    await expect(sprintService.start('s1', ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('propagates repo-thrown 409 for non-DRAFT state', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockStartAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot start sprint in CLOSED state'), {
        status: 409,
      })
    )
    await expect(sprintService.start('s1', ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })
})

// ── close ───────────────────────────────────────────────────────────────────

describe('sprintService.close', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    team: { workspaceId: 'ws1' },
  }

  it('delegates to closeAtomically with actorId and returns its result', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    const decisions = { t1: 'moveToNext' as const }

    const result = await sprintService.close('s1', decisions, ACTOR)

    expect(mockCloseAtomically).toHaveBeenCalledWith('s1', decisions, 'actor-x')
    expect(result).toEqual({ id: 's1', status: 'CLOSED' })
  })

  it('throws 404 when sprint not found (before entering transaction)', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.close('sX', {}, ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockCloseAtomically).not.toHaveBeenCalled()
  })

  it('propagates 409 for non-ACTIVE state', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot close sprint in DRAFT state'), {
        status: 409,
      })
    )
    await expect(sprintService.close('s1', {}, ACTOR)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('propagates 400 for missing decision', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(new Error('decision missing for task t-unfinished'), {
        status: 400,
      })
    )
    await expect(sprintService.close('s1', {}, ACTOR)).rejects.toMatchObject({
      status: 400,
    })
  })

  it('propagates 409 for stale decision set', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(
        new Error('sprint membership changed; reopen close dialog'),
        {
          status: 409,
        }
      )
    )
    await expect(
      sprintService.close('s1', { tGone: 'moveToNext' }, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('propagates 409 when no DRAFT available for spillover', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(
        new Error('no draft sprint to receive spillover; create one first'),
        { status: 409 }
      )
    )
    await expect(
      sprintService.close('s1', { t1: 'moveToNext' }, ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('fires SPRINT_CLOSED notification after successful close', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1' })
    const { dispatchSprintNotification } = jest.requireMock(
      '@/lib/services/sprint-notifications.service'
    )

    await sprintService.close('s1', {}, ACTOR)

    expect(dispatchSprintNotification).toHaveBeenCalledWith(
      's1',
      't1',
      'ws1',
      'SPRINT_CLOSED',
      'actor-x'
    )
  })

  it('triggers summary generation fire-and-forget', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockCloseAtomically.mockResolvedValueOnce({ id: 's1' })
    const { sprintSummaryService: mocked } = jest.requireMock(
      '@/lib/services/sprint-summary.service'
    )

    await sprintService.close('s1', {}, ACTOR)

    expect(mocked.generate).toHaveBeenCalledWith('s1')
  })
})

// ── addTaskToSprint / moveTaskBetweenSprints ────────────────────────────────

describe('sprintService.addTaskToSprint', () => {
  it('delegates to addTaskAtomically with actor id', async () => {
    mockAddTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: 's1',
    })
    const result = await sprintService.addTaskToSprint('t1', 's1', ACTOR)
    expect(mockAddTaskAtomically).toHaveBeenCalledWith('t1', 's1', 'actor-x')
    expect(result).toEqual({ taskId: 't1', sprintId: 's1' })
  })

  it('propagates 404 task', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task not found'), { status: 404 })
    )
    await expect(
      sprintService.addTaskToSprint('tX', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 404 sprint', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('sprint not found'), { status: 404 })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 'sX', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 400 on team mismatch', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task and sprint belong to different teams'), {
        status: 400,
      })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 400 })
  })

  it('propagates 409 when sprint is closed', async () => {
    mockAddTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('sprint is closed'), { status: 409 })
    )
    await expect(
      sprintService.addTaskToSprint('t1', 's1', ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })

  it('moveTaskBetweenSprints is an alias that forwards to addTaskToSprint', async () => {
    mockAddTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: 's2',
    })
    await sprintService.moveTaskBetweenSprints('t1', 's2', ACTOR)
    expect(mockAddTaskAtomically).toHaveBeenCalledWith('t1', 's2', 'actor-x')
  })
})

// ── removeTaskFromSprint ────────────────────────────────────────────────────

describe('sprintService.removeTaskFromSprint', () => {
  it('delegates to removeTaskAtomically with actor id', async () => {
    mockRemoveTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: null,
    })
    const result = await sprintService.removeTaskFromSprint('t1', ACTOR)
    expect(mockRemoveTaskAtomically).toHaveBeenCalledWith('t1', 'actor-x')
    expect(result).toEqual({ taskId: 't1', sprintId: null })
  })

  it('propagates no-op when task has no sprint', async () => {
    mockRemoveTaskAtomically.mockResolvedValueOnce({
      taskId: 't1',
      sprintId: null,
    })
    await sprintService.removeTaskFromSprint('t1', ACTOR)
    expect(mockRemoveTaskAtomically).toHaveBeenCalled()
  })

  it('propagates 404 when task not found', async () => {
    mockRemoveTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('task not found'), { status: 404 })
    )
    await expect(
      sprintService.removeTaskFromSprint('tX', ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('propagates 409 when current sprint is closed', async () => {
    mockRemoveTaskAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot remove task from closed sprint'), {
        status: 409,
      })
    )
    await expect(
      sprintService.removeTaskFromSprint('t1', ACTOR)
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ── updateMeta ──────────────────────────────────────────────────────────────

describe('sprintService.updateMeta', () => {
  const SPRINT = {
    id: 's1',
    teamId: 't1',
    name: 'Sprint 1',
    startDate: new Date('2026-05-01'),
    endDate: new Date('2026-05-15'),
  }

  it('renames a sprint', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintUpdate.mockResolvedValueOnce({ ...SPRINT, name: 'Renamed' })
    await sprintService.updateMeta('s1', { name: 'Renamed' }, ACTOR)
    expect(mockSprintUpdate).toHaveBeenCalledWith('s1', { name: 'Renamed' })
  })

  it('updates dates when non-overlapping', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's2',
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-14'),
      },
    ])
    const newStart = new Date('2026-05-02')
    const newEnd = new Date('2026-05-16')
    mockSprintUpdate.mockResolvedValueOnce({})
    await sprintService.updateMeta(
      's1',
      { startDate: newStart, endDate: newEnd },
      ACTOR
    )
    expect(mockSprintUpdate).toHaveBeenCalledWith('s1', {
      startDate: newStart,
      endDate: newEnd,
    })
  })

  it('throws 404 when sprint not found', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(
      sprintService.updateMeta('sX', {}, ACTOR)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('throws 400 when endDate <= startDate', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    await expect(
      sprintService.updateMeta(
        's1',
        {
          startDate: new Date('2026-05-10'),
          endDate: new Date('2026-05-10'),
        },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('throws 409 when new dates overlap another sprint on the same team', async () => {
    mockSprintFindById.mockResolvedValueOnce(SPRINT)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's2',
        name: 'Sprint 2',
        startDate: new Date('2026-05-10'),
        endDate: new Date('2026-05-25'),
      },
    ])
    await expect(
      sprintService.updateMeta(
        's1',
        {
          startDate: new Date('2026-05-05'),
          endDate: new Date('2026-05-20'),
        },
        ACTOR
      )
    ).rejects.toMatchObject({ status: 409 })
  })
})

// ── remove ──────────────────────────────────────────────────────────────────

describe('sprintService.remove', () => {
  it('removes a sprint regardless of status', async () => {
    mockSprintFindById.mockResolvedValueOnce({ id: 's1', status: 'CLOSED' })
    mockSprintRemove.mockResolvedValueOnce(undefined)
    await sprintService.remove('s1', ACTOR)
    expect(mockSprintRemove).toHaveBeenCalledWith('s1')
  })

  it('throws 404 when sprint is missing', async () => {
    mockSprintFindById.mockResolvedValueOnce(null)
    await expect(sprintService.remove('sX', ACTOR)).rejects.toMatchObject({
      status: 404,
    })
    expect(mockSprintRemove).not.toHaveBeenCalled()
  })
})

// ── configureCadence ────────────────────────────────────────────────────────

describe('sprintService.configureCadence', () => {
  it('passes only `enabled` when other fields are undefined', async () => {
    mockUpdateSprintCadence.mockResolvedValueOnce({})
    await sprintService.configureCadence('t1', { enabled: true }, ACTOR)
    expect(mockUpdateSprintCadence).toHaveBeenCalledWith('t1', {
      enabled: true,
    })
  })

  it('passes all cadence fields when provided', async () => {
    mockUpdateSprintCadence.mockResolvedValueOnce({})
    await sprintService.configureCadence(
      't1',
      {
        enabled: false,
        durationDays: 10,
        cooldownDays: 2,
        startWeekday: 1,
        autoCreate: 3,
      },
      ACTOR
    )
    expect(mockUpdateSprintCadence).toHaveBeenCalledWith('t1', {
      enabled: false,
      durationDays: 10,
      cooldownDays: 2,
      startWeekday: 1,
      autoCreate: 3,
    })
  })
})

// ── ensureFutureSprints ─────────────────────────────────────────────────────

describe('sprintService.ensureFutureSprints', () => {
  const NOW = new Date('2026-04-23T00:00:00Z')
  const TEAM_CFG = {
    id: 't1',
    sprintsEnabled: true,
    sprintDurationDays: 14,
    sprintCooldownDays: 0,
    sprintStartWeekday: 1,
    sprintAutoCreate: 2,
  }

  it('no-op when sprints disabled', async () => {
    mockFindSprintCadence.mockResolvedValueOnce({
      ...TEAM_CFG,
      sprintsEnabled: false,
    })
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintListByTeam).not.toHaveBeenCalled()
  })

  it('no-op when autoCreate is 0', async () => {
    mockFindSprintCadence.mockResolvedValueOnce({
      ...TEAM_CFG,
      sprintAutoCreate: 0,
    })
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintListByTeam).not.toHaveBeenCalled()
  })

  it('no-op when the quota is already met', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([
      {
        id: 's1',
        number: 5,
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-15'),
      },
      {
        id: 's2',
        number: 4,
        startDate: new Date('2026-05-16'),
        endDate: new Date('2026-05-30'),
      },
    ])
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintCreate).not.toHaveBeenCalled()
  })

  it('creates the shortfall (latest future sprint seeds anchor)', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([]) // empty → bootstrap from NOW
    mockSprintNextNumber.mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    mockSprintCreate.mockResolvedValue({})
    await sprintService.ensureFutureSprints('t1', NOW)
    expect(mockSprintCreate).toHaveBeenCalledTimes(2)
  })

  it('bails out silently on P2002 race', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([])
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' })
    )
    await expect(
      sprintService.ensureFutureSprints('t1', NOW)
    ).resolves.toBeUndefined()
  })

  it('re-throws non-P2002 errors', async () => {
    mockFindSprintCadence.mockResolvedValueOnce(TEAM_CFG)
    mockSprintListByTeam.mockResolvedValueOnce([])
    mockSprintNextNumber.mockResolvedValueOnce(1)
    mockSprintCreate.mockRejectedValueOnce(new Error('random'))
    await expect(sprintService.ensureFutureSprints('t1', NOW)).rejects.toThrow(
      'random'
    )
  })
})

// ── re-exports from sprint-date ─────────────────────────────────────────────

describe('nextUtcMondayMidnight', () => {
  it('returns next Monday 00:00 UTC when today is Monday', () => {
    const mon = new Date('2026-04-20T10:00:00Z')
    const next = nextUtcMondayMidnight(mon)
    expect(next.getUTCDay()).toBe(1)
  })

  it('handles a Sunday', () => {
    const sun = new Date('2026-04-19T10:00:00Z')
    const next = nextUtcMondayMidnight(sun)
    expect(next.getUTCDay()).toBe(1)
  })
})

describe('addDays', () => {
  it('adds N UTC days', () => {
    const base = new Date('2026-04-23T00:00:00Z')
    const plus3 = addDays(base, 3)
    expect(plus3.toISOString()).toBe('2026-04-26T00:00:00.000Z')
  })
})
