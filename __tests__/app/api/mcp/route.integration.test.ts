/**
 * @jest-environment node
 *
 * Integration test for the MCP HTTP route (Task 2.10).
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

// ── Clerk auth — Option A ─────────────────────────────────────────────────────
// Mock the Clerk server packages that the route's `verifyToken` callback calls.
// `verifyClerkToken` returns a fixture AuthInfo; `auth` returns a stub
// MachineAuthObject that verifyClerkToken normally consumes (but here ignored
// since we mock verifyClerkToken directly).
//
// Note: FIXTURE_AUTH_INFO is inlined in the factory — jest.mock factories are
// hoisted before const declarations so we cannot reference module-level vars.

jest.mock(
  '@clerk/mcp-tools/server',
  () => ({
    verifyClerkToken: jest.fn().mockReturnValue({
      token: 'fixture-bearer-token',
      clientId: 'test_client',
      scopes: [],
    }),
  }),
  { virtual: true }
)

jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn().mockResolvedValue({ userId: 'test_user_clerk_id' }),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

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

describe('POST /api/mcp — bootstrap flow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns exactly the 3 bootstrap tools when user has multiple workspaces and none is bound', async () => {
    // Arrange
    mockConnectionRepo.upsertOnConnect.mockResolvedValue({
      id: 'conn1',
      activeWorkspaceId: null,
      clerkUserId: 'test_user_clerk_id',
      clientId: 'test_client',
      clientName: null,
      lastUsedAt: new Date(),
      revokedAt: null,
      autoBoundAt: null,
    } as never)

    // Two memberships → user has multiple workspaces → no auto-bind → bootstrap
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

    // Act
    const req = mcpPost({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await readMcpResponse(res)

    // Assert — `registerAllTools` registers workspace tools unconditionally
    // plus all domain tools; tools themselves gate at call time via
    // requireWorkspace(ctx) when no workspace is bound. The tool list itself
    // is therefore the full surface regardless of binding state.
    const result = body.result as { tools: { name: string }[] } | undefined
    expect(result).toBeDefined()

    const toolNames = (result?.tools ?? []).map(t => t.name).sort()
    expect(toolNames).toEqual([
      'get_active_workspace',
      'get_member',
      'get_project',
      'get_workspace',
      'list_members',
      'list_my_workspaces',
      'list_projects',
      'list_tags',
      'select_workspace',
    ])
  })

  it('auto-binds the sole workspace and returns the full tool surface', async () => {
    // Arrange
    mockConnectionRepo.upsertOnConnect.mockResolvedValue({
      id: 'conn2',
      activeWorkspaceId: null,
      clerkUserId: 'test_user_clerk_id',
      clientId: 'test_client',
      clientName: null,
      lastUsedAt: new Date(),
      revokedAt: null,
      autoBoundAt: null,
    } as never)

    mockConnectionRepo.setActiveWorkspace = jest.fn().mockResolvedValue({
      id: 'conn2',
      activeWorkspaceId: 'ws-only',
    } as never)

    // Only one membership → auto-bind path
    mockMemberRepo.findByClerkId.mockResolvedValue([
      {
        id: 'mem1',
        workspaceId: 'ws-only',
        role: 'OWNER',
        workspace: { name: 'Solo', slug: 'solo' },
      },
    ] as never)

    // Act
    const req = mcpPost({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await readMcpResponse(res)
    const result = body.result as { tools: { name: string }[] } | undefined
    expect(result).toBeDefined()

    const toolNames = (result?.tools ?? []).map(t => t.name).sort()
    expect(toolNames).toEqual([
      'get_active_workspace',
      'get_member',
      'get_project',
      'get_workspace',
      'list_members',
      'list_my_workspaces',
      'list_projects',
      'list_tags',
      'select_workspace',
    ])
  })
})
