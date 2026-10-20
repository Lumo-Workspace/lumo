/**
 * @jest-environment node
 *
 * LUM-1278 — the batched reads behind the sprint attention read model. Each
 * is one query for the whole task set and carries the caller's workspaceId.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: jest.fn() },
    sprint: { findFirst: jest.fn() },
    pullRequest: { findMany: jest.fn() },
    boundaryCrossing: { findMany: jest.fn() },
    testCase: { findMany: jest.fn() },
    taskActivity: { findMany: jest.fn() },
    outcomeSignal: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { outcomeSignalRepository } from '@/lib/repositories/outcome-signal.repository'

const m = prisma as unknown as Record<string, Record<string, jest.Mock>>
const whereOf = (fn: jest.Mock) =>
  (fn.mock.calls[0]![0] as { where: Record<string, unknown> }).where

beforeEach(() => jest.clearAllMocks())

describe('sprintRepository.taskRowsForAttention', () => {
  it('reads the sprint’s live tasks in the workspace and builds identifiers', async () => {
    m.task!.findMany!.mockResolvedValue([
      {
        id: 't1',
        number: 4,
        title: 'A',
        status: 'TODO',
        createdAt: new Date(0),
        assigneeActorId: null,
        team: { identifier: 'LUM' },
      },
    ])
    const rows = await sprintRepository.taskRowsForAttention('s1', 'ws1')
    expect(whereOf(m.task!.findMany!)).toEqual({
      sprintId: 's1',
      workspaceId: 'ws1',
      deletedAt: null,
    })
    expect(rows).toEqual([
      {
        id: 't1',
        identifier: 'LUM-4',
        title: 'A',
        status: 'TODO',
        createdAt: new Date(0),
        assigneeActorId: null,
      },
    ])
  })
})

describe('sprintRepository.findPreviousInTeam', () => {
  it('takes the highest number below the current one in the team', async () => {
    m.sprint!.findFirst!.mockResolvedValue(null)
    await sprintRepository.findPreviousInTeam('team1', 5)
    expect(m.sprint!.findFirst!).toHaveBeenCalledWith({
      where: { teamId: 'team1', number: { lt: 5 } },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, name: true },
    })
  })
})

describe('pullRequestRepository.listForAttentionByTaskIds', () => {
  it('filters by workspaceId + task ids in one query', async () => {
    m.pullRequest!.findMany!.mockResolvedValue([
      { id: 'p1', taskId: 't1' },
      { id: 'p2', taskId: null },
    ])
    const rows = await pullRequestRepository.listForAttentionByTaskIds('ws1', [
      't1',
      't2',
    ])
    expect(m.pullRequest!.findMany!).toHaveBeenCalledTimes(1)
    expect(whereOf(m.pullRequest!.findMany!)).toEqual({
      workspaceId: 'ws1',
      taskId: { in: ['t1', 't2'] },
    })
    const select = (
      m.pullRequest!.findMany!.mock.calls[0]![0] as {
        select: Record<string, boolean>
      }
    ).select
    expect(select).toMatchObject({
      isDraft: true,
      createdAt: true,
      mergedAt: true,
      headSha: true,
      mergeCommitSha: true,
    })
    expect(rows.map(r => r.id)).toEqual(['p1'])
  })

  it('skips the query for no tasks', async () => {
    expect(
      await pullRequestRepository.listForAttentionByTaskIds('ws1', [])
    ).toEqual([])
    expect(m.pullRequest!.findMany!).not.toHaveBeenCalled()
  })
})

describe('boundaryCrossingRepository.findOpenByTaskIds', () => {
  it('reads undispositioned crossings scoped to the workspace through the task', async () => {
    m.boundaryCrossing!.findMany!.mockResolvedValue([
      { id: 'c1', taskId: 't1', detectedAt: new Date(0) },
    ])
    const rows = await boundaryCrossingRepository.findOpenByTaskIds('ws1', [
      't1',
    ])
    expect(whereOf(m.boundaryCrossing!.findMany!)).toEqual({
      taskId: { in: ['t1'] },
      task: { workspaceId: 'ws1' },
      disposition: null,
    })
    expect(rows).toHaveLength(1)
  })

  it('skips the query for no tasks', async () => {
    expect(
      await boundaryCrossingRepository.findOpenByTaskIds('ws1', [])
    ).toEqual([])
    expect(m.boundaryCrossing!.findMany!).not.toHaveBeenCalled()
  })
})

describe('testCaseRepository.listWithLatestRunByTaskIds', () => {
  it('reads non-deleted cases in the workspace with only the latest run', async () => {
    const run = { result: 'PASS', disposition: null }
    m.testCase!.findMany!.mockResolvedValue([
      { id: 'tc1', taskId: 't1', requiredEnvironment: null, runs: [run] },
      { id: 'tc2', taskId: 't1', requiredEnvironment: 'LOCAL', runs: [] },
    ])
    const rows = await testCaseRepository.listWithLatestRunByTaskIds('ws1', [
      't1',
    ])
    const args = m.testCase!.findMany!.mock.calls[0]![0] as {
      where: unknown
      select: { runs: { orderBy: unknown; take: number } }
    }
    expect(args.where).toEqual({
      taskId: { in: ['t1'] },
      deletedAt: null,
      task: { workspaceId: 'ws1' },
    })
    expect(args.select.runs.orderBy).toEqual({ createdAt: 'desc' })
    expect(args.select.runs.take).toBe(1)
    expect(rows).toEqual([
      { id: 'tc1', taskId: 't1', requiredEnvironment: null, latestRun: run },
      {
        id: 'tc2',
        taskId: 't1',
        requiredEnvironment: 'LOCAL',
        latestRun: null,
      },
    ])
  })
})

describe('activityRepository.listStatusChangesByTaskIds', () => {
  it('reads STATUS_CHANGED with actorId, workspace-scoped, oldest first', async () => {
    m.taskActivity!.findMany!.mockResolvedValue([])
    await activityRepository.listStatusChangesByTaskIds('ws1', ['t1'])
    expect(m.taskActivity!.findMany!).toHaveBeenCalledWith({
      where: {
        taskId: { in: ['t1'] },
        type: 'STATUS_CHANGED',
        task: { workspaceId: 'ws1' },
      },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, actorId: true, payload: true, createdAt: true },
    })
  })
})

describe('outcomeSignalRepository.listReworkByTaskIds', () => {
  it('reads REVERTED / REOPENED signals in the workspace', async () => {
    m.outcomeSignal!.findMany!.mockResolvedValue([])
    await outcomeSignalRepository.listReworkByTaskIds('ws1', ['t1'])
    expect(whereOf(m.outcomeSignal!.findMany!)).toEqual({
      workspaceId: 'ws1',
      taskId: { in: ['t1'] },
      kind: { in: ['REVERTED', 'REOPENED'] },
    })
  })
})
