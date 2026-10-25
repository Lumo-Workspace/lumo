/**
 * @jest-environment node
 *
 * LUM-553 — triggerForProject budget maintenance: high-water trigger + cooldown
 * + lease; folds toward the cap, then archives (reversibly) the oldest
 * never-judged-used cards the rest of the way; best-effort error swallowing.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveProjectMemories: jest.fn(),
    tryClaimLayer2Lease: jest.fn(),
    releaseLayer2Lease: jest.fn(),
    setEmbedding: jest.fn(),
    archiveMemoriesInWorkspace: jest.fn(),
    foldInto: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findFoldState: jest.fn(), stampFoldAttempt: jest.fn() },
}))
jest.mock('@/lib/services/memory/fold-compute', () => ({
  computeProjectFoldProposals: jest.fn(),
  MIN_CLUSTER_SIZE: 3,
}))
jest.mock('@/lib/services/lineage.service', () => ({
  lineageService: { fragmentTrustForMemories: jest.fn() },
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))

import {
  foldService,
  selectPruneTargets,
  MEMORY_HIGH_WATER,
} from '@/lib/services/memory/fold.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import { lineageService } from '@/lib/services/lineage.service'

const mActive = memoryRepository.findActiveProjectMemories as jest.Mock
const mClaim = memoryRepository.tryClaimLayer2Lease as jest.Mock
const mRelease = memoryRepository.releaseLayer2Lease as jest.Mock
const mFoldState = projectRepository.findFoldState as jest.Mock
const mStamp = projectRepository.stampFoldAttempt as jest.Mock
const mCompute = computeProjectFoldProposals as jest.Mock
const mTrust = lineageService.fragmentTrustForMemories as jest.Mock

const overHighWater = () =>
  mActive.mockResolvedValue(
    Array.from({ length: MEMORY_HIGH_WATER + 5 }, (_, i) => ({
      id: `m${i}`,
      createdAt: new Date(1000 * (i + 1)), // all 1970 → past the prune grace
    }))
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockAiDerivedEnabled.mockResolvedValue(true)
  mClaim.mockResolvedValue(true)
  mFoldState.mockResolvedValue({
    workspaceId: 'ws-1',
    lastMemoryFoldAttemptAt: null,
  })
  mCompute.mockResolvedValue({ proposals: [], degraded: false })
  mTrust.mockResolvedValue({}) // all cards never judged-used
  ;(memoryRepository.archiveMemoriesInWorkspace as jest.Mock).mockResolvedValue(
    {
      count: 0,
    }
  )
})

describe('foldService.triggerForProject is throttled by active-count floor and cooldown and swallows errors', () => {
  it('skips when the workspace turned AI-derived content off (LUM-917)', async () => {
    overHighWater()
    mockAiDerivedEnabled.mockResolvedValue(false)
    await expect(foldService.triggerForProject('proj-1')).resolves.toEqual({
      folded: 0,
      pruned: 0,
      skipped: 'ai-derived-off',
    })
    expect(mCompute).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })

  it('skips when already within the high-water mark without computing or stamping', async () => {
    mActive.mockResolvedValue([{ id: 'm1' }]) // <= MEMORY_HIGH_WATER
    await foldService.triggerForProject('proj-1')
    expect(mCompute).not.toHaveBeenCalled()
    expect(mStamp).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window without computing', async () => {
    overHighWater()
    mFoldState.mockResolvedValue({
      workspaceId: 'ws-1',
      lastMemoryFoldAttemptAt: new Date(), // just now → inside cooldown
    })
    await foldService.triggerForProject('proj-1')
    expect(mCompute).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })

  it('stamps and computes (bounded) when over the high-water mark and past cooldown', async () => {
    overHighWater()
    await foldService.triggerForProject('proj-1')
    expect(mStamp).toHaveBeenCalledWith('proj-1', 'ws-1', expect.any(Date))
    // bounded compute: a per-run cluster cap is passed
    expect(mCompute).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ maxProposals: expect.any(Number) })
    )
    expect(mRelease).toHaveBeenCalledWith('proj-1')
  })

  it('swallows errors (best-effort) and still releases the lease', async () => {
    overHighWater()
    mCompute.mockRejectedValue(new Error('llm down'))
    await expect(foldService.triggerForProject('proj-1')).resolves.toBeDefined()
    expect(mRelease).toHaveBeenCalledWith('proj-1')
  })
})

describe('triggerForProject guardrail: prune must not silently cover for a failed fold (LUM-555)', () => {
  const mFoldInto = memoryRepository.foldInto as jest.Mock
  const mArchive = memoryRepository.archiveMemoriesInWorkspace as jest.Mock

  it('skips prune when fold produced nothing despite proposals', async () => {
    // Compute surfaced foldable proposals, but every applyFold throws → folded
    // stays 0. Prune must NOT archive the overflow that should have been folded.
    overHighWater()
    mCompute.mockResolvedValue({
      proposals: [
        {
          category: 'TRAP',
          coarseContent: {},
          sourceIds: ['a', 'b', 'c'],
          excludedIds: [],
        },
      ],
      degraded: false,
    })
    mFoldInto.mockRejectedValue(new Error('supersede race'))

    const res = await foldService.triggerForProject('proj-1')

    expect(res.folded).toBe(0)
    expect(res.foldFailed).toBe(true)
    expect(res.pruned).toBe(0)
    expect(mArchive).not.toHaveBeenCalled()
  })

  it('skips prune when the fold pipeline degraded', async () => {
    // No proposals because clustering errored (degraded). Empty proposals here
    // means "fold couldn't run", not "nothing to fold" — prune must not proceed.
    overHighWater()
    mCompute.mockResolvedValue({ proposals: [], degraded: true })

    const res = await foldService.triggerForProject('proj-1')

    expect(res.folded).toBe(0)
    expect(res.foldFailed).toBe(true)
    expect(mArchive).not.toHaveBeenCalled()
  })

  it('still prunes when fold genuinely has nothing to do', async () => {
    // Healthy pipeline, no foldable clusters (all singletons) → prune is the
    // correct budget enforcer and must still run.
    overHighWater()
    mCompute.mockResolvedValue({ proposals: [], degraded: false })
    mArchive.mockResolvedValue({ count: 25 })

    const res = await foldService.triggerForProject('proj-1')

    expect(res.foldFailed).toBeFalsy()
    expect(mArchive).toHaveBeenCalled()
  })
})

describe('selectPruneTargets', () => {
  it('archives oldest never-judged-used cards, protecting used and recent ones', () => {
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const active = [
      { id: 'used-old', createdAt: new Date(now - 100 * day) }, // judged-used → kept
      { id: 'never-old1', createdAt: new Date(now - 90 * day) },
      { id: 'never-old2', createdAt: new Date(now - 80 * day) },
      { id: 'never-recent', createdAt: new Date(now - 1 * day) }, // within grace → kept
    ]
    const judgedUsed = (id: string) => (id === 'used-old' ? 3 : 0)

    // Asking for 5 but only 2 are eligible; oldest first; used + recent excluded.
    expect(selectPruneTargets(active, judgedUsed, 5, now)).toEqual([
      'never-old1',
      'never-old2',
    ])
    // n caps the result.
    expect(selectPruneTargets(active, judgedUsed, 1, now)).toEqual([
      'never-old1',
    ])
    // n <= 0 → nothing.
    expect(selectPruneTargets(active, judgedUsed, 0, now)).toEqual([])
  })
})

describe('foldService.triggerForProject — global memory pipeline switch (LUM-1314)', () => {
  afterEach(() => {
    delete process.env.MEMORY_PIPELINE_DISABLED
  })

  it('skips without computing while the switch is on', async () => {
    process.env.MEMORY_PIPELINE_DISABLED = '1'
    overHighWater()
    await expect(foldService.triggerForProject('proj-1')).resolves.toEqual({
      folded: 0,
      pruned: 0,
      skipped: 'memory-pipeline-off',
    })
    expect(mCompute).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })
})
