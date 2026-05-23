/**
 * @jest-environment node
 */
import { formatDeleteRefusal } from '@/cli/src/commands/milestone-delete'

describe('formatDeleteRefusal', () => {
  it('lists task impact for safety', () => {
    expect(formatDeleteRefusal('Q3 Launch', 12)).toBe(
      'Refusing to delete milestone "Q3 Launch" without --yes.\n' +
        '12 tasks under it will keep their data; only milestoneId is cleared.\n' +
        'Re-run with --yes to confirm.'
    )
  })

  it('omits the "tasks" line when count is zero', () => {
    expect(formatDeleteRefusal('Empty', 0)).toBe(
      'Refusing to delete milestone "Empty" without --yes.\n' +
        'Re-run with --yes to confirm.'
    )
  })
})
