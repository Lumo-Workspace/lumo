/**
 * @jest-environment node
 *
 * LUM-540 (P4a) — retire action loop. Two independent signals (low judged-used
 * track record, curation-judge clearly-wrong) feed retire CANDIDATES; on human
 * confirmation a candidate is retired through the EXISTING memory status machine
 * (archiveMemories: ACTIVE→ARCHIVED, reversible) — never hard-deleted, never a
 * new status column or parallel pipeline. Selection is pure (zero writes).
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    archiveMemories: jest.fn(),
    invalidate: jest.fn(),
    delete: jest.fn(),
    listForProject: jest.fn(),
    listStaleAnchorReportsForProject: jest.fn(),
  },
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: {
    fragmentTrustForMemories: jest.fn().mockResolvedValue({}),
  },
}))

import {
  selectRetireCandidates,
  retireConfirmed,
  computeProjectRetireCandidates,
} from '@/lib/services/memory/retire.service'
import type { TrustVerdict } from '@/lib/services/lineage-signal'
import { memoryRepository } from '@/lib/repositories/memory.repository'

const archive = memoryRepository.archiveMemories as jest.Mock
const hardDelete = memoryRepository.delete as jest.Mock
const listForProject = memoryRepository.listForProject as jest.Mock
const listStaleReports =
  memoryRepository.listStaleAnchorReportsForProject as jest.Mock

/** A qualified verdict (cleared the cold-start grace, audited in N tasks). */
function verdict(judgedUsedTasks: number, auditedTasks: number): TrustVerdict {
  return {
    judgedUsedTasks,
    auditedTasks,
    appearanceTasks: auditedTasks,
    usefulnessPct: Math.round((judgedUsedTasks / auditedTasks) * 100),
    qualified: judgedUsedTasks >= 3,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  archive.mockResolvedValue({ count: 1 })
})

describe('selectRetireCandidates (pure, no writes)', () => {
  test('cold-start and abstained fragments are never selected for retirement', () => {
    const candidates = selectRetireCandidates({
      memories: [{ id: 'cold' }, { id: 'proven' }, { id: 'low' }],
      // 'cold' has NO verdict (never cleared cold-start) → absent from the map.
      trustByMemoryId: new Map<string, TrustVerdict>([
        ['proven', verdict(4, 7)], // judged used → never a candidate
        ['low', verdict(0, 5)], // audited 5×, never used → low-judged-used
      ]),
      contradictionMemoryIds: new Set<string>(),
    })

    const ids = candidates.map(c => c.memoryId)
    // abstention (cold-start, no usage data) is NOT negative evidence
    expect(ids).not.toContain('cold')
    // proven memory is protected
    expect(ids).not.toContain('proven')
    // only the audited-but-never-used memory is proposed, via the usage signal
    expect(candidates).toEqual([
      { memoryId: 'low', reasons: ['low-judged-used'] },
    ])
    // selection performs ZERO writes
    expect(archive).not.toHaveBeenCalled()
    expect(hardDelete).not.toHaveBeenCalled()
  })

  test('retire never physically deletes and never archives without confirmation', async () => {
    // Detection alone (no confirmation) writes nothing.
    selectRetireCandidates({
      memories: [{ id: 'low' }],
      trustByMemoryId: new Map([['low', verdict(0, 4)]]),
      contradictionMemoryIds: new Set(),
    })
    expect(archive).not.toHaveBeenCalled()
    expect(hardDelete).not.toHaveBeenCalled()

    // Confirmation flips status via the existing machine — never deletes.
    await retireConfirmed('low')
    expect(archive).toHaveBeenCalledWith(['low'])
    expect(hardDelete).not.toHaveBeenCalled()
  })
})

