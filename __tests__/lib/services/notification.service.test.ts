import { notificationService } from '@/lib/services/notification.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByRecipient = jest.fn()
const mockFindById = jest.fn()
const mockUpdateRead = jest.fn()
const mockMarkAllRead = jest.fn()
const mockDeleteById = jest.fn()
const mockBatchFetchTasksByIds = jest.fn()
const mockBatchFetchCommentsByIds = jest.fn()

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
  },
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
      expect(mockFindByRecipient).toHaveBeenCalledWith('actor-1', 'ws-1')
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
})
