/**
 * @jest-environment node
 *
 * Tests for `decideSprintAction` (pure) and `taskUpdate --sprint` integration
 * (mock fetch).
 */
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => process.env.CLAUDE_CODE_SESSION_ID,
  AmbiguousSessionError: class extends Error {},
}))

import { decideSprintAction } from '@/cli/src/commands/task-update'

// ---------------------------------------------------------------------------
// Pure: decideSprintAction
// ---------------------------------------------------------------------------
describe('decideSprintAction', () => {
  it('noop-clear: flag is "" and currentSprintId is null', () => {
    const action = decideSprintAction({ currentSprintId: null, flag: '' })
    expect(action).toEqual({ type: 'noop-clear' })
  })

  it('unbind: flag is "" and currentSprintId is set', () => {
    const action = decideSprintAction({
      currentSprintId: 'sprint-old',
      flag: '',
    })
    expect(action).toEqual({ type: 'unbind', oldSprintId: 'sprint-old' })
  })

  it('noop-same: flag equals currentSprintId (already bound to same sprint)', () => {
    const action = decideSprintAction({
      currentSprintId: 'sprint-abc',
      flag: 'sprint-abc',
    })
    expect(action).toEqual({ type: 'noop-same', sprintId: 'sprint-abc' })
  })

  it('bind: flag is non-empty and currentSprintId is null', () => {
    const action = decideSprintAction({
      currentSprintId: null,
      flag: 'sprint-new',
    })
    expect(action).toEqual({ type: 'bind', newSprintId: 'sprint-new' })
  })

  it('rebind: flag is non-empty and currentSprintId is a different sprint', () => {
    const action = decideSprintAction({
      currentSprintId: 'sprint-old',
      flag: 'sprint-new',
    })
    expect(action).toEqual({
      type: 'rebind',
      oldSprintId: 'sprint-old',
      newSprintId: 'sprint-new',
    })
  })
})

// ---------------------------------------------------------------------------
// Integration: taskUpdate with --sprint flag (mock fetch)
// ---------------------------------------------------------------------------
// LUM-825: DONE also cleans up the task's local git worktrees; these suites
// test the API flow, so never let it touch the real checkout's worktrees.
jest.mock('@/cli/src/lib/worktree-cleanup', () => ({
  ...jest.requireActual('@/cli/src/lib/worktree-cleanup'),
  planTaskWorktreeCleanup: jest.fn(() => null),
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

jest.mock('@/cli/src/lib/tag-resolver', () => ({
  resolveTagRefs: jest.fn(async () => []),
}))

// We mock resolveSprintId so we don't need real network calls in the
// resolve step. The mock returns a fully-resolved sprint object.
jest.mock('@/cli/src/lib/resolve', () => ({
  ...jest.requireActual('@/cli/src/lib/resolve'),
  resolveSprintId: jest.fn(),
}))

import { resolveSprintId } from '@/cli/src/lib/resolve'
const mockResolveSprintId = resolveSprintId as jest.Mock

import { taskUpdate } from '@/cli/src/commands/task-update'

/** Build a minimal UpdatedTaskResponse (PATCH 200) */
function patchOk() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      task: {
        id: 'task-1',
        identifier: 'LUM-1',
        title: 'My Task',
        url: 'https://api.lumo.test/task/LUM-1',
        taskTags: [],
      },
    }),
  }
}

/** Build a ShowTaskFromCliResult (GET by-identifier 200) with sprint info */
function showOk(opts: {
  sprintId: string | null
  teamId: string
  number?: number
}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      task: {
        id: 'task-1',
        identifier: 'LUM-1',
        title: 'My Task',
        url: 'https://api.lumo.test/task/LUM-1',
        status: 'TODO',
        priority: 'LOW',
        description: null,
        sprintId: opts.sprintId,
        teamId: opts.teamId,
        project: { id: 'proj-1', name: 'Lumo' },
        assignee: null,
      },
    }),
  }
}

/** Sprint tasks POST 200 */
function sprintTasksPostOk() {
  return { ok: true, status: 200, json: async () => ({}) }
}

/** Sprint tasks DELETE 200 */
function sprintTasksDeleteOk() {
  return { ok: true, status: 200, json: async () => ({}) }
}

