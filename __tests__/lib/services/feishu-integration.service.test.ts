/**
 * @jest-environment node
 *
 * LUM-1341 — the Feishu / Lark connection service: the owner's workspace
 * install, the member's account link, encrypted token storage, tenant token
 * caching, and needsReauth on a refresh that can never succeed.
 */
if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)

const repo = {
  findInstallStatus: jest.fn(),
  findInstallWithToken: jest.fn(),
  upsertInstall: jest.fn(),
  updateTenantToken: jest.fn(),
  deleteInstall: jest.fn(),
  findAccount: jest.fn(),
  upsertAccount: jest.fn(),
  updateAccountTokens: jest.fn(),
  markAccountNeedsReauth: jest.fn(),
  deleteAccount: jest.fn(),
}
jest.mock('@/lib/repositories/feishu-integration.repository', () => ({
  feishuIntegrationRepository: new Proxy(
    {},
    {
      get:
        (_t, k: string) =>
        (...a: unknown[]) =>
          (repo as Record<string, jest.Mock>)[k]!(...a),
    }
  ),
}))
const mockAudit = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))
const mockExchange = jest.fn()
const mockUserInfo = jest.fn()
jest.mock('@/lib/integrations/feishu/oauth', () => ({
  ...jest.requireActual('@/lib/integrations/feishu/oauth'),
  exchangeCode: (...a: unknown[]) => mockExchange(...a),
  fetchUserInfo: (...a: unknown[]) => mockUserInfo(...a),
}))
const mockTenantToken = jest.fn()
const mockTenantInfo = jest.fn()
jest.mock('@/lib/integrations/feishu/tenant', () => ({
  ...jest.requireActual('@/lib/integrations/feishu/tenant'),
  fetchTenantAccessToken: (...a: unknown[]) => mockTenantToken(...a),
  fetchTenantInfo: (...a: unknown[]) => mockTenantInfo(...a),
}))

import { decrypt, encrypt } from '@/lib/crypto'
import { decodeOauthState } from '@/lib/integrations/oauth-state'
import {
  buildAccountAuthorizeUrl,
  buildInstallAuthorizeUrl,
  completeAccountLink,
  completeInstall,
  disconnectAccount,
  disconnectInstall,
  getAccountStatus,
  getInstallStatus,
  getTenantAccessToken,
  getUserClientForMember,
  hasAccountLink,
  isFeishuEnabled,
  isInstallCurrent,
  removeAccountLink,
} from '@/lib/services/feishu-integration.service'
import { FeishuNeedsReauthError } from '@/lib/integrations/feishu/client'

const WS = 'ws_dogfood'
const APP_URL = 'https://lumo.test'
const fetchMock = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  for (const fn of Object.values(repo)) fn.mockReset()
  process.env.LUMO_DOGFOOD_WORKSPACE_IDS = WS
  process.env.FEISHU_APP_ID = 'cli_app'
  process.env.FEISHU_APP_SECRET = 'app-secret'
  delete process.env.FEISHU_DOMAIN
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  // Defaults: a current install of tenant `tk`; writes succeed.
  repo.findInstallStatus.mockResolvedValue(CURRENT_INSTALL)
  repo.upsertInstall.mockResolvedValue({ status: 'ok', removedAccounts: 0 })
  repo.updateTenantToken.mockResolvedValue(true)
  repo.deleteInstall.mockResolvedValue({ install: true, accounts: 0 })
})

/** The install as findInstallStatus returns it (no token). */
const CURRENT_INSTALL = {
  domain: 'feishu',
  appId: 'cli_app',
  tenantKey: 'tk',
  tenantName: 'Lumo Inc',
  createdAt: new Date(0),
}

const userToken = (over = {}) => ({
  accessToken: 'u-access',
  expiresAt: new Date(Date.now() + 7_200_000),
  refreshToken: 'u-refresh',
  refreshExpiresAt: new Date(Date.now() + 604_800_000),
  scopes: ['offline_access', 'docx:document:readonly'],
  ...over,
})

