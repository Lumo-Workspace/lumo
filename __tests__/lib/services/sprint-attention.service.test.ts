/**
 * @jest-environment node
 */
const mockRepo = {
  taskRowsForAttention: jest.fn(),
  findPreviousInTeam: jest.fn(),
  listForAttentionByTaskIds: jest.fn(),
  findOpenByTaskIds: jest.fn(),
  isGateEnabledForWorkspace: jest.fn(),
  listWithLatestRunByTaskIds: jest.fn(),
  listStatusChangesByTaskIds: jest.fn(),
  listReworkByTaskIds: jest.fn(),
  loadSessionTokenRowsForTasks: jest.fn(),
  findActorByMemberId: jest.fn(),
  readDoneGatePluginRow: jest.fn(),
  actorDisplayNames: jest.fn(),
}

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    taskRowsForAttention: (...a: unknown[]) =>
      mockRepo.taskRowsForAttention(...a),
    findPreviousInTeam: (...a: unknown[]) => mockRepo.findPreviousInTeam(...a),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    listForAttentionByTaskIds: (...a: unknown[]) =>
      mockRepo.listForAttentionByTaskIds(...a),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findOpenByTaskIds: (...a: unknown[]) => mockRepo.findOpenByTaskIds(...a),
    isGateEnabledForWorkspace: (...a: unknown[]) =>
      mockRepo.isGateEnabledForWorkspace(...a),
  },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: {
    listWithLatestRunByTaskIds: (...a: unknown[]) =>
      mockRepo.listWithLatestRunByTaskIds(...a),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    listStatusChangesByTaskIds: (...a: unknown[]) =>
      mockRepo.listStatusChangesByTaskIds(...a),
  },
}))
jest.mock('@/lib/repositories/outcome-signal.repository', () => ({
  outcomeSignalRepository: {
    listReworkByTaskIds: (...a: unknown[]) =>
      mockRepo.listReworkByTaskIds(...a),
  },
}))
jest.mock('@/lib/repositories/retrospective.repository', () => ({
  retrospectiveRepository: {
    loadSessionTokenRowsForTasks: (...a: unknown[]) =>
      mockRepo.loadSessionTokenRowsForTasks(...a),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findActorByMemberId: (...a: unknown[]) =>
      mockRepo.findActorByMemberId(...a),
  },
}))
jest.mock('@/lib/plugins/done-gate', () => ({
  readDoneGatePluginRow: (...a: unknown[]) =>
    mockRepo.readDoneGatePluginRow(...a),
}))
jest.mock('@/lib/services/comment-author-names', () => ({
  actorDisplayNames: (...a: unknown[]) => mockRepo.actorDisplayNames(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { sprintAttentionService } from '@/lib/services/sprint-attention.service'

const NOW = new Date('2026-10-19T12:00:00Z')
const SPRINT = { id: 's2', number: 2, teamId: 'team1', workspaceId: 'ws1' }

function tasks(n: number, status = 'IN_PROGRESS') {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    identifier: `LUM-${i}`,
    title: `Task ${i}`,
    status,
    createdAt: new Date('2026-10-10T00:00:00Z'),
    assigneeActorId: 'actor-me',
  }))
}

/** Batched-read mocks (everything except the per-task security plane). */
const BATCHED = [
  mockRepo.taskRowsForAttention,
  mockRepo.listForAttentionByTaskIds,
  mockRepo.findOpenByTaskIds,
  mockRepo.listWithLatestRunByTaskIds,
  mockRepo.listStatusChangesByTaskIds,
  mockRepo.listReworkByTaskIds,
  mockRepo.loadSessionTokenRowsForTasks,
  mockRepo.isGateEnabledForWorkspace,
  mockRepo.actorDisplayNames,
  mockRepo.findPreviousInTeam,
  mockRepo.findActorByMemberId,
]

function arrange(taskRows: ReturnType<typeof tasks>) {
  mockRepo.taskRowsForAttention.mockResolvedValue(taskRows)
  mockRepo.findPreviousInTeam.mockResolvedValue(null)
  mockRepo.listForAttentionByTaskIds.mockResolvedValue([])
  mockRepo.findOpenByTaskIds.mockResolvedValue(
    taskRows.map(t => ({
      id: `c-${t.id}`,
      number: 1,
      taskId: t.id,
      category: 'DESTRUCTIVE_COMMAND',
      severity: 'MEDIUM',
      advisory: false,
      detectedAt: new Date('2026-10-19T09:00:00Z'),
    }))
  )
  mockRepo.isGateEnabledForWorkspace.mockResolvedValue(true)
  mockRepo.listWithLatestRunByTaskIds.mockResolvedValue([])
  mockRepo.listStatusChangesByTaskIds.mockResolvedValue([])
  mockRepo.listReworkByTaskIds.mockResolvedValue([])
  mockRepo.loadSessionTokenRowsForTasks.mockResolvedValue([])
  mockRepo.findActorByMemberId.mockResolvedValue({ id: 'actor-me' })
  mockRepo.readDoneGatePluginRow.mockResolvedValue({
    present: true,
    blocking: 0,
    checked: true,
  })
  mockRepo.actorDisplayNames.mockResolvedValue(new Map([['actor-me', 'Me']]))
}

const get = (scope: 'team' | 'mine' = 'team') =>
  sprintAttentionService.getForSprint(SPRINT, {
    viewerMemberId: 'm1',
    scope,
    now: NOW,
  })

beforeEach(() => jest.clearAllMocks())

describe('sprintAttentionService.getForSprint', () => {
  it('passes the workspaceId and the sprint task ids to every batched read', async () => {
    arrange(tasks(2))
    await get()
    expect(mockRepo.taskRowsForAttention).toHaveBeenCalledWith('s2', 'ws1')
    for (const fn of [
      mockRepo.listForAttentionByTaskIds,
      mockRepo.findOpenByTaskIds,
      mockRepo.listWithLatestRunByTaskIds,
      mockRepo.listStatusChangesByTaskIds,
      mockRepo.listReworkByTaskIds,
    ]) {
      expect(fn).toHaveBeenCalledWith('ws1', ['t0', 't1'])
    }
    expect(mockRepo.loadSessionTokenRowsForTasks).toHaveBeenCalledWith([
      't0',
      't1',
    ])
    expect(mockRepo.actorDisplayNames).toHaveBeenCalledWith('ws1', ['actor-me'])
    expect(mockRepo.findPreviousInTeam).toHaveBeenCalledWith('team1', 2)
  })

  it('query count does not grow with tasks — only the security plane is per task', async () => {
    const counts = async (n: number) => {
      jest.clearAllMocks()
      arrange(tasks(n))
      await get()
      return {
        batched: BATCHED.map(fn => fn.mock.calls.length),
        security: mockRepo.readDoneGatePluginRow.mock.calls.length,
      }
    }
    const small = await counts(1)
    const large = await counts(25)
    expect(large.batched).toEqual(small.batched)
    expect(small.batched.every(c => c <= 1)).toBe(true)
    expect(small.security).toBe(1)
    expect(large.security).toBe(25)
  })

  it('a security plane that throws reads unknown for that task only', async () => {
    arrange(tasks(2))
    mockRepo.readDoneGatePluginRow.mockImplementation(
      async (taskId: string) => {
        if (taskId === 't1') throw new Error('plugin down')
        return { present: true, blocking: 0, checked: true }
      }
    )
    const r = await get()
    expect(r.tasks.map(t => t.trust.security)).toEqual(['clear', 'unknown'])
  })

  it('scope=mine filters the queue to the viewer actor', async () => {
    arrange(tasks(1))
    mockRepo.findActorByMemberId.mockResolvedValue({ id: 'someone-else' })
    expect((await get('mine')).queue).toEqual([])
    mockRepo.findActorByMemberId.mockResolvedValue({ id: 'actor-me' })
    const mine = await get('mine')
    expect(mine.scope).toBe('mine')
    expect(mine.queue).toHaveLength(1)
    expect(mine.asOf).toBe(NOW.toISOString())
    expect(mine.queue[0]!.waitingSec).toBe(3 * 3600)
  })

  it('previous sprint missing → previousSprint null', async () => {
    arrange(tasks(1))
    const r = await get()
    expect(r.cost.previousSprint).toBeNull()
    expect(mockRepo.taskRowsForAttention).toHaveBeenCalledTimes(1)
  })

  it('previous sprint present → its cost, security read for DONE tasks only, no name lookup', async () => {
    arrange(tasks(1))
    mockRepo.findPreviousInTeam.mockResolvedValue({
      id: 's1',
      number: 1,
      name: 'Sprint 1',
    })
    mockRepo.taskRowsForAttention.mockImplementation(
      async (sprintId: string) =>
        sprintId === 's1'
          ? [...tasks(2, 'DONE'), { ...tasks(1)[0]!, id: 'p-open' }]
          : tasks(1)
    )
    mockRepo.listReworkByTaskIds.mockImplementation(
      async (_ws: string, ids: string[]) =>
        ids.includes('p-open') ? [{ taskId: 'p-open', kind: 'REVERTED' }] : []
    )
    const r = await get()
    expect(r.cost.previousSprint).toEqual({
      sprintId: 's1',
      number: 1,
      name: 'Sprint 1',
      tokensPerVerifiedTask: null,
      reworkShare: 1 / 3,
    })
    const securityTaskIds = mockRepo.readDoneGatePluginRow.mock.calls.map(
      c => c[0]
    )
    expect(securityTaskIds.sort()).toEqual(['t0', 't0', 't1'].sort())
    expect(securityTaskIds).not.toContain('p-open')
    expect(mockRepo.actorDisplayNames).toHaveBeenCalledTimes(1)
  })

  it('skips the workspace gate read when no non-advisory crossing is open', async () => {
    arrange(tasks(1))
    mockRepo.findOpenByTaskIds.mockResolvedValue([])
    await get()
    expect(mockRepo.isGateEnabledForWorkspace).not.toHaveBeenCalled()
  })
})
