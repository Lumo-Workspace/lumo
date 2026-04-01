/**
 * @jest-environment node
 */
import { validateMcpToken } from '@/lib/auth/mcp-auth'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentRun: { findFirst: jest.fn() },
    task: { findUnique: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'

const mockAgentRun = prisma.agentRun.findFirst as jest.Mock
const mockTask = prisma.task.findUnique as jest.Mock
const mockApiKey = prisma.apiKey.findUnique as jest.Mock
const mockApiKeyUpdate = prisma.apiKey.update as jest.Mock

function makeRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  return new Request('http://localhost/test', { headers })
}

beforeEach(() => jest.clearAllMocks())

describe('validateMcpToken', () => {
  describe('missing / malformed auth', () => {
    it('returns false when no Authorization header', async () => {
      expect(await validateMcpToken(makeRequest(), 'task-1')).toBe(false)
    })

    it('returns false when header is not Bearer', async () => {
      const req = new Request('http://localhost', {
        headers: { Authorization: 'Basic abc' },
      })
      expect(await validateMcpToken(req, 'task-1')).toBe(false)
    })
  })

  describe('per-task token', () => {
    it('returns true when AgentRun matches taskId + token + WORKING status', async () => {
      mockAgentRun.mockResolvedValueOnce({ id: 'run-1' })
      expect(await validateMcpToken(makeRequest('tok-abc'), 'task-1')).toBe(
        true
      )
      expect(mockAgentRun).toHaveBeenCalledWith({
        where: { taskId: 'task-1', mcpToken: 'tok-abc', status: 'WORKING' },
        select: { id: true },
      })
      // Note: uses findFirst (not findUnique) because compound where
      // (taskId + mcpToken + status) is not a @unique constraint in Prisma schema
    })

    it('returns false when no matching AgentRun', async () => {
      mockAgentRun.mockResolvedValueOnce(null)
      mockTask.mockResolvedValueOnce(null)
      expect(await validateMcpToken(makeRequest('bad-token'), 'task-1')).toBe(
        false
      )
    })
  })

  describe('per-user API key', () => {
    const WORKSPACE_ID = 'ws-1'

    beforeEach(() => {
      mockAgentRun.mockResolvedValue(null)
      mockTask.mockResolvedValue({
        project: { workspaceId: WORKSPACE_ID },
      })
    })

    it('returns true when API key hash matches and member is in same workspace', async () => {
      mockApiKey.mockResolvedValueOnce({
        revokedAt: null,
        member: { workspaceId: WORKSPACE_ID },
      })
      mockApiKeyUpdate.mockResolvedValueOnce({})
      expect(await validateMcpToken(makeRequest('lum_mykey'), 'task-1')).toBe(
        true
      )
    })

    it('returns false when API key is revoked', async () => {
      mockApiKey.mockResolvedValueOnce({
        revokedAt: new Date(),
        member: { workspaceId: WORKSPACE_ID },
      })
      expect(await validateMcpToken(makeRequest('lum_mykey'), 'task-1')).toBe(
        false
      )
    })

    it('returns false when member is in a different workspace', async () => {
      mockApiKey.mockResolvedValueOnce({
        revokedAt: null,
        member: { workspaceId: 'other-ws' },
      })
      expect(await validateMcpToken(makeRequest('lum_mykey'), 'task-1')).toBe(
        false
      )
    })

    it('returns false when API key not found', async () => {
      mockApiKey.mockResolvedValueOnce(null)
      expect(await validateMcpToken(makeRequest('lum_unknown'), 'task-1')).toBe(
        false
      )
    })
  })
})
