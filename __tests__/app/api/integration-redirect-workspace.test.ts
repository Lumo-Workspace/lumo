/**
 * @jest-environment node
 *
 * LUM-989 — integration connect flows are full-page redirects, so they never
 * carry the `X-Lumo-Workspace` header apiFetch sends (LUM-987). Without a slug
 * `getUserWorkspace` falls back to the user's earliest-joined workspace, which
 * refused a multi-workspace user connecting from any other workspace.
 *
 * Start routes must resolve with the `?workspaceUrl=` slug; callbacks with the
 * slug inside the verified state (never the query string), then keep the
 * workspaceId + memberId comparison.
 *
 * The REAL `getUserWorkspace` runs here (only Prisma, Clerk and next/headers
 * are stubbed), so a route that drops the slug resolves to ALPHA — exactly the
 * production behavior — rather than to whatever a hand-mocked helper returns.
 */
const mockFindMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceMember: { findMany: (...a: unknown[]) => mockFindMany(...a) },
  },
}))
// A redirect request has no X-Lumo-Workspace header.
jest.mock('next/headers', () => ({ headers: async () => new Headers() }))
const mockClerkAuth = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => mockClerkAuth(),
  currentUser: jest.fn(),
}))
jest.mock('@/lib/services/github.service', () => ({
  githubService: { upsertIntegration: jest.fn() },
}))
jest.mock('@/lib/services/slack.service', () => ({
  slackService: { upsertIntegration: jest.fn() },
}))
jest.mock('@/lib/services/figma-integration.service', () => ({
  ...jest.requireActual('@/lib/services/figma-integration.service'),
  completeOauthFlow: jest.fn(),
}))
jest.mock('@/lib/services/google-drive-integration.service', () => ({
  ...jest.requireActual('@/lib/services/google-drive-integration.service'),
  completeOauthFlow: jest.fn(),
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
import { encrypt, decrypt } from '@/lib/crypto'
import { encodeOauthState } from '@/lib/integrations/oauth-state'
import { githubService } from '@/lib/services/github.service'
import { slackService } from '@/lib/services/slack.service'
import * as figmaService from '@/lib/services/figma-integration.service'
import * as driveService from '@/lib/services/google-drive-integration.service'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { GET as githubOauth } from '@/app/api/github/oauth/route'
import { GET as githubCallback } from '@/app/api/github/callback/route'
import { GET as slackOauth } from '@/app/api/slack/oauth/route'
import { GET as slackCallback } from '@/app/api/slack/callback/route'
import { GET as figmaOauth } from '@/app/api/figma/oauth/route'
import { GET as figmaCallback } from '@/app/api/figma/callback/route'
import { GET as driveOauth } from '@/app/api/google-drive/oauth/route'
import { GET as driveCallback } from '@/app/api/google-drive/callback/route'
import { GET as appInstall } from '@/app/api/github/app/install/route'
import { GET as appReverify } from '@/app/api/github/app/reverify/route'
import { GET as appSetup } from '@/app/api/github/app/setup/route'
import { GET as appCallback } from '@/app/api/github/app/callback/route'

const APP = 'https://lumo.test'

const membership = (clerkId: string, wsId: string, slug: string) => ({
  id: `m_${slug}_${clerkId}`,
  workspaceId: wsId,
  clerkId,
  role: 'OWNER',
  workspace: { id: wsId, slug, name: slug },
})
/** DUAL joined ALPHA first, then BRAVO — ALPHA is the no-slug default. */
const DUAL_ALPHA = membership('dual', 'w_alpha', 'alpha')
const DUAL_BRAVO = membership('dual', 'w_bravo', 'bravo')
/** Another member of BRAVO, for replayed-state checks. */
const OTHER_BRAVO = membership('other', 'w_bravo', 'bravo')
const SOLO_ALPHA = membership('solo', 'w_alpha', 'alpha')

const MEMBERSHIPS: Record<string, unknown[]> = {
  dual: [DUAL_ALPHA, DUAL_BRAVO],
  other: [OTHER_BRAVO],
  solo: [SOLO_ALPHA],
}

function signIn(clerkId: string) {
  mockClerkAuth.mockResolvedValue({ userId: clerkId })
}

function req(path: string, query: Record<string, string>): NextRequest {
  const url = new URL(`${APP}${path}`)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

function stateParam(location: string): string {
  const state = new URL(location).searchParams.get('state')
  if (!state) throw new Error(`no state in ${location}`)
  return state
}

const fetchMock = jest.fn()

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP
  if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = '0'.repeat(64)
  process.env.GITHUB_CLIENT_ID = 'gh_client'
  process.env.SLACK_CLIENT_ID = 'slack_client'
  process.env.SLACK_CLIENT_SECRET = 'slack_secret'
  process.env.FIGMA_OAUTH_CLIENT_ID = 'figma_client'
  process.env.FIGMA_OAUTH_REDIRECT_URI = `${APP}/api/figma/callback`
  process.env.GOOGLE_CLIENT_ID = 'google_client'
  process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI = `${APP}/api/google-drive/callback`
  process.env.GITHUB_APP_SLUG = 'lumo-app'
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
  mockFindMany.mockImplementation(
    async (args: { where: { clerkId: string } }) =>
      MEMBERSHIPS[args.where.clerkId] ?? []
  )
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'gho_test' }))
    }
    if (url.startsWith('https://api.github.com/user')) {
      return new Response(JSON.stringify({ id: 42, login: 'octo' }))
    }
    if (url.startsWith('https://slack.com/api/oauth.v2.access')) {
      return new Response(
        JSON.stringify({
          ok: true,
          access_token: 'xoxb-test',
          team: { id: 'T1', name: 'Team' },
          authed_user: { id: 'U1' },
        })
      )
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  ;(githubAppInstallService.userAuthorizeUrl as jest.Mock).mockImplementation(
    (st: string) =>
      `https://github.com/login/oauth/authorize?state=${encodeURIComponent(st)}`
  )
  ;(githubAppInstallService.startReverify as jest.Mock).mockResolvedValue(77)
})

