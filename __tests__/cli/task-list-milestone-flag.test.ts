/**
 * @jest-environment node
 */
import { resolveTaskListEndpoint } from '@/cli/src/commands/task-list'

describe('resolveTaskListEndpoint', () => {
  it('returns /api/tasks/me when no milestone is set', () => {
    expect(resolveTaskListEndpoint('http://x', undefined)).toBe(
      'http://x/api/tasks/me'
    )
  })

  it('returns the milestone-scoped endpoint with assigned=me when milestone is set', () => {
    expect(resolveTaskListEndpoint('http://x', 'm-1')).toBe(
      'http://x/api/milestones/m-1/tasks?assigned=me'
    )
  })
})
