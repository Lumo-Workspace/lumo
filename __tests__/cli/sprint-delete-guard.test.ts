/**
 * @jest-environment node
 */
import { describeSprintDelete } from '@/cli/src/commands/sprint-delete'

describe('describeSprintDelete (confirmation envelope changes[])', () => {
  it('lists the sprint and the task-impact line', () => {
    expect(describeSprintDelete(3, 'Sprint 3', 5)).toEqual([
      'Will delete sprint #3 "Sprint 3"',
      '5 tasks under it keep their data; only sprintId is cleared',
    ])
  })

  it('omits the task line when zero', () => {
    expect(describeSprintDelete(4, 'Sprint 4', 0)).toEqual([
      'Will delete sprint #4 "Sprint 4"',
    ])
  })
})
