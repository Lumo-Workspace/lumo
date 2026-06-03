import { sprintService } from '@/lib/services/sprint.service'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockFindActiveByTeam = jest.fn()
const mockListByTeam = jest.fn()
const mockFindById = jest.fn()
const mockStartAtomically = jest.fn()
const mockCloseAtomically = jest.fn()
const mockListUnfinishedIds = jest.fn()
const mockDispatch = jest.fn().mockResolvedValue(undefined)

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findActiveByTeam: (...a: any[]) => mockFindActiveByTeam(...a),
    listByTeam: (...a: any[]) => mockListByTeam(...a),
    findById: (...a: any[]) => mockFindById(...a),
    startAtomically: (...a: any[]) => mockStartAtomically(...a),
    closeAtomically: (...a: any[]) => mockCloseAtomically(...a),
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    listUnfinishedIdsBySprint: (...a: any[]) => mockListUnfinishedIds(...a),
  },
}))

jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: {},
}))

jest.mock('@/lib/services/sprint-summary.service', () => ({
  sprintSummaryService: { generate: jest.fn().mockResolvedValue(undefined) },
}))

jest.mock('@/lib/services/sprint-notifications.service', () => ({
  dispatchSprintNotification: (...a: any[]) => mockDispatch(...a),
}))

beforeEach(() => jest.clearAllMocks())

// 2026-06-03 — inside Sprint 4's window (2026-06-01..2026-06-14).
const NOW = new Date('2026-06-03T00:00:00Z')

const draftInWindow = {
  id: 'sB',
  teamId: 't1',
  number: 4,
  status: 'DRAFT',
  startDate: new Date('2026-06-01T00:00:00Z'),
  endDate: new Date('2026-06-14T00:00:00Z'),
  team: { workspaceId: 'ws1' },
}

const draftEndedNeverStarted = {
  id: 'sOld',
  teamId: 't1',
  number: 2,
  status: 'DRAFT',
  startDate: new Date('2026-05-04T00:00:00Z'),
  endDate: new Date('2026-05-17T00:00:00Z'),
  team: { workspaceId: 'ws1' },
}

const activeEnded = {
  id: 'sA',
  teamId: 't1',
  number: 3,
  status: 'ACTIVE',
  startDate: new Date('2026-05-18T00:00:00Z'),
  endDate: new Date('2026-05-31T00:00:00Z'),
  team: { workspaceId: 'ws1' },
}

const activeStillRunning = {
  ...activeEnded,
  endDate: new Date('2026-06-14T00:00:00Z'),
}

describe('sprintService.reconcileSprintStates', () => {
  it('activates the DRAFT whose window contains now when no sprint is active', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(null)
    mockListByTeam.mockResolvedValueOnce([draftInWindow])
    mockFindById.mockResolvedValueOnce(draftInWindow)
    mockStartAtomically.mockResolvedValueOnce({ id: 'sB', status: 'ACTIVE' })

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockStartAtomically).toHaveBeenCalledWith('sB')
    expect(mockCloseAtomically).not.toHaveBeenCalled()
  })

  it('attributes the auto-start to the system (null trigger actor)', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(null)
    mockListByTeam.mockResolvedValueOnce([draftInWindow])
    mockFindById.mockResolvedValueOnce(draftInWindow)
    mockStartAtomically.mockResolvedValueOnce({ id: 'sB' })

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockDispatch).toHaveBeenCalledWith(
      'sB',
      't1',
      'ws1',
      'SPRINT_STARTED',
      null
    )
  })

  it('leaves a past DRAFT that was never started untouched', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(null)
    mockListByTeam.mockResolvedValueOnce([draftEndedNeverStarted])

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockStartAtomically).not.toHaveBeenCalled()
    expect(mockCloseAtomically).not.toHaveBeenCalled()
  })

  it('no-ops while the active sprint window has not ended', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(activeStillRunning)

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockCloseAtomically).not.toHaveBeenCalled()
    expect(mockStartAtomically).not.toHaveBeenCalled()
    expect(mockListByTeam).not.toHaveBeenCalled()
  })

  it('closes the ended active sprint routing all unfinished to backlog, then activates the next in-window draft', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(activeEnded)
    mockListUnfinishedIds.mockResolvedValueOnce([{ id: 'k1' }, { id: 'k2' }])
    mockFindById
      .mockResolvedValueOnce(activeEnded) // inside close()
      .mockResolvedValueOnce(draftInWindow) // inside start()
    mockCloseAtomically.mockResolvedValueOnce({ id: 'sA', status: 'CLOSED' })
    mockListByTeam.mockResolvedValueOnce([draftInWindow])
    mockStartAtomically.mockResolvedValueOnce({ id: 'sB', status: 'ACTIVE' })

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockCloseAtomically).toHaveBeenCalledWith(
      'sA',
      { k1: 'backToBacklog', k2: 'backToBacklog' },
      null
    )
    expect(mockStartAtomically).toHaveBeenCalledWith('sB')
  })

  it('closes the ended active sprint even when there is no draft to activate next', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(activeEnded)
    mockListUnfinishedIds.mockResolvedValueOnce([])
    mockFindById.mockResolvedValueOnce(activeEnded)
    mockCloseAtomically.mockResolvedValueOnce({ id: 'sA', status: 'CLOSED' })
    mockListByTeam.mockResolvedValueOnce([])

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockCloseAtomically).toHaveBeenCalledWith('sA', {}, null)
    expect(mockStartAtomically).not.toHaveBeenCalled()
  })

  it('swallows contention (4xx) from start and resolves', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(null)
    mockListByTeam.mockResolvedValueOnce([draftInWindow])
    mockFindById.mockResolvedValueOnce(draftInWindow)
    mockStartAtomically.mockRejectedValueOnce(
      Object.assign(new Error('team already has ACTIVE sprint'), { status: 409 })
    )

    await expect(
      sprintService.reconcileSprintStates('t1', NOW)
    ).resolves.toBeUndefined()
  })

  it('stops after a close race (4xx) without activating', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(activeEnded)
    mockListUnfinishedIds.mockResolvedValueOnce([])
    mockFindById.mockResolvedValueOnce(activeEnded)
    mockCloseAtomically.mockRejectedValueOnce(
      Object.assign(new Error('cannot close sprint in CLOSED state'), {
        status: 409,
      })
    )

    await sprintService.reconcileSprintStates('t1', NOW)

    expect(mockListByTeam).not.toHaveBeenCalled()
    expect(mockStartAtomically).not.toHaveBeenCalled()
  })

  it('re-throws unexpected (non-4xx) errors from close', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(activeEnded)
    mockListUnfinishedIds.mockResolvedValueOnce([])
    mockFindById.mockResolvedValueOnce(activeEnded)
    mockCloseAtomically.mockRejectedValueOnce(new Error('db down'))

    await expect(
      sprintService.reconcileSprintStates('t1', NOW)
    ).rejects.toThrow('db down')
  })

  it('re-throws unexpected (non-4xx) errors from start', async () => {
    mockFindActiveByTeam.mockResolvedValueOnce(null)
    mockListByTeam.mockResolvedValueOnce([draftInWindow])
    mockFindById.mockResolvedValueOnce(draftInWindow)
    mockStartAtomically.mockRejectedValueOnce(new Error('db down'))

    await expect(
      sprintService.reconcileSprintStates('t1', NOW)
    ).rejects.toThrow('db down')
  })
})
