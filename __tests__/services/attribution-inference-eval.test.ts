/**
 * @jest-environment node
 *
 * LUM-932 P2 Task 8: read-only evaluation of inferred attribution against
 * explicit attaches. Repositories mocked; the real engine runs.
 */
jest.mock('@/lib/repositories/attribution.repository', () => ({
  ATTRIBUTION_COMPUTE_VERSION: 1,
  attributionRepository: {
    loadFamily: jest.fn(),
    resolveIdentifiers: jest.fn(),
    taskIdsForBranches: jest.fn(),
    commitFamilyAttribution: jest.fn(),
    listExplicitRootSessionsForMember: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))

import { attributionRepository } from '@/lib/repositories/attribution.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { attributionService } from '@/lib/services/attribution.service'

const repo = attributionRepository as unknown as Record<
  | 'loadFamily'
  | 'resolveIdentifiers'
  | 'taskIdsForBranches'
  | 'commitFamilyAttribution'
  | 'listExplicitRootSessionsForMember',
  jest.Mock
>
const findMember = miscRepository.findMemberIdForHook as jest.Mock
const identity = {
  user: { id: 'u1' },
  workspace: { id: 'ws' },
} as unknown as Parameters<
  typeof attributionService.inferenceEval
>[0]['identity']

const t = (s: number) => new Date(Date.UTC(2026, 9, 2, 0, 0, s))

function fam(id: string, boundTask: string, withSignal: boolean) {
  return {
    workspaceId: 'ws',
    sessions: [
      {
        id,
        parentSessionId: null,
        agentId: null,
        taskId: boundTask,
        bindingSource: 'ATTACH',
        startedAt: t(0),
      },
    ],
    events: [
      {
        id: `${id}-1`,
        sessionId: id,
        type: 'USER_PROMPT_SUBMIT',
        createdAt: t(1),
        attributionSignals: withSignal
          ? [{ kind: 'LUMO_CMD', identifier: 'LUM-12' }]
          : [],
        payload: null,
        payloadPrunedAt: null,
      },
      {
        id: `${id}-2`,
        sessionId: id,
        type: 'USER_PROMPT_SUBMIT',
        createdAt: t(2),
        attributionSignals: [],
        payload: null,
        payloadPrunedAt: null,
      },
    ],
  }
}

beforeEach(() => {
  for (const fn of Object.values(repo)) fn.mockReset()
  findMember.mockReset()
  findMember.mockResolvedValue('member_1')
  repo.resolveIdentifiers.mockResolvedValue(new Map([['LUM-12', 'task_12']]))
  repo.taskIdsForBranches.mockResolvedValue(new Map())
})

describe('attributionService.inferenceEval', () => {
  it('throws 403 when the caller is not a workspace member', async () => {
    findMember.mockResolvedValue(null)
    await expect(
      attributionService.inferenceEval({ identity, days: 30 })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.listExplicitRootSessionsForMember).not.toHaveBeenCalled()
  })

  it('scores a recognised session and a signal-less one, never writing', async () => {
    repo.listExplicitRootSessionsForMember.mockResolvedValue(['s1', 's2'])
    repo.loadFamily.mockImplementation(async (id: string) =>
      id === 's1' ? fam('s1', 'task_12', true) : fam('s2', 'task_12', false)
    )
    const res = await attributionService.inferenceEval({ identity, days: 7 })
    expect(res).toMatchObject({
      sessionsEvaluated: 2,
      turns: 4,
      correct: 2,
      unlabeled: 2,
      wrong: 0,
      sessionCorrect: 1,
      sessionUnlabeled: 1,
      sessionWrong: 0,
      computeVersion: 1,
      days: 7,
    })
    expect(repo.commitFamilyAttribution).not.toHaveBeenCalled()
    const [memberArg, sinceArg, limitArg] =
      repo.listExplicitRootSessionsForMember.mock.calls[0]!
    expect(memberArg).toBe('member_1')
    expect(limitArg).toBe(50)
    expect(Date.now() - (sinceArg as Date).getTime()).toBeGreaterThanOrEqual(
      7 * 86_400_000 - 1000
    )
  })

  it('counts a wrongly inferred task as wrong', async () => {
    repo.listExplicitRootSessionsForMember.mockResolvedValue(['s1'])
    repo.loadFamily.mockResolvedValue(fam('s1', 'task_other', true))
    const res = await attributionService.inferenceEval({ identity, days: 30 })
    expect(res).toMatchObject({ wrong: 2, sessionWrong: 1, correct: 0 })
  })

  it('skips sessions that vanished and bounds concurrency', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `s${i}`)
    repo.listExplicitRootSessionsForMember.mockResolvedValue(ids)
    let active = 0
    let peak = 0
    repo.loadFamily.mockImplementation(async (id: string) => {
      active++
      peak = Math.max(peak, active)
      await new Promise(r => setTimeout(r, 1))
      active--
      return id === 's0' ? null : fam(id, 'task_12', true)
    })
    const res = await attributionService.inferenceEval({ identity, days: 30 })
    expect(res.sessionsEvaluated).toBe(19)
    expect(peak).toBeLessThanOrEqual(5)
  })
})
