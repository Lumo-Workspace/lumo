import { notificationService } from '@/lib/services/notification.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByRecipient = jest.fn()
const mockFindById = jest.fn()
const mockUpdateRead = jest.fn()
const mockMarkAllRead = jest.fn()
const mockDeleteById = jest.fn()
const mockBatchFetchTasksByIds = jest.fn()
const mockBatchFetchCommentsByIds = jest.fn()
const mockBatchFetchSprintsByIds = jest.fn()
const mockBatchFetchProjectsByIds = jest.fn()
const mockBatchFetchMilestonesByIds = jest.fn()
const mockBatchFetchDocumentsByIds = jest.fn()

jest.mock('@/lib/repositories/notification.repository', () => ({
  notificationRepository: {
    findByRecipient: (...args: any[]) => mockFindByRecipient(...args),
    findById: (...args: any[]) => mockFindById(...args),
    updateRead: (...args: any[]) => mockUpdateRead(...args),
    markAllRead: (...args: any[]) => mockMarkAllRead(...args),
    deleteById: (...args: any[]) => mockDeleteById(...args),
    batchFetchTasksByIds: (...args: any[]) => mockBatchFetchTasksByIds(...args),
    batchFetchCommentsByIds: (...args: any[]) =>
      mockBatchFetchCommentsByIds(...args),
    batchFetchSprintsByIds: (...args: any[]) =>
      mockBatchFetchSprintsByIds(...args),
    batchFetchProjectsByIds: (...args: any[]) =>
      mockBatchFetchProjectsByIds(...args),
    batchFetchMilestonesByIds: (...args: any[]) =>
      mockBatchFetchMilestonesByIds(...args),
    batchFetchDocumentsByIds: (...args: any[]) =>
      mockBatchFetchDocumentsByIds(...args),
  },
}))

