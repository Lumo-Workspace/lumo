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
  deleteMany: jest.fn(),
}
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
  },
}))

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
})

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

  it('install writes are pinned to the workspace', async () => {
    await repo.upsertInstall({
      workspaceId: 'w1',
      installedBy: 'm1',
      domain: 'feishu',
      appId: 'cli',
      tenantKey: 'tk',
      tenantName: 'n',
      tenantAccessToken: 'enc',
      tenantTokenExpiresAt: new Date(0),
    })
    pinned('FeishuIntegration', 'upsert', install.upsert.mock.calls[0][0])
    expect(install.upsert.mock.calls[0][0].create.workspaceId).toBe('w1')
    await repo.updateTenantToken('w1', 'id1', {
      tenantAccessToken: 'e',
      tenantTokenExpiresAt: new Date(0),
    })
    pinned('FeishuIntegration', 'update', install.update.mock.calls[0][0])
    await expect(repo.deleteInstall('w1')).resolves.toBe(true)
    pinned(
      'FeishuIntegration',
      'deleteMany',
      install.deleteMany.mock.calls[0][0]
    )
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
    await repo.updateAccountTokens('w1', 'a1', {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: new Date(0),
      refreshExpiresAt: null,
    })
    pinned(
      'FeishuAccountIntegration',
      'update',
      account.update.mock.calls[0][0]
    )
    await repo.markAccountNeedsReauth('w1', 'a1')
    const mark = account.updateMany.mock.calls[0][0]
    pinned('FeishuAccountIntegration', 'updateMany', mark)
    expect(mark.data).toEqual({ needsReauth: true })
    await expect(repo.deleteAccount('w1', 'm1')).resolves.toBe(false)
    pinned(
      'FeishuAccountIntegration',
      'deleteMany',
      account.deleteMany.mock.calls[0][0]
    )
  })
})
