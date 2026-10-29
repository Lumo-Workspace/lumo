/**
 * @jest-environment node
 *
 * LUM-1303: decisions moved over from a description get their task's
 * assignee as author when that is a member; others stay unknown.
 */
jest.mock('@/lib/repositories/task-decision.repository', () => ({
  taskDecisionRepository: {
    listUnattributed: jest.fn(),
    setAuthorIfUnset: jest.fn(),
  },
}))

import { taskDecisionRepository as repo } from '@/lib/repositories/task-decision.repository'
import { backfillDecisionAuthors } from '@/lib/services/task-decision-author-backfill.service'

const row = (id: string, memberId: string | null | undefined) => ({
  id,
  workspaceId: 'ws_1',
  task: {
    assignee: memberId === undefined ? null : { memberId },
  },
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(repo.listUnattributed as jest.Mock)
    .mockResolvedValueOnce([
      row('d1', 'mem_1'), // member assignee
      row('d2', null), // agent / GitHub assignee (no member)
    ])
    .mockResolvedValueOnce([row('d3', undefined)]) // no assignee
    .mockResolvedValue([])
  ;(repo.setAuthorIfUnset as jest.Mock).mockResolvedValue(true)
})

describe('backfillDecisionAuthors', () => {
  it('dry run counts and writes nothing', async () => {
    expect(
      await backfillDecisionAuthors({ dryRun: true, pageSize: 2 })
    ).toEqual({ candidates: 3, attributed: 1, noMemberAssignee: 2 })
    expect(repo.setAuthorIfUnset).not.toHaveBeenCalled()
  })

  it('sets only a member assignee, and pages by the last id', async () => {
    await backfillDecisionAuthors({ dryRun: false, pageSize: 2 })
    expect(repo.setAuthorIfUnset).toHaveBeenCalledTimes(1)
    expect(repo.setAuthorIfUnset).toHaveBeenCalledWith('d1', 'ws_1', 'mem_1')
    expect((repo.listUnattributed as jest.Mock).mock.calls).toEqual([
      [null, 2],
      ['d2', 2],
    ])
  })

  it('does not count a decision someone attributed in the meantime', async () => {
    ;(repo.setAuthorIfUnset as jest.Mock).mockResolvedValue(false)
    expect(
      await backfillDecisionAuthors({ dryRun: false, pageSize: 2 })
    ).toMatchObject({ attributed: 0 })
  })
})