describe('rollout flag', () => {
  it('is on only for the dogfood cohort', () => {
    expect(isFeishuEnabled(WS)).toBe(true)
    expect(isFeishuEnabled('ws_customer')).toBe(false)
  })

  it('refuses every flow outside the cohort with 404', async () => {
    expect(() =>
      buildInstallAuthorizeUrl({
        workspaceId: 'ws_customer',
        memberId: 'm',
        workspaceUrl: 'c',
        role: 'OWNER',
        appUrl: APP_URL,
      })
    ).toThrow(expect.objectContaining({ status: 404 }))
    await expect(getInstallStatus('ws_customer')).resolves.toEqual({
      connected: false,
    })
    expect(repo.findInstallStatus).not.toHaveBeenCalled()
  })
})

describe('workspace install (TEAM)', () => {
  it('only an owner can start it; the state is minted for the install leg', () => {
    expect(() =>
      buildInstallAuthorizeUrl({
        workspaceId: WS,
        memberId: 'm1',
        workspaceUrl: 'lumo',
        role: 'MEMBER',
        appUrl: APP_URL,
      })
    ).toThrow(expect.objectContaining({ status: 403, code: 'not_owner' }))

    const url = new URL(
      buildInstallAuthorizeUrl({
        workspaceId: WS,
        memberId: 'm1',
        workspaceUrl: 'lumo',
        role: 'OWNER',
        appUrl: APP_URL,
      })
    )
    expect(url.host).toBe('accounts.feishu.cn')
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${APP_URL}/api/feishu/install/callback`
    )
    const state = url.searchParams.get('state')!
    expect(decodeOauthState(state, Date.now(), 'feishu-install')).toMatchObject(
      {
        ok: true,
        payload: { workspaceId: WS, memberId: 'm1', workspaceUrl: 'lumo' },
      }
    )
    // ...and cannot be replayed into the account leg.
    expect(decodeOauthState(state, Date.now(), 'feishu-account').ok).toBe(false)
  })

  it('binds the tenant and stores the tenant token encrypted', async () => {
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({ openId: 'ou', tenantKey: 'tk', name: 'O' })
    const expiresAt = new Date(Date.now() + 7_200_000)
    mockTenantToken.mockResolvedValue({ token: 't-plain', expiresAt })
    mockTenantInfo.mockResolvedValue({ tenantKey: 'tk', name: 'Lumo Inc' })

    await completeInstall({
      workspaceId: WS,
      memberId: 'm1',
      role: 'OWNER',
      code: 'c',
      appUrl: APP_URL,
    })

    expect(mockExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: `${APP_URL}/api/feishu/install/callback`,
        code: 'c',
      })
    )
    const row = repo.upsertInstall.mock.calls[0][0]
    expect(row).toMatchObject({
      workspaceId: WS,
      installedBy: 'm1',
      domain: 'feishu',
      appId: 'cli_app',
      tenantKey: 'tk',
      tenantName: 'Lumo Inc',
      tenantTokenExpiresAt: expiresAt,
    })
    expect(row.tenantAccessToken).not.toContain('t-plain')
    expect(decrypt(row.tenantAccessToken)).toBe('t-plain')
    // The owner's own user token is not stored anywhere.
    expect(JSON.stringify(row)).not.toContain('u-access')
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feishu.connected', workspaceId: WS })
    )
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('t-plain')
  })

  it('refuses an owner from a different tenant than the app', async () => {
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({
      openId: 'ou',
      tenantKey: 'other',
      name: null,
    })
    mockTenantToken.mockResolvedValue({ token: 't', expiresAt: new Date() })
    mockTenantInfo.mockResolvedValue({ tenantKey: 'tk', name: 'Lumo Inc' })
    await expect(
      completeInstall({
        workspaceId: WS,
        memberId: 'm1',
        role: 'OWNER',
        code: 'c',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'tenant_mismatch', status: 403 })
    expect(repo.upsertInstall).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('refuses a non-owner at the callback too', async () => {
    await expect(
      completeInstall({
        workspaceId: WS,
        memberId: 'm2',
        role: 'MEMBER',
        code: 'c',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'not_owner' })
    expect(mockExchange).not.toHaveBeenCalled()
  })

  it('reports status from the row', async () => {
    process.env.FEISHU_DOMAIN = 'lark'
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      domain: 'lark',
      tenantName: 'Acme',
    })
    await expect(getInstallStatus(WS)).resolves.toEqual({
      connected: true,
      tenantName: 'Acme',
      domain: 'lark',
      reinstallRequired: false,
    })
    repo.findInstallStatus.mockResolvedValue(null)
    await expect(getInstallStatus(WS)).resolves.toEqual({ connected: false })
  })

  it('disconnect is owner-only, deletes the row and is audited', async () => {
    await expect(disconnectInstall(WS, 'MEMBER')).rejects.toMatchObject({
      status: 403,
    })
    expect(repo.deleteInstall).not.toHaveBeenCalled()
    await disconnectInstall(WS, 'OWNER')
    expect(repo.deleteInstall).toHaveBeenCalledWith(WS)
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feishu.disconnected' })
    )
    // No member links went with it: no second event.
    expect(mockAudit).toHaveBeenCalledTimes(1)
  })

  it('disconnect removes every member link with the install, and audits it', async () => {
    repo.deleteInstall.mockResolvedValue({ install: true, accounts: 3 })
    await disconnectInstall(WS, 'OWNER')
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feishu.member_accounts_removed',
        metadata: { count: 3 },
      })
    )
  })

  it('refuses a tenant another workspace already holds (tenant_taken, 409)', async () => {
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({ openId: 'ou', tenantKey: 'tk', name: 'O' })
    mockTenantToken.mockResolvedValue({ token: 't', expiresAt: new Date() })
    mockTenantInfo.mockResolvedValue({ tenantKey: 'tk', name: 'Lumo Inc' })
    repo.upsertInstall.mockResolvedValue({ status: 'tenant_taken' })
    process.env.LUMO_DOGFOOD_WORKSPACE_IDS = `${WS},ws_second`
    await expect(
      completeInstall({
        workspaceId: 'ws_second',
        memberId: 'm9',
        role: 'OWNER',
        code: 'c',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'tenant_taken', status: 409 })
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('a reinstall into another tenant audits the old-tenant member links it removed', async () => {
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({
      openId: 'ou',
      tenantKey: 'tk2',
      name: 'O',
    })
    mockTenantToken.mockResolvedValue({ token: 't', expiresAt: new Date() })
    mockTenantInfo.mockResolvedValue({ tenantKey: 'tk2', name: 'New Org' })
    repo.upsertInstall.mockResolvedValue({ status: 'ok', removedAccounts: 2 })
    await completeInstall({
      workspaceId: WS,
      memberId: 'm1',
      role: 'OWNER',
      code: 'c',
      appUrl: APP_URL,
    })
    expect(repo.upsertInstall).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, tenantKey: 'tk2' })
    )
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feishu.member_accounts_removed',
        metadata: { count: 2 },
      })
    )
  })

  it('a same-tenant reinstall removes nothing and audits only the connect', async () => {
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({ openId: 'ou', tenantKey: 'tk', name: 'O' })
    mockTenantToken.mockResolvedValue({ token: 't', expiresAt: new Date() })
    mockTenantInfo.mockResolvedValue({ tenantKey: 'tk', name: 'Lumo Inc' })
    await completeInstall({
      workspaceId: WS,
      memberId: 'm1',
      role: 'OWNER',
      code: 'c',
      appUrl: APP_URL,
    })
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feishu.connected' })
    )
  })

  it('reports an install made for another app / domain as reinstallRequired', async () => {
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      appId: 'cli_old',
    })
    await expect(getInstallStatus(WS)).resolves.toMatchObject({
      connected: true,
      reinstallRequired: true,
    })
  })
})

describe('status reads without Feishu env (no 500)', () => {
  it.each([
    ['FEISHU_APP_ID missing', () => delete process.env.FEISHU_APP_ID],
    ['FEISHU_DOMAIN invalid', () => (process.env.FEISHU_DOMAIN = 'nope')],
  ])('%s: status still answers', async (_name, breakEnv) => {
    breakEnv()
    repo.findAccount.mockResolvedValue({
      name: 'M',
      tenantKey: 'tk',
      needsReauth: false,
    })
    await expect(getInstallStatus(WS)).resolves.toMatchObject({
      connected: true,
      reinstallRequired: true,
    })
    await expect(getAccountStatus(WS, 'm2')).resolves.toEqual({
      installed: false,
      connected: false,
      name: null,
      needsReauth: false,
    })
  })
})

describe('isInstallCurrent', () => {
  it('needs the same app id and domain as the env', () => {
    const app = { appId: 'cli_app', domain: 'feishu' as const }
    expect(isInstallCurrent({ appId: 'cli_app', domain: 'feishu' }, app)).toBe(
      true
    )
    expect(isInstallCurrent({ appId: 'cli_old', domain: 'feishu' }, app)).toBe(
      false
    )
    expect(isInstallCurrent({ appId: 'cli_app', domain: 'lark' }, app)).toBe(
      false
    )
  })
})

describe('getTenantAccessToken', () => {
  const NOW = 50_000_000

  it('returns the cached token while it has time left', async () => {
    repo.findInstallWithToken.mockResolvedValue({
      id: 'fi1',
      domain: 'feishu',
      appId: 'cli_app',
      tenantKey: 'tk',
      tenantAccessToken: encrypt('cached'),
      tenantTokenExpiresAt: new Date(NOW + 3_600_000),
    })
    await expect(getTenantAccessToken(WS, NOW)).resolves.toBe('cached')
    expect(mockTenantToken).not.toHaveBeenCalled()
  })

  it('fetches, encrypts and persists a new one when the cached one is expiring', async () => {
    repo.findInstallWithToken.mockResolvedValue({
      id: 'fi1',
      domain: 'feishu',
      appId: 'cli_app',
      tenantKey: 'tk',
      tenantAccessToken: encrypt('old'),
      tenantTokenExpiresAt: new Date(NOW + 60_000),
    })
    const expiresAt = new Date(NOW + 7_200_000)
    mockTenantToken.mockResolvedValue({ token: 'fresh', expiresAt })
    await expect(getTenantAccessToken(WS, NOW)).resolves.toBe('fresh')
    const [ws, id, next] = repo.updateTenantToken.mock.calls[0]
    expect([ws, id]).toEqual([WS, 'fi1'])
    expect(next.tenantTokenExpiresAt).toEqual(expiresAt)
    expect(decrypt(next.tenantAccessToken)).toBe('fresh')
  })

  it('throws not_installed without an install', async () => {
    repo.findInstallWithToken.mockResolvedValue(null)
    await expect(getTenantAccessToken(WS)).rejects.toMatchObject({
      code: 'not_installed',
    })
  })

  it('never hands out the cached token of another app (reinstall_required)', async () => {
    repo.findInstallWithToken.mockResolvedValue({
      id: 'fi1',
      domain: 'feishu',
      appId: 'cli_old',
      tenantKey: 'tk',
      tenantAccessToken: encrypt('other-app-token'),
      tenantTokenExpiresAt: new Date(NOW + 3_600_000),
    })
    await expect(getTenantAccessToken(WS, NOW)).rejects.toMatchObject({
      code: 'reinstall_required',
      status: 409,
    })
    process.env.FEISHU_DOMAIN = 'lark'
    repo.findInstallWithToken.mockResolvedValue({
      id: 'fi1',
      domain: 'feishu',
      appId: 'cli_app',
      tenantKey: 'tk',
      tenantAccessToken: encrypt('feishu-token'),
      tenantTokenExpiresAt: new Date(NOW + 3_600_000),
    })
    await expect(getTenantAccessToken(WS, NOW)).rejects.toMatchObject({
      code: 'reinstall_required',
    })
    expect(mockTenantToken).not.toHaveBeenCalled()
  })

  it('a disconnect during the refresh yields a clean not_installed', async () => {
    repo.findInstallWithToken.mockResolvedValue({
      id: 'fi1',
      domain: 'feishu',
      appId: 'cli_app',
      tenantKey: 'tk',
      tenantAccessToken: null,
      tenantTokenExpiresAt: null,
    })
    mockTenantToken.mockResolvedValue({ token: 'fresh', expiresAt: new Date() })
    repo.updateTenantToken.mockResolvedValue(false)
    await expect(getTenantAccessToken(WS, NOW)).rejects.toMatchObject({
      code: 'not_installed',
    })
  })
})

describe('member account link (PERSONAL)', () => {
  const install = CURRENT_INSTALL

  it('needs the workspace install before a member can start', async () => {
    repo.findInstallStatus.mockResolvedValue(null)
    await expect(
      buildAccountAuthorizeUrl({
        workspaceId: WS,
        memberId: 'm2',
        workspaceUrl: 'lumo',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'not_installed', status: 409 })
  })

  it('asks for offline_access + doc scopes with an account-leg state', async () => {
    repo.findInstallStatus.mockResolvedValue(install)
    const url = new URL(
      await buildAccountAuthorizeUrl({
        workspaceId: WS,
        memberId: 'm2',
        workspaceUrl: 'lumo',
        appUrl: APP_URL,
      })
    )
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${APP_URL}/api/feishu/account/callback`
    )
    const state = url.searchParams.get('state')!
    expect(decodeOauthState(state, Date.now(), 'feishu-account').ok).toBe(true)
    expect(decodeOauthState(state, Date.now(), 'feishu-install').ok).toBe(false)
  })

  it('stores both tokens encrypted with their expiries', async () => {
    repo.findInstallStatus.mockResolvedValue(install)
    const t = userToken()
    mockExchange.mockResolvedValue(t)
    mockUserInfo.mockResolvedValue({
      openId: 'ou_2',
      tenantKey: 'tk',
      name: 'M',
    })
    await completeAccountLink({
      workspaceId: WS,
      memberId: 'm2',
      code: 'c',
      appUrl: APP_URL,
    })
    const row = repo.upsertAccount.mock.calls[0][0]
    expect(row).toMatchObject({
      workspaceId: WS,
      memberId: 'm2',
      openId: 'ou_2',
      tenantKey: 'tk',
      name: 'M',
      expiresAt: t.expiresAt,
      refreshExpiresAt: t.refreshExpiresAt,
      scopes: t.scopes,
    })
    expect(row.accessToken).not.toContain('u-access')
    expect(row.refreshToken).not.toContain('u-refresh')
    expect(decrypt(row.accessToken)).toBe('u-access')
    expect(decrypt(row.refreshToken)).toBe('u-refresh')
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feishu_account.connected' })
    )
    const audited = JSON.stringify(mockAudit.mock.calls)
    expect(audited).not.toContain('u-access')
    expect(audited).not.toContain('u-refresh')
  })

  it('refuses a link without a refresh token (offline_access not granted)', async () => {
    repo.findInstallStatus.mockResolvedValue(install)
    mockExchange.mockResolvedValue(userToken({ refreshToken: null }))
    await expect(
      completeAccountLink({
        workspaceId: WS,
        memberId: 'm2',
        code: 'c',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'no_refresh_token' })
    expect(repo.upsertAccount).not.toHaveBeenCalled()
  })

  it('refuses an account from another tenant', async () => {
    repo.findInstallStatus.mockResolvedValue(install)
    mockExchange.mockResolvedValue(userToken())
    mockUserInfo.mockResolvedValue({
      openId: 'ou',
      tenantKey: 'other',
      name: null,
    })
    await expect(
      completeAccountLink({
        workspaceId: WS,
        memberId: 'm2',
        code: 'c',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'tenant_mismatch' })
    expect(repo.upsertAccount).not.toHaveBeenCalled()
  })

  it('reports status including needsReauth and whether the app is installed', async () => {
    repo.findAccount.mockResolvedValue({
      name: 'M',
      tenantKey: 'tk',
      needsReauth: true,
    })
    await expect(getAccountStatus(WS, 'm2')).resolves.toEqual({
      installed: true,
      connected: true,
      name: 'M',
      needsReauth: true,
    })
    repo.findInstallStatus.mockResolvedValue(null)
    repo.findAccount.mockResolvedValue(null)
    await expect(getAccountStatus(WS, 'm2')).resolves.toEqual({
      installed: false,
      connected: false,
      name: null,
      needsReauth: false,
    })
  })

  it('never reports connected without a matching current install', async () => {
    const link = { name: 'M', tenantKey: 'tk', needsReauth: false }
    repo.findAccount.mockResolvedValue(link)
    repo.findInstallStatus.mockResolvedValue(null)
    await expect(getAccountStatus(WS, 'm2')).resolves.toMatchObject({
      installed: false,
      connected: false,
    })
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      tenantKey: 'other',
    })
    await expect(getAccountStatus(WS, 'm2')).resolves.toMatchObject({
      installed: true,
      connected: false,
      name: null,
    })
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      appId: 'cli_old',
    })
    await expect(getAccountStatus(WS, 'm2')).resolves.toMatchObject({
      installed: false,
      connected: false,
    })
  })

  it('an account flow refuses a stale install (reinstall_required)', async () => {
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      domain: 'lark',
    })
    await expect(
      buildAccountAuthorizeUrl({
        workspaceId: WS,
        memberId: 'm2',
        workspaceUrl: 'lumo',
        appUrl: APP_URL,
      })
    ).rejects.toMatchObject({ code: 'reinstall_required', status: 409 })
  })

  it('the route disconnect is behind the rollout flag; member cleanup is not', async () => {
    await expect(disconnectAccount('ws_customer', 'm2')).rejects.toMatchObject({
      status: 404,
    })
    expect(repo.deleteAccount).not.toHaveBeenCalled()
    await removeAccountLink('ws_customer', 'm2')
    expect(repo.deleteAccount).toHaveBeenCalledWith('ws_customer', 'm2')
  })

  it('disconnect deletes the stored tokens and is audited', async () => {
    await disconnectAccount(WS, 'm2')
    expect(repo.deleteAccount).toHaveBeenCalledWith(WS, 'm2')
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'feishu_account.disconnected' })
    )
  })

  it('hasAccountLink reflects the row', async () => {
    repo.findAccount.mockResolvedValue(null)
    await expect(hasAccountLink(WS, 'm2')).resolves.toBe(false)
    repo.findAccount.mockResolvedValue({ id: 'a1' })
    await expect(hasAccountLink(WS, 'm2')).resolves.toBe(true)
  })
})

