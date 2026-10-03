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
})

describe('lineageOutcomeService', () => {
  describe('stampForPrState', () => {
    it('stamps MERGED when a PR reaches the merged state', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 2 })

      const result = await lineageOutcomeService.stampForPrState(
        't-1',
        'merged'
      )

      expect(result).toEqual({ count: 2 })
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED')
    })

    it('stamps REJECTED when a PR is closed without merging', async () => {
      await lineageOutcomeService.stampForPrState('t-1', 'closed')

      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'REJECTED')
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
    it('stamps MERGED when the task reaches DONE', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 4 })

      const result = await lineageOutcomeService.stampForTaskDone('t-1')

      expect(result).toEqual({ count: 4 })
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED')
    })
  })

  describe('stampForTaskReopened', () => {
    it('stamps REWORKED for the reopened task', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 1 })

      const result = await lineageOutcomeService.stampForTaskReopened('t-1')

      expect(result).toEqual({ count: 1 })
      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'REWORKED')
    })
  })

  describe('sweepDoneTaskEdges', () => {
    it('delegates to the repository sweep and returns its count', async () => {
      mockStampDoneTaskEdges.mockResolvedValue({ count: 546 })

      const result = await lineageOutcomeService.sweepDoneTaskEdges()

      expect(result).toEqual({ count: 546 })
      expect(mockStampDoneTaskEdges).toHaveBeenCalledWith()
    })
  })

  describe('stampLineageInBackground', () => {
    it('runs the stamp against the service under waitUntil', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 3 })

      stampLineageInBackground(s => s.stampForTaskDone('t-1'))
      await Promise.all(waitUntilPromises.splice(0))

      expect(mockStampOutcomeByTask).toHaveBeenCalledWith('t-1', 'MERGED')
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
