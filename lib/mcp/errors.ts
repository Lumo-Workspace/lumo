import { ZodError } from 'zod'

export const McpErrorCode = {
  ResourceNotFound: -32001,
  WorkspaceRequired: -32002,
  RateLimit: -32005,
  InvalidParams: -32602,
  Forbidden: -32603,
  Internal: -32603,
} as const

export class McpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message)
    this.name = 'McpError'
  }
}

export function toMcpError(err: unknown): McpError {
  if (err instanceof McpError) return err
  if (err instanceof ZodError) {
    return new McpError(McpErrorCode.InvalidParams, 'Invalid parameters', {
      issues: err.issues,
    })
  }
  if (err && typeof err === 'object') {
    const maybe = err as { code?: string; status?: number; message?: string }
    if (maybe.code === 'RATE_LIMIT') {
      return new McpError(
        McpErrorCode.RateLimit,
        maybe.message ?? 'Too Many Requests'
      )
    }
    if (maybe.code === 'WORKSPACE_REQUIRED') {
      return new McpError(
        McpErrorCode.WorkspaceRequired,
        maybe.message ?? 'Workspace required — call select_workspace first'
      )
    }
    if (maybe.status === 404) {
      return new McpError(
        McpErrorCode.ResourceNotFound,
        maybe.message ?? 'Resource not found'
      )
    }
    if (maybe.status === 403) {
      return new McpError(McpErrorCode.Forbidden, maybe.message ?? 'Forbidden')
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return new McpError(McpErrorCode.Internal, message)
}
