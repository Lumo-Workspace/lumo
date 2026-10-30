/**
 * @jest-environment node
 *
 * LUM-1341 — every Feishu repository query pins its workspace (LUM-979) and
 * selects only what its caller needs. Prisma is stubbed under the real
 * scope check, so an unpinned query would throw here.
 */
const mockInstall = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
}
const mockUnscopedFind = jest.fn()
const mockUnscoped = jest.fn((reason: string) => ({
  reason,
  feishuIntegration: { findUnique: mockUnscopedFind },
}))
const mockAccount = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
  updateMany: jest.fn(),
  deleteMany: jest.fn(),
}
const install = mockInstall
const account = mockAccount
jest.mock('@/lib/db/workspace-scope', () => ({
  scopedPrisma: {
    get feishuIntegration() {
      return mockInstall
    },
    get feishuAccountIntegration() {
      return mockAccount
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        feishuIntegration: mockInstall,
        feishuAccountIntegration: mockAccount,
      }),
  },
  unscoped: (reason: string) => mockUnscoped(reason),
}))

import { Prisma } from '@prisma/client'
import type * as WorkspaceScope from '@/lib/db/workspace-scope'
import { feishuIntegrationRepository as repo } from '@/lib/repositories/feishu-integration.repository'

const { findScopeViolation: realFind } = jest.requireActual<
  typeof WorkspaceScope
>('@/lib/db/workspace-scope')

function pinned(model: string, op: string, args: unknown) {
  expect(realFind(model, op, args)).toBeNull()
}

beforeEach(() => {
  for (const m of [install, account])
    for (const f of Object.values(m)) f.mockReset()
  install.deleteMany.mockResolvedValue({ count: 1 })
  account.deleteMany.mockResolvedValue({ count: 0 })
  install.updateMany.mockResolvedValue({ count: 1 })
  mockUnscopedFind.mockReset()
  mockUnscoped.mockClear()
})

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  })
const INSTALL_DATA = {
  workspaceId: 'w1',
  installedBy: 'm1',
  domain: 'feishu',
  appId: 'cli',
  tenantKey: 'tk',
  tenantName: 'n',
  tenantAccessToken: 'enc',
  tenantTokenExpiresAt: new Date(0),
}

