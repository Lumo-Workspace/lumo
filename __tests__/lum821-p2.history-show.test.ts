/**
 * @jest-environment node
 *
 * LUM-821 e2e findings, pinned: (1) incremental tag add/remove now records
 * TAGS_CHANGED (it left no history before); (2) `task show` survives a Clerk
 * profile lookup failure instead of reporting the task as not found.
 */
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn(), getTaskDetail: jest.fn() },
}))
jest.mock('@/lib/services/auth.service', () => ({
  authService: { fetchUserProfile: jest.fn() },
}))

import { buildActivityEvents } from '@/lib/services/task-notifications.service'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskService } from '@/lib/services/task.service'
import { authService } from '@/lib/services/auth.service'

type Args = Parameters<typeof buildActivityEvents>
const result = (tags: string[]) =>
  ({
    task: { tags: tags.map(name => ({ name })) },
    changedFields: [],
    oldStatus: 'TODO',
  }) as unknown as Args[3]
const check = (tags: string[]) =>
  ({ tags: tags.map(name => ({ name })) }) as unknown as Args[4]

describe('TAGS_CHANGED for incremental tag edits', () => {
  it('--add-tag records the added tag', () => {
    const events = buildActivityEvents(
      't1',
      'p1',
      { addTagIds: ['tg-infra'] },
      result(['bug', 'infra']),
      check(['bug']),
      'a1'
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'task:tags_changed',
        added: ['infra'],
        removed: [],
      }),
    ])
  })

  it('--remove-tag records the removed tag', () => {
    const events = buildActivityEvents(
      't1',
      'p1',
      { removeTagIds: ['tg-bug'] },
      result([]),
      check(['bug']),
      'a1'
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'task:tags_changed',
        added: [],
        removed: ['bug'],
      }),
    ])
  })

  it('an incremental no-op (tag already attached) records nothing', () => {
    const events = buildActivityEvents(
      't1',
      'p1',
      { addTagIds: ['tg-bug'] },
      result(['bug']),
      check(['bug']),
      'a1'
    )
    expect(events).toEqual([])
  })
})

describe('showFromCli with an unreachable Clerk profile', () => {
  it('returns the task with a degraded assignee label, not a 404', async () => {
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 't4',
      identifier: 'E2E-4',
    })
    ;(taskService.getTaskDetail as jest.Mock).mockResolvedValue({
      id: 't4',
      title: 'Spike',
      status: 'TODO',
      priority: 'LOW',
      description: null,
      sprintId: null,
      teamId: 'team',
      project: { id: 'p', name: 'Core' },
      assignee: { type: 'HUMAN', member: { clerkId: 'user_gone' } },
      pullRequests: [],
      dueDate: null,
      parent: null,
      children: [],
    })
    ;(authService.fetchUserProfile as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    )
    const r = await taskCliService.showFromCli({
      workspaceId: 'ws',
      workspaceSlug: 'ws',
      identifier: 'E2E-4',
    })
    expect(r.title).toBe('Spike')
    expect(r.assignee).toEqual({
      type: 'member',
      label: '(unknown member)',
      email: null,
    })
  })
})
