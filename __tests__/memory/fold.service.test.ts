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
  mClaim.mockResolvedValue(true)
  mFoldState.mockResolvedValue({
    workspaceId: 'ws-1',
    lastMemoryFoldAttemptAt: null,
  })
  mCompute.mockResolvedValue([])
  mTrust.mockResolvedValue({}) // all cards never judged-used
  ;(memoryRepository.archiveMemoriesInWorkspace as jest.Mock).mockResolvedValue(
    {
      count: 0,
    }
  )
})

describe('foldService.triggerForProject is throttled by active-count floor and cooldown and swallows errors', () => {
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
    expect(mStamp).toHaveBeenCalledWith('proj-1', expect.any(Date))
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
