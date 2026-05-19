/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findUnique: jest.fn() },
    teamMember: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/repositories/team.repository', () => ({
  teamRepository: { findWorkspaceId: jest.fn() },
}))

import { prisma } from '@/lib/db/prisma'
import { teamRepository } from '@/lib/repositories/team.repository'
import { requireTeamAccessById } from '@/lib/auth/require-team-access'

const findWorkspaceId = teamRepository.findWorkspaceId as jest.Mock
const findWsMember = prisma.workspaceMember.findUnique as jest.Mock
const findTeamMember = prisma.teamMember.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('requireTeamAccessById', () => {
  it('throws 404 when the team does not exist', async () => {
    findWorkspaceId.mockResolvedValue(null)

    await expect(
      requireTeamAccessById('missing', 'clerk_1')
    ).rejects.toMatchObject({ message: 'Team not found', status: 404 })
  })

  it('returns owner result when caller is workspace OWNER', async () => {
    findWorkspaceId.mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' })
    findWsMember.mockResolvedValue({ id: 'mem-1', role: 'OWNER' })

    const result = await requireTeamAccessById('team-1', 'clerk_owner')

    expect(result).toEqual({
      memberId: 'mem-1',
      workspaceId: 'ws-1',
      reason: 'owner',
    })
    expect(findTeamMember).not.toHaveBeenCalled()
  })

  it('returns team result when caller is an explicit TeamMember', async () => {
    findWorkspaceId.mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' })
    findWsMember.mockResolvedValue({ id: 'mem-1', role: 'MEMBER' })
    findTeamMember.mockResolvedValue({ id: 'tm-1' })

    const result = await requireTeamAccessById('team-1', 'clerk_member')

    expect(result).toEqual({
      memberId: 'mem-1',
      workspaceId: 'ws-1',
      reason: 'team',
    })
  })

  it('throws 403 when caller is in the workspace but not on the team', async () => {
    findWorkspaceId.mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' })
    findWsMember.mockResolvedValue({ id: 'mem-1', role: 'MEMBER' })
    findTeamMember.mockResolvedValue(null)

    await expect(
      requireTeamAccessById('team-1', 'clerk_outsider')
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 403 when caller is not in the workspace at all', async () => {
    findWorkspaceId.mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' })
    findWsMember.mockResolvedValue(null)

    await expect(
      requireTeamAccessById('team-1', 'clerk_stranger')
    ).rejects.toMatchObject({ status: 403 })
  })
})
