/**
 * Tests for the DI-testable core of backfill-memory-embeddings.
 * All external deps (DB, AI gateway) are injected mocks — no real I/O.
 */

// memoryContentToText is imported lazily inside backfillMemoryEmbeddings via
// dynamic import. We mock the whole module so tests don't pull in the real one.
jest.mock('@/lib/memory/content-text', () => ({
  memoryContentToText: jest.fn((category: string, content: unknown) => {
    // Simple deterministic fake: return "category:summary" for objects,
    // '' for null/non-objects.
    if (content === null || typeof content !== 'object') return ''
    const c = content as Record<string, unknown>
    const summary = typeof c['summary'] === 'string' ? c['summary'] : ''
    return summary ? `${category}:${summary}` : ''
  }),
}))

import { backfillMemoryEmbeddings } from '@/scripts/backfill-memory-embeddings'
import type { MemoryCategory } from '@prisma/client'

function makeRow(id: string, summary?: string) {
  return {
    id,
    category: 'TRAP' as MemoryCategory,
    content: summary !== undefined ? { summary } : {},
  }
}

interface TestDeps {
  fetchUnembeddedBatch: jest.Mock
  embed: jest.Mock
  store: jest.Mock
  batchSize: number
  dryRun: boolean
  log: jest.Mock
}

function makeDeps(overrides: Partial<TestDeps> = {}): TestDeps {
  const fetchUnembeddedBatch = jest.fn()
  const embed = jest.fn()
  const store = jest.fn().mockResolvedValue(undefined)
  return {
    fetchUnembeddedBatch,
    embed,
    store,
    batchSize: 3,
    dryRun: false,
    log: jest.fn(),
    ...overrides,
  }
}

beforeEach(() => jest.clearAllMocks())

describe('backfillMemoryEmbeddings — multiple batches', () => {
  it('processes all batches until empty and returns correct counts', async () => {
    const deps = makeDeps()
    // Two batches then empty
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1', 'trap one'), makeRow('r2', 'trap two')])
      .mockResolvedValueOnce([makeRow('r3', 'trap three')])
      .mockResolvedValueOnce([]) // done

    deps.embed
      .mockResolvedValueOnce([[0.1, 0.2], [0.3, 0.4]])
      .mockResolvedValueOnce([[0.5, 0.6]])

    const result = await backfillMemoryEmbeddings(deps)

    expect(result.processed).toBe(3)
    expect(result.embedded).toBe(3)
    expect(result.failedBatches).toBe(0)

    expect(deps.store).toHaveBeenCalledTimes(3)
    expect(deps.store).toHaveBeenCalledWith('r1', [0.1, 0.2])
    expect(deps.store).toHaveBeenCalledWith('r2', [0.3, 0.4])
    expect(deps.store).toHaveBeenCalledWith('r3', [0.5, 0.6])
  })
})

describe('backfillMemoryEmbeddings — dryRun', () => {
  it('counts embeddable rows but calls neither embed nor store', async () => {
    const deps = makeDeps({ dryRun: true })
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1', 'trap one'), makeRow('r2', 'trap two')])
      .mockResolvedValueOnce([])

    const result = await backfillMemoryEmbeddings(deps)

    expect(result.processed).toBe(2)
    expect(result.embedded).toBe(2) // counted as "would embed"
    expect(result.failedBatches).toBe(0)
    expect(deps.embed).not.toHaveBeenCalled() // dry-run never hits the gateway
    expect(deps.store).not.toHaveBeenCalled()
  })

  it('terminates via keyset pagination even though dry-run stores nothing (regression: IS-NULL-only fetch would loop forever)', async () => {
    // A real keyset paginator over a fixed dataset. With the old IS-NULL-only
    // query + no store, this would re-return the same rows forever in dry-run.
    const dataset = [
      makeRow('a1', 'one'),
      makeRow('a2', 'two'),
      makeRow('a3', 'three'),
      makeRow('a4', 'four'),
    ]
    const fetchUnembeddedBatch = jest.fn(
      async (limit: number, afterId?: string) => {
        const start = afterId
          ? dataset.findIndex(r => r.id === afterId) + 1
          : 0
        return dataset.slice(start, start + limit)
      }
    )
    const deps = makeDeps({ dryRun: true, batchSize: 2, fetchUnembeddedBatch })

    const result = await backfillMemoryEmbeddings(deps)

    expect(result.processed).toBe(4)
    expect(result.embedded).toBe(4)
    expect(deps.embed).not.toHaveBeenCalled()
    expect(deps.store).not.toHaveBeenCalled()
    // 2 data batches (a1-a2, a3-a4) + 1 empty terminator = 3 fetches
    expect(fetchUnembeddedBatch).toHaveBeenCalledTimes(3)
  })
})

