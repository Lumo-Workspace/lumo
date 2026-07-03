/**
 * @jest-environment node
 */
// LUM-650 — getWeightedProgressForMilestone joins per-task status rows to the
// batched TaskComplexity rows: a task without a complexity row is passed to the
// pure fold as `changedFileCount: null` (unmeasured), never a 0.
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { taskStatusRows: jest.fn() },
}))
jest.mock('@/lib/repositories/task-complexity.repository', () => ({
  taskComplexityRepository: { listByTaskIds: jest.fn() },
}))

import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskComplexityRepository } from '@/lib/repositories/task-complexity.repository'

const statusRows = milestoneRepository.taskStatusRows as jest.Mock
const listComplexity = taskComplexityRepository.listByTaskIds as jest.Mock

beforeEach(() => {
  statusRows.mockReset()
  listComplexity.mockReset()
})

describe('milestoneService.getWeightedProgressForMilestone', () => {
  it('joins status to complexity and leaves unmeasured tasks out of the sums', async () => {
    statusRows.mockResolvedValue([
      { id: 't1', status: 'DONE' },
      { id: 't2', status: 'IN_PROGRESS' },
      { id: 't3', status: 'DONE' }, // no complexity row → unmeasured
    ])
    listComplexity.mockResolvedValue([
      { taskId: 't1', changedFileCount: 8 },
      { taskId: 't2', changedFileCount: 2 },
    ])

    const r = await milestoneService.getWeightedProgressForMilestone('m-1')

    // done weight = 8 (t1), total measured weight = 10 (t1 + t2). t3 is
    // unmeasured — excluded from both sums, but counted against coverage.
    expect(r.doneWeight).toBe(8)
    expect(r.totalWeight).toBe(10)
    expect(r.pct).toBe(80)
    expect(r.measuredTasks).toBe(2)
    expect(r.totalTasks).toBe(3)
    expect(listComplexity).toHaveBeenCalledWith(['t1', 't2', 't3'])
  })

  it('reports a null pct (Unavailable) when no task has a complexity row', async () => {
    statusRows.mockResolvedValue([
      { id: 't1', status: 'DONE' },
      { id: 't2', status: 'TODO' },
    ])
    listComplexity.mockResolvedValue([])

    const r = await milestoneService.getWeightedProgressForMilestone('m-1')
    expect(r.pct).toBeNull()
    expect(r.measuredTasks).toBe(0)
    expect(r.totalTasks).toBe(2)
  })
})
