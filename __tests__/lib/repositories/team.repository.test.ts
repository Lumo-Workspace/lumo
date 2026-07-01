/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    team: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { teamRepository } from '@/lib/repositories/team.repository'

const findUnique = prisma.team.findUnique as jest.Mock
const findMany = prisma.team.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('teamRepository.findWorkspaceId', () => {
  it('selects only id and workspaceId', async () => {
    findUnique.mockResolvedValue({ id: 'team-1', workspaceId: 'ws-1' })

    const result = await teamRepository.findWorkspaceId('team-1')

    expect(result).toEqual({ id: 'team-1', workspaceId: 'ws-1' })
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      select: { id: true, workspaceId: true },
    })
  })

  it('returns null when the team does not exist', async () => {
    findUnique.mockResolvedValue(null)

    const result = await teamRepository.findWorkspaceId('missing')

    expect(result).toBeNull()
  })
})

describe('teamRepository.listForMember', () => {
  it('OWNERs see every team in the workspace', async () => {
    findMany.mockResolvedValue([])

    await teamRepository.listForMember('ws-1', 'mem-1', { isOwner: true })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      })
    )
  })

  it('non-OWNERs are filtered to teams where they have a TeamMember row', async () => {
    findMany.mockResolvedValue([])

    await teamRepository.listForMember('ws-1', 'mem-1', { isOwner: false })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: 'ws-1',
          members: { some: { memberId: 'mem-1' } },
        },
      })
    )
  })

  it('selects the team-list column set the API contract expects', async () => {
    findMany.mockResolvedValue([])

    await teamRepository.listForMember('ws-1', 'mem-1', { isOwner: true })

    const call = findMany.mock.calls[0][0]
    expect(call.select).toEqual({
      id: true,
      name: true,
      identifier: true,
      isDefault: true,
      sprintsEnabled: true,
      sprintDurationDays: true,
      sprintCooldownDays: true,
      sprintStartWeekday: true,
      sprintAutoCreate: true,
      sprintAutoAddCompleted: true,
    })
  })
})
