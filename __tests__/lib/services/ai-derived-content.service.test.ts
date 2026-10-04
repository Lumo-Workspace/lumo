/**
 * LUM-917 — aiDerivedContentService: the switch fails closed, the status is
 * OWNER-only, and the delete runs bounded batches and reports `done`.
 */
jest.mock('@/lib/repositories/ai-derived-content.repository', () => ({
  aiDerivedContentRepository: {
    findEnabled: jest.fn(),
    countForWorkspace: jest.fn(),
    deleteMemoryBatch: jest.fn(),
    clearSessionSummaryBatch: jest.fn(),
    clearRunSummaryBatch: jest.fn(),
    clearClaimSnapshotBatch: jest.fn(),
    clearVerdictTextBatch: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  aiDerivedContentService,
  AI_DERIVED_PURGE_BATCH_SIZE,
  AI_DERIVED_PURGE_MAX_BATCHES,
} from '@/lib/services/ai-derived-content.service'
import { aiDerivedContentRepository } from '@/lib/repositories/ai-derived-content.repository'

const repo = aiDerivedContentRepository as unknown as Record<string, jest.Mock>
const WS = { id: 'w1', name: 'Acme' }

beforeEach(() => {
  jest.clearAllMocks()
  repo.deleteMemoryBatch!.mockResolvedValue(0)
  repo.clearSessionSummaryBatch!.mockResolvedValue(0)
  repo.clearRunSummaryBatch!.mockResolvedValue(0)
  repo.clearClaimSnapshotBatch!.mockResolvedValue(0)
  repo.clearVerdictTextBatch!.mockResolvedValue(0)
})

describe('aiDerivedContentService.isEnabled', () => {
  it('is true only when the stored switch is true; fails closed otherwise', async () => {
    repo.findEnabled!.mockResolvedValueOnce(true)
    expect(await aiDerivedContentService.isEnabled({ workspaceId: 'w1' })).toBe(
      true
    )
    repo.findEnabled!.mockResolvedValueOnce(false)
    expect(await aiDerivedContentService.isEnabled({ projectId: 'p1' })).toBe(
      false
    )
    repo.findEnabled!.mockResolvedValueOnce(null)
    expect(await aiDerivedContentService.isEnabled({ taskId: 't1' })).toBe(
      false
    )
    repo.findEnabled!.mockRejectedValueOnce(new Error('db down'))
    expect(await aiDerivedContentService.isEnabled({ milestoneId: 'm1' })).toBe(
      false
    )
  })
})

describe('aiDerivedContentService.getStatus', () => {
  it('returns switch and counts to an OWNER and refuses anyone else', async () => {
    repo.findEnabled!.mockResolvedValue(false)
    repo.countForWorkspace!.mockResolvedValue({
      memories: 1,
      sessionSummaries: 0,
      runSummaries: 0,
    })
    await expect(
      aiDerivedContentService.getStatus('w1', 'OWNER')
    ).resolves.toEqual({
      enabled: false,
      counts: { memories: 1, sessionSummaries: 0, runSummaries: 0 },
    })
    await expect(
      aiDerivedContentService.getStatus('w1', 'MEMBER')
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('aiDerivedContentService.purge', () => {
  it('drains each kind in order until a short batch', async () => {
    repo
      .deleteMemoryBatch!.mockResolvedValueOnce(AI_DERIVED_PURGE_BATCH_SIZE)
      .mockResolvedValueOnce(7)
    repo.clearSessionSummaryBatch!.mockResolvedValueOnce(3)
    repo.clearRunSummaryBatch!.mockResolvedValueOnce(4)
    repo.clearClaimSnapshotBatch!.mockResolvedValueOnce(2)
    repo.clearVerdictTextBatch!.mockResolvedValueOnce(1)
    const out = await aiDerivedContentService.purge(WS, 'OWNER', 'Acme')
    expect(out).toEqual({
      deleted: {
        memories: AI_DERIVED_PURGE_BATCH_SIZE + 7,
        sessionSummaries: 3,
        runSummaries: 4,
        claimSnapshots: 2,
        verdictTexts: 1,
      },
      done: true,
    })
    expect(repo.deleteMemoryBatch).toHaveBeenCalledTimes(2)
    expect(repo.deleteMemoryBatch).toHaveBeenCalledWith(
      'w1',
      AI_DERIVED_PURGE_BATCH_SIZE
    )
  })

  it('stops at the batch budget and says it is not done', async () => {
    repo.deleteMemoryBatch!.mockResolvedValue(AI_DERIVED_PURGE_BATCH_SIZE)
    const out = await aiDerivedContentService.purge(WS, 'OWNER', 'Acme')
    expect(out.done).toBe(false)
    expect(repo.deleteMemoryBatch).toHaveBeenCalledTimes(
      AI_DERIVED_PURGE_MAX_BATCHES
    )
    expect(repo.clearSessionSummaryBatch).not.toHaveBeenCalled()
    expect(repo.clearClaimSnapshotBatch).not.toHaveBeenCalled()
  })

  it('refuses a non-owner or a wrong name before touching anything', async () => {
    await expect(
      aiDerivedContentService.purge(WS, 'MEMBER', 'Acme')
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      aiDerivedContentService.purge(WS, 'OWNER', 'acme')
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.deleteMemoryBatch).not.toHaveBeenCalled()
  })
})
