import Fastify from 'fastify'
import { registerHealthRoute } from './routes/health.js'
import { registerExecuteRoute } from './routes/execute.js'
import { registerSandboxDoneRoute } from './routes/sandbox-done.js'
import { registerRetryRoute } from './routes/retry.js'
import { registerMcpClarifyRoutes } from './routes/mcp-clarify.js'
import { createMcpServer, registerMcpRoutes } from './mcp-server.js'

const PORT = parseInt(process.env.PORT ?? '4001', 10)
const HOST = process.env.HOST ?? '0.0.0.0'

async function main() {
  const app = Fastify({
    logger: true,
    bodyLimit: 1024 * 1024, // 1MB
  })

  // ── REST routes ────────────────────────────────────────────────────────
  registerHealthRoute(app)
  registerExecuteRoute(app)
  registerSandboxDoneRoute(app)
  registerRetryRoute(app)
  registerMcpClarifyRoutes(app)

  // ── MCP SSE server ─────────────────────────────────────────────────────
  const mcpServer = createMcpServer()
  registerMcpRoutes(app, mcpServer)

  // ── Start ──────────────────────────────────────────────────────────────
  await app.listen({ port: PORT, host: HOST })
  console.log(`🚀 Agent server listening on ${HOST}:${PORT}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