describe('backfillMemoryEmbeddings — embed failure', () => {
  it('counts failed batches and continues the loop', async () => {
    const deps = makeDeps()
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1', 'trap one')])
      .mockResolvedValueOnce([makeRow('r2', 'trap two')]) // succeeds
      .mockResolvedValueOnce([])

    deps.embed
      .mockRejectedValueOnce(new Error('gateway error'))  // first batch fails
      .mockResolvedValueOnce([[0.5, 0.6]])                // second batch succeeds

    const result = await backfillMemoryEmbeddings(deps)

    expect(result.processed).toBe(2)
    expect(result.failedBatches).toBe(1)
    expect(result.embedded).toBe(1) // only second batch stored
    expect(deps.store).toHaveBeenCalledTimes(1)
    expect(deps.store).toHaveBeenCalledWith('r2', [0.5, 0.6])
  })

  it('survives multiple failed batches and still processes successes', async () => {
    const deps = makeDeps()
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1', 'a')])
      .mockResolvedValueOnce([makeRow('r2', 'b')])
      .mockResolvedValueOnce([makeRow('r3', 'c')])
      .mockResolvedValueOnce([])

    deps.embed
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce([[1, 2]])

    const result = await backfillMemoryEmbeddings(deps)

    expect(result.failedBatches).toBe(2)
    expect(result.embedded).toBe(1)
    expect(result.processed).toBe(3)
  })
})

describe('backfillMemoryEmbeddings — empty text rows', () => {
  it('skips embed call when all rows produce empty text', async () => {
    const deps = makeDeps()
    // makeRow with no summary → content={} → memoryContentToText returns ''
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1'), makeRow('r2')])
      .mockResolvedValueOnce([])

    const result = await backfillMemoryEmbeddings(deps)

    expect(deps.embed).not.toHaveBeenCalled()
    expect(deps.store).not.toHaveBeenCalled()
    expect(result.processed).toBe(2)
    expect(result.embedded).toBe(0)
    expect(result.failedBatches).toBe(0)
  })
})

describe('backfillMemoryEmbeddings — empty first batch', () => {
  it('returns zero counts immediately when no rows to process', async () => {
    const deps = makeDeps()
    deps.fetchUnembeddedBatch.mockResolvedValueOnce([])

    const result = await backfillMemoryEmbeddings(deps)

    expect(result).toEqual({ processed: 0, embedded: 0, failedBatches: 0 })
    expect(deps.embed).not.toHaveBeenCalled()
    expect(deps.store).not.toHaveBeenCalled()
  })
})

describe('backfillMemoryEmbeddings — idempotency characteristic', () => {
  it('does not re-embed rows that have embeddings (fetch returns empty on second run)', async () => {
    const deps = makeDeps()
    // First run: one batch then done
    deps.fetchUnembeddedBatch
      .mockResolvedValueOnce([makeRow('r1', 'trap')])
      .mockResolvedValueOnce([])
    deps.embed.mockResolvedValueOnce([[0.1, 0.2]])

    const first = await backfillMemoryEmbeddings(deps)
    expect(first.embedded).toBe(1)

    // Reset and simulate second run: fetch returns empty (rows already embedded)
    deps.fetchUnembeddedBatch.mockReset()
    deps.fetchUnembeddedBatch.mockResolvedValueOnce([])
    deps.embed.mockReset()
    deps.store.mockReset()

    const second = await backfillMemoryEmbeddings(deps)
    expect(second).toEqual({ processed: 0, embedded: 0, failedBatches: 0 })
    expect(deps.embed).not.toHaveBeenCalled()
    expect(deps.store).not.toHaveBeenCalled()
  })
})
