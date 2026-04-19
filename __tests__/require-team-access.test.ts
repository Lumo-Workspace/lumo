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

describe('requireTeamMemberOrOwner', () => {
  it('passes when caller is the workspace OWNER', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm1', role: 'OWNER' })
    await expect(
      requireTeamMemberOrOwner('ws-1', 'team-1', 'clerk-1')
    ).resolves.toMatchObject({ memberId: 'm1', reason: 'owner' })
  })

  it('passes when caller is a TeamMember', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm2', role: 'MEMBER' })
    mockTeamMemberFind.mockResolvedValueOnce({ id: 'tm1' })
    await expect(
      requireTeamMemberOrOwner('ws-1', 'team-1', 'clerk-1')
    ).resolves.toMatchObject({ memberId: 'm2', reason: 'team' })
  })

  it('403 when caller is neither', async () => {
    mockWorkspaceMemberFind.mockResolvedValueOnce({ id: 'm3', role: 'MEMBER' })
    mockTeamMemberFind.mockResolvedValueOnce(null)
    await expect(
      requireTeamMemberOrOwner('ws-1', 'team-1', 'clerk-1')
    ).rejects.toMatchObject({ status: 403 })
  })
})