// ── Start routes ────────────────────────────────────────────────────────────

type StartFlow = {
  name: string
  path: string
  GET: (r: NextRequest) => Promise<Response>
  /** The workspace the flow was started for, read back from what it emitted. */
  boundWorkspace: (res: Response) => { workspaceId: string; memberId: string }
}

const decodeMemberState = (res: Response) => {
  const st = JSON.parse(
    decrypt(stateParam(res.headers.get('location') ?? ''))
  ) as { workspaceId: string; memberId: string }
  return { workspaceId: st.workspaceId, memberId: st.memberId }
}

const START_FLOWS: StartFlow[] = [
  {
    name: 'github/oauth',
    path: '/api/github/oauth',
    GET: githubOauth,
    boundWorkspace: decodeMemberState,
  },
  {
    name: 'slack/oauth',
    path: '/api/slack/oauth',
    GET: slackOauth,
    boundWorkspace: decodeMemberState,
  },
  {
    name: 'figma/oauth',
    path: '/api/figma/oauth',
    GET: figmaOauth,
    boundWorkspace: decodeMemberState,
  },
  {
    name: 'google-drive/oauth',
    path: '/api/google-drive/oauth',
    GET: driveOauth,
    boundWorkspace: decodeMemberState,
  },
  {
    name: 'github/app/install',
    path: '/api/github/app/install',
    GET: appInstall,
    boundWorkspace: decodeMemberState,
  },
  {
    name: 'github/app/reverify',
    path: '/api/github/app/reverify',
    GET: appReverify,
    boundWorkspace: res => {
      const bound = decodeMemberState(res)
      expect(githubAppInstallService.startReverify).toHaveBeenCalledWith(
        bound.workspaceId,
        'OWNER'
      )
      return bound
    },
  },
]

