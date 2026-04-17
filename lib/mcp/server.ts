// lib/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerAllTools, type CtxProvider } from './tools'
import { checkRateLimit } from './rate-limit'
import { writeAuditLog } from './audit'
import { toMcpError } from './errors'

export function buildMcpServer(ctxProvider: CtxProvider): McpServer {
  const server = new McpServer({ name: 'lumo', version: '1.0.0' })

  // Monkey-patch registerTool to inject rate-limit + audit middleware on every
  // tool call without requiring each tool to wire it in individually.
  // We use `any` here because registerTool has complex generic overloads that
  // cannot be precisely re-typed in a generic wrapper — the runtime behaviour
  // is what matters.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalRegister = server.registerTool.bind(server) as (...args: any[]) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(server as any).registerTool = (name: string, def: unknown, handler: (...args: any[]) => Promise<unknown>) => {
    const wrapped = async (...handlerArgs: unknown[]) => {
      const ctx = await ctxProvider()
      const started = Date.now()
      try {
        await checkRateLimit({ clerkUserId: ctx.clerkUserId, toolName: name })
        const result = await handler(...handlerArgs)
        await writeAuditLog({
          connectionId: ctx.connectionId,
          clerkUserId: ctx.clerkUserId,
          workspaceId: ctx.workspaceId ?? null,
          toolName: name,
          status: 'ok',
          durationMs: Date.now() - started,
        })
        return result
      } catch (err) {
        const mcpErr = toMcpError(err)
        await writeAuditLog({
          connectionId: ctx.connectionId,
          clerkUserId: ctx.clerkUserId,
          workspaceId: ctx.workspaceId ?? null,
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

  registerAllTools(server, ctxProvider)
  return server
}
