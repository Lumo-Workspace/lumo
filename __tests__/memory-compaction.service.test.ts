/**
 * LUM-328 — usage-strength cold eviction (forgetting curve).
 *
 * The sweep archives the coldest ACTIVE PROJECT memories of any project over
 * the threshold, ranked by usage-rate (LUM-300 task-deduped口径) with the
 * MemoryBank retention term R=e^(-t/S) as tie-break. Protected rows are never
 * archived: manual curation, freshness window, strong usage trust verdicts
 * (mirror of the LUM-325 supersede-guard), and recently-used rows.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findProjectsOverActiveMemoryThreshold: jest.fn(),
    findActiveProjectMemoriesForCompaction: jest.fn(),
    archiveMemories: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    mergeRateByFragments: jest.fn(),
    usageMergeRateByFragments: jest.fn(),
    lastUsedAtByFragments: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: { resolveCanonicalFragment: jest.fn() },
}))

jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { fragmentTrustForMemories: jest.fn() },
}))

jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}))

import { memoryCompactionService } from '@/lib/services/memory/compaction.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { memoryProvenanceRepository } from '@/lib/repositories/memory-provenance.repository'
import { lineageService } from '@/lib/services/lineage.service'
import { logger } from '@/lib/logger'

const mockOverThreshold =
  memoryRepository.findProjectsOverActiveMemoryThreshold as jest.Mock
const mockRows =
  memoryRepository.findActiveProjectMemoriesForCompaction as jest.Mock
const mockArchive = memoryRepository.archiveMemories as jest.Mock
const mockPresence = lineageEdgeRepository.mergeRateByFragments as jest.Mock
const mockUsage = lineageEdgeRepository.usageMergeRateByFragments as jest.Mock
const mockLastUsed = lineageEdgeRepository.lastUsedAtByFragments as jest.Mock
const mockCanonical =
  memoryProvenanceRepository.resolveCanonicalFragment as jest.Mock
const mockTrust = lineageService.fragmentTrustForMemories as jest.Mock

const NOW = new Date('2026-06-09T00:00:00Z')
const DAY = 86_400_000

const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

/** ACTIVE PROJECT row as returned by findActiveProjectMemoriesForCompaction. */
function row(
  id: string,
  ageDays: number,
  createdByMemberId: string | null = null
) {
  return { id, createdAt: daysAgo(ageDays), createdByMemberId }
}

/** Presence stat (task-deduped) keyed by canonical fragment id. */
function presence(fragmentId: string, resolvedTasks: number, mergedTasks = 0) {
  return { fragmentType: 'MEMORY', fragmentId, resolvedTasks, mergedTasks }
}

/** Usage stat (used=true, task-deduped) keyed by canonical fragment id. */
function usage(
  fragmentId: string,
  usedResolvedTasks: number,
  usedMergedTasks = 0
) {
  return {
    fragmentType: 'MEMORY',
    fragmentId,
    usedResolvedTasks,
    usedMergedTasks,
  }
}

function archivedIds(): string[] {
  return mockArchive.mock.calls.flatMap(c => c[0] as string[])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOverThreshold.mockResolvedValue([])
  mockRows.mockResolvedValue([])
  mockArchive.mockImplementation(async (ids: string[]) => ({
    count: ids.length,
  }))
  mockPresence.mockResolvedValue([])
  mockUsage.mockResolvedValue([])
  mockLastUsed.mockResolvedValue([])
  mockCanonical.mockImplementation(async (_type: string, id: string) => id)
  mockTrust.mockResolvedValue({})
})