describe.each(START_FLOWS)('start: $name', flow => {
  it('dual-member user starting from the second workspace → redirect bound to that workspace', async () => {
    signIn('dual')
    const res = await flow.GET(req(flow.path, { workspaceUrl: 'bravo' }))

    expect(res.status).toBe(307)
    expect(flow.boundWorkspace(res)).toEqual({
      workspaceId: 'w_bravo',
      memberId: DUAL_BRAVO.id,
    })
  })

  it('dual-member user starting from the default workspace → still bound to it', async () => {
    signIn('dual')
    const res = await flow.GET(req(flow.path, { workspaceUrl: 'alpha' }))

    expect(res.status).toBe(307)
    expect(flow.boundWorkspace(res)).toEqual({
      workspaceId: 'w_alpha',
      memberId: DUAL_ALPHA.id,
    })
  })

  it('slug the user is not a member of → 403', async () => {
    signIn('dual')
    const res = await flow.GET(req(flow.path, { workspaceUrl: 'charlie' }))
    expect(res.status).toBe(403)
  })

  it('single-workspace user: own slug works, any other slug is 403', async () => {
    signIn('solo')
    const ok = await flow.GET(req(flow.path, { workspaceUrl: 'alpha' }))
    expect(ok.status).toBe(307)
    expect(flow.boundWorkspace(ok)).toEqual({
      workspaceId: 'w_alpha',
      memberId: SOLO_ALPHA.id,
    })

    const refused = await flow.GET(req(flow.path, { workspaceUrl: 'bravo' }))
    expect(refused.status).toBe(403)
  })
})

// ── Member OAuth callbacks (GitHub OAuth, Slack, Figma, Google Drive) ──────

type MemberCallback = {
  name: string
  path: string
  GET: (r: NextRequest) => Promise<Response>
  mintState: (p: {
    workspaceId: string
    memberId: string
    workspaceUrl: string
  }) => string
  /** The (workspaceId, memberId) the callback wrote, or null when it wrote nothing. */
  written: () => { workspaceId: string; memberId: string } | null
  mismatch: string
  invalid: string
}

const writtenBy =
  (fn: unknown, member: 'memberId' | 'installedBy') =>
  (): { workspaceId: string; memberId: string } | null => {
    const arg = (fn as jest.Mock).mock.calls[0]?.[0] as
      | { workspaceId: string; memberId?: string; installedBy?: string }
      | undefined
    if (!arg) return null
    return { workspaceId: arg.workspaceId, memberId: arg[member] ?? '' }
  }

const MEMBER_CALLBACKS: MemberCallback[] = [
  {
    name: 'github/callback',
    path: '/api/github/callback',
    GET: githubCallback,
    mintState: p => encodeOauthState(p),
    written: writtenBy(githubService.upsertIntegration, 'memberId'),
    mismatch: 'github_error=identity_mismatch',
    invalid: 'github_error=invalid_state',
  },
  {
    name: 'slack/callback',
    path: '/api/slack/callback',
    GET: slackCallback,
    mintState: p => encodeOauthState(p),
    written: writtenBy(slackService.upsertIntegration, 'installedBy'),
    mismatch: 'slack_error=identity_mismatch',
    invalid: 'slack_error=invalid_state',
  },
  {
    name: 'figma/callback',
    path: '/api/figma/callback',
    GET: figmaCallback,
    mintState: p => figmaService.encodeOauthState(p),
    written: writtenBy(figmaService.completeOauthFlow, 'memberId'),
    mismatch: 'figma_error=identity_mismatch',
    invalid: 'figma_error=invalid_state',
  },
  {
    name: 'google-drive/callback',
    path: '/api/google-drive/callback',
    GET: driveCallback,
    mintState: p => driveService.encodeOauthState(p),
    written: writtenBy(driveService.completeOauthFlow, 'memberId'),
    mismatch: 'google_error=identity_mismatch',
    invalid: 'google_error=invalid_state',
  },
]

const BRAVO_STATE = {
  workspaceId: 'w_bravo',
  memberId: DUAL_BRAVO.id,
  workspaceUrl: 'bravo',
}

