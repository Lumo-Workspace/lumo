import { viewRepository } from '@/lib/repositories/view.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockViewFindUnique = jest.fn()
const mockViewFindFirst = jest.fn()
const mockViewCreate = jest.fn()
const mockOrderFindMany = jest.fn()
const mockOrderUpsert = jest.fn()
const mockMemberFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    view: {
      findUnique: (...args: any[]) => mockViewFindUnique(...args),
      findFirst: (...args: any[]) => mockViewFindFirst(...args),
      create: (...args: any[]) => mockViewCreate(...args),
    },
    viewTaskOrder: {
      findMany: (...args: any[]) => mockOrderFindMany(...args),
      upsert: (...args: any[]) => mockOrderUpsert(...args),
    },
    workspaceMember: {
      findFirst: (...args: any[]) => mockMemberFindFirst(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('viewRepository', () => {
  describe('findById', () => {
    it('returns view with project and member workspace info', async () => {
      mockViewFindUnique.mockResolvedValue({
        id: 'v-1',
        project: { workspaceId: 'ws-1' },
        member: null,
      })

      const result = await viewRepository.findById('v-1')

      expect(result?.id).toBe('v-1')
      expect(mockViewFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v-1' },
          include: {
            project: { select: { workspaceId: true } },
            member: { select: { workspaceId: true, clerkId: true } },
          },
        })
      )
    })
  })

  describe('findOrCreateMemberKanban', () => {
    it('returns existing view when found', async () => {
      mockViewFindFirst.mockResolvedValue({ id: 'v-1', type: 'KANBAN' })

      const result = await viewRepository.findOrCreateMemberKanban(
        'ws-1',
        'm-1'
      )

      expect(result.id).toBe('v-1')
      expect(mockViewCreate).not.toHaveBeenCalled()
    })

    it('creates view when none exists', async () => {
      mockViewFindFirst.mockResolvedValue(null)
      mockViewCreate.mockResolvedValue({ id: 'v-new', type: 'KANBAN' })

      const result = await viewRepository.findOrCreateMemberKanban(
        'ws-1',
        'm-1'
      )

      expect(result.id).toBe('v-new')
      expect(mockViewCreate).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          memberId: 'm-1',
          name: 'My Tasks',
          type: 'KANBAN',
          isDefault: false,
        },
      })
    })
  })

  describe('findOrCreateProjectKanban', () => {
    it('returns existing view when found', async () => {
      mockViewFindFirst.mockResolvedValue({ id: 'v-1', type: 'KANBAN' })

      const result = await viewRepository.findOrCreateProjectKanban(
        'ws-1',
        'proj-1'
      )

      expect(result.id).toBe('v-1')
      expect(mockViewCreate).not.toHaveBeenCalled()
    })

    it('creates view with "Board" name when none exists', async () => {
      mockViewFindFirst.mockResolvedValue(null)
      mockViewCreate.mockResolvedValue({ id: 'v-new' })

      await viewRepository.findOrCreateProjectKanban('ws-1', 'proj-1')

      expect(mockViewCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'proj-1',
          name: 'Board',
        }),
      })
    })
  })

  describe('findTaskOrders', () => {
    it('returns all task orders for a view', async () => {
      mockOrderFindMany.mockResolvedValue([
        { taskId: 't-1', order: 0 },
        { taskId: 't-2', order: 1 },
      ])

      const result = await viewRepository.findTaskOrders('v-1')

      expect(result).toHaveLength(2)
      expect(mockOrderFindMany).toHaveBeenCalledWith({
        where: { viewId: 'v-1' },
      })
    })
  })

  describe('upsertTaskOrder', () => {
    it('upserts task order with correct composite key', async () => {
      mockOrderUpsert.mockResolvedValue({ viewId: 'v-1', taskId: 't-1' })

      await viewRepository.upsertTaskOrder('v-1', 't-1', 'TODO', 5)

      expect(mockOrderUpsert).toHaveBeenCalledWith({
        where: { viewId_taskId: { viewId: 'v-1', taskId: 't-1' } },
        update: { order: 5, groupKey: 'TODO' },
        create: { viewId: 'v-1', taskId: 't-1', groupKey: 'TODO', order: 5 },
      })
    })
  })

  describe('findMemberByWorkspaceAndClerkId', () => {
    it('finds member by workspace and clerk ID', async () => {
      mockMemberFindFirst.mockResolvedValue({ id: 'm-1' })

      const result = await viewRepository.findMemberByWorkspaceAndClerkId(
        'ws-1',
        'clerk-1'
      )

      expect(result?.id).toBe('m-1')
    })
  })
})
