/**
 * @jest-environment node
 */
import { formatDeleteRefusal } from '@/cli/src/commands/sprint-delete'

describe('formatDeleteRefusal', () => {
  it('refuses with task count', () => {
    expect(formatDeleteRefusal(3, 'Sprint 3', 5)).toBe(
      'Refusing to delete sprint #3 "Sprint 3" without --yes.\n' +
        '5 tasks under it will keep their data; only sprintId is cleared.\n' +
        'Re-run with --yes to confirm.'
    )
  })

  it('omits task line when zero', () => {
    expect(formatDeleteRefusal(4, 'Sprint 4', 0)).toBe(
      'Refusing to delete sprint #4 "Sprint 4" without --yes.\n' +
        'Re-run with --yes to confirm.'
    )
  })
})
