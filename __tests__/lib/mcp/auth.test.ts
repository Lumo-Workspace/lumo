import { requireRole } from '@/lib/mcp/auth'
import { McpError, McpErrorCode } from '@/lib/mcp/errors'

describe('requireRole', () => {
  it('allows when memberRole is in the allowed list', () => {
    expect(() =>
      requireRole({ memberRole: 'MEMBER' } as any, ['MEMBER', 'OWNER'])
    ).not.toThrow()
  })
  it('throws McpError Forbidden when role is not allowed', () => {
    expect(() =>
      requireRole({ memberRole: 'VIEWER' } as any, ['MEMBER'])
    ).toThrow(McpError)
    try {
      requireRole({ memberRole: 'VIEWER' } as any, ['MEMBER'])
    } catch (e) {
      expect((e as McpError).code).toBe(McpErrorCode.Forbidden)
    }
  })
  it('throws when memberRole is undefined', () => {
    expect(() => requireRole({} as any, ['MEMBER'])).toThrow(McpError)
  })
})