describe('feishu-integration.repository', () => {
  it('install reads are by workspace and select no token for status', async () => {
    await repo.findInstallStatus('w1')
    const args = install.findUnique.mock.calls[0][0]
    pinned('FeishuIntegration', 'findUnique', args)
    expect(args.select.tenantAccessToken).toBeUndefined()
    await repo.findInstallWithToken('w1')
    expect(install.findUnique.mock.calls[1][0].select.tenantAccessToken).toBe(
      true
    )
  })

  it('install writes are pinned to the workspace (same workspace reinstall is an upsert)', async () => {
    await expect(repo.upsertInstall(INSTALL_DATA)).resolves.toEqual({
      status: 'ok',
      removedAccounts: 0,
    })
    pinned('FeishuIntegration', 'upsert', install.upsert.mock.calls[0][0])
    expect(install.upsert.mock.calls[0][0].create.workspaceId).toBe('w1')
    await expect(
      repo.updateTenantToken('w1', 'id1', {
        tenantAccessToken: 'e',
        tenantTokenExpiresAt: new Date(0),
      })
    ).resolves.toBe(true)
    pinned(
      'FeishuIntegration',
      'updateMany',
      install.updateMany.mock.calls[0][0]
    )
    expect(install.update).not.toHaveBeenCalled()
  })

  it('updateTenantToken reports a row deleted mid-call instead of throwing P2025', async () => {
    install.updateMany.mockResolvedValue({ count: 0 })
    await expect(
      repo.updateTenantToken('w1', 'id1', {
        tenantAccessToken: 'e',
        tenantTokenExpiresAt: new Date(0),
      })
    ).resolves.toBe(false)
  })

  it('deleteInstall removes every member link and the install in one transaction', async () => {
    account.deleteMany.mockResolvedValue({ count: 2 })
    await expect(repo.deleteInstall('w1')).resolves.toEqual({
      install: true,
      accounts: 2,
    })
    pinned(
      'FeishuAccountIntegration',
      'deleteMany',
      account.deleteMany.mock.calls[0][0]
    )
    pinned(
      'FeishuIntegration',
      'deleteMany',
      install.deleteMany.mock.calls[0][0]
    )
    expect(account.deleteMany.mock.calls[0][0]).toEqual({
      where: { workspaceId: 'w1' },
    })
  })

  it('upsertInstall maps a unique tenantKey held by another workspace to tenant_taken', async () => {
    install.upsert.mockRejectedValue(p2002())
    mockUnscopedFind.mockResolvedValue({ workspaceId: 'w_other' })
    await expect(repo.upsertInstall(INSTALL_DATA)).resolves.toEqual({
      status: 'tenant_taken',
    })
    // The upsert failed first: nothing was deleted.
    expect(account.deleteMany).not.toHaveBeenCalled()
    expect(mockUnscopedFind).toHaveBeenCalledWith({
      where: { tenantKey: 'tk' },
      select: { workspaceId: true },
    })
    expect(mockUnscoped.mock.calls[0]?.[0]).toMatch(/LUM-1341/)
  })

  it('a reinstall removes only the workspace member links of other tenants, in the transaction', async () => {
    account.deleteMany.mockResolvedValue({ count: 2 })
    await expect(
      repo.upsertInstall({ ...INSTALL_DATA, tenantKey: 'tk2' })
    ).resolves.toEqual({ status: 'ok', removedAccounts: 2 })
    const del = account.deleteMany.mock.calls[0][0]
    pinned('FeishuAccountIntegration', 'deleteMany', del)
    expect(del).toEqual({
      where: { workspaceId: 'w1', NOT: { tenantKey: 'tk2' } },
    })
    // Same-tenant reinstall: the filter keeps that tenant's links.
    account.deleteMany.mockResolvedValue({ count: 0 })
    await expect(repo.upsertInstall(INSTALL_DATA)).resolves.toEqual({
      status: 'ok',
      removedAccounts: 0,
    })
    expect(account.deleteMany.mock.calls[1][0].where.NOT).toEqual({
      tenantKey: 'tk',
    })
  })

  it('upsertInstall rethrows a P2002 that is not another workspace holding the tenant', async () => {
    install.upsert.mockRejectedValue(p2002())
    mockUnscopedFind.mockResolvedValue({ workspaceId: 'w1' })
    await expect(repo.upsertInstall(INSTALL_DATA)).rejects.toMatchObject({
      code: 'P2002',
    })
    install.upsert.mockRejectedValue(new Error('db down'))
    await expect(repo.upsertInstall(INSTALL_DATA)).rejects.toThrow('db down')
  })

  it('account reads and writes are pinned and reset needsReauth on reconnect', async () => {
    await repo.findAccount('w1', 'm1')
    pinned(
      'FeishuAccountIntegration',
      'findUnique',
      account.findUnique.mock.calls[0][0]
    )
    await repo.upsertAccount({
      workspaceId: 'w1',
      memberId: 'm1',
      domain: 'feishu',
      tenantKey: 'tk',
      openId: 'ou',
      name: null,
      accessToken: 'ea',
      refreshToken: 'er',
      expiresAt: new Date(0),
      refreshExpiresAt: null,
      scopes: [],
    })
    const up = account.upsert.mock.calls[0][0]
    pinned('FeishuAccountIntegration', 'upsert', up)
    expect(up.update.needsReauth).toBe(false)
    expect(up.create.needsReauth).toBe(false)
    // Compare-and-swap on the stored refresh-token ciphertext (LUM-1341).
    account.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      repo.updateAccountTokens('w1', 'a1', 'enc-old', {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: new Date(0),
        refreshExpiresAt: null,
      })
    ).resolves.toBe(true)
    const swap = account.updateMany.mock.calls[0][0]
    pinned('FeishuAccountIntegration', 'updateMany', swap)
    expect(swap.where).toEqual({
      id: 'a1',
      workspaceId: 'w1',
      refreshToken: 'enc-old',
    })
    expect(swap.data.needsReauth).toBe(false)
    account.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(
      repo.updateAccountTokens('w1', 'a1', 'enc-stale', {
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: new Date(0),
        refreshExpiresAt: null,
      })
    ).resolves.toBe(false)
    account.updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(
      repo.markAccountNeedsReauth('w1', 'a1', 'enc-old')
    ).resolves.toBe(true)
    const mark = account.updateMany.mock.calls[2][0]
    pinned('FeishuAccountIntegration', 'updateMany', mark)
    expect(mark.where.refreshToken).toBe('enc-old')
    expect(mark.data).toEqual({ needsReauth: true })
    await expect(repo.deleteAccount('w1', 'm1')).resolves.toBe(false)
    pinned(
      'FeishuAccountIntegration',
      'deleteMany',
      account.deleteMany.mock.calls[0][0]
    )
  })
})