describe('memoryCompactionService.sweepColdProjectMemories', () => {
  it('does nothing when no project exceeds the ACTIVE threshold', async () => {
    const result = await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
    })
    expect(result.archivedTotal).toBe(0)
    expect(result.projects).toEqual([])
    expect(mockArchive).not.toHaveBeenCalled()
  })

  it('archives the lowest usage-rate rows down to the threshold', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 8 }])
    const rows = [
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('m6', 60),
      row('m7', 60),
      row('m8', 60),
    ]
    mockRows.mockResolvedValue(rows)
    // m1..m5 are warm (used in all 4 resolved tasks); m6..m8 injected but never used.
    mockPresence.mockResolvedValue(rows.map(r => presence(r.id, 4, 2)))
    mockUsage.mockResolvedValue([
      usage('m1', 4, 2),
      usage('m2', 4, 2),
      usage('m3', 4, 2),
      usage('m4', 4, 2),
      usage('m5', 4, 2),
    ])

    const result = await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
      freshnessDays: 14,
      recentUseDays: 14,
    })

    // Overage = 8 - 5 = 3 → exactly the three never-used rows go.
    expect(new Set(archivedIds())).toEqual(new Set(['m6', 'm7', 'm8']))
    expect(result.archivedTotal).toBe(3)
    expect(result.projects[0]).toMatchObject({ projectId: 'p1', archived: 3 })
  })

  it('caps the per-sweep eviction and evicts older rows first within equal usage-rate (R tie-break)', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 8 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('m6', 90), // oldest never-used → lowest R → first out
      row('m7', 70),
      row('m8', 50),
    ])
    mockUsage.mockResolvedValue([
      usage('m1', 4),
      usage('m2', 4),
      usage('m3', 4),
      usage('m4', 4),
      usage('m5', 4),
    ])
    mockPresence.mockResolvedValue(
      ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map(id =>
        presence(id, 4)
      )
    )

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 2,
    })

    expect(archivedIds()).toEqual(['m6', 'm7'])
  })

  it('never archives manually created memories', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 7 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('manual', 90, 'member_1'), // coldest of all, but human-curated
      row('m7', 60),
    ])

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
    })

    expect(archivedIds()).not.toContain('manual')
    expect(archivedIds()).toHaveLength(2)
  })

  it('protects rows inside the freshness window even when never used', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('fresh', 3), // never used, but only 3 days old
    ])

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
      freshnessDays: 14,
    })

    expect(archivedIds()).not.toContain('fresh')
    expect(archivedIds()).toHaveLength(1)
  })

  it('protects rows carrying a strong usage trust verdict (supersede-guard mirror)', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('trusted', 90),
    ])
    mockTrust.mockResolvedValue({
      trusted: { kind: 'usage', resolvedTasks: 3, mergedTasks: 3, pct: 100 },
    })

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
    })

    expect(archivedIds()).not.toContain('trusted')
    expect(archivedIds()).toHaveLength(1)
  })

  it('protects recently-used rows', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('m5', 60),
      row('recent', 90),
    ])
    mockLastUsed.mockResolvedValue([
      { fragmentType: 'MEMORY', fragmentId: 'recent', lastUsedAt: daysAgo(2) },
    ])

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
      recentUseDays: 14,
    })

    expect(archivedIds()).not.toContain('recent')
    expect(archivedIds()).toHaveLength(1)
  })

  it('archives nothing when protections leave no candidates', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    mockRows.mockResolvedValue([
      row('m1', 60, 'member_1'),
      row('m2', 60, 'member_1'),
      row('m3', 60, 'member_1'),
      row('m4', 60, 'member_1'),
      row('m5', 60, 'member_1'),
      row('m6', 60, 'member_1'),
    ])

    const result = await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
    })

    expect(mockArchive).not.toHaveBeenCalled()
    expect(result.archivedTotal).toBe(0)
  })

  it('joins lineage stats via the canonical fragment id', async () => {
    mockOverThreshold.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    mockRows.mockResolvedValue([
      row('m1', 60),
      row('m2', 60),
      row('m3', 60),
      row('m4', 60),
      row('rekeyed', 90), // stats live under its canonical id
      row('cold', 60),
    ])
    mockCanonical.mockImplementation(async (_t: string, id: string) =>
      id === 'rekeyed' ? 'canon_1' : id
    )
    mockPresence.mockResolvedValue([
      presence('canon_1', 4),
      ...['m1', 'm2', 'm3', 'm4', 'cold'].map(id => presence(id, 4)),
    ])
    mockUsage.mockResolvedValue([
      usage('canon_1', 4),
      usage('m1', 4),
      usage('m2', 4),
      usage('m3', 4),
      usage('m4', 4),
    ])

    await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
    })

    expect(mockCanonical).toHaveBeenCalledWith('MEMORY', 'rekeyed')
    // canonical stats say it's warm (usage-rate 1) → the truly cold row goes instead
    expect(archivedIds()).toEqual(['cold'])
  })

  it('continues with the next project when one project fails', async () => {
    mockOverThreshold.mockResolvedValue([
      { projectId: 'boom', activeCount: 9 },
      { projectId: 'ok', activeCount: 6 },
    ])
    mockRows.mockImplementation(async (projectId: string) => {
      if (projectId === 'boom') throw new Error('db hiccup')
      return [
        row('m1', 60),
        row('m2', 60),
        row('m3', 60),
        row('m4', 60),
        row('m5', 60),
        row('m6', 60),
      ]
    })

    const result = await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
      threshold: 5,
      cap: 10,
    })

    expect(result.archivedTotal).toBe(1)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0]?.projectId).toBe('ok')
    expect(logger.error).toHaveBeenCalled()
  })

  it('never throws: enumeration failure degrades to an empty result', async () => {
    mockOverThreshold.mockRejectedValue(new Error('db down'))
    const result = await memoryCompactionService.sweepColdProjectMemories({
      now: NOW,
    })
    expect(result.archivedTotal).toBe(0)
    expect(result.projects).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })
})
