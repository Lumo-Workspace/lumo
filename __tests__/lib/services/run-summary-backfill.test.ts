/**
 * @jest-environment node
 *
 * LUM-576 — runSummaryBackfillService: one-time regeneration of run-summaries
 * for historical completed tasks whose qualified sessions lost their runSummary
 * to the old fire-and-forget waitUntil path. Selects only completed tasks with
 * a qualified-but-missing session, regenerates per task, and is idempotent.
 */
import { runSummaryBackfillService } from '@/lib/services/run-summary-backfill'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { runSummaryService } from '@/lib/services/run-summary.service'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listCompletedTaskIdsMissingRunSummary: jest.fn(),
  },
}))

jest.mock('@/lib/services/run-summary.service', () => ({
  runSummaryService: { generateForTask: jest.fn() },
}))

const mList =
  sessionRepository.listCompletedTaskIdsMissingRunSummary as jest.Mock
const mGenerate = runSummaryService.generateForTask as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('run-summary backfill (LUM-576)', () => {
  it('backfill regenerates once per selected completed task', async () => {
    mList.mockResolvedValue(['t1', 't2'])
    mGenerate
      .mockResolvedValueOnce({
        generated: 1,
        failed: 0,
        skippedEmpty: 0,
        degraded: false,
      })
      .mockResolvedValueOnce({
        generated: 2,
        failed: 1,
        skippedEmpty: 0,
        degraded: true,
      })

    const result = await runSummaryBackfillService.backfillCompletedTasks()

    expect(mGenerate).toHaveBeenCalledTimes(2)
    expect(mGenerate).toHaveBeenCalledWith('t1')
    expect(mGenerate).toHaveBeenCalledWith('t2')
    expect(result).toEqual({
      candidateTasks: 2,
      generated: 3,
      failed: 1,
      degradedTasks: 1,
    })
  })

  it('backfill dry-run selects candidates but generates nothing', async () => {
    mList.mockResolvedValue(['t1', 't2'])

    const result = await runSummaryBackfillService.backfillCompletedTasks({
      dryRun: true,
    })

    expect(mGenerate).not.toHaveBeenCalled()
    expect(result.candidateTasks).toBe(2)
    expect(result.generated).toBe(0)
  })

  it('backfill is idempotent — an empty selection (second pass) does nothing', async () => {
    mList.mockResolvedValue([])

    const result = await runSummaryBackfillService.backfillCompletedTasks()

    expect(mGenerate).not.toHaveBeenCalled()
    expect(result).toEqual({
      candidateTasks: 0,
      generated: 0,
      failed: 0,
      degradedTasks: 0,
    })
  })
})
