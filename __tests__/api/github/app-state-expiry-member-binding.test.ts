/**
 * @jest-environment node
 *
 * LUM-991 — the GitHub App install / reverify `state` expires and is bound to
 * the member who started the flow, like the member OAuth flows (LUM-982).
 *
 * Legs: install → (GitHub) → setup → (GitHub authorize) → callback, and
 * reverify → (GitHub authorize) → callback. Every leg mints its state with
 * lib/integrations/oauth-state, and every receiver rejects an expired or
 * tampered state and a state completed by a different member of the same
 * workspace. Real AES-GCM crypto; the clock is jest's fake system time.
 */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/services/github-app-install.service', () => ({
  githubAppInstallService: {
    install: jest.fn(),
    reverify: jest.fn(),
    startReverify: jest.fn(),
    userAuthorizeUrl: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import {
  OAUTH_STATE_TTL_MS,
  decodeOauthState,
  encodeOauthState,
} from '@/lib/integrations/oauth-state'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { GET as installGET } from '@/app/api/github/app/install/route'
import { GET as reverifyGET } from '@/app/api/github/app/reverify/route'
import { GET as setupGET } from '@/app/api/github/app/setup/route'
import { GET as callbackGET } from '@/app/api/github/app/callback/route'

const APP_URL = 'https://app.test'
const NOW = 1_800_000_000_000
const install = githubAppInstallService.install as jest.Mock
const reverify = githubAppInstallService.reverify as jest.Mock
const userAuthorizeUrl = githubAppInstallService.userAuthorizeUrl as jest.Mock

/** Two members of the same workspace: A starts the flow, B tries to finish it. */
const MEMBER_A = {
  workspaceId: 'w1',
  member: { id: 'm_a', role: 'OWNER' },
  workspace: { slug: 'acme' },
}
const MEMBER_B = { ...MEMBER_A, member: { id: 'm_b', role: 'OWNER' } }

const A_STATE = { workspaceId: 'w1', workspaceUrl: 'acme', memberId: 'm_a' }

function signedInAs(ws: typeof MEMBER_A) {
  ;(getUserWorkspace as jest.Mock).mockResolvedValue(ws)
}

function req(path: string, query: Record<string, string>) {
  const url = new URL(`${APP_URL}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function stateOf(res: Response): string {
  const st = new URL(res.headers.get('location') ?? '').searchParams.get(
    'state'
  )
  if (!st) throw new Error(`no state in ${res.headers.get('location')}`)
  return st
}

const setup = (state: string) =>
  setupGET(
    req('/api/github/app/setup', {
      installation_id: '42',
      setup_action: 'install',
      state,
    })
  )
const callback = (state: string) =>
  callbackGET(req('/api/github/app/callback', { code: 'c', state }))

const INSTALL_VERIFY = { ...A_STATE, installationId: 42 }
const REVERIFY_VERIFY = {
  ...A_STATE,
  installationId: 42,
  mode: 'reverify' as const,
}

beforeAll(() => {
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
  process.env.GITHUB_APP_SLUG = 'lumo-app'
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers({ now: NOW })
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk_a' })
  signedInAs(MEMBER_A)
  install.mockResolvedValue({ installationId: 42 })
  reverify.mockResolvedValue({ confirmed: 1, added: [], removed: [] })
  ;(githubAppInstallService.startReverify as jest.Mock).mockResolvedValue(42)
  userAuthorizeUrl.mockImplementation(
    (st: string) =>
      `https://github.com/login/oauth/authorize?state=${encodeURIComponent(st)}`
  )
})

afterEach(() => {
  jest.useRealTimers()
})

