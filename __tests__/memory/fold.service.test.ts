/**
 * @jest-environment node
 *
 * LUM-553 — triggerForProject throttle: over-cap (MEMORY_CAP) + per-project
 * cooldown + lease, and best-effort error swallowing.
 */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findActiveProjectMemories: jest.fn(),
    tryClaimLayer2Lease: jest.fn(),
    releaseLayer2Lease: jest.fn(),
    setEmbedding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: { findFoldState: jest.fn(), stampFoldAttempt: jest.fn() },
}))
jest.mock('@/lib/services/memory/fold-compute', () => ({
  computeProjectFoldProposals: jest.fn(),
  MIN_CLUSTER_SIZE: 3,
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))

import { foldService, MEMORY_CAP } from '@/lib/services/memory/fold.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'

const mActive = memoryRepository.findActiveProjectMemories as jest.Mock
const mClaim = memoryRepository.tryClaimLayer2Lease as jest.Mock
const mRelease = memoryRepository.releaseLayer2Lease as jest.Mock
const mFoldState = projectRepository.findFoldState as jest.Mock
const mStamp = projectRepository.stampFoldAttempt as jest.Mock
const mCompute = computeProjectFoldProposals as jest.Mock

const overCap = () =>
  mActive.mockResolvedValue(
    Array.from({ length: MEMORY_CAP + 5 }, (_, i) => ({ id: `m${i}` }))
  )

beforeEach(() => {
  jest.clearAllMocks()
  mClaim.mockResolvedValue(true)
  mFoldState.mockResolvedValue({
    workspaceId: 'ws-1',
    lastMemoryFoldAttemptAt: null,
  })
  mCompute.mockResolvedValue([])
})

describe('foldService.triggerForProject is throttled by active-count floor and cooldown and swallows errors', () => {
  it('skips when already within the cap without computing or stamping', async () => {
    mActive.mockResolvedValue([{ id: 'm1' }]) // <= MEMORY_CAP
    await foldService.triggerForProject('proj-1')
    expect(mCompute).not.toHaveBeenCalled()
    expect(mStamp).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })

  it('skips inside the cooldown window without computing', async () => {
    overCap()
    mFoldState.mockResolvedValue({
      workspaceId: 'ws-1',
      lastMemoryFoldAttemptAt: new Date(), // just now → inside cooldown
    })
    await foldService.triggerForProject('proj-1')
    expect(mCompute).not.toHaveBeenCalled()
    expect(mClaim).not.toHaveBeenCalled()
  })

  it('stamps and computes (bounded) when over cap and past cooldown', async () => {
    overCap()
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
    overCap()
    mCompute.mockRejectedValue(new Error('llm down'))
    await expect(foldService.triggerForProject('proj-1')).resolves.toBeDefined()
    expect(mRelease).toHaveBeenCalledWith('proj-1')
  })
})
