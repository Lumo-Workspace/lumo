/**
 * @jest-environment node
 */
import { assertSameTeam } from '@/cli/src/commands/task-create'

describe('assertSameTeam', () => {
  it('does not throw when team IDs match', () => {
    expect(() =>
      assertSameTeam(
        { teamId: 'team-abc', identifier: 'LUM-1' },
        { id: 'sp-1', number: 3, name: 'Sprint 3', teamId: 'team-abc' }
      )
    ).not.toThrow()
  })

  it('throws with the expected mismatch message when team IDs differ', () => {
    expect(() =>
      assertSameTeam(
        { teamId: 'team-xyz', identifier: 'LUM-1' },
        { id: 'sp-1', number: 5, name: 'Sprint 5', teamId: 'team-abc' }
      )
    ).toThrow(
      'Sprint binding skipped: sprint #5 belongs to a different team than LUM-1'
    )
  })
})
