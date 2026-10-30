/**
 * @jest-environment node
 *
 * LUM-1341 — the Feishu OAuth routes. The state is rejected when tampered,
 * expired, minted for the other leg, or replayed by another member / in
 * another workspace; only a verified callback reaches the service.
 *
 * The REAL getUserWorkspace runs (only Prisma and the session are stubbed),
 * as in integration-redirect-workspace.test.ts.
 */
const mockFindMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  },
}))
jest.mock('next/headers', () => ({ headers: async () => new Headers() }))
const mockSession = jest.fn()
jest.mock('@/lib/auth/session', () => ({
  getCurrentUserId: async () => mockSession(),
}))
const mockCompleteInstall = jest.fn()
const mockCompleteAccount = jest.fn()
const mockBuildAccountUrl = jest.fn()
jest.mock('@/lib/services/feishu-integration.service', () => ({
  ...jest.requireActual('@/lib/services/feishu-integration.service'),
  completeInstall: (...a: unknown[]) => mockCompleteInstall(...a),
  completeAccountLink: (...a: unknown[]) => mockCompleteAccount(...a),
  buildAccountAuthorizeUrl: (...a: unknown[]) => mockBuildAccountUrl(...a),
}))

import { NextRequest } from 'next/server'
import { encrypt } from '@/lib/crypto'
import {
  encodeOauthState,
  OAUTH_STATE_TTL_MS,
} from '@/lib/integrations/oauth-state'
import { GET as installStart } from '@/app/api/feishu/install/route'
import { GET as installCallback } from '@/app/api/feishu/install/callback/route'
import { GET as accountStart } from '@/app/api/feishu/account/connect/route'
import { GET as accountCallback } from '@/app/api/feishu/account/callback/route'

const APP = 'https://lumo.test'

const membership = (
  clerkId: string,
  wsId: string,
  slug: string,
  role = 'OWNER'
) => ({
  id: `m_${slug}_${clerkId}`,
  workspaceId: wsId,
  clerkId,
  role,
  workspace: { id: wsId, slug, name: slug },
})
const OWNER_ALPHA = membership('owner', 'w_alpha', 'alpha')
const OWNER_BRAVO = membership('owner', 'w_bravo', 'bravo')
const MEMBER_ALPHA = membership('member', 'w_alpha', 'alpha', 'MEMBER')
const MEMBERSHIPS: Record<string, unknown[]> = {
  owner: [OWNER_ALPHA, OWNER_BRAVO],
  member: [MEMBER_ALPHA],
}

