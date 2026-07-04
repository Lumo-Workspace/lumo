/**
 * LUM-662: the team-level Priority is append-only. `declarePriority` inserts a
 * new row and never overwrites; the "current" priority is whichever row has
 * the greatest `effectiveFrom`, and the full history is preserved.
 *
 * The repository is mocked with a faithful in-memory append-only store (no
 * update/delete path — mirroring the real repository, which deliberately
 * exposes neither) so the test exercises the service's real composition of
 * append + findCurrent + listHistory.
 */
/** @jest-environment node */
jest.mock('@/lib/repositories/priority.repository', () => {
  const rows: {
    id: string
    teamId: string
    workspaceId: string
    statement: string
    effectiveFrom: Date
    declaredByMemberId: string
    createdAt: Date
  }[] = []
  const byEffectiveDesc = (
    a: { effectiveFrom: Date; createdAt: Date },
    b: { effectiveFrom: Date; createdAt: Date }
  ) =>
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  return {
    priorityRepository: {
      rows, // exposed so the test can reset between cases
      append: jest.fn(
        async (data: {
          teamId: string
          workspaceId: string
          statement: string
          effectiveFrom: Date
          declaredByMemberId: string
        }) => {
          const row = {
            id: `p${rows.length + 1}`,
            createdAt: new Date(2026, 0, 1, 0, 0, rows.length),
            ...data,
          }
          rows.push(row)
          return row
        }
      ),
      findCurrent: jest.fn(async (teamId: string) => {
        const scoped = rows.filter(r => r.teamId === teamId)
        return scoped.length ? scoped.slice().sort(byEffectiveDesc)[0] : null
      }),
      listHistory: jest.fn(async (teamId: string) =>
        rows
          .filter(r => r.teamId === teamId)
          .slice()
          .sort(byEffectiveDesc)
      ),
    },
  }
})

import { priorityService } from '@/lib/services/priority.service'
import { priorityRepository } from '@/lib/repositories/priority.repository'

const repo = priorityRepository as unknown as { rows: unknown[] }

beforeEach(() => {
  repo.rows.length = 0
  jest.clearAllMocks()
})

it('priority is append-only and current is the latest', async () => {
  const t1 = new Date('2026-01-01T00:00:00.000Z')
  const t2 = new Date('2026-02-01T00:00:00.000Z')

  const first = await priorityService.declarePriority('team1', 'w1', 'm1', {
    statement: 'Ship the idea capture MVP',
    effectiveFrom: t1,
  })
  const second = await priorityService.declarePriority('team1', 'w1', 'm2', {
    statement: 'Now focus on the converter state machine',
    effectiveFrom: t2,
  })

  // Two independent rows — the append never overwrote the first.
  expect(repo.rows).toHaveLength(2)
  expect(first.id).not.toBe(second.id)

  // Current = the row with the greatest effectiveFrom (the second).
  const current = await priorityService.getCurrent('team1')
  expect(current?.id).toBe(second.id)
  expect(current?.statement).toBe('Now focus on the converter state machine')

  // History holds both rows, newest first, and the first row is unchanged.
  const history = await priorityService.listHistory('team1')
  expect(history.map(h => h.id)).toEqual([second.id, first.id])
  expect(history[1]?.statement).toBe('Ship the idea capture MVP')
  expect(history[1]?.effectiveFrom).toEqual(t1)

  // Append-only by construction: the repository exposes no mutation path.
  expect(
    (priorityRepository as unknown as Record<string, unknown>).update
  ).toBeUndefined()
  expect(
    (priorityRepository as unknown as Record<string, unknown>).delete
  ).toBeUndefined()
})

it('scopes current/history to the team', async () => {
  await priorityService.declarePriority('teamA', 'w1', 'm1', {
    statement: 'A priority',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  })
  await priorityService.declarePriority('teamB', 'w1', 'm1', {
    statement: 'B priority',
    effectiveFrom: new Date('2026-01-02T00:00:00.000Z'),
  })

  const a = await priorityService.getCurrent('teamA')
  const b = await priorityService.getCurrent('teamB')
  expect(a?.statement).toBe('A priority')
  expect(b?.statement).toBe('B priority')
  expect(await priorityService.listHistory('teamA')).toHaveLength(1)
})

it('rejects a blank statement with status 400', async () => {
  await expect(
    priorityService.declarePriority('team1', 'w1', 'm1', { statement: '   ' })
  ).rejects.toMatchObject({ status: 400 })
})

it('defaults effectiveFrom to now when not supplied', async () => {
  const before = Date.now()
  const row = await priorityService.declarePriority('team1', 'w1', 'm1', {
    statement: 'no explicit time',
  })
  expect(row.effectiveFrom.getTime()).toBeGreaterThanOrEqual(before)
})
