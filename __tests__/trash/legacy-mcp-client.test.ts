/**
 * LUM-923 — the legacy stdio MCP builds its own PrismaClient (mcp/db.ts); it
 * (via mcp/client.ts) must carry the same soft-delete extension as the app client, or its list
 * and lookup tools surface tasks and documents in the trash.
 */
const mockExtends = jest.fn((ext: unknown) => ({ extendedWith: ext }))

jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: jest.fn() }))
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({ $extends: mockExtends })),
}))

describe('LUM-923 trash leak: legacy MCP client', () => {
  it('LUM-923 trash leak: the legacy MCP client carries the soft-delete filter for tasks and documents', async () => {
    const { createMcpClient } = await import('@/mcp/client')
    const prisma = createMcpClient('postgresql://x@localhost/db')

    expect(mockExtends).toHaveBeenCalledTimes(1)
    const ext = mockExtends.mock.calls[0]![0] as {
      query: Record<string, unknown>
    }
    expect(Object.keys(ext.query).sort()).toEqual(['document', 'task'])
    expect(prisma).toEqual({ extendedWith: ext })
  })
})
