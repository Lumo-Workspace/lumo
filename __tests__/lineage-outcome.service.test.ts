/**
 * @jest-environment node
 *
 * LUM-598 — reopen-after-MERGED folds into the post-hoc outcome well.
 *
 * When a DONE task is reopened, the existing lineage path stamps its edges
 * REWORKED. That same transition is a post-hoc REJECTION — reality made the
 * user redo the delivery — so it is also captured in the well as a first-class
 * REOPENED signal, anchored to the lineage fact (an agent cannot construct it).
 */

const mockUpdateMany = jest.fn(async (..._a: unknown[]) => ({ count: 1 }))
const mockTaskFindUnique = jest.fn(async (..._a: unknown[]) => ({
  id: 'reopened-task',
  project: { workspaceId: 'ws-1' },
}))
const mockSignalCreate = jest.fn(
  async (arg: { data: Record<string, unknown> }) => ({
    id: 'sig1',
    ...arg.data,
  })
)

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    lineageEdge: { updateMany: (...a: unknown[]) => mockUpdateMany(...a) },
    task: { findUnique: (...a: unknown[]) => mockTaskFindUnique(...a) },
    outcomeSignal: {
      create: (arg: { data: Record<string, unknown> }) => mockSignalCreate(arg),
    },
  },
}))

import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'

beforeEach(() => {
  mockUpdateMany.mockClear()
  mockSignalCreate.mockClear()
})

describe('lineage outcome — reopen folds into the well', () => {
  it('reopen after MERGED writes a REOPENED outcome signal', async () => {
    await lineageOutcomeService.stampForTaskReopened('reopened-task')

    // The existing lineage stamp still runs (REWORKED).
    expect(mockUpdateMany).toHaveBeenCalledTimes(1)

    // And the well captures the rejection as a REOPENED / LINEAGE signal.
    expect(mockSignalCreate).toHaveBeenCalledTimes(1)
    const arg = mockSignalCreate.mock.calls[0]![0]
    expect(arg.data).toMatchObject({
      taskId: 'reopened-task',
      kind: 'REOPENED',
      source: 'LINEAGE',
      workspaceId: 'ws-1',
    })
  })
})
