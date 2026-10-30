import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'
import { platformAdminAuditRepository } from '@/lib/repositories/platform-admin-audit.repository'

jest.mock('@/lib/repositories/platform-admin-audit.repository', () => ({
  platformAdminAuditRepository: {
    create: jest.fn(),
    listPage: jest.fn(),
  },
}))

const repo = platformAdminAuditRepository as jest.Mocked<
  typeof platformAdminAuditRepository
>

function row(id: string) {
  return {
    id,
    adminUserId: 'admin-1',
    action: 'user.list',
    targetType: 'user',
    targetId: '*',
    workspaceId: null,
    metadata: null,
    createdAt: new Date('2026-10-30T00:00:00Z'),
  }
}

describe('platformAdminAudit', () => {
  beforeEach(() => jest.resetAllMocks())

  it('record writes one row with the given fields', async () => {
    repo.create.mockResolvedValue(undefined)
    await platformAdminAudit.record({
      adminUserId: 'admin-1',
      action: 'workspace.view',
      targetType: 'workspace',
      targetId: 'ws-1',
      workspaceId: 'ws-1',
      metadata: { reason: 'x' },
    })
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'workspace.view',
      targetType: 'workspace',
      targetId: 'ws-1',
      workspaceId: 'ws-1',
      metadata: { reason: 'x' },
    })
  })

  it('record propagates write failures', async () => {
    repo.create.mockRejectedValue(new Error('db down'))
    await expect(
      platformAdminAudit.record({
        adminUserId: 'a',
        action: 'user.list',
        targetType: 'user',
        targetId: '*',
      })
    ).rejects.toThrow('db down')
  })

  it('list filters by adminUserId and targetType and returns nextCursor when more rows exist', async () => {
    repo.listPage.mockResolvedValue([row('c'), row('b'), row('a')])
    const before = new Date('2026-11-01T00:00:00Z')
    const res = await platformAdminAudit.list({
      adminUserId: 'admin-1',
      targetType: 'user',
      before,
      limit: 2,
    })
    expect(repo.listPage).toHaveBeenCalledWith(
      {
        adminUserId: 'admin-1',
        targetType: 'user',
        targetId: undefined,
        before,
      },
      undefined,
      3
    )
    expect(res.items.map(i => i.id)).toEqual(['c', 'b'])
    expect(res.nextCursor).toBe('b')
  })

  it('list returns null nextCursor on the last page and forwards the cursor', async () => {
    repo.listPage.mockResolvedValue([row('a')])
    const res = await platformAdminAudit.list({ limit: 5, cursor: 'b' })
    expect(repo.listPage).toHaveBeenCalledWith(expect.any(Object), 'b', 6)
    expect(res.nextCursor).toBeNull()
  })

  it('list caps limit at 100', async () => {
    repo.listPage.mockResolvedValue([])
    await platformAdminAudit.list({ limit: 5000 })
    expect(repo.listPage).toHaveBeenCalledWith(
      expect.any(Object),
      undefined,
      101
    )
  })
})
