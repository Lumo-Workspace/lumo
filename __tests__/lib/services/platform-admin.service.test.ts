import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminRepository } from '@/lib/repositories/platform-admin.repository'

jest.mock('@/lib/repositories/platform-admin.repository', () => ({
  platformAdminRepository: {
    listWorkspaces: jest.fn(),
    findWorkspace: jest.fn(),
    findWorkspacesByIds: jest.fn(),
    listActiveMembers: jest.fn(),
    listUsers: jest.fn(),
    findUser: jest.fn(),
    findUserEmails: jest.fn(),
    listUserMemberships: jest.fn(),
    listSpendForMonth: jest.fn(),
    listSpendForWorkspace: jest.fn(),
    countWorkspaces: jest.fn(),
    countUsers: jest.fn(),
    countPendingWaitlist: jest.fn(),
  },
}))

const repo = platformAdminRepository as jest.Mocked<
  typeof platformAdminRepository
>
const T = new Date('2026-10-01T00:00:00Z')

const ws = (id: string) => ({
  id,
  name: `WS ${id}`,
  slug: id,
  createdAt: T,
})

describe('platformAdminService', () => {
  beforeEach(() => jest.resetAllMocks())

  it('listWorkspaces: memberCount, ownerEmail, nextCursor from limit+1', async () => {
    repo.listWorkspaces.mockResolvedValue([ws('a'), ws('b'), ws('c')])
    repo.listActiveMembers.mockResolvedValue([
      { workspaceId: 'a', clerkId: 'u1', role: 'OWNER', joinedAt: T },
      { workspaceId: 'a', clerkId: 'u2', role: 'MEMBER', joinedAt: T },
      { workspaceId: 'b', clerkId: 'u2', role: 'MEMBER', joinedAt: T },
    ])
    repo.findUserEmails.mockResolvedValue([{ id: 'u1', email: 'o@x.com' }])

    const res = await platformAdminService.listWorkspaces({ limit: 2 })

    expect(repo.listWorkspaces).toHaveBeenCalledWith({
      q: undefined,
      cursor: undefined,
      take: 3,
    })
    expect(res.nextCursor).toBe('b')
    expect(res.items).toEqual([
      { ...ws('a'), memberCount: 2, ownerEmail: 'o@x.com' },
      { ...ws('b'), memberCount: 1, ownerEmail: null },
    ])
  })

  it('listWorkspaces: last page has null nextCursor', async () => {
    repo.listWorkspaces.mockResolvedValue([ws('a')])
    repo.listActiveMembers.mockResolvedValue([])
    repo.findUserEmails.mockResolvedValue([])
    const res = await platformAdminService.listWorkspaces({ limit: 2 })
    expect(res.nextCursor).toBeNull()
  })

  it('getWorkspace: serialises BigInt spend as strings, newest month first', async () => {
    repo.findWorkspace.mockResolvedValue(ws('a'))
    repo.listActiveMembers.mockResolvedValue([
      { workspaceId: 'a', clerkId: 'u1', role: 'OWNER', joinedAt: T },
    ])
    repo.findUserEmails.mockResolvedValue([{ id: 'u1', email: 'o@x.com' }])
    repo.listSpendForWorkspace.mockResolvedValue([
      { workspaceId: 'a', month: '2026-09', usdMicros: BigInt(5) },
      {
        workspaceId: 'a',
        month: '2026-10',
        usdMicros: BigInt('9007199254740993'),
      },
      { workspaceId: 'a', month: '2026-10', usdMicros: BigInt(1) },
    ])

    const res = await platformAdminService.getWorkspace('a')

    expect(res.llmSpendByMonth).toEqual([
      { month: '2026-10', usdMicros: '9007199254740994' },
      { month: '2026-09', usdMicros: '5' },
    ])
    expect(res.members).toEqual([
      { userId: 'u1', email: 'o@x.com', role: 'OWNER', joinedAt: T },
    ])
    expect(() => JSON.stringify(res)).not.toThrow()
  })

  it('getWorkspace: member with no AuthUser row has email null', async () => {
    repo.findWorkspace.mockResolvedValue(ws('a'))
    repo.listActiveMembers.mockResolvedValue([
      { workspaceId: 'a', clerkId: 'u1', role: 'OWNER', joinedAt: T },
      { workspaceId: 'a', clerkId: 'gone', role: 'MEMBER', joinedAt: T },
    ])
    repo.findUserEmails.mockResolvedValue([{ id: 'u1', email: 'o@x.com' }])
    repo.listSpendForWorkspace.mockResolvedValue([])
    const res = await platformAdminService.getWorkspace('a')
    expect(res.members).toEqual([
      { userId: 'u1', email: 'o@x.com', role: 'OWNER', joinedAt: T },
      { userId: 'gone', email: null, role: 'MEMBER', joinedAt: T },
    ])
  })

  it('getWorkspace: unknown id throws 404', async () => {
    repo.findWorkspace.mockResolvedValue(null)
    await expect(platformAdminService.getWorkspace('x')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('getUser: lists active workspaces with memberRole; null banned -> false', async () => {
    repo.findUser.mockResolvedValue({
      id: 'u1',
      email: 'a@x.com',
      name: 'A',
      createdAt: T,
      banned: null,
      role: null,
    })
    repo.listUserMemberships.mockResolvedValue([
      { role: 'MEMBER', workspace: { id: 'a', name: 'WS a', slug: 'a' } },
    ])
    const res = await platformAdminService.getUser('u1')
    expect(res.banned).toBe(false)
    expect(res.workspaces).toEqual([
      { id: 'a', name: 'WS a', slug: 'a', memberRole: 'MEMBER' },
    ])
  })

  it('getUser: unknown id throws 404', async () => {
    repo.findUser.mockResolvedValue(null)
    await expect(platformAdminService.getUser('x')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('usage: sums features per workspace, sorts desc, totals as string', async () => {
    repo.listSpendForMonth.mockResolvedValue([
      { workspaceId: 'a', month: '2026-10', usdMicros: BigInt(10) },
      { workspaceId: 'b', month: '2026-10', usdMicros: BigInt(50) },
      { workspaceId: 'a', month: '2026-10', usdMicros: BigInt(15) },
    ])
    repo.findWorkspacesByIds.mockResolvedValue([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    const res = await platformAdminService.usage('2026-10')
    expect(res).toEqual({
      month: '2026-10',
      totalUsdMicros: '75',
      byWorkspace: [
        { workspaceId: 'b', name: 'B', usdMicros: '50' },
        { workspaceId: 'a', name: 'A', usdMicros: '25' },
      ],
    })
  })

  it('usage: defaults to the current UTC month', async () => {
    repo.listSpendForMonth.mockResolvedValue([])
    repo.findWorkspacesByIds.mockResolvedValue([])
    const res = await platformAdminService.usage(
      undefined,
      new Date('2026-12-31T23:59:59Z')
    )
    expect(repo.listSpendForMonth).toHaveBeenCalledWith('2026-12')
    expect(res).toEqual({
      month: '2026-12',
      totalUsdMicros: '0',
      byWorkspace: [],
    })
  })

  it('overview: counts and current-month spend as string', async () => {
    repo.countWorkspaces.mockResolvedValue(3)
    repo.countUsers.mockResolvedValue(7)
    repo.countPendingWaitlist.mockResolvedValue(2)
    repo.listSpendForMonth.mockResolvedValue([
      { workspaceId: 'a', month: '2026-10', usdMicros: BigInt(4) },
      { workspaceId: 'b', month: '2026-10', usdMicros: BigInt(6) },
    ])
    const res = await platformAdminService.overview(
      new Date('2026-10-30T00:00:00Z')
    )
    expect(res).toEqual({
      workspaceCount: 3,
      userCount: 7,
      pendingWaitlistCount: 2,
      currentMonthUsdMicros: '10',
    })
    expect(repo.listSpendForMonth).toHaveBeenCalledWith('2026-10')
  })
})
