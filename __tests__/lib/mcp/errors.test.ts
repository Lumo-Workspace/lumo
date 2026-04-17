import { z } from 'zod'
import { toMcpError, McpErrorCode } from '@/lib/mcp/errors'

describe('toMcpError', () => {
  it('maps Zod errors to -32602', () => {
    const zerr = z.string().safeParse(123)
    if (zerr.success) throw new Error('bad fixture')
    const err = toMcpError(zerr.error)
    expect(err.code).toBe(McpErrorCode.InvalidParams)
  })

  it('maps service { status: 404 } to -32001', () => {
    const svc = Object.assign(new Error('not found'), { status: 404 })
    expect(toMcpError(svc).code).toBe(McpErrorCode.ResourceNotFound)
  })

  it('maps service { status: 403 } to -32603 Forbidden', () => {
    const svc = Object.assign(new Error('forbidden'), { status: 403 })
    expect(toMcpError(svc).code).toBe(McpErrorCode.Forbidden)
  })

  it('maps unknown errors to -32603 Internal', () => {
    expect(toMcpError(new Error('boom')).code).toBe(McpErrorCode.Internal)
  })

  it('maps RateLimitError to -32005', () => {
    const err = Object.assign(new Error('too many'), { code: 'RATE_LIMIT' })
    expect(toMcpError(err).code).toBe(McpErrorCode.RateLimit)
  })

  it('maps WorkspaceRequiredError to -32002', () => {
    const err = Object.assign(new Error('select workspace'), {
      code: 'WORKSPACE_REQUIRED',
    })
    expect(toMcpError(err).code).toBe(McpErrorCode.WorkspaceRequired)
  })
})
