/**
 * MCP Server for the Lumo agent-server.
 *
 * Exposes the same tools as the existing mcp/server.ts (workspace, projects,
 * tasks, comments, agent-comm) but runs as an SSE endpoint within the
 * Fastify server rather than a standalone stdio process.
 *
 * This is a placeholder — the full tool registration will be ported from
 * mcp/tools/ when needed. For now it exposes the agent-communication tools
 * that the sandbox needs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { FastifyInstance } from 'fastify'
import { prisma } from './db/prisma.js'
import { validateMcpToken } from './auth/mcp-auth.js'

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'lumo-agent-server',
    version: '1.0.0',
  })

  // ── Agent communication tools ──────────────────────────────────────────

  server.tool(
    'get_task',
    'Get task details by ID',
    { taskId: { type: 'string', description: 'Task ID' } },
    async ({ taskId }) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId as string },
        select: {
          id: true,
          title: true,
          description: true,
          spec: true,
          status: true,
          priority: true,
          agentStatus: true,
        },
      })
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: 'Task not found' }],
          isError: true,
        }
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(task, null, 2) },
        ],
      }
    }
  )

  server.tool(
    'list_tasks',
    'List tasks for a project',
    {
      projectId: { type: 'string', description: 'Project ID' },
      status: {
        type: 'string',
        description: 'Filter by status (optional)',
      },
    },
    async ({ projectId, status }) => {
      const where: Record<string, unknown> = {
        projectId: projectId as string,
      }
      if (status) where.status = status
      const tasks = await prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          agentStatus: true,
          number: true,
        },
        orderBy: { number: 'asc' },
        take: 50,
      })
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(tasks, null, 2) },
        ],
      }
    }
  )

  return server
}

/**
 * Mount SSE-based MCP transport on Fastify.
 */
export function registerMcpRoutes(app: FastifyInstance, server: McpServer) {
  // Store active transports by session
  const transports = new Map<string, SSEServerTransport>()

  app.get('/mcp/sse', async (request, reply) => {
    const transport = new SSEServerTransport('/mcp/messages', reply.raw)
    const sessionId = transport.sessionId
    transports.set(sessionId, transport)

    request.raw.on('close', () => {
      transports.delete(sessionId)
    })

    await server.connect(transport)
    // The SSE transport handles the response — don't let Fastify send another
  })

  app.post('/mcp/messages', async (request, reply) => {
    const sessionId = (request.query as Record<string, string>).sessionId
    const transport = transports.get(sessionId ?? '')
    if (!transport) {
      return reply.status(400).send({ error: 'Invalid session' })
    }
    await transport.handlePostMessage(request.raw, reply.raw)
  })
}
