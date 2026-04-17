import { writeAuditLog } from '@/lib/mcp/audit'

const mockCreate = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: { mcpAuditLog: { create: (...a: any[]) => mockCreate(...a) } },
}))

beforeEach(() => jest.clearAllMocks())

describe('writeAuditLog', () => {
  it('persists a successful call', async () => {
    await writeAuditLog({
      connectionId: 'c1',
      clerkUserId: 'u1',
      workspaceId: 'ws1',
      toolName: 'list_tasks',
      status: 'ok',
      durationMs: 42,
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        connectionId: 'c1',
        clerkUserId: 'u1',
        workspaceId: 'ws1',
        toolName: 'list_tasks',
        status: 'ok',
        errorCode: null,
        durationMs: 42,
      },
    })
  })
  it('persists an error with code', async () => {
    await writeAuditLog({
      connectionId: 'c1',
      clerkUserId: 'u1',
      workspaceId: null,
      toolName: 'update_task',
      status: 'error',
      errorCode: '-32603',
      durationMs: 3,
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'error',
        errorCode: '-32603',
        workspaceId: null,
      }),
    })
  })
  it('swallows DB errors — audit must never break the request', async () => {
    mockCreate.mockRejectedValue(new Error('db dead'))
    await expect(
      writeAuditLog({
        connectionId: 'c1',
        clerkUserId: 'u1',
        workspaceId: null,
        toolName: 'list_tasks',
        status: 'ok',
        durationMs: 5,
      })
    ).resolves.toBeUndefined()
  })
})
