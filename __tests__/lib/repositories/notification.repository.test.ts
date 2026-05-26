import { notificationRepository } from '@/lib/repositories/notification.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockNotificationFindMany = jest.fn()
const mockNotificationFindUnique = jest.fn()
const mockNotificationUpdate = jest.fn()
const mockNotificationUpdateMany = jest.fn()
const mockNotificationDelete = jest.fn()

const mockClarifyFindFirst = jest.fn()
const mockClarifyFindUnique = jest.fn()
const mockClarifyFindMany = jest.fn()
const mockClarifyCreate = jest.fn()
const mockClarifyUpdate = jest.fn()

const mockTaskFindMany = jest.fn()
const mockCommentFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    notification: {
      findMany: (...args: any[]) => mockNotificationFindMany(...args),
      findUnique: (...args: any[]) => mockNotificationFindUnique(...args),
      update: (...args: any[]) => mockNotificationUpdate(...args),
      updateMany: (...args: any[]) => mockNotificationUpdateMany(...args),
      delete: (...args: any[]) => mockNotificationDelete(...args),
    },
    agentClarify: {
      findFirst: (...args: any[]) => mockClarifyFindFirst(...args),
      findUnique: (...args: any[]) => mockClarifyFindUnique(...args),
      findMany: (...args: any[]) => mockClarifyFindMany(...args),
      create: (...args: any[]) => mockClarifyCreate(...args),
      update: (...args: any[]) => mockClarifyUpdate(...args),
    },
    task: {
      findMany: (...args: any[]) => mockTaskFindMany(...args),
    },
    comment: {
      findMany: (...args: any[]) => mockCommentFindMany(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('notificationRepository', () => {
  describe('findByRecipient', () => {
    it('queries with correct where, orderBy, take, and include', async () => {
      mockNotificationFindMany.mockResolvedValue([{ id: 'n1' }])

      const result = await notificationRepository.findByRecipient(
        'actor-1',
        'ws-1'
      )

      expect(mockNotificationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', recipientActorId: 'actor-1' },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: expect.objectContaining({
            trigger: expect.objectContaining({
              select: expect.objectContaining({
                id: true,
                type: true,
              }),
            }),
          }),
        })
      )
      expect(result).toEqual([{ id: 'n1' }])
    })
  })

  describe('findById', () => {
    it('finds notification by ID', async () => {
      mockNotificationFindUnique.mockResolvedValue({ id: 'n1' })

      const result = await notificationRepository.findById('n1')

      expect(mockNotificationFindUnique).toHaveBeenCalledWith({
        where: { id: 'n1' },
      })
      expect(result).toEqual({ id: 'n1' })
    })

    it('returns null when not found', async () => {
      mockNotificationFindUnique.mockResolvedValue(null)

      const result = await notificationRepository.findById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('findForRespond', () => {
    it('finds notification with respond-specific select', async () => {
      const notification = {
        id: 'n1',
        type: 'AGENT_CLARIFY',
        requiresAction: true,
        actionTakenAt: null,
        recipientActorId: 'actor-1',
        taskId: 'task-1',
        clarifyId: 'clarify-1',
      }
      mockNotificationFindUnique.mockResolvedValue(notification)

      const result = await notificationRepository.findForRespond('n1')

      expect(mockNotificationFindUnique).toHaveBeenCalledWith({
        where: { id: 'n1' },
        select: expect.objectContaining({
          id: true,
          type: true,
          requiresAction: true,
          actionTakenAt: true,
          recipientActorId: true,
          taskId: true,
          clarifyId: true,
        }),
      })
      expect(result).toEqual(notification)
    })
  })

  describe('updateRead', () => {
    it('updates read status to true', async () => {
      mockNotificationUpdate.mockResolvedValue({ id: 'n1', read: true })

      await notificationRepository.updateRead('n1', true)

      expect(mockNotificationUpdate).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { read: true },
      })
    })

    it('updates read status to false', async () => {
      mockNotificationUpdate.mockResolvedValue({ id: 'n1', read: false })

      await notificationRepository.updateRead('n1', false)

      expect(mockNotificationUpdate).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { read: false },
      })
    })
  })

  describe('markAllRead', () => {
    it('updates all unread notifications for recipient', async () => {
      mockNotificationUpdateMany.mockResolvedValue({ count: 3 })

      await notificationRepository.markAllRead('actor-1', 'ws-1')

      expect(mockNotificationUpdateMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          recipientActorId: 'actor-1',
          read: false,
        },
        data: { read: true },
      })
    })
  })

  describe('markActionTaken', () => {
    it('sets actionTakenAt and read=true', async () => {
      mockNotificationUpdate.mockResolvedValue({ id: 'n1' })

      await notificationRepository.markActionTaken('n1')

      expect(mockNotificationUpdate).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: {
          actionTakenAt: expect.any(Date),
          read: true,
        },
      })
    })
  })

  describe('deleteById', () => {
    it('deletes notification by ID', async () => {
      mockNotificationDelete.mockResolvedValue({ id: 'n1' })

      await notificationRepository.deleteById('n1')

      expect(mockNotificationDelete).toHaveBeenCalledWith({
        where: { id: 'n1' },
      })
    })
  })

  // ── AgentClarify operations ─────────────────────────────────────────────

  describe('findPendingClarify', () => {
    it('finds unreplied clarify for task', async () => {
      mockClarifyFindFirst.mockResolvedValue({ id: 'c1', taskId: 'task-1' })

      const result = await notificationRepository.findPendingClarify('task-1')

      expect(mockClarifyFindFirst).toHaveBeenCalledWith({
        where: { taskId: 'task-1', reply: null },
        orderBy: { createdAt: 'desc' },
      })
      expect(result).toEqual({ id: 'c1', taskId: 'task-1' })
    })
  })

  describe('findClarifyForPoll', () => {
    it('finds clarify with reply fields', async () => {
      mockClarifyFindUnique.mockResolvedValue({
        taskId: 'task-1',
        reply: 'answer',
        repliedAt: new Date(),
      })

      const result = await notificationRepository.findClarifyForPoll('c1')

      expect(mockClarifyFindUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
        select: { taskId: true, reply: true, repliedAt: true },
      })
      expect(result?.reply).toBe('answer')
    })
  })

  describe('createClarify', () => {
    it('creates clarify record', async () => {
      const clarifyData = {
        taskId: 'task-1',
        question: 'What color?',
        context: 'For the button',
      }
      mockClarifyCreate.mockResolvedValue({ id: 'c-new', ...clarifyData })

      const result = await notificationRepository.createClarify(clarifyData)

      expect(mockClarifyCreate).toHaveBeenCalledWith({ data: clarifyData })
      expect(result.id).toBe('c-new')
    })
  })

  describe('replyClarify', () => {
    it('updates clarify with reply and repliedAt', async () => {
      mockClarifyUpdate.mockResolvedValue({ id: 'c1', reply: 'Blue' })

      await notificationRepository.replyClarify('c1', 'Blue')

      expect(mockClarifyUpdate).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { reply: 'Blue', repliedAt: expect.any(Date) },
      })
    })
  })

  describe('batchFetchClarifyByIds', () => {
    it('fetches clarifies by IDs with question and context', async () => {
      mockClarifyFindMany.mockResolvedValue([
        { id: 'c1', question: 'Q1', context: null },
      ])

      const result = await notificationRepository.batchFetchClarifyByIds(['c1'])

      expect(mockClarifyFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1'] } },
        select: { id: true, question: true, context: true },
      })
      expect(result).toHaveLength(1)
    })
  })

  // ── Batch-fetch helpers ─────────────────────────────────────────────────

  describe('batchFetchTasksByIds', () => {
    it('fetches tasks with team identifier', async () => {
      mockTaskFindMany.mockResolvedValue([
        { id: 'task-1', team: { identifier: 'ENG' } },
      ])

      const result = await notificationRepository.batchFetchTasksByIds([
        'task-1',
      ])

      expect(mockTaskFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-1'] } },
        include: { team: { select: { identifier: true } } },
      })
      expect(result).toHaveLength(1)
    })
  })

  describe('batchFetchCommentsByIds', () => {
    it('fetches comments with body', async () => {
      mockCommentFindMany.mockResolvedValue([
        { id: 'com-1', body: '<p>Hello</p>' },
      ])

      const result = await notificationRepository.batchFetchCommentsByIds([
        'com-1',
      ])

      expect(mockCommentFindMany).toHaveBeenCalledWith({
        where: { id: { in: ['com-1'] }, deletedAt: null },
        select: { id: true, body: true },
      })
      expect(result).toHaveLength(1)
    })
  })
})
