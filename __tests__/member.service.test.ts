import { memberService } from '@/lib/services/member.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByWorkspace = jest.fn()
const mockFindById = jest.fn()
const mockUpdateRole = jest.fn()
const mockCountOwners = jest.fn()
const mockDeactivate = jest.fn()
const mockFindCodingAgentProfile = jest.fn()
const mockCreateCodingAgent = jest.fn()
const mockFindAgentActors = jest.fn()

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspace: (...args: any[]) => mockFindByWorkspace(...args),
    findById: (...args: any[]) => mockFindById(...args),
    updateRole: (...args: any[]) => mockUpdateRole(...args),
    countOwners: (...args: any[]) => mockCountOwners(...args),
    deactivate: (...args: any[]) => mockDeactivate(...args),
    findCodingAgentProfile: (...args: any[]) =>
      mockFindCodingAgentProfile(...args),
    createCodingAgent: (...args: any[]) => mockCreateCodingAgent(...args),
    findAgentActors: (...args: any[]) => mockFindAgentActors(...args),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockDeactivate.mockResolvedValue({ deactivated: true, apiKeysRevoked: 0 })
})

// ── Tests ───────────────────────────────────────────────────────────────────

describe('memberService', () => {
  describe('listMembers', () => {
    it('delegates to repository', async () => {
      mockFindByWorkspace.mockResolvedValue([{ id: 'm-1' }])

      const result = await memberService.listMembers('ws-1')

      expect(result).toHaveLength(1)
      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('getAgentActors', () => {
    it('returns shaped agent actors', async () => {
      mockFindCodingAgentProfile.mockResolvedValue({ id: 'agent-1' })
      mockFindAgentActors.mockResolvedValue([
        {
          id: 'a-1',
          agent: {
            name: 'Coding Agent',
            avatarColor: '#6366f1',
            type: 'CODING',
          },
        },
      ])

      const result = await memberService.getAgentActors('ws-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.actorId).toBe('a-1')
      expect(result[0]!.name).toBe('Coding Agent')
      // Should not create since agent already exists
      expect(mockCreateCodingAgent).not.toHaveBeenCalled()
    })

    it('lazy-creates coding agent when none exists', async () => {
      mockFindCodingAgentProfile.mockResolvedValue(null)
      mockFindAgentActors.mockResolvedValue([])

      await memberService.getAgentActors('ws-1')

      expect(mockCreateCodingAgent).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('updateMemberRole', () => {
    it('updates role successfully', async () => {
      mockFindById.mockResolvedValue({
        id: 'm-2',
        workspaceId: 'ws-1',
        role: 'MEMBER',
      })
      mockUpdateRole.mockResolvedValue({ id: 'm-2', role: 'OWNER' })

      const result = await memberService.updateMemberRole(
        'm-2',
        'OWNER',
        'm-1',
        'OWNER',
        'ws-1'
      )

      expect(result.role).toBe('OWNER')
    })

    it('throws 403 when caller is not OWNER', async () => {
      await expect(
        memberService.updateMemberRole('m-2', 'OWNER', 'm-1', 'MEMBER', 'ws-1')
      ).rejects.toMatchObject({ status: 403 })
    })

    it('throws 400 when trying to change own role', async () => {
      await expect(
        memberService.updateMemberRole('m-1', 'MEMBER', 'm-1', 'OWNER', 'ws-1')
      ).rejects.toMatchObject({ status: 400 })
    })

    it('throws 404 when target member not in workspace', async () => {
      mockFindById.mockResolvedValue({
        id: 'm-2',
        workspaceId: 'ws-other',
        role: 'MEMBER',
      })

      await expect(
        memberService.updateMemberRole('m-2', 'OWNER', 'm-1', 'OWNER', 'ws-1')
      ).rejects.toMatchObject({ status: 404 })
    })

    it('throws 400 when demoting the last OWNER', async () => {
      mockFindById.mockResolvedValue({
        id: 'm-2',
        workspaceId: 'ws-1',
        role: 'OWNER',
      })
      mockCountOwners.mockResolvedValue(1)

      await expect(
        memberService.updateMemberRole('m-2', 'MEMBER', 'm-1', 'OWNER', 'ws-1')
      ).rejects.toMatchObject({
        message: 'Cannot remove the last admin',
        status: 400,
      })
    })
  })

  describe('getMember', () => {
    it('returns member when found in workspace', async () => {
      mockFindById.mockResolvedValue({
        id: 'm-1',
        workspaceId: 'ws-1',
        role: 'MEMBER',
      })

      const result = await memberService.getMember('m-1', 'ws-1')

      expect(result.id).toBe('m-1')
      expect(mockFindById).toHaveBeenCalledWith('m-1')
    })

    it('throws 404 when member belongs to another workspace', async () => {
      mockFindById.mockResolvedValue({
        id: 'm-1',
        workspaceId: 'ws-other',
        role: 'MEMBER',
      })

      await expect(
        memberService.getMember('m-1', 'ws-1')
      ).rejects.toMatchObject({ status: 404 })
    })

    it('throws 404 when member does not exist', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        memberService.getMember('m-missing', 'ws-1')
      ).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('leaveWorkspace', () => {
    it('deactivates (not deletes) the member when not last OWNER', async () => {
      await memberService.leaveWorkspace('m-1', 'MEMBER', 'ws-1')

      expect(mockDeactivate).toHaveBeenCalledWith('m-1', 'LEFT')
    })

    it('allows OWNER to leave when there are other owners', async () => {
      mockCountOwners.mockResolvedValue(2)

      await memberService.leaveWorkspace('m-1', 'OWNER', 'ws-1')

      expect(mockDeactivate).toHaveBeenCalledWith('m-1', 'LEFT')
    })

    it('throws 400 when last OWNER tries to leave', async () => {
      mockCountOwners.mockResolvedValue(1)

      await expect(
        memberService.leaveWorkspace('m-1', 'OWNER', 'ws-1')
      ).rejects.toMatchObject({ status: 400 })
    })
  })
})
