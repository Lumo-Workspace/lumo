import {
  lineageOutcomeService,
  stampLineageInBackground,
} from '@/lib/services/lineage-outcome.service'

// ── Mock the repositories ───────────────────────────────────────────────────

const mockStampOutcomeByTask = jest.fn()
const mockStampDoneTaskEdges = jest.fn()

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    stampOutcomeByTask: (...args: any[]) => mockStampOutcomeByTask(...args),
    stampDoneTaskEdges: (...args: any[]) => mockStampDoneTaskEdges(...args),
  },
}))

// LUM-397: MERGED stamps derive strength from the verification log.
const mockHasAllPassRound = jest.fn()
const mockTaskIdsWithAllPassRound = jest.fn()

jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: {
    hasAllPassRound: (...args: any[]) => mockHasAllPassRound(...args),
    taskIdsWithAllPassRound: (...args: any[]) =>
      mockTaskIdsWithAllPassRound(...args),
  },
}))

// Capture the promise handed to waitUntil so the detach-and-swallow behavior
// can be asserted directly.
const waitUntilPromises: Array<Promise<unknown>> = []
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => {
    waitUntilPromises.push(p)
    return p
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockStampOutcomeByTask.mockResolvedValue({ count: 0 })
  mockStampDoneTaskEdges.mockResolvedValue({ count: 0 })
  mockHasAllPassRound.mockResolvedValue(false)
  mockTaskIdsWithAllPassRound.mockResolvedValue(new Set())
})

describe('lineageOutcomeService', () => {
  describe('stampForPrState', () => {
    it('stamps MERGED with derived strength when a PR reaches the merged state', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 2 })
      mockHasAllPassRound.mockResolvedValue(true)

      const result = await lineageOutcomeService.stampForPrState(
        't-1',
        'merged'
      )

      expect(result).toEqual({ count: 2 })
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED', {
        verified: true,
      })
    })

    it('stamps REJECTED when a PR is closed without merging — no strength derivation', async () => {
      await lineageOutcomeService.stampForPrState('t-1', 'closed')

      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'REJECTED')
      expect(mockHasAllPassRound).not.toHaveBeenCalled()
    })

    it('no-ops for a still-open PR without touching the repository', async () => {
      const result = await lineageOutcomeService.stampForPrState('t-1', 'open')

      expect(result).toEqual({ count: 0 })
      expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
    })

    it('no-ops for an unrecognized state', async () => {
      const result = await lineageOutcomeService.stampForPrState('t-1', 'draft')

      expect(result).toEqual({ count: 0 })
      expect(mockStampOutcomeByTask).not.toHaveBeenCalled()
    })
  })

  describe('stampForTaskDone', () => {
    it('stamps MERGED verified=true when the task has an all-PASS round', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 4 })
      mockHasAllPassRound.mockResolvedValue(true)

      const result = await lineageOutcomeService.stampForTaskDone('t-1')

      expect(result).toEqual({ count: 4 })
      expect(mockHasAllPassRound).toHaveBeenCalledWith('t-1')
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED', {
        verified: true,
      })
    })

    it('stamps MERGED verified=false when the task never recorded an all-PASS round', async () => {
      mockHasAllPassRound.mockResolvedValue(false)

      await lineageOutcomeService.stampForTaskDone('t-1')

      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED', {
        verified: false,
      })
    })
  })

  describe('stampForTaskReopened', () => {
    it('stamps REWORKED for the reopened task — strength untouched', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 1 })

      const result = await lineageOutcomeService.stampForTaskReopened('t-1')

      expect(result).toEqual({ count: 1 })
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'REWORKED')
      expect(mockHasAllPassRound).not.toHaveBeenCalled()
    })
  })

  describe('sweepDoneTaskEdges', () => {
    it('feeds the all-PASS task set into the repository sweep and returns its counts', async () => {
      mockTaskIdsWithAllPassRound.mockResolvedValue(new Set(['t-v1', 't-v2']))
      mockStampDoneTaskEdges.mockResolvedValue({
        count: 546,
        verifiedStamped: 12,
        unverifiedStamped: 534,
      })

      const result = await lineageOutcomeService.sweepDoneTaskEdges()

      expect(result).toEqual({
        count: 546,
        verifiedStamped: 12,
        unverifiedStamped: 534,
      })
      expect(mockStampDoneTaskEdges).toHaveBeenCalledWith(['t-v1', 't-v2'])
    })
  })

  describe('stampLineageInBackground', () => {
    it('runs the stamp against the service under waitUntil', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 3 })

      stampLineageInBackground(s => s.stampForTaskDone('t-1'))
      await Promise.all(waitUntilPromises.splice(0))

      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED', {
        verified: false,
      })
    })

    it('swallows a rejected stamp so the caller never sees the error', async () => {
      mockStampOutcomeByTask.mockRejectedValue(new Error('db down'))

      stampLineageInBackground(s => s.stampForTaskDone('t-1'))

      // The promise handed to waitUntil must resolve, not reject.
      await expect(
        Promise.all(waitUntilPromises.splice(0))
      ).resolves.toBeDefined()
    })
  })
})
