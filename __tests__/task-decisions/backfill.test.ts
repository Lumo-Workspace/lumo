/**
 * @jest-environment node
 *
 * LUM-1303: the one-time move of description `## Decisions` sections into the
 * task_decisions table.
 */
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: {
    listTasksWithDecisionsHeading: jest.fn(),
    moveFromDescription: jest.fn(),
  },
}))

import { taskDecisionRepository as repo } from '@/lib/repositories/task-decision.repository'
import { backfillTaskDecisions } from '@/lib/services/task-decision-backfill.service'

const updatedAt = new Date('2026-10-20T08:00:00Z')
const withSection = {
  id: 't1',
  workspaceId: 'ws_1',
  description:
    '<p>body</p><h2>Decisions</h2><ul><li><p>2026-10-04 a</p></li><li><p>2026-10-04 b</p></li><li><p>c</p></li></ul>',
  updatedAt,
}
// Matches the text prefilter but has no real section heading.
const falsePositive = {
  id: 't2',
  workspaceId: 'ws_1',
  description: '<p>see decisions</h2>?</p>',
  updatedAt,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(repo.listTasksWithDecisionsHeading as jest.Mock)
    .mockResolvedValueOnce([withSection, falsePositive])
    .mockResolvedValue([])
  ;(repo.moveFromDescription as jest.Mock).mockResolvedValue(true)
})

describe('backfillTaskDecisions', () => {
  it('dry run counts and writes nothing', async () => {
    expect(await backfillTaskDecisions({ dryRun: true })).toEqual({
      tasks: 1,
      decisions: 3,
      skippedConcurrentEdit: 0,
    })
    expect(repo.moveFromDescription).not.toHaveBeenCalled()
  })

  it('moves the rows, keeping order (same-day lines a second apart; undated → last update)', async () => {
    await backfillTaskDecisions({ dryRun: false })
    expect(repo.moveFromDescription).toHaveBeenCalledTimes(1)
    expect(repo.moveFromDescription).toHaveBeenCalledWith({
      taskId: 't1',
      workspaceId: 'ws_1',
      expectedDescription: withSection.description,
      description: '<p>body</p>',
      decisions: [
        { text: 'a', createdAt: new Date('2026-10-04T12:00:00Z') },
        { text: 'b', createdAt: new Date('2026-10-04T12:00:01Z') },
        { text: 'c', createdAt: new Date(updatedAt.getTime() + 2000) },
      ],
    })
  })

  it('counts a task whose description changed mid-run as skipped', async () => {
    ;(repo.moveFromDescription as jest.Mock).mockResolvedValue(false)
    expect(await backfillTaskDecisions({ dryRun: false })).toMatchObject({
      skippedConcurrentEdit: 1,
    })
  })
})