describe('retireConfirmed (shared action path)', () => {
  test('retire candidate archives via existing memory status machine on confirm', async () => {
    const candidates = selectRetireCandidates({
      memories: [{ id: 'low' }],
      trustByMemoryId: new Map([['low', verdict(0, 5)]]),
      contradictionMemoryIds: new Set(),
    })
    expect(candidates[0]).toEqual({
      memoryId: 'low',
      reasons: ['low-judged-used'],
    })

    const n = await retireConfirmed('low')
    // Routes through archiveMemories (ACTIVE→ARCHIVED, guarded + reversible),
    // not a new status column or parallel table.
    expect(archive).toHaveBeenCalledWith(['low'])
    expect(n).toBe(1)
  })

  test('contradiction retirement reuses curation-judge through the shared retire path', async () => {
    // A memory the curation-judge flagged clearly-wrong (contradiction) — even
    // with no usage verdict — is a candidate via the independent contradiction
    // signal, and retires through the SAME retireConfirmed action.
    const candidates = selectRetireCandidates({
      memories: [{ id: 'wrong' }],
      trustByMemoryId: new Map(),
      contradictionMemoryIds: new Set(['wrong']),
    })
    expect(candidates).toEqual([
      { memoryId: 'wrong', reasons: ['contradiction'] },
    ])

    await retireConfirmed('wrong')
    expect(archive).toHaveBeenCalledWith(['wrong'])
    expect(hardDelete).not.toHaveBeenCalled()
  })
})

describe('stale-anchor signal (LUM-547)', () => {
  test('a memory with a stale-anchor report is a candidate carrying its evidence', () => {
    const candidates = selectRetireCandidates({
      memories: [{ id: 'stale' }, { id: 'fine' }],
      trustByMemoryId: new Map(),
      contradictionMemoryIds: new Set(),
      staleAnchorsByMemoryId: new Map([
        ['stale', [{ kind: 'file', value: 'lib/gone.ts' }]],
      ]),
    })
    expect(candidates).toEqual([
      {
        memoryId: 'stale',
        reasons: ['stale-anchor'],
        staleAnchors: [{ kind: 'file', value: 'lib/gone.ts' }],
      },
    ])
  })

  test('an empty evidence list does not make a candidate', () => {
    const candidates = selectRetireCandidates({
      memories: [{ id: 'm' }],
      trustByMemoryId: new Map(),
      contradictionMemoryIds: new Set(),
      staleAnchorsByMemoryId: new Map([['m', []]]),
    })
    expect(candidates).toEqual([])
  })

  test('a memory flagged by usage AND stale-anchor carries both reasons + evidence', () => {
    const candidates = selectRetireCandidates({
      memories: [{ id: 'both' }],
      trustByMemoryId: new Map([['both', verdict(0, 5)]]),
      contradictionMemoryIds: new Set(),
      staleAnchorsByMemoryId: new Map([
        ['both', [{ kind: 'symbol', value: 'goneFn' }]],
      ]),
    })
    expect(candidates[0]!.reasons).toEqual(['low-judged-used', 'stale-anchor'])
    expect(candidates[0]!.staleAnchors).toEqual([
      { kind: 'symbol', value: 'goneFn' },
    ])
  })

  test('stale-anchor candidate retires through the same human-confirmed archive path', async () => {
    await retireConfirmed('stale')
    expect(archive).toHaveBeenCalledWith(['stale'])
    expect(hardDelete).not.toHaveBeenCalled()
  })

  test('computeProjectRetireCandidates folds persisted stale-anchor reports into the pool', async () => {
    listForProject.mockResolvedValue([{ id: 'stale' }, { id: 'clean' }])
    listStaleReports.mockResolvedValue([
      {
        memoryId: 'stale',
        deadAnchors: [{ kind: 'file', value: 'lib/gone.ts' }],
      },
    ])

    const candidates = await computeProjectRetireCandidates('proj1')

    expect(candidates).toEqual([
      {
        memoryId: 'stale',
        reasons: ['stale-anchor'],
        staleAnchors: [{ kind: 'file', value: 'lib/gone.ts' }],
      },
    ])
  })
})
