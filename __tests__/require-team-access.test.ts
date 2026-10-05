import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'

const mockTeamMemberFind = jest.fn()
const mockWorkspaceMemberFind = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    teamMember: { findUnique: (...a: any[]) => mockTeamMemberFind(...a) },
    workspaceMember: {
      findUnique: (...a: any[]) => mockWorkspaceMemberFind(...a),
    },
    team: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' }),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

const caller = { clerkId: 'clerk-1', workspaceId: 'ws-1' }
const resource = { workspaceId: 'ws-1', teamId: 'team-1' }

describe('requireTeamMemberOrOwner', () => {
  it('passes when caller is the workspace OWNER', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm1', role: 'OWNER' })
    await expect(
      requireTeamMemberOrOwner(caller, resource)
    ).resolves.toMatchObject({ memberId: 'm1', reason: 'owner' })
  })

  it('passes when caller is a TeamMember', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm2', role: 'MEMBER' })
    mockTeamMemberFind.mockResolvedValueOnce({ id: 'tm1' })
    await expect(
      requireTeamMemberOrOwner(caller, resource)
    ).resolves.toMatchObject({ memberId: 'm2', reason: 'team' })
  })

  it('403 when caller is neither', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm3', role: 'MEMBER' })
    mockTeamMemberFind.mockResolvedValueOnce(null)
    await expect(
      requireTeamMemberOrOwner(caller, resource)
    ).rejects.toMatchObject({ status: 403 })
  })

  // LUM-985: the caller's credential workspace scopes the check.
  it('404 when the resource is in another workspace than the credential, without a membership lookup', async () => {
    await expect(
      requireTeamMemberOrOwner(
        { clerkId: 'clerk-1', workspaceId: 'ws-alpha' },
        { workspaceId: 'ws-bravo', teamId: 'team-b' },
        'Sprint not found'
      )
    ).rejects.toMatchObject({ status: 404, message: 'Sprint not found' })
    expect(mockWorkspaceMemberFind).not.toHaveBeenCalled()
    expect(mockTeamMemberFind).not.toHaveBeenCalled()
  })

  it('404 on mismatch defaults to a generic message', async () => {
    await expect(
      requireTeamMemberOrOwner(
        { clerkId: 'clerk-1', workspaceId: 'ws-alpha' },
        { workspaceId: 'ws-bravo', teamId: 'team-b' }
      )
    ).rejects.toMatchObject({ status: 404, message: 'Not found' })
  })

  it('looks up membership in the credential workspace', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm1', role: 'OWNER' })
    await requireTeamMemberOrOwner(caller, resource)
    expect(mockWorkspaceMemberFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId_clerkId: { workspaceId: 'ws-1', clerkId: 'clerk-1' },
          deactivatedAt: null,
        },
      })
    )
  })
})
