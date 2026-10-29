/**
 * @jest-environment node
 *
 * LUM-1039: the hosted MCP endpoint must answer at the URL the Next App
 * Router actually delivers to `app/api/mcp/route.ts`.
 *
 * The request path is not hand-picked: it is derived from the route file's
 * location under `app/`, which is the only path Next will ever hand to this
 * module (the directory has no dynamic / catch-all segment). Before the fix,
 * `basePath: '/api/mcp'` made mcp-handler match only `/api/mcp/mcp`, so a
 * request Next delivered to this file got 404.
 *
 * Token verification is mocked to an authenticated principal for the fixture
 * bearer token only (no token → undefined, like the real verifier).
 */
import fs from 'fs'
import path from 'path'

jest.mock('@/lib/repositories/mcp-connection.repository', () => ({
  mcpConnectionRepository: {
    upsertOnConnect: jest.fn(),
    setActiveWorkspace: jest.fn(),
    findByClerkUserAndClient: jest.fn(),
    touchLastUsed: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findByClerkId: jest.fn() },
}))

jest.mock('@/lib/mcp/rate-limit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue({ success: true }),
  BOOTSTRAP_TOOLS: new Set([
    'list_my_workspaces',
    'select_workspace',
    'get_active_workspace',
  ]),
}))

jest.mock('@/lib/mcp/audit', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/auth/mcp', () => ({
  isMcpOAuthSupported: () => true,
  mcpOAuthUnsupportedResponse: () => new Response(null, { status: 501 }),
  verifyMcpAccessToken: jest.fn(async (token: string | undefined) =>
    token === 'fixture-bearer-token'
      ? {
          token,
          clientId: 'test_client',
          scopes: [],
          userId: 'test_user_clerk_id',
          extra: { userId: 'test_user_clerk_id' },
        }
      : undefined
  ),
}))

import { POST } from '@/app/api/mcp/route'
import { mcpConnectionRepository } from '@/lib/repositories/mcp-connection.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

const APP_DIR = path.join(process.cwd(), 'app')
const ROUTE_DIR = path.join(APP_DIR, 'api', 'mcp')

/** The URL path Next's App Router serves `app/api/mcp/route.ts` at. */
function appRouterPathOf(routeDir: string): string {
  return '/' + path.relative(APP_DIR, routeDir).split(path.sep).join('/')
}

const ROUTED_PATH = appRouterPathOf(ROUTE_DIR)

function mcpPost(body: unknown, authorization?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (authorization) headers.Authorization = authorization
  return new Request(`http://localhost${ROUTED_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function readJsonRpc(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const dataLine = text.split('\n').find(l => l.startsWith('data:'))
  const json = dataLine ? dataLine.slice('data:'.length).trim() : text.trim()
  return JSON.parse(json) as Record<string, unknown>
}

describe('hosted MCP endpoint — published URL (LUM-1039)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(mcpConnectionRepository.upsertOnConnect as jest.Mock).mockResolvedValue({
      id: 'conn1',
      activeWorkspaceId: null,
      clerkUserId: 'test_user_clerk_id',
      clientId: 'test_client',
      clientName: null,
      lastUsedAt: new Date(),
      revokedAt: null,
      autoBoundAt: null,
    })
    ;(memberRepository.findByClerkId as jest.Mock).mockResolvedValue([
      {
        id: 'mem1',
        workspaceId: 'ws1',
        role: 'OWNER',
        workspace: { name: 'Alpha', slug: 'alpha' },
      },
      {
        id: 'mem2',
        workspaceId: 'ws2',
        role: 'MEMBER',
        workspace: { name: 'Beta', slug: 'beta' },
      },
    ])
  })

  it('is routed by Next at /api/mcp only (no dynamic segment below it)', () => {
    expect(ROUTED_PATH).toBe('/api/mcp')
    expect(fs.existsSync(path.join(ROUTE_DIR, 'route.ts'))).toBe(true)
    const subdirs = fs
      .readdirSync(ROUTE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
    expect(subdirs).toEqual([])
  })

  it('answers tools/list with 200 at the routed URL for an authenticated principal', async () => {
    const res = await POST(
      mcpPost(
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        'Bearer fixture-bearer-token'
      )
    )

    expect(res.status).toBe(200)
    const body = await readJsonRpc(res)
    const tools = (body.result as { tools: { name: string }[] }).tools
    expect(tools.map(t => t.name)).toEqual(
      expect.arrayContaining(['list_my_workspaces', 'select_workspace'])
    )
  })

  it('returns 401 with a WWW-Authenticate challenge at the routed URL without a token', async () => {
    const res = await POST(
      mcpPost({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    )

    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource"'
    )
  })
})
