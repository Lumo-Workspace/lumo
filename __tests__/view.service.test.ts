import { viewService } from '@/lib/services/view.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindById = jest.fn()
const mockFindOrCreateMemberKanban = jest.fn()
const mockFindOrCreateProjectKanban = jest.fn()
const mockFindTaskOrders = jest.fn()
const mockUpsertTaskOrder = jest.fn()
const mockFindMemberByWorkspaceAndClerkId = jest.fn()

jest.mock('@/lib/repositories/view.repository', () => ({
  viewRepository: {
    findById: (...args: any[]) => mockFindById(...args),
    findOrCreateMemberKanban: (...args: any[]) =>
      mockFindOrCreateMemberKanban(...args),
    findOrCreateProjectKanban: (...args: any[]) =>
      mockFindOrCreateProjectKanban(...args),
    findTaskOrders: (...args: any[]) => mockFindTaskOrders(...args),
    upsertTaskOrder: (...args: any[]) => mockUpsertTaskOrder(...args),
    findMemberByWorkspaceAndClerkId: (...args: any[]) =>
      mockFindMemberByWorkspaceAndClerkId(...args),
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('viewService', () => {
  describe('getOrCreateMemberKanban', () => {
    it('delegates to repository', async () => {
      mockFindOrCreateMemberKanban.mockResolvedValue({ id: 'v-1' })

      const result = await viewService.getOrCreateMemberKanban('ws-1', 'm-1')

      expect(result.id).toBe('v-1')
      expect(mockFindOrCreateMemberKanban).toHaveBeenCalledWith('ws-1', 'm-1')
    })
  })

  describe('getOrCreateProjectKanban', () => {
    it('delegates to repository', async () => {
      mockFindOrCreateProjectKanban.mockResolvedValue({ id: 'v-1' })

      const result = await viewService.getOrCreateProjectKanban(
        'ws-1',
        'proj-1'
      )

      expect(result.id).toBe('v-1')
    })
  })

  describe('getTaskOrderMap', () => {
    it('returns a Map of taskId to order', async () => {
      mockFindTaskOrders.mockResolvedValue([
        { taskId: 't-1', order: 0 },
        { taskId: 't-2', order: 1 },
      ])

      const result = await viewService.getTaskOrderMap('v-1')

      expect(result).toBeInstanceOf(Map)
      expect(result.get('t-1')).toBe(0)
      expect(result.get('t-2')).toBe(1)
    })
  })

  describe('upsertTaskOrder', () => {
    it('upserts task order when authorized', async () => {
      mockFindById.mockResolvedValue({
        id: 'v-1',
        memberId: null,
        project: { workspaceId: 'ws-1' },
        member: null,
      })
      mockFindMemberByWorkspaceAndClerkId.mockResolvedValue({ id: 'm-1' })

      await viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')

      expect(mockUpsertTaskOrder).toHaveBeenCalledWith('v-1', 't-1', 'TODO', 5)
    })

    it('throws 404 when view not found', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')
      ).rejects.toMatchObject({ status: 404 })
    })

    it('throws 400 when view has no workspace', async () => {
      mockFindById.mockResolvedValue({
        id: 'v-1',
        memberId: null,
        project: null,
        member: null,
      })

      await expect(
        viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')
      ).rejects.toMatchObject({ status: 400 })
    })

    it('throws 403 when caller is not workspace member', async () => {
      mockFindById.mockResolvedValue({
        id: 'v-1',
        memberId: null,
        project: { workspaceId: 'ws-1' },
        member: null,
      })
      mockFindMemberByWorkspaceAndClerkId.mockResolvedValue(null)

      await expect(
        viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('throws 403 when updating someone else personal view', async () => {
      mockFindById.mockResolvedValue({
        id: 'v-1',
        memberId: 'm-other',
        project: null,
        member: { workspaceId: 'ws-1', clerkId: 'clerk-other' },
      })
      mockFindMemberByWorkspaceAndClerkId.mockResolvedValue({ id: 'm-1' })

      await expect(
        viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('allows personal view owner to update', async () => {
      mockFindById.mockResolvedValue({
        id: 'v-1',
        memberId: 'm-1',
        project: null,
        member: { workspaceId: 'ws-1', clerkId: 'clerk-1' },
      })
      mockFindMemberByWorkspaceAndClerkId.mockResolvedValue({ id: 'm-1' })

      await viewService.upsertTaskOrder('v-1', 't-1', 'TODO', 5, 'clerk-1')

      expect(mockUpsertTaskOrder).toHaveBeenCalled()
    })
  })
})
