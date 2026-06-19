/**
 * @jest-environment node
 *
 * LUM-553 — triggerForProject budget maintenance: high-water trigger + cooldown
 * + lease; folds toward the cap, then archives never-used cards the rest of the
 * way; best-effort error swallowing.
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
jest.mock('@/lib/services/memory/retire.service', () => ({
  computeProjectRetireCandidates: jest.fn(),
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))

import {
  foldService,
  MEMORY_HIGH_WATER,
} from '@/lib/services/memory/fold.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'
import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'

const mActive = memoryRepository.findActiveProjectMemories as jest.Mock
const mClaim = memoryRepository.tryClaimLayer2Lease as jest.Mock
const mRelease = memoryRepository.releaseLayer2Lease as jest.Mock
const mArchive = memoryRepository.archiveMemoriesInWorkspace as jest.Mock
const mFoldState = projectRepository.findFoldState as jest.Mock
const mStamp = projectRepository.stampFoldAttempt as jest.Mock
const mCompute = computeProjectFoldProposals as jest.Mock
const mRetire = computeProjectRetireCandidates as jest.Mock

const overHighWater = () =>
  mActive.mockResolvedValue(
    Array.from({ length: MEMORY_HIGH_WATER + 5 }, (_, i) => ({ id: `m${i}` }))
  )

beforeEach(() => {
  jest.clearAllMocks()
  mClaim.mockResolvedValue(true)
  mFoldState.mockResolvedValue({
    workspaceId: 'ws-1',
    lastMemoryFoldAttemptAt: null,
  })
  mCompute.mockResolvedValue([])
  mRetire.mockResolvedValue([])
  mArchive.mockResolvedValue({ count: 0 })
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

  it('archives only never-used cards to reach the cap when folding alone cannot', async () => {
    overHighWater() // MEMORY_HIGH_WATER + 5 active, nothing folds (compute → [])
    mRetire.mockResolvedValue([
      { memoryId: 'a', reasons: ['low-judged-used'] },
      { memoryId: 'b', reasons: ['low-judged-used'] },
      { memoryId: 'c', reasons: ['contradiction'] }, // not never-used → excluded
    ])
    mArchive.mockResolvedValue({ count: 2 })

    const res = await foldService.triggerForProject('proj-1')

    // Only the low-judged-used (never-used) ids are archived, workspace-scoped.
    expect(mArchive).toHaveBeenCalledWith(['a', 'b'], 'ws-1')
    expect(res.pruned).toBe(2)
  })

  it('swallows errors (best-effort) and still releases the lease', async () => {
    overHighWater()
    mCompute.mockRejectedValue(new Error('llm down'))
    await expect(foldService.triggerForProject('proj-1')).resolves.toBeDefined()
    expect(mRelease).toHaveBeenCalledWith('proj-1')
  })
})
