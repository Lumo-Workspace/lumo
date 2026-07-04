/**
 * LUM-677: the plan-run list + archive repository queries. Drives the real
 * repository over a mocked Prisma client to pin the query shape — the list is
 * team-scoped and newest-first (so no other team's runs leak), and the archive
 * is a single-run lookup carrying the workspace guard field.
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    planRun: { findMany: jest.fn(), findUnique: jest.fn() },
    planRunStageRecord: { findFirst: jest.fn() },
  },
}))

import { planRunRepository } from '@/lib/repositories/plan-run.repository'
import { prisma } from '@/lib/db/prisma'

const findMany = prisma.planRun.findMany as jest.Mock
const findUnique = prisma.planRun.findUnique as jest.Mock
const findFirstStageRecord = prisma.planRunStageRecord.findFirst as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('planRunRepository.listByTeam', () => {
  it('queries only the given team, newest first', async () => {
    findMany.mockResolvedValue([])

    await planRunRepository.listByTeam('team-1')

    expect(findMany).toHaveBeenCalledTimes(1)
    const arg = findMany.mock.calls[0][0]
    expect(arg.where).toEqual({ teamId: 'team-1' })
    expect(arg.orderBy).toEqual({ createdAt: 'desc' })
    // Includes the materialized initiative(s) for lineage.
    expect(arg.select.initiatives).toBeDefined()
  })

  it('returns whatever Prisma returns (active + terminal, unfiltered by stage)', async () => {
    const rows = [
      { id: 'a', stage: 'CLUSTERS_READY', initiatives: [] },
      { id: 'b', stage: 'MATERIALIZED', initiatives: [] },
      { id: 'c', stage: 'FAILED', initiatives: [] },
    ]
    findMany.mockResolvedValue(rows)

    expect(await planRunRepository.listByTeam('team-1')).toBe(rows)
    // No stage filter — the list is every run for the team.
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty('stage')
  })
})

describe('planRunRepository.findArchiveById', () => {
  it('looks up one run by id with stage records + initiatives + the workspace guard', async () => {
    findUnique.mockResolvedValue(null)

    await planRunRepository.findArchiveById('run-1')

    const arg = findUnique.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'run-1' })
    expect(arg.select.workspaceId).toBe(true)
    expect(arg.select.stageRecords).toBeDefined()
    expect(arg.select.initiatives).toBeDefined()
  })
})

describe('planRunRepository.findLatestClusterRecordByTeam', () => {
  it('finds the CLUSTER record of the team newest run, ordered by run createdAt', async () => {
    findFirstStageRecord.mockResolvedValue(null)

    await planRunRepository.findLatestClusterRecordByTeam('team-1')

    const arg = findFirstStageRecord.mock.calls[0][0]
    expect(arg.where).toEqual({
      kind: 'CLUSTER',
      planRun: { teamId: 'team-1' },
    })
    expect(arg.orderBy).toEqual({ planRun: { createdAt: 'desc' } })
    expect(arg.select).toMatchObject({
      planRunId: true,
      llmRawOutput: true,
      humanConfirmedOutput: true,
    })
  })
})
