/**
 * @jest-environment node
 *
 * LUM-1047: Clerk-mode MCP tool calls must reach the tool with a userId.
 *
 * Strategy: Option A — mock Clerk auth layers so that `withMcpAuth` runs
 * unchanged and produces a real `AuthInfo` for the fixture user. Mocks only
 * the Clerk-owned verification surface and the DB repositories. The full
 * server.ts + tools pipeline runs for real.
 *
 * URL note: the route handler is configured with basePath='/api', which
 * makes mcp-handler derive streamableHttpEndpoint='/api/mcp' — the path Next
 * routes to app/api/mcp/route.ts (LUM-1039).
 */

// ── Repositories ─────────────────────────────────────────────────────────────

jest.mock('@/lib/repositories/mcp-connection.repository', () => ({
  mcpConnectionRepository: {
    upsertOnConnect: jest.fn(),
    setActiveWorkspace: jest.fn(),
    findByClerkUserAndClient: jest.fn(),
    touchLastUsed: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByClerkId: jest.fn(),
  },
}))

// ── Audit + rate-limit (side-effecting, avoid real Redis/Prisma) ──────────────

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

// ── Clerk auth: REAL verifyClerkToken, only Clerk's auth() is stubbed ─────────
// @clerk/mcp-tools 0.3.1 returns { token, scopes, clientId, extra: { userId } }
// with NO top-level userId, while lib/mcp/server.ts reads authInfo.userId.
// The old integration test mocked verifyClerkToken (hiding that) and only
// exercised tools/list, which never reads the user.
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn().mockResolvedValue({
    isAuthenticated: true,
    tokenType: 'oauth_token',
    clientId: 'test_client',
    scopes: ['profile', 'email'],
    userId: 'user_clerk_123',
  }),
}))

import { POST } from '@/app/api/mcp/route'
import { mcpConnectionRepository } from '@/lib/repositories/mcp-connection.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

const mockConnectionRepo = mcpConnectionRepository as jest.Mocked<
  typeof mcpConnectionRepository
>
const mockMemberRepo = memberRepository as jest.Mocked<typeof memberRepository>

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a POST Request that mcp-handler will route to the streamable HTTP
 * transport (pathname must be /api/mcp).
 */
function mcpPost(body: unknown): Request {
  // The MCP Streamable HTTP transport (RFC) requires the client to send
  // Accept: application/json, text/event-stream on POST requests.
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer fixture-bearer-token',
    },
    body: JSON.stringify(body),
  })
}

/**
 * Read the response body and parse out the (first) JSON result.
 *
 * When both application/json and text/event-stream are listed in Accept,
 * the MCP Streamable HTTP transport replies with an SSE envelope:
 *   event: message\ndata: {...}\n\n
 * We need to extract the JSON from the `data:` line.
 * Plain JSON (no SSE wrapping) is also handled as a fallback.
 */
async function readMcpResponse(
  res: Response
): Promise<Record<string, unknown>> {
  const text = await res.text()
  // Try SSE `data:` line first
  const dataLine = text.split('\n').find(l => l.startsWith('data:'))
  if (dataLine) {
    return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<
      string,
      unknown
    >
  }
  // Fallback: plain JSON object on a line
  const jsonLine = text
    .trim()
    .split('\n')
    .find(l => l.trim().startsWith('{'))
  if (!jsonLine) throw new Error(`No JSON in response: ${text}`)
  return JSON.parse(jsonLine) as Record<string, unknown>
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/mcp — Clerk tools/call reaches the tool with the user', () => {
  beforeEach(() => jest.clearAllMocks())

  it('list_my_workspaces succeeds and is resolved for the token user', async () => {
    mockConnectionRepo.upsertOnConnect.mockResolvedValue({
      id: 'conn1',
      activeWorkspaceId: null,
      clerkUserId: 'user_clerk_123',
      clientId: 'test_client',
      clientName: null,
      lastUsedAt: new Date(),
      revokedAt: null,
      autoBoundAt: null,
    } as never)
    mockMemberRepo.findByClerkId.mockResolvedValue([
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
    ] as never)

    const res = await POST(
      mcpPost({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_my_workspaces', arguments: {} },
      })
    )
    expect(res.status).toBe(200)
    const body = await readMcpResponse(res)
    const result = body.result as
      | { isError?: boolean; content?: { text: string }[] }
      | undefined

    expect(body.error).toBeUndefined()
    expect(result?.isError).not.toBe(true)
    expect(JSON.stringify(result?.content ?? [])).not.toMatch(
      /missing auth context/
    )
    expect(mockMemberRepo.findByClerkId).toHaveBeenCalledWith('user_clerk_123')
  })
})
