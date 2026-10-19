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

const mockFindLabelFields = jest.fn()
jest.mock('@/lib/repositories/actor.repository', () => ({
  actorRepository: {
    findLabelFieldsByIds: (...a: unknown[]) => mockFindLabelFields(...a),
  },
}))
const mockProfiles = jest.fn()
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: (...a: unknown[]) => mockProfiles(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { activityRepository } from '@/lib/repositories/activity.repository'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { timelineService } from '@/lib/services/timeline.service'

const mockFindActivities = activityRepository.findByTaskId as jest.Mock
const mockFindComments = commentRepository.findByTaskId as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockFindLabelFields.mockResolvedValue([])
  mockProfiles.mockResolvedValue(new Map())
})

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

    const result = await timelineService.getTimeline('task-1', {
      limit: 30,
      workspaceId: 'ws-1',
    })

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

    const result = await timelineService.getTimeline('task-1', {
      limit: 30,
      workspaceId: 'ws-1',
    })

    expect(result.items.length).toBeLessThanOrEqual(30)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeDefined()
  })

  it('returns empty timeline for task with no activities or comments', async () => {
    mockFindActivities.mockResolvedValue([])
    mockFindComments.mockResolvedValue([])

    const result = await timelineService.getTimeline('task-1', {
      limit: 30,
      workspaceId: 'ws-1',
    })

    expect(result.items).toEqual([])
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeNull()
  })

  it('LUM-1238: comment entries and their replies carry authorName from the caller workspace', async () => {
    mockFindActivities.mockResolvedValue([])
    mockFindComments.mockResolvedValue([
      {
        id: 'c1',
        body: 'scan',
        createdAt: new Date('2026-01-01T11:00:00Z'),
        authorActorId: 'gh-bot',
        parentId: null,
        replies: [
          {
            id: 'r1',
            body: 'reply',
            createdAt: new Date('2026-01-01T11:05:00Z'),
            authorActorId: 'member-1',
            parentId: 'c1',
          },
        ],
      },
      {
        id: 'c2',
        body: 'orphan',
        createdAt: new Date('2026-01-01T12:00:00Z'),
        authorActorId: 'gone',
        parentId: null,
        replies: [],
      },
    ])
    mockFindLabelFields.mockResolvedValue([
      {
        id: 'gh-bot',
        type: 'GITHUB_USER',
        externalIdentity: 'github:uselumo[bot]',
        member: null,
        agent: null,
      },
      {
        id: 'member-1',
        type: 'MEMBER',
        externalIdentity: null,
        member: { clerkId: 'u1' },
        agent: null,
      },
    ])
    mockProfiles.mockResolvedValue(new Map([['u1', { name: 'Chao Li' }]]))

    const result = await timelineService.getTimeline('task-1', {
      limit: 30,
      workspaceId: 'ws-1',
    })

    expect(mockFindLabelFields).toHaveBeenCalledWith('ws-1', [
      'gh-bot',
      'member-1',
      'gone',
    ])
    const c1 = result.items.find(i => i.id === 'c1')!
    expect(c1.authorName).toBe('@uselumo[bot]')
    expect((c1.replies as { authorName: unknown }[])[0]!.authorName).toBe(
      'Chao Li'
    )
    expect(result.items.find(i => i.id === 'c2')!.authorName).toBeNull()
  })

  it('LUM-1238: only looks up authors of comments on the returned page', async () => {
    mockFindActivities.mockResolvedValue([])
    mockFindComments.mockResolvedValue([
      {
        id: 'c1',
        body: 'first',
        createdAt: new Date('2026-01-01T10:00:00Z'),
        authorActorId: 'on-page',
        parentId: null,
        replies: [
          {
            id: 'r1',
            body: 'reply',
            createdAt: new Date('2026-01-01T10:01:00Z'),
            authorActorId: 'reply-author',
            parentId: 'c1',
          },
        ],
      },
      {
        id: 'c2',
        body: 'later',
        createdAt: new Date('2026-01-02T10:00:00Z'),
        authorActorId: 'next-page',
        parentId: null,
        replies: [],
      },
    ])

    const result = await timelineService.getTimeline('task-1', {
      limit: 1,
      workspaceId: 'ws-1',
    })

    expect(result.items.map(i => i.id)).toEqual(['c1'])
    expect(mockFindLabelFields).toHaveBeenCalledTimes(1)
    expect(mockFindLabelFields).toHaveBeenCalledWith('ws-1', [
      'on-page',
      'reply-author',
    ])
  })
})