function req(path: string, query: Record<string, string>): NextRequest {
  const url = new URL(`${APP}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}
const location = (res: Response) => res.headers.get('location') ?? ''

const ALPHA_OWNER_STATE = {
  workspaceId: 'w_alpha',
  memberId: OWNER_ALPHA.id,
  workspaceUrl: 'alpha',
}

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.FEISHU_APP_ID = 'cli_app'
  process.env.FEISHU_APP_SECRET = 'secret'
  process.env.LUMO_DOGFOOD_WORKSPACE_IDS = 'w_alpha,w_bravo'
  mockSession.mockResolvedValue('owner')
  mockFindMany.mockImplementation(
    async (args: { where: { clerkId: string } }) =>
      MEMBERSHIPS[args.where.clerkId] ?? []
  )
})

const CALLBACKS = [
  {
    leg: 'install',
    GET: installCallback,
    path: '/api/feishu/install/callback',
    purpose: 'feishu-install' as const,
    other: 'feishu-account' as const,
    complete: mockCompleteInstall,
    page: 'integrations',
  },
  {
    leg: 'account',
    GET: accountCallback,
    path: '/api/feishu/account/callback',
    purpose: 'feishu-account' as const,
    other: 'feishu-install' as const,
    complete: mockCompleteAccount,
    page: 'connected-accounts',
  },
]

describe.each(CALLBACKS)('callback: $leg', flow => {
  const settings = `${APP}/workspace/alpha/settings/${flow.page}`

  it('a valid state reaches the service for the member who started it', async () => {
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const res = await flow.GET(req(flow.path, { code: 'c1', state }))
    expect(location(res)).toBe(`${settings}?feishu_connected=1`)
    expect(flow.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w_alpha',
        memberId: OWNER_ALPHA.id,
        code: 'c1',
        appUrl: APP,
      }),
      expect.anything()
    )
  })

  it('rejects a tampered state', async () => {
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const tampered = state.slice(0, -2) + (state.endsWith('00') ? '11' : '00')
    const res = await flow.GET(req(flow.path, { code: 'c', state: tampered }))
    expect(location(res)).toContain('feishu_error=invalid_state')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('rejects a state replayed into another workspace than the member it names', async () => {
    const forged = encrypt(
      JSON.stringify({
        workspaceId: 'w_bravo',
        memberId: OWNER_ALPHA.id,
        workspaceUrl: 'bravo',
        purpose: flow.purpose,
        iat: Date.now(),
      })
    )
    // Genuine ciphertext naming bravo, but carrying the alpha member id: in
    // bravo the signed-in user is a different member, so it is refused.
    const res = await flow.GET(req(flow.path, { code: 'c', state: forged }))
    expect(location(res)).toContain('feishu_error=identity_mismatch')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('rejects an expired state', async () => {
    const state = encodeOauthState(
      { ...ALPHA_OWNER_STATE, purpose: flow.purpose },
      Date.now() - OAUTH_STATE_TTL_MS - 1000
    )
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(location(res)).toContain('feishu_error=expired')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('rejects a state minted for the other Feishu leg', async () => {
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.other,
    })
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(location(res)).toContain('feishu_error=invalid_state')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('rejects a captured state replayed by another member of the workspace', async () => {
    mockSession.mockResolvedValue('member')
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(location(res)).toContain('feishu_error=identity_mismatch')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('rejects a state replayed in a workspace the signed-in user is not in', async () => {
    mockSession.mockResolvedValue('member') // only in alpha
    const state = encodeOauthState({
      workspaceId: 'w_bravo',
      memberId: OWNER_BRAVO.id,
      workspaceUrl: 'bravo',
      purpose: flow.purpose,
    })
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(location(res)).toContain('feishu_error=identity_mismatch')
    expect(flow.complete).not.toHaveBeenCalled()
  })

  it('reports the user declining consent', async () => {
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const res = await flow.GET(
      req(flow.path, { error: 'access_denied', state })
    )
    expect(location(res)).toBe(`${settings}?feishu_error=denied`)
  })

  it('puts a service flow error code in the redirect, never its message', async () => {
    flow.complete.mockRejectedValue(
      Object.assign(new Error('secret detail'), {
        code: 'tenant_mismatch',
        status: 403,
      })
    )
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(location(res)).toBe(`${settings}?feishu_error=tenant_mismatch`)
  })

  it('404s when the deployment has no Feishu app configured', async () => {
    delete process.env.FEISHU_APP_ID
    const state = encodeOauthState({
      ...ALPHA_OWNER_STATE,
      purpose: flow.purpose,
    })
    const res = await flow.GET(req(flow.path, { code: 'c', state }))
    expect(res.status).toBe(404)
  })
})

describe('install start', () => {
  it('redirects an owner to the Feishu authorize page for that workspace', async () => {
    const res = await installStart(
      req('/api/feishu/install', { workspaceUrl: 'bravo' })
    )
    const url = new URL(location(res))
    expect(url.origin + url.pathname).toBe(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize'
    )
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${APP}/api/feishu/install/callback`
    )
  })

  it('sends a non-owner back with not_owner', async () => {
    mockSession.mockResolvedValue('member')
    const res = await installStart(
      req('/api/feishu/install', { workspaceUrl: 'alpha' })
    )
    expect(location(res)).toBe(
      `${APP}/workspace/alpha/settings/integrations?feishu_error=not_owner`
    )
  })

  it('404s for a workspace outside the rollout', async () => {
    process.env.LUMO_DOGFOOD_WORKSPACE_IDS = 'w_other'
    const res = await installStart(
      req('/api/feishu/install', { workspaceUrl: 'alpha' })
    )
    expect(res.status).toBe(404)
  })
})

describe('account start', () => {
  it('sends the member to the authorize URL the service builds', async () => {
    mockBuildAccountUrl.mockResolvedValue('https://accounts.feishu.cn/x')
    const res = await accountStart(
      req('/api/feishu/account/connect', { workspaceUrl: 'alpha' })
    )
    expect(location(res)).toBe('https://accounts.feishu.cn/x')
    expect(mockBuildAccountUrl).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w_alpha', workspaceUrl: 'alpha' })
    )
  })

  it('names not_installed when the workspace has no install yet', async () => {
    mockBuildAccountUrl.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'not_installed', status: 409 })
    )
    const res = await accountStart(
      req('/api/feishu/account/connect', { workspaceUrl: 'alpha' })
    )
    expect(location(res)).toBe(
      `${APP}/workspace/alpha/settings/connected-accounts?feishu_error=not_installed`
    )
  })
})
