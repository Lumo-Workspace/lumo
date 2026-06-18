/**
 * LUM-539 (C6): the three trust consumers — relevance-gate always-keep, cold
 * eviction protection, and the supersede guard — all decide on the judged-used
 * track record (`qualified`), and a fragment's merge rate no longer drives any
 * keep/evict/supersede decision. The TrustVerdict type carries no merge field at
 * all, so this is enforced structurally as well as behaviorally.
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
    judgedUsageByFragments: jest.fn(),
    lastUsedAtByFragments: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/memory-provenance.repository', () => ({
  memoryProvenanceRepository: {
    resolveCanonicalFragment: jest.fn(async (_t: string, id: string) => id),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { fragmentTrustForMemories: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))

import { gateProjectMemories } from '@/lib/services/memory/relevance-gate'
import { resolveGuardedSupersedeIds } from '@/lib/services/memory/supersede-guard'
import { memoryCompactionService } from '@/lib/services/memory/compaction.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { lineageService } from '@/lib/services/lineage.service'
import type { TrustVerdict } from '@/types/lineage'

const mockTrust = lineageService.fragmentTrustForMemories as jest.Mock
const mockJudged = lineageEdgeRepository.judgedUsageByFragments as jest.Mock
const mockLastUsed = lineageEdgeRepository.lastUsedAtByFragments as jest.Mock
const mockOver =
  memoryRepository.findProjectsOverActiveMemoryThreshold as jest.Mock
const mockRows =
  memoryRepository.findActiveProjectMemoriesForCompaction as jest.Mock
const mockArchive = memoryRepository.archiveMemories as jest.Mock

function verdict(qualified: boolean): TrustVerdict {
  return {
    judgedUsedTasks: qualified ? 4 : 0,
    auditedTasks: 5,
    appearanceTasks: 6,
    usefulnessPct: qualified ? 80 : 0,
    qualified,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockJudged.mockResolvedValue([])
  mockLastUsed.mockResolvedValue([])
  mockOver.mockResolvedValue([])
  mockRows.mockResolvedValue([])
  mockArchive.mockImplementation(async (ids: string[]) => ({
    count: ids.length,
  }))
})

describe('LUM-539 trust consumers decide on judged-used not merge rate', () => {
  it('trust consumers decide on judged-used not merge rate', async () => {
    // The verdict shape carries judged-used counts and NO merge field — merge
    // rate cannot drive any decision because it isn't even present.
    const v = verdict(true)
    expect(v).toHaveProperty('judgedUsedTasks')
    expect(v).toHaveProperty('appearanceTasks')
    expect(v).not.toHaveProperty('mergedTasks')
    expect(v).not.toHaveProperty('resolvedTasks')
    expect(v).not.toHaveProperty('pct')
    expect(v).not.toHaveProperty('kind')

    // (1) supersede guard: only the `qualified` target is guarded.
    mockTrust.mockResolvedValue({ a: verdict(true), b: verdict(false) })
    const guarded = await resolveGuardedSupersedeIds(['a', 'b'])
    expect([...guarded]).toEqual(['a'])

    // (2) relevance gate: below the similarity floor, only the qualified memory
    //     is always-kept (its judged-used track record carries it).
    const corpus = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      scope: 'PROJECT' as const,
      category: 'CONVENTION' as const,
      content: { summary: `m${i}` },
    }))
    const gateRes = await gateProjectMemories(
      {
        task: { title: 't', description: 'd' },
        projectMemories: corpus,
        projectId: 'p',
      },
      {
        rankBySimilarity: async () => ({
          mechanism: 'embedding',
          ranked: corpus.map(m => ({ id: m.id, score: 0.1 })), // all below floor
        }),
        trustByFragment: async () =>
          new Map([
            ['m7', verdict(true)],
            ['m8', verdict(false)],
          ]),
      }
    )
    expect(gateRes.selected.map(m => m.id)).toEqual(['m7'])

    // (3) cold eviction: a qualified row is protected; an unqualified cold row evicts.
    mockOver.mockResolvedValue([{ projectId: 'p1', activeCount: 6 }])
    const old = new Date('2026-01-01T00:00:00Z')
    mockRows.mockResolvedValue([
      { id: 'k1', createdAt: old, createdByMemberId: null },
      { id: 'k2', createdAt: old, createdByMemberId: null },
      { id: 'k3', createdAt: old, createdByMemberId: null },
      { id: 'k4', createdAt: old, createdByMemberId: null },
      { id: 'proven', createdAt: old, createdByMemberId: null },
      { id: 'cold', createdAt: old, createdByMemberId: null },
    ])
    mockTrust.mockResolvedValue({ proven: verdict(true) }) // proven is qualified
    mockJudged.mockResolvedValue([
      {
        fragmentType: 'MEMORY',
        fragmentId: 'k1',
        judgedUsedTasks: 4,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'k2',
        judgedUsedTasks: 4,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'k3',
        judgedUsedTasks: 4,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'k4',
        judgedUsedTasks: 4,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
      // `cold` has rate 0 → coldest; `proven` would also be cold by rate but is
      // protected by its qualified verdict, so `cold` is the one archived.
      {
        fragmentType: 'MEMORY',
        fragmentId: 'proven',
        judgedUsedTasks: 0,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
      {
        fragmentType: 'MEMORY',
        fragmentId: 'cold',
        judgedUsedTasks: 0,
        auditedTasks: 4,
        appearanceTasks: 4,
      },
    ])
    await memoryCompactionService.sweepColdProjectMemories({
      now: new Date('2026-06-18T00:00:00Z'),
      threshold: 5,
      cap: 10,
    })
    const archived = mockArchive.mock.calls.flatMap(c => c[0] as string[])
    expect(archived).toEqual(['cold'])
    expect(archived).not.toContain('proven')
  })
})