describe('taskUpdate --sprint integration', () => {
  let consoleSpy: jest.SpyInstance
  let stdoutSpy: jest.SpyInstance

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    stdoutSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    mockResolveSprintId.mockReset()
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    stdoutSpy.mockRestore()
    jest.restoreAllMocks()
  })

  it('noop-clear: prints "has no sprint binding" and exits 0 when task has no sprint and --sprint ""', async () => {
    const fetchMock = jest.fn()
    // PATCH (title update) succeeds first, then GET by-identifier
    fetchMock
      .mockResolvedValueOnce(patchOk())
      .mockResolvedValueOnce(showOk({ sprintId: null, teamId: 'team-1' }))
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', { title: 'New', sprint: '' })
    expect(exitCode).toBeUndefined() // exit 0
    const stdoutCalls = (stdoutSpy.mock.calls as [string][])
      .map(c => c[0])
      .join('')
    expect(stdoutCalls).toContain('has no sprint binding')
  })

  it('unbind: calls DELETE on old sprint and prints "Unbound LUM-N from sprint #N"', async () => {
    const fetchMock = jest.fn()
    fetchMock
      .mockResolvedValueOnce(patchOk())
      .mockResolvedValueOnce(
        showOk({ sprintId: 'sprint-old', teamId: 'team-1' })
      )
      // GET /api/sprints/sprint-old for number lookup
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sprint: {
            id: 'sprint-old',
            number: 3,
            name: 'Sprint 3',
            teamId: 'team-1',
            status: 'ACTIVE',
            startDate: '',
            endDate: '',
          },
        }),
      })
      .mockResolvedValueOnce(sprintTasksDeleteOk())
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', { title: 'New', sprint: '' })
    expect(exitCode).toBeUndefined()
    const stdoutCalls = (stdoutSpy.mock.calls as [string][])
      .map(c => c[0])
      .join('')
    expect(stdoutCalls).toMatch(/Unbound LUM-1 from sprint #3/)
  })

  it('bind: calls POST to new sprint and prints Sprint: - → #5', async () => {
    mockResolveSprintId.mockResolvedValue({
      id: 'sprint-new',
      number: 5,
      name: 'Sprint 5',
      teamId: 'team-1',
    })
    const fetchMock = jest.fn()
    fetchMock
      .mockResolvedValueOnce(patchOk())
      .mockResolvedValueOnce(showOk({ sprintId: null, teamId: 'team-1' }))
      .mockResolvedValueOnce(sprintTasksPostOk())
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', { title: 'New', sprint: '5' })
    expect(exitCode).toBeUndefined()
    const stdoutCalls = (stdoutSpy.mock.calls as [string][])
      .map(c => c[0])
      .join('')
    expect(stdoutCalls).toMatch(/Sprint:.*-.*→.*#5/)
  })

  it('cross-team: prints error and exits 1 without calling sprint bind endpoint', async () => {
    mockResolveSprintId.mockResolvedValue({
      id: 'sprint-other-team',
      number: 7,
      name: 'Sprint 7',
      teamId: 'team-2', // different team
    })
    const fetchMock = jest.fn()
    fetchMock
      .mockResolvedValueOnce(patchOk())
      .mockResolvedValueOnce(showOk({ sprintId: null, teamId: 'team-1' }))
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', { title: 'New', sprint: '7' })
    expect(exitCode).toBe(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('different team')
    )
    // Only 2 fetch calls: PATCH + GET — no POST to sprint
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('noop-same: prints "already in sprint" and exits 0', async () => {
    mockResolveSprintId.mockResolvedValue({
      id: 'sprint-abc',
      number: 3,
      name: 'Sprint 3',
      teamId: 'team-1',
    })
    const fetchMock = jest.fn()
    fetchMock
      .mockResolvedValueOnce(patchOk())
      .mockResolvedValueOnce(
        showOk({ sprintId: 'sprint-abc', teamId: 'team-1' })
      )
    global.fetch = fetchMock as unknown as typeof fetch

    const exitCode = await taskUpdate('LUM-1', { title: 'New', sprint: '3' })
    expect(exitCode).toBeUndefined()
    const stdoutCalls = (stdoutSpy.mock.calls as [string][])
      .map(c => c[0])
      .join('')
    expect(stdoutCalls).toContain('already in sprint')
  })
})