describe('getUserClientForMember', () => {
  const row = (over = {}) => ({
    id: 'fa1',
    domain: 'feishu',
    tenantKey: 'tk',
    name: 'M',
    accessToken: encrypt('a1'),
    refreshToken: encrypt('r1'),
    expiresAt: new Date(Date.now() - 1000), // expired
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
    needsReauth: false,
    ...over,
  })
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status })

  it('refreshes an expired token and persists the rotated pair encrypted', async () => {
    const stored = row()
    repo.findAccount.mockResolvedValue(stored)
    repo.updateAccountTokens.mockResolvedValue(true)
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          code: 0,
          access_token: 'a2',
          expires_in: 7200,
          refresh_token: 'r2',
          refresh_token_expires_in: 604800,
        })
      )
      .mockResolvedValueOnce(json(200, { code: 0, data: {} }))
    const client = await getUserClientForMember(WS, 'm2')
    await client.get('/open-apis/docx/v1/documents/x')
    const [ws, id, expected, next] = repo.updateAccountTokens.mock.calls[0]
    // Compare-and-swap against the ciphertext this client read.
    expect([ws, id, expected]).toEqual([WS, 'fa1', stored.refreshToken])
    expect(decrypt(next.accessToken)).toBe('a2')
    expect(decrypt(next.refreshToken)).toBe('r2')
    expect(repo.markAccountNeedsReauth).not.toHaveBeenCalled()
  })

  it('marks the link needsReauth when the refresh fails for good', async () => {
    const stored = row()
    repo.findAccount.mockResolvedValue(stored)
    fetchMock.mockResolvedValueOnce(json(400, { code: 20064 }))
    const client = await getUserClientForMember(WS, 'm2')
    await expect(client.get('/open-apis/x')).rejects.toBeInstanceOf(
      FeishuNeedsReauthError
    )
    // Only while the row still holds the refresh token that failed.
    expect(repo.markAccountNeedsReauth).toHaveBeenCalledWith(
      WS,
      'fa1',
      stored.refreshToken
    )
    expect(repo.updateAccountTokens).not.toHaveBeenCalled()
  })

  it('a refresh that lost the race to another process adopts the stored pair, no needsReauth', async () => {
    const mine = row()
    const rotated = row({
      accessToken: encrypt('a2'),
      refreshToken: encrypt('r2'),
      expiresAt: new Date(Date.now() + 7_200_000),
    })
    // Read at client creation, then re-read after the failed refresh.
    repo.findAccount.mockResolvedValueOnce(mine).mockResolvedValue(rotated)
    fetchMock
      .mockResolvedValueOnce(json(400, { code: 20073, error: 'used' }))
      .mockResolvedValueOnce(json(200, { code: 0, data: { ok: 1 } }))
    const client = await getUserClientForMember(WS, 'm2')
    await expect(client.get('/open-apis/x')).resolves.toEqual({
      code: 0,
      data: { ok: 1 },
    })
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer a2')
    expect(repo.markAccountNeedsReauth).not.toHaveBeenCalled()
    expect(repo.updateAccountTokens).not.toHaveBeenCalled()
  })

  it('a rotation whose compare-and-swap loses keeps the request going', async () => {
    repo.findAccount.mockResolvedValue(row())
    repo.updateAccountTokens.mockResolvedValue(false)
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          code: 0,
          access_token: 'a2',
          expires_in: 7200,
          refresh_token: 'r2',
          refresh_token_expires_in: 604800,
        })
      )
      .mockResolvedValueOnce(json(200, { code: 0 }))
    const client = await getUserClientForMember(WS, 'm2')
    await expect(client.get('/open-apis/x')).resolves.toEqual({ code: 0 })
    expect(repo.markAccountNeedsReauth).not.toHaveBeenCalled()
  })

  it('a rate-limited refresh (429) never flags needsReauth', async () => {
    repo.findAccount.mockResolvedValue(row())
    fetchMock.mockResolvedValueOnce(json(429, { code: 99991400 }))
    const client = await getUserClientForMember(WS, 'm2')
    await expect(client.get('/open-apis/x')).rejects.toMatchObject({
      httpStatus: 429,
    })
    expect(repo.markAccountNeedsReauth).not.toHaveBeenCalled()
  })

  it('does not mark needsReauth on a transient refresh failure', async () => {
    repo.findAccount.mockResolvedValue(row())
    fetchMock.mockResolvedValueOnce(json(503, { code: 20072 }))
    const client = await getUserClientForMember(WS, 'm2')
    await expect(client.get('/open-apis/x')).rejects.toBeTruthy()
    expect(repo.markAccountNeedsReauth).not.toHaveBeenCalled()
  })

  it('refuses with not_installed (409) when the install is gone or for another tenant', async () => {
    repo.findAccount.mockResolvedValue(row())
    repo.findInstallStatus.mockResolvedValue(null)
    await expect(getUserClientForMember(WS, 'm2')).rejects.toMatchObject({
      code: 'not_installed',
      status: 409,
    })
    repo.findInstallStatus.mockResolvedValue({
      ...CURRENT_INSTALL,
      tenantKey: 'other',
    })
    await expect(getUserClientForMember(WS, 'm2')).rejects.toMatchObject({
      code: 'not_installed',
      status: 409,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a missing or needs-reauth link up front', async () => {
    repo.findAccount.mockResolvedValue(null)
    await expect(getUserClientForMember(WS, 'm2')).rejects.toMatchObject({
      code: 'feishu_not_connected',
    })
    repo.findAccount.mockResolvedValue(row({ needsReauth: true }))
    await expect(getUserClientForMember(WS, 'm2')).rejects.toMatchObject({
      code: 'feishu_needs_reauth',
    })
  })
})
