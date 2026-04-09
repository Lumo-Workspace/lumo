/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    findByTaskId: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findByTaskId: jest.fn(),
  },
}))

import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { timelineService } from '@/lib/services/timeline.service'

const mockFindActivities = activityRepository.findByTaskId as jest.Mock
const mockFindComments = commentRepository.findByTaskId as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('timelineService.getTimeline', () => {
  it('merges activities and comments sorted by createdAt ASC', async () => {
    mockFindActivities.mockResolvedValue([
      {
        id: 'a1',
        type: 'STATUS_CHANGED',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        payload: { from: 'TODO', to: 'IN_PROGRESS' },
        actor: null,
      },
      {
        id: 'a2',
        type: 'ASSIGNEE_CHANGED',
        createdAt: new Date('2026-01-01T12:00:00Z'),
        payload: {},
        actor: null,
      },
    ])
    mockFindComments.mockResolvedValue([
      {
        id: 'c1',
        body: 'Hello',
        createdAt: new Date('2026-01-01T11:00:00Z'),
        authorActorId: 'actor-1',
        parentId: null,
        replies: [],
      },
    ])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items).toHaveLength(3)
    expect(result.items[0]!.id).toBe('a1')
    expect(result.items[0]!.kind).toBe('activity')
    expect(result.items[1]!.id).toBe('c1')
    expect(result.items[1]!.kind).toBe('comment')
    expect(result.items[2]!.id).toBe('a2')
    expect(result.items[2]!.kind).toBe('activity')
    expect(result.hasMore).toBe(false)
  })

  it('returns hasMore=true when activities exceed limit', async () => {
    const activities = Array.from({ length: 31 }, (_, i) => ({
      id: `a${i}`,
      type: 'STATUS_CHANGED',
      createdAt: new Date(
        `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`
      ),
      payload: {},
      actor: null,
    }))
    mockFindActivities.mockResolvedValue(activities)
    mockFindComments.mockResolvedValue([])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items.length).toBeLessThanOrEqual(30)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeDefined()
  })

  it('returns empty timeline for task with no activities or comments', async () => {
    mockFindActivities.mockResolvedValue([])
    mockFindComments.mockResolvedValue([])

    const result = await timelineService.getTimeline('task-1', { limit: 30 })

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })
})
