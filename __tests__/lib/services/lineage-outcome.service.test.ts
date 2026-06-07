import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'

// ── Mock the repository ─────────────────────────────────────────────────────

const mockStampOutcomeByTask = jest.fn()

jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    stampOutcomeByTask: (...args: any[]) => mockStampOutcomeByTask(...args),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockStampOutcomeByTask.mockResolvedValue({ count: 0 })
})

describe('lineageOutcomeService', () => {
  describe('stampForPrState', () => {
    it('stamps MERGED when a PR reaches the merged state', async () => {
      mockStampOutcomeByTask.mockResolvedValue({ count: 2 })

      const result = await lineageOutcomeService.stampForPrState('t-1', 'merged')

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
    it('stamps MERGED for the completed task', async () => {
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
})
