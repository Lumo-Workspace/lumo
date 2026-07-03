/** @jest-environment node */

// Stateful in-memory fake of prisma.milestoneMemoryEdge that honors the
// [sessionId, memoryId] unique constraint under skipDuplicates — so the
// idempotency test exercises real de-dup behavior, not just the passed flag.
// Everything lives INSIDE the mock factory (jest hoists jest.mock above
// module-scope consts, so an outer `const` would be in the TDZ here).
jest.mock('@/lib/db/prisma', () => {
  interface Row {
    id: string
    workspaceId: string
    memoryId: string
    sourceMilestoneId: string | null
    consumerMilestoneId: string
    sessionId: string
    used: boolean | null
    usedAt: Date | null
  }
  const store: Row[] = []
  let seq = 0

  const milestoneMemoryEdge = {
    createMany: jest.fn(
      ({
        data,
        skipDuplicates,
      }: {
        data: Record<string, unknown>[]
        skipDuplicates?: boolean
      }) => {
        let count = 0
        for (const d of data) {
          const dup = store.some(
            r => r.sessionId === d.sessionId && r.memoryId === d.memoryId
          )
          if (dup && skipDuplicates) continue
          store.push({
            id: `mme_${seq++}`,
            workspaceId: d.workspaceId as string,
            memoryId: d.memoryId as string,
            sourceMilestoneId: (d.sourceMilestoneId as string) ?? null,
            consumerMilestoneId: d.consumerMilestoneId as string,
            sessionId: d.sessionId as string,
            used: null,
            usedAt: null,
          })
          count++
        }
        return Promise.resolve({ count })
      }
    ),
    findMany: jest.fn(({ where = {}, select }: any) => {
      let rows = store
      if (where.sessionId && typeof where.sessionId === 'string') {
        rows = rows.filter(r => r.sessionId === where.sessionId)
      }
      if (where.consumerMilestoneId) {
        rows = rows.filter(
          r => r.consumerMilestoneId === where.consumerMilestoneId
        )
      }
      const projected = rows.map(r =>
        select
          ? Object.fromEntries(Object.keys(select).map(k => [k, (r as any)[k]]))
          : { ...r }
      )
      return Promise.resolve(projected)
    }),
  }

  return {
    prisma: { milestoneMemoryEdge },
    __store: () => store,
    __reset: () => {
      store.length = 0
      seq = 0
    },
  }
})

import { milestoneMemoryEdgeRepository } from '@/lib/repositories/milestone-memory-edge.repository'
// The mock module exports test-only helpers alongside `prisma`.

const prismaMock = jest.requireMock('@/lib/db/prisma') as {
  prisma: { milestoneMemoryEdge: { createMany: jest.Mock } }
  __store: () => unknown[]
  __reset: () => void
}

beforeEach(() => {
  prismaMock.__reset()
  jest.clearAllMocks()
})

describe('milestoneMemoryEdgeRepository (LUM-648)', () => {
  it('records injection edges idempotently on replay', async () => {
    const input = {
      workspaceId: 'w1',
      consumerMilestoneId: 'ms_consumer',
      sessionId: 'sess_steward',
      rows: [
        { memoryId: 'mem_a', sourceMilestoneId: 'ms_source1' },
        { memoryId: 'mem_b', sourceMilestoneId: 'ms_source2' },
        // Source milestone deleted → null source; edge still recorded.
        { memoryId: 'mem_c', sourceMilestoneId: null },
      ],
    }

    const first = await milestoneMemoryEdgeRepository.recordInjection(input)
    expect(first.count).toBe(3)

    const edges =
      await milestoneMemoryEdgeRepository.findSessionEdges('sess_steward')
    expect(edges).toHaveLength(3)
    // Source pointer carried through; null-source edge kept (not dropped).
    expect(edges.find(e => e.memoryId === 'mem_a')!.sourceMilestoneId).toBe(
      'ms_source1'
    )
    expect(
      edges.find(e => e.memoryId === 'mem_c')!.sourceMilestoneId
    ).toBeNull()

    // skipDuplicates is what makes the replay safe.
    expect(
      prismaMock.prisma.milestoneMemoryEdge.createMany
    ).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))

    // Replaying the identical session-start injection is a no-op: the
    // [sessionId, memoryId] unique index absorbs it — no duplicate rows.
    const replay = await milestoneMemoryEdgeRepository.recordInjection(input)
    expect(replay.count).toBe(0)
    expect(
      await milestoneMemoryEdgeRepository.findSessionEdges('sess_steward')
    ).toHaveLength(3)
  })

  it('recordInjection is a no-op on empty rows (no query)', async () => {
    const res = await milestoneMemoryEdgeRepository.recordInjection({
      workspaceId: 'w1',
      consumerMilestoneId: 'ms_consumer',
      sessionId: 'sess',
      rows: [],
    })
    expect(res).toEqual({ count: 0 })
    expect(
      prismaMock.prisma.milestoneMemoryEdge.createMany
    ).not.toHaveBeenCalled()
  })

  it('aggregateUsage counts used/unused/abstained and distinct sources', async () => {
    await milestoneMemoryEdgeRepository.recordInjection({
      workspaceId: 'w1',
      consumerMilestoneId: 'ms_consumer',
      sessionId: 's1',
      rows: [
        { memoryId: 'm1', sourceMilestoneId: 'src_a' },
        { memoryId: 'm2', sourceMilestoneId: 'src_a' },
        { memoryId: 'm3', sourceMilestoneId: 'src_b' },
      ],
    })
    const store = prismaMock.__store() as Array<{
      memoryId: string
      used: boolean | null
    }>
    store.find(r => r.memoryId === 'm1')!.used = true
    store.find(r => r.memoryId === 'm2')!.used = false
    // m3 stays null (abstained)

    const agg =
      await milestoneMemoryEdgeRepository.aggregateUsage('ms_consumer')
    expect(agg).toEqual({
      injected: 3,
      judgedUsed: 1,
      judgedUnused: 1,
      abstained: 1,
      sourceMilestones: 2,
    })
  })
})
