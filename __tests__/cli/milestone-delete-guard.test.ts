/**
 * @jest-environment node
 */
import { describeMilestoneDelete } from '@/cli/src/commands/milestone-delete'

describe('describeMilestoneDelete (confirmation envelope changes[])', () => {
  it('lists task impact for safety', () => {
    expect(describeMilestoneDelete('Q3 Launch', 12)).toEqual([
      'Will delete milestone "Q3 Launch"',
      '12 tasks under it keep their data; only milestoneId is cleared',
    ])
  })

  it('omits the "tasks" line when count is zero', () => {
    expect(describeMilestoneDelete('Empty', 0)).toEqual([
      'Will delete milestone "Empty"',
    ])
  })
})
