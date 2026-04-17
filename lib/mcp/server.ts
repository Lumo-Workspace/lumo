// lib/mcp/server.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools } from './tools'
import { checkRateLimit } from './rate-limit'
import { writeAuditLog } from './audit'
import { toMcpError } from './errors'
import { resolveLumoContext } from './context'

/**
 * Registers all MCP tools on a server passed in by mcp-handler. Wraps every
 * tool call with auth extraction (from extra.authInfo), context resolution,
 * rate limiting, and audit logging. This fits mcp-handler's per-request
 * `initializeServer(server)` model — a fresh server is created per request
 * and this function wires auth + observability around each registered tool.
 */
export function registerMcpTools(server: McpServer): void {
  // registerTool has complex generic overloads we cannot precisely re-type
  // in a generic wrapper — runtime behaviour is what matters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRegister = server.registerTool.bind(server) as (...args: any[]) => any

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(server as any).registerTool = (name: string, def: unknown, handler: unknown) => {
    const typedHandler = handler as (
      args: unknown,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extra: any
    ) => Promise<unknown>

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wrapped = async (args: unknown, extra: any) => {
      const clerkUserId = extra?.authInfo?.userId as string | undefined
      if (!clerkUserId) {
        throw new Error('Unauthorized — missing auth context')
      }
      const clientId =
        (extra?.authInfo?.clientId as string | undefined) ?? 'unknown'
      const clientName =
        (extra?.authInfo?.clientName as string | undefined) ?? null

      const started = Date.now()
      let connectionId = 'unresolved'
      let workspaceId: string | null = null
      try {
        await checkRateLimit({ clerkUserId, toolName: name })
        const ctx = await resolveLumoContext({ clerkUserId, clientId, clientName })
        connectionId = ctx.connectionId
        workspaceId = ctx.workspaceId ?? null

        // Inject resolved ctx into extra so downstream tool handlers can access
        // it without re-running resolveLumoContext.
        const result = await typedHandler(args, { ...extra, ctx })

        await writeAuditLog({
          connectionId,
          clerkUserId,
          workspaceId,
          toolName: name,
          status: 'ok',
          durationMs: Date.now() - started,
        })
        return result
      } catch (err) {
        const mcpErr = toMcpError(err)
        await writeAuditLog({
          connectionId,
          clerkUserId,
          workspaceId,
          toolName: name,
          status: 'error',
          errorCode: String(mcpErr.code),
          durationMs: Date.now() - started,
        })
        throw mcpErr
      }
    }

    return originalRegister(name, def, wrapped)
  }

  registerAllTools(server)
}
