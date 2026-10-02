/**
 * @jest-environment node
 *
 * LUM-932 P3 Task 3: the provisional task of an event of an UNATTACHED
 * session, decided at record time. The repository is mocked.
 */
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    findOpenSegmentTask: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
  },
}))

import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { provisionalTaskFor } from '@/lib/services/attribution.service'
import type { AttributionSignal } from '@/lib/attribution/signals'

const repo = attributionRepository as unknown as Record<
  'findOpenSegmentTask' | 'resolveIdentifiers' | 'taskIdsForBranches',
  jest.Mock
>

const ROOT = 'root-uuid'
const CHILD = `${ROOT}:a1`

beforeEach(() => {
  jest.clearAllMocks()
  repo.findOpenSegmentTask.mockResolvedValue(null)
  repo.resolveIdentifiers.mockResolvedValue(new Map())
  repo.taskIdsForBranches.mockResolvedValue(new Map())
})

const run = (signals: AttributionSignal[], parentSessionId: string | null) =>
  provisionalTaskFor({
    workspaceId: 'ws_1',
    sessionId: parentSessionId ? CHILD : ROOT,
    parentSessionId,
    signals,
  })

describe('provisionalTaskFor', () => {
  it('uses the open segment, asking for the child before its parent', async () => {
    repo.findOpenSegmentTask.mockResolvedValue('task_open')
    await expect(
      run([{ kind: 'LUMO_CMD', identifier: 'LUM-9' }], ROOT)
    ).resolves.toBe('task_open')
    expect(repo.findOpenSegmentTask).toHaveBeenCalledWith('ws_1', [CHILD, ROOT])
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(repo.taskIdsForBranches).not.toHaveBeenCalled()
  })

  it('asks only for the session itself when it has no parent', async () => {
    await run([], null)
    expect(repo.findOpenSegmentTask).toHaveBeenCalledWith('ws_1', [ROOT])
  })

  it('without an open segment, takes the first strong signal that resolves, in BRANCH > LUMO_CMD > COMMIT > PR_CREATE order', async () => {
    repo.resolveIdentifiers.mockResolvedValue(
      new Map([
        ['LUM-3', 'task_commit'],
        ['LUM-4', 'task_pr'],
        ['LUM-2', 'task_cmd'],
      ])
    )
    await expect(
      run(
        [
          { kind: 'PR_CREATE', identifier: 'LUM-4' },
          { kind: 'COMMIT', identifier: 'LUM-3' },
          { kind: 'LUMO_CMD', identifier: 'lum-002' },
          { kind: 'BRANCH', identifier: 'LUM-1', branch: 'lumo/LUM-1-x' },
        ],
        null
      )
    ).resolves.toBe('task_cmd')
    expect(repo.resolveIdentifiers).toHaveBeenCalledTimes(1)
    expect(repo.resolveIdentifiers.mock.calls[0]![1].sort()).toEqual([
      'LUM-1',
      'LUM-2',
      'LUM-3',
      'LUM-4',
    ])
  })

  it('resolves a branch without an identifier through its linked PR', async () => {
    repo.taskIdsForBranches.mockResolvedValue(
      new Map([['feature/login', 'task_pr_branch']])
    )
    repo.resolveIdentifiers.mockResolvedValue(new Map([['LUM-2', 'task_cmd']]))
    await expect(
      run(
        [
          { kind: 'LUMO_CMD', identifier: 'LUM-2' },
          { kind: 'BRANCH', branch: 'feature/login' },
        ],
        null
      )
    ).resolves.toBe('task_pr_branch')
    expect(repo.taskIdsForBranches).toHaveBeenCalledWith('ws_1', [
      'feature/login',
    ])
  })

  it('never uses PROMPT / GIT_HINT / AGENT_PROMPT and skips resolution queries without strong signals', async () => {
    repo.resolveIdentifiers.mockResolvedValue(new Map([['LUM-5', 'task_5']]))
    await expect(
      run(
        [
          { kind: 'PROMPT', identifier: 'LUM-5' },
          { kind: 'GIT_HINT', identifier: 'LUM-5' },
          { kind: 'AGENT_PROMPT', identifier: 'LUM-5', agentId: 'a1' },
        ],
        null
      )
    ).resolves.toBeNull()
    expect(repo.resolveIdentifiers).not.toHaveBeenCalled()
    expect(repo.taskIdsForBranches).not.toHaveBeenCalled()
  })

  it('returns null when no strong signal resolves', async () => {
    await expect(
      run(
        [
          { kind: 'COMMIT', identifier: 'LUM-404' },
          { kind: 'BRANCH', branch: 'feature/x' },
        ],
        null
      )
    ).resolves.toBeNull()
  })
})