describe.each(MEMBER_CALLBACKS)('callback: $name', flow => {
  it('dual-member user, state from the second workspace → binds to that member', async () => {
    signIn('dual')
    const res = await flow.GET(
      req(flow.path, { code: 'c', state: flow.mintState(BRAVO_STATE) })
    )

    expect(res.headers.get('location')).toContain(
      `${APP}/workspace/bravo/settings/integrations`
    )
    expect(res.headers.get('location')).not.toContain('error')
    expect(flow.written()).toEqual({
      workspaceId: 'w_bravo',
      memberId: DUAL_BRAVO.id,
    })
  })

  it('a slug in the query string is ignored — only the verified state counts', async () => {
    signIn('dual')
    const res = await flow.GET(
      req(flow.path, {
        code: 'c',
        state: flow.mintState(BRAVO_STATE),
        workspaceUrl: 'alpha',
      })
    )

    expect(flow.written()).toEqual({
      workspaceId: 'w_bravo',
      memberId: DUAL_BRAVO.id,
    })
    expect(res.headers.get('location')).not.toContain('error')
  })

  it('state for a workspace the user is not a member of → identity_mismatch, nothing written', async () => {
    signIn('dual')
    const res = await flow.GET(
      req(flow.path, {
        code: 'c',
        state: flow.mintState({
          workspaceId: 'w_charlie',
          memberId: 'm_charlie',
          workspaceUrl: 'charlie',
        }),
      })
    )

    expect(res.headers.get('location')).toContain(flow.mismatch)
    expect(flow.written()).toBeNull()
  })

  it('another member of the same workspace replaying the state → identity_mismatch', async () => {
    signIn('other')
    const res = await flow.GET(
      req(flow.path, { code: 'c', state: flow.mintState(BRAVO_STATE) })
    )

    expect(res.headers.get('location')).toContain(flow.mismatch)
    expect(flow.written()).toBeNull()
  })

  it('tampered state → rejected, nothing written', async () => {
    signIn('dual')
    const res = await flow.GET(
      req(flow.path, { code: 'c', state: 'not-a-real-state' })
    )

    expect(res.headers.get('location')).toContain(flow.invalid)
    expect(flow.written()).toBeNull()
  })

  it('single-workspace user: zero behavior change', async () => {
    signIn('solo')
    const res = await flow.GET(
      req(flow.path, {
        code: 'c',
        state: flow.mintState({
          workspaceId: 'w_alpha',
          memberId: SOLO_ALPHA.id,
          workspaceUrl: 'alpha',
        }),
      })
    )

    expect(res.headers.get('location')).toContain(
      `${APP}/workspace/alpha/settings/integrations`
    )
    expect(flow.written()).toEqual({
      workspaceId: 'w_alpha',
      memberId: SOLO_ALPHA.id,
    })
  })
})

describe('expired state is still rejected', () => {
  it.each([
    [
      'github/callback',
      githubCallback,
      '/api/github/callback',
      'github_error=expired',
    ],
    [
      'slack/callback',
      slackCallback,
      '/api/slack/callback',
      'slack_error=expired',
    ],
  ] as const)('%s', async (_n, GET, path, expected) => {
    signIn('dual')
    const state = encodeOauthState(BRAVO_STATE, Date.now() - 11 * 60 * 1000)
    const res = await GET(req(path, { code: 'c', state }))
    expect(res.headers.get('location')).toContain(expected)
    expect(githubService.upsertIntegration).not.toHaveBeenCalled()
    expect(slackService.upsertIntegration).not.toHaveBeenCalled()
  })

  it.each([
    [
      'figma/callback',
      figmaCallback,
      '/api/figma/callback',
      'figma_error=invalid_state',
      figmaService.completeOauthFlow,
    ],
    [
      'google-drive/callback',
      driveCallback,
      '/api/google-drive/callback',
      'google_error=invalid_state',
      driveService.completeOauthFlow,
    ],
  ] as const)('%s', async (_n, GET, path, expected, write) => {
    signIn('dual')
    const state = encrypt(
      JSON.stringify({ ...BRAVO_STATE, iat: Date.now() - 11 * 60 * 1000 })
    )
    const res = await GET(req(path, { code: 'c', state }))
    expect(res.headers.get('location')).toContain(expected)
    expect(write).not.toHaveBeenCalled()
  })
})

