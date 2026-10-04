/**
 * @jest-environment node
 *
 * LUM-982 — the GitHub OAuth callback must bind the token to the signed-in
 * member (not just whoever's id is inside `state`) and reject stale state.
 */
import { NextRequest, NextResponse } from 'next/server'
import { GET } from '@/app/api/github/callback/route'
import { encrypt } from '@/lib/crypto'
import * as auth from '@/lib/auth'
import { githubService } from '@/lib/services/github.service'

jest.mock('@/lib/auth')
jest.mock('@/lib/services/github.service', () => ({
  githubService: { upsertIntegration: jest.fn() },
}))

const fetchMock = jest.fn()

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  jest.resetAllMocks()
  ;(auth.requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk_1' })
  ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    member: { id: 'm1' },
    workspace: { slug: 'lumo' },
  })
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(
        JSON.stringify({ access_token: 'gho_test', token_type: 'bearer' })
      )
    }
    return new Response(JSON.stringify({ id: 42, login: 'octo' }))
  })
})

function makeState(extra: Record<string, unknown> = {}): string {
  return encrypt(
    JSON.stringify({
      memberId: 'm1',
      workspaceId: 'w1',
      workspaceUrl: 'lumo',
      iat: Date.now(),
      ...extra,
    })
  )
}

function makeReq(query: Record<string, string>): NextRequest {
  const url = new URL('https://lumo.test/api/github/callback')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('GET /api/github/callback', () => {
  it('(a) signed out → 401, no upsert', async () => {
    ;(auth.requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(makeReq({ code: 'c', state: makeState() }))

    expect(res.status).toBe(401)
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('(b) signed in as another member → identity_mismatch, no upsert', async () => {
    ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w2',
      member: { id: 'm_attacker' },
      workspace: { slug: 'evil' },
    })

    const res = await GET(makeReq({ code: 'c', state: makeState() }))

    expect(res.headers.get('location')).toContain(
      'github_error=identity_mismatch'
    )
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('(b) same workspace, different member → identity_mismatch', async () => {
    ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm_other' },
      workspace: { slug: 'lumo' },
    })

    const res = await GET(makeReq({ code: 'c', state: makeState() }))

    expect(res.headers.get('location')).toContain(
      'github_error=identity_mismatch'
    )
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('(c) state older than the expiry → expired, no upsert', async () => {
    const state = makeState({ iat: Date.now() - 11 * 60 * 1000 })

    const res = await GET(makeReq({ code: 'c', state }))

    expect(res.headers.get('location')).toContain('github_error=expired')
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('(c) state without iat (issued before expiry existed) → rejected', async () => {
    const state = makeState({ iat: undefined })

    const res = await GET(makeReq({ code: 'c', state }))

    expect(res.headers.get('location')).toContain('github_error=expired')
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('tampered state → invalid_state, no upsert', async () => {
    const res = await GET(makeReq({ code: 'c', state: 'not-a-real-state' }))

    expect(res.headers.get('location')).toContain('github_error=invalid_state')
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
  })

  it('(d) matching member + fresh state → upsert for that member/workspace', async () => {
    const res = await GET(makeReq({ code: 'c', state: makeState() }))

    expect(res.headers.get('location')).toBe(
      'https://lumo.test/workspace/lumo/settings/integrations'
    )
    expect(githubService.upsertIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        memberId: 'm1',
        githubUserId: '42',
        githubLogin: 'octo',
      })
    )
  })
})
