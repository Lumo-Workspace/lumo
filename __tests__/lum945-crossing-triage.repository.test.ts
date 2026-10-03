/**
 * @jest-environment node
 *
 * LUM-945 — the triage data layer at the query-shape level: candidates are
 * OPEN and untriaged; the write is guarded by the same predicate and only
 * carries AUTO_LEGIT (never a human actor) when asked to auto-clear.
 */
const findMany = jest.fn()
const updateMany = jest.fn()
const groupBy = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    boundaryCrossing: {
      findMany: (...a: unknown[]) => findMany(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
  },
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const NOW = new Date('2026-10-03T12:00:00Z')

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([])
  updateMany.mockReset().mockResolvedValue({ count: 1 })
  groupBy.mockReset().mockResolvedValue([])
})

describe('LUM-945 triage repository', () => {
  it('selects OPEN untriaged rows oldest first with the task context', async () => {
    await boundaryCrossingRepository.findTriageCandidates(25)
    const arg = findMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ disposition: null, triagedAt: null })
    expect(arg.orderBy).toEqual({ detectedAt: 'asc' })
    expect(arg.take).toBe(25)
    expect(arg.select.task.select).toMatchObject({
      title: true,
      description: true,
      project: { select: { workspaceId: true } },
    })
    expect(arg.select.explanations).toBeDefined()
  })

  it('writes the score under the open-and-untriaged guard and stamps AUTO_LEGIT only on auto-clear', async () => {
    await boundaryCrossingRepository.recordTriage('c1', {
      probability: 0.8,
      model: 'typesafe-ai/jev',
      autoClear: true,
      now: NOW,
    })
    await boundaryCrossingRepository.recordTriage('c2', {
      probability: 0.3,
      model: 'typesafe-ai/jev',
      autoClear: false,
      now: NOW,
    })
    const [clear, keep] = updateMany.mock.calls.map(c => c[0])
    expect(clear.where).toEqual({
      id: 'c1',
      disposition: null,
      triagedAt: null,
    })
    expect(clear.data).toEqual({
      triageProbability: 0.8,
      triageModel: 'typesafe-ai/jev',
      triagedAt: NOW,
      disposition: 'AUTO_LEGIT',
      dispositionedAt: NOW,
    })
    expect(clear.data).not.toHaveProperty('dispositionedById')
    expect(keep.data).not.toHaveProperty('disposition')
  })

  it('marks a skipped row triaged without a score', async () => {
    await boundaryCrossingRepository.markTriageSkipped('c3', NOW)
    expect(updateMany.mock.calls[0]![0]).toEqual({
      where: { id: 'c3', triagedAt: null },
      data: { triagedAt: NOW },
    })
  })

  it('groups the rows the triage scored at or above the threshold by category and disposition', async () => {
    const since = new Date('2026-09-03T12:00:00Z')
    await boundaryCrossingRepository.triageClearCounts(since, 0.6)
    expect(groupBy.mock.calls[0]![0]).toEqual({
      by: ['category', 'disposition'],
      where: {
        triageModel: { not: null },
        triagedAt: { gte: since },
        triageProbability: { gte: 0.6 },
      },
      _count: { _all: true },
    })
  })
})