// enrichNotifications calls clerkClient() for HUMAN trigger actors. Stub it out
// so the tests that exercise entity-reference serialization don't hit Clerk.
jest.mock('@/lib/auth/users', () => ({
  getUserDirectory: async () => ({ getUserList: async () => ({ data: [] }) }),
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('notificationService', () => {
  describe('getNotifications', () => {
    it('returns notifications sorted with actionable first', async () => {
      const now = new Date()
      const earlier = new Date(now.getTime() - 1000)
      mockFindByRecipient.mockResolvedValue([
        {
          id: 'n1',
          requiresAction: false,
          actionTakenAt: null,
          createdAt: now,
        },
        {
          id: 'n2',
          requiresAction: true,
          actionTakenAt: null,
          createdAt: earlier,
        },
      ])

      const result = await notificationService.getNotifications(
        'actor-1',
        'ws-1'
      )

      expect(result[0]!.id).toBe('n2') // actionable first
      expect(result[1]!.id).toBe('n1')
      expect(mockFindByRecipient).toHaveBeenCalledWith('actor-1', 'ws-1', {})
    })

    it('LUM-1233: passes unreadOnly through to the repository', async () => {
      mockFindByRecipient.mockResolvedValue([])
      await notificationService.getNotifications('actor-1', 'ws-1', {
        unreadOnly: true,
      })
      expect(mockFindByRecipient).toHaveBeenCalledWith('actor-1', 'ws-1', {
        unreadOnly: true,
      })
    })

    it('returns empty array when no notifications', async () => {
      mockFindByRecipient.mockResolvedValue([])

      const result = await notificationService.getNotifications(
        'actor-1',
        'ws-1'
      )

      expect(result).toEqual([])
    })
  })

  describe('updateRead', () => {
    it('updates read status when user owns notification', async () => {
      mockFindById.mockResolvedValue({
        id: 'n1',
        recipientActorId: 'actor-1',
      })
      mockUpdateRead.mockResolvedValue(undefined)

      await notificationService.updateRead('n1', 'actor-1', true)

      expect(mockUpdateRead).toHaveBeenCalledWith('n1', true)
    })

    it('throws 404 when notification not found', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        notificationService.updateRead('nonexistent', 'actor-1', true)
      ).rejects.toMatchObject({ message: 'Not found', status: 404 })
    })

    it('throws 403 when user does not own notification', async () => {
      mockFindById.mockResolvedValue({
        id: 'n1',
        recipientActorId: 'other-actor',
      })

      await expect(
        notificationService.updateRead('n1', 'actor-1', true)
      ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
    })
  })

  describe('markAllRead', () => {
    it('delegates to repository', async () => {
      mockMarkAllRead.mockResolvedValue({ count: 5 })

      await notificationService.markAllRead('actor-1', 'ws-1')

      expect(mockMarkAllRead).toHaveBeenCalledWith('actor-1', 'ws-1')
    })
  })

  describe('deleteNotification', () => {
    it('deletes when user owns notification', async () => {
      mockFindById.mockResolvedValue({
        id: 'n1',
        recipientActorId: 'actor-1',
      })
      mockDeleteById.mockResolvedValue(undefined)

      await notificationService.deleteNotification('n1', 'actor-1')

      expect(mockDeleteById).toHaveBeenCalledWith('n1')
    })

    it('throws 404 when notification not found', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        notificationService.deleteNotification('nonexistent', 'actor-1')
      ).rejects.toMatchObject({ message: 'Not found', status: 404 })
    })

    it('throws 403 when user does not own notification', async () => {
      mockFindById.mockResolvedValue({
        id: 'n1',
        recipientActorId: 'other-actor',
      })

      await expect(
        notificationService.deleteNotification('n1', 'actor-1')
      ).rejects.toMatchObject({ message: 'Forbidden', status: 403 })
    })
  })

  describe('batchFetchRelatedData', () => {
    it('fetches all related data in parallel', async () => {
      mockBatchFetchTasksByIds.mockResolvedValue([
        { id: 'task-1', title: 'T1', number: 1, team: { identifier: 'ENG' } },
      ])
      mockBatchFetchCommentsByIds.mockResolvedValue([
        { id: 'com-1', body: '<p>Hello</p>' },
      ])

      const result = await notificationService.batchFetchRelatedData(
        ['task-1'],
        ['com-1']
      )

      expect(result.taskMap.get('task-1')).toBeDefined()
      expect(result.commentMap.get('com-1')).toBe('<p>Hello</p>')
    })

    it('skips fetch for empty ID arrays', async () => {
      const result = await notificationService.batchFetchRelatedData([], [])

      expect(mockBatchFetchTasksByIds).not.toHaveBeenCalled()
      expect(mockBatchFetchCommentsByIds).not.toHaveBeenCalled()
      expect(result.taskMap.size).toBe(0)
      expect(result.commentMap.size).toBe(0)
    })
  })

  describe('enrichNotifications', () => {
    const baseRow = {
      read: false,
      requiresAction: false,
      actionTakenAt: null,
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      taskId: null,
      commentId: null,
      clarifyId: null,
      sprintId: null,
      projectId: null,
      milestoneId: null,
      documentId: null,
      triggerActorId: null,
      trigger: null,
    }

    beforeEach(() => {
      mockBatchFetchTasksByIds.mockResolvedValue([])
      mockBatchFetchCommentsByIds.mockResolvedValue([])
      mockBatchFetchSprintsByIds.mockResolvedValue([])
      mockBatchFetchProjectsByIds.mockResolvedValue([])
      mockBatchFetchMilestonesByIds.mockResolvedValue([])
      mockBatchFetchDocumentsByIds.mockResolvedValue([])
    })

    it('serializes a PROJECT_MENTIONED row into project { id, name, url }', async () => {
      mockBatchFetchProjectsByIds.mockResolvedValue([
        { id: 'proj-1', name: 'Apollo', workspace: { slug: 'acme' } },
      ])

      const [out] = await notificationService.enrichNotifications([
        {
          ...baseRow,
          id: 'n1',
          type: 'PROJECT_MENTIONED',
          projectId: 'proj-1',
        },
      ] as any)

      expect(mockBatchFetchProjectsByIds).toHaveBeenCalledWith(['proj-1'])
      expect(out!.projectId).toBe('proj-1')
      expect(out!.project).toMatchObject({ id: 'proj-1', name: 'Apollo' })
      expect(out!.project!.url).toContain('/projects/apollo')
    })

    it('serializes a MILESTONE_MENTIONED row into milestone { id, name, url }', async () => {
      mockBatchFetchMilestonesByIds.mockResolvedValue([
        {
          id: 'ms-1',
          name: 'Beta',
          slug: 'beta-1',
          project: { name: 'Apollo', workspace: { slug: 'acme' } },
        },
      ])

      const [out] = await notificationService.enrichNotifications([
        {
          ...baseRow,
          id: 'n2',
          type: 'MILESTONE_MENTIONED',
          milestoneId: 'ms-1',
        },
      ] as any)

      expect(mockBatchFetchMilestonesByIds).toHaveBeenCalledWith(['ms-1'])
      expect(out!.milestoneId).toBe('ms-1')
      expect(out!.milestone).toMatchObject({ id: 'ms-1', name: 'Beta' })
      expect(out!.milestone!.url).toContain('/milestones/beta-1')
    })

    it('serializes a DOCUMENT_COMMENT_MENTIONED row into document { id, title, url }', async () => {
      mockBatchFetchDocumentsByIds.mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Spec',
          slug: 'spec-7',
          workspace: { slug: 'acme' },
        },
      ])

      const [out] = await notificationService.enrichNotifications([
        {
          ...baseRow,
          id: 'n3',
          type: 'DOCUMENT_COMMENT_MENTIONED',
          documentId: 'doc-1',
        },
      ] as any)

      expect(mockBatchFetchDocumentsByIds).toHaveBeenCalledWith(['doc-1'])
      expect(out!.documentId).toBe('doc-1')
      expect(out!.document).toMatchObject({ id: 'doc-1', title: 'Spec' })
      expect(out!.document!.url).toContain('/documents/spec-7')
    })

    it('leaves entity refs null when no id is present', async () => {
      const [out] = await notificationService.enrichNotifications([
        { ...baseRow, id: 'n4', type: 'TASK_DONE' },
      ] as any)

      expect(out!.project).toBeNull()
      expect(out!.milestone).toBeNull()
      expect(out!.document).toBeNull()
      expect(mockBatchFetchProjectsByIds).not.toHaveBeenCalled()
      expect(mockBatchFetchMilestonesByIds).not.toHaveBeenCalled()
      expect(mockBatchFetchDocumentsByIds).not.toHaveBeenCalled()
    })
  })
})