describe('start legs mint an expiring state', () => {
  it('install: the state decodes fresh now and is expired after the TTL', async () => {
    const res = await installGET(
      req('/api/github/app/install', { workspaceUrl: 'acme' })
    )
    const st = stateOf(res)
    expect(decodeOauthState(st, NOW)).toEqual({ ok: true, payload: A_STATE })
    expect(decodeOauthState(st, NOW + OAUTH_STATE_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('reverify: the state carries installationId + mode and expires', async () => {
    const res = await reverifyGET(
      req('/api/github/app/reverify', { workspaceUrl: 'acme' })
    )
    const st = stateOf(res)
    expect(decodeOauthState(st, NOW)).toEqual({
      ok: true,
      payload: REVERIFY_VERIFY,
    })
    expect(decodeOauthState(st, NOW + OAUTH_STATE_TTL_MS + 1).ok).toBe(false)
  })

  it('setup: the verify state it hands to GitHub expires too', async () => {
    const res = await setup(encodeOauthState(A_STATE, NOW))
    expect(res.status).toBe(307)
    const st = stateOf(res)
    expect(decodeOauthState(st, NOW)).toEqual({
      ok: true,
      payload: INSTALL_VERIFY,
    })
    expect(decodeOauthState(st, NOW + OAUTH_STATE_TTL_MS + 1).ok).toBe(false)
  })
})

describe('setup', () => {
  it('fresh valid state from the same member → hands over to GitHub', async () => {
    const res = await setup(encodeOauthState(A_STATE, NOW - 60_000))
    expect(res.status).toBe(307)
    expect(userAuthorizeUrl).toHaveBeenCalledTimes(1)
  })

  it('expired state → rejected, nothing handed over', async () => {
    const res = await setup(
      encodeOauthState(A_STATE, NOW - OAUTH_STATE_TTL_MS - 1)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/expired/),
    })
    expect(userAuthorizeUrl).not.toHaveBeenCalled()
  })

  it('state minted by member A, completed by member B of the same workspace → rejected', async () => {
    signedInAs(MEMBER_B)
    const res = await setup(encodeOauthState(A_STATE, NOW))
    expect(res.status).toBe(403)
    expect(userAuthorizeUrl).not.toHaveBeenCalled()
  })

  it('tampered state → rejected', async () => {
    const st = encodeOauthState(A_STATE, NOW)
    const [iv, tag, ct] = st.split(':') as [string, string, string]
    const flipped = `${iv}:${tag}:${(ct[0] === 'a' ? 'b' : 'a') + ct.slice(1)}`
    const res = await setup(flipped)
    expect(res.status).toBe(400)
    expect(userAuthorizeUrl).not.toHaveBeenCalled()
  })
})

describe.each([
  ['install', INSTALL_VERIFY, install],
  ['reverify', REVERIFY_VERIFY, reverify],
] as const)('callback (%s mode)', (mode, payload, write) => {
  it('fresh valid state from the same member → succeeds', async () => {
    const res = await callback(encodeOauthState(payload, NOW - 60_000))
    expect(res.headers.get('location')).toBe(
      `${APP_URL}/workspace/acme/settings/integrations?github_app=${mode === 'install' ? 'installed' : 'reverified'}`
    )
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('expired state → rejected, nothing recorded', async () => {
    const res = await callback(
      encodeOauthState(payload, NOW - OAUTH_STATE_TTL_MS - 1)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/expired/),
    })
    expect(install).not.toHaveBeenCalled()
    expect(reverify).not.toHaveBeenCalled()
  })

  it('state minted by member A, completed by member B of the same workspace → rejected', async () => {
    signedInAs(MEMBER_B)
    const res = await callback(encodeOauthState(payload, NOW))
    expect(res.status).toBe(403)
    expect(install).not.toHaveBeenCalled()
    expect(reverify).not.toHaveBeenCalled()
  })

  it('tampered state → rejected', async () => {
    const st = encodeOauthState(payload, NOW)
    const [iv, tag, ct] = st.split(':') as [string, string, string]
    const flipped = `${iv}:${tag}:${(ct[0] === 'a' ? 'b' : 'a') + ct.slice(1)}`
    const res = await callback(flipped)
    expect(res.status).toBe(400)
    expect(install).not.toHaveBeenCalled()
    expect(reverify).not.toHaveBeenCalled()
  })
})

describe('end to end: install → setup → callback', () => {
  it('a flow finished within the TTL by the member who started it installs', async () => {
    const started = await installGET(
      req('/api/github/app/install', { workspaceUrl: 'acme' })
    )
    jest.setSystemTime(NOW + 5 * 60 * 1000)
    const handed = await setup(stateOf(started))
    expect(handed.status).toBe(307)
    jest.setSystemTime(NOW + 9 * 60 * 1000)
    const done = await callback(stateOf(handed))
    expect(done.headers.get('location')).toContain('github_app=installed')
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm_a', installationId: 42 })
    )
  })

  it('a captured install link replayed after the TTL is refused at setup', async () => {
    const started = await installGET(
      req('/api/github/app/install', { workspaceUrl: 'acme' })
    )
    jest.setSystemTime(NOW + OAUTH_STATE_TTL_MS + 1)
    const res = await setup(stateOf(started))
    expect(res.status).toBe(400)
    expect(userAuthorizeUrl).not.toHaveBeenCalled()
  })
})
