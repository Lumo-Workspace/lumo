/**
 * @jest-environment node
 */
import { buildTaskListPath } from '@/cli/src/commands/task-list'

// LUM-1093: `task list` always pages through GET /api/tasks/me; --milestone
// is now a server-side filter there instead of the milestone tasks route.
describe('buildTaskListPath', () => {
  it('sends only the page when no filter is set', () => {
    expect(buildTaskListPath({}, { limit: 50, offset: 0 })).toBe(
      '/api/tasks/me?limit=50'
    )
  })

  it('scopes to the milestone server-side when --milestone is set', () => {
    const u = new URL(
      `http://x${buildTaskListPath({ milestoneId: 'm-1' }, { limit: 50, offset: 0 })}`
    )
    expect(u.pathname).toBe('/api/tasks/me')
    expect(u.searchParams.get('milestoneIds')).toBe('m-1')
  })
})