// ── GitHub App install legs (setup → callback) ─────────────────────────────

describe('github/app/setup', () => {
  const setupState = (p: {
    workspaceId: string
    workspaceUrl: string
    memberId: string
  }) => encrypt(JSON.stringify(p))

  it('dual-member user, install started from the second workspace → verify state for that workspace', async () => {
    signIn('dual')
    const res = await appSetup(
      req('/api/github/app/setup', {
        installation_id: '42',
        setup_action: 'install',
        state: setupState(BRAVO_STATE),
      })
    )

    expect(res.status).toBe(307)
    const verify = JSON.parse(
      decrypt(stateParam(res.headers.get('location') ?? ''))
    ) as Record<string, unknown>
    expect(verify).toMatchObject({
      workspaceId: 'w_bravo',
      workspaceUrl: 'bravo',
      memberId: DUAL_BRAVO.id,
      installationId: 42,
    })
  })

  it('state for a workspace the user is not a member of → 403', async () => {
    signIn('dual')
    const res = await appSetup(
      req('/api/github/app/setup', {
        installation_id: '42',
        state: setupState({
          workspaceId: 'w_charlie',
          workspaceUrl: 'charlie',
          memberId: 'm_charlie',
        }),
      })
    )
    expect(res.status).toBe(403)
    expect(githubAppInstallService.userAuthorizeUrl).not.toHaveBeenCalled()
  })

  it('tampered state → 400', async () => {
    signIn('dual')
    const res = await appSetup(
      req('/api/github/app/setup', { installation_id: '42', state: 'junk' })
    )
    expect(res.status).toBe(400)
  })

  it('single-workspace user: zero behavior change', async () => {
    signIn('solo')
    const res = await appSetup(
      req('/api/github/app/setup', {
        installation_id: '42',
        state: setupState({
          workspaceId: 'w_alpha',
          workspaceUrl: 'alpha',
          memberId: SOLO_ALPHA.id,
        }),
      })
    )
    expect(res.status).toBe(307)
  })
})

describe('github/app/callback', () => {
  const verifyState = (p: Record<string, unknown>) =>
    encrypt(JSON.stringify({ installationId: 42, ...p }))

  it('dual-member user, install from the second workspace → installs onto that workspace/member', async () => {
    signIn('dual')
    const res = await appCallback(
      req('/api/github/app/callback', {
        code: 'c',
        state: verifyState(BRAVO_STATE),
      })
    )

    expect(res.headers.get('location')).toBe(
      `${APP}/workspace/bravo/settings/integrations?github_app=installed`
    )
    expect(githubAppInstallService.install).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w_bravo',
        memberId: DUAL_BRAVO.id,
        installationId: 42,
      })
    )
  })

  it('reverify from the second workspace → reverifies that workspace', async () => {
    signIn('dual')
    await appCallback(
      req('/api/github/app/callback', {
        code: 'c',
        state: verifyState({ ...BRAVO_STATE, mode: 'reverify' }),
      })
    )
    expect(githubAppInstallService.reverify).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w_bravo' })
    )
  })

  it('state for a workspace the user is not a member of → 403, nothing recorded', async () => {
    signIn('dual')
    const res = await appCallback(
      req('/api/github/app/callback', {
        code: 'c',
        state: verifyState({
          workspaceId: 'w_charlie',
          workspaceUrl: 'charlie',
          memberId: 'm_charlie',
        }),
      })
    )
    expect(res.status).toBe(403)
    expect(githubAppInstallService.install).not.toHaveBeenCalled()
  })

  it('tampered state → 400', async () => {
    signIn('dual')
    const res = await appCallback(
      req('/api/github/app/callback', { code: 'c', state: 'junk' })
    )
    expect(res.status).toBe(400)
    expect(githubAppInstallService.install).not.toHaveBeenCalled()
  })
})
