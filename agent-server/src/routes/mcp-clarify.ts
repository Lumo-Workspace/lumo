import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { transitionAgentStatus } from '../agent/state-machine.js'
import { pushAgentEvent } from '../pusher/server.js'
import { notifyAgentClarify } from '../notifications/notifyAgentActions.js'
import { validateMcpToken } from '../auth/mcp-auth.js'

export function registerMcpClarifyRoutes(app: FastifyInstance) {
  /**
   * POST /api/agent/mcp-clarify
   * Called by sandbox MCP server when agent invokes ask_user.
   */
  app.post('/api/agent/mcp-clarify', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const { taskId, question, context } = body as {
        taskId?: string
        question?: string
        context?: string | null
      }

      if (!taskId || !question) {
        return reply
          .status(400)
          .send({ error: 'taskId and question are required' })
      }

      const authorized = await validateMcpToken(
        request.headers.authorization as string | null,
        taskId
      )
      if (!authorized) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      // Avoid duplicates
      const existing = await prisma.agentClarify.findFirst({
        where: { taskId, reply: null },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) {
        return reply.send({ ok: true, clarifyId: existing.id })
      }

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { projectId: true },
      })
      if (!task) {
        return reply.status(404).send({ error: 'Task not found' })
      }

      const clarify = await prisma.agentClarify.create({
        data: {
          taskId,
          question,
          context: context ?? null,
        },
      })

      await transitionAgentStatus(taskId, task.projectId, 'INPUT_REQUIRED', {
        inputReason: 'clarify',
      })
      await notifyAgentClarify(taskId, clarify.id)
      await pushAgentEvent(taskId, {
        type: 'agent:clarify',
        question,
        context: context ?? null,
      })

      return reply.send({ ok: true, clarifyId: clarify.id })
    } catch (error) {
      console.error('[mcp-clarify] Error:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })

  /**
   * GET /api/agent/mcp-clarify/:id
   * Polled by sandbox MCP server to check for user reply.
   */
  app.get<{ Params: { id: string } }>(
    '/api/agent/mcp-clarify/:id',
    async (request, reply) => {
      try {
        const { id } = request.params

        const clarify = await prisma.agentClarify.findUnique({
          where: { id },
          select: { taskId: true, reply: true, repliedAt: true },
        })

        if (!clarify) {
          return reply.status(404).send({ error: 'Not found' })
        }

        const authorized = await validateMcpToken(
          request.headers.authorization as string | null,
          clarify.taskId
        )
        if (!authorized) {
          return reply.status(404).send({ error: 'Not found' })
        }

        if (clarify.reply != null) {
          return reply.send({ status: 'replied', reply: clarify.reply })
        }

        return reply.send({ status: 'pending' })
      } catch (error) {
        console.error('[mcp-clarify/get] Error:', error)
        return reply.status(500).send({ error: 'Internal server error' })
      }
    }
  )

  /**
   * POST /api/agent/mcp-progress
   * Fire-and-forget progress reports from sandbox.
   */
  app.post('/api/agent/mcp-progress', async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>
      const { taskId, message } = body as {
        taskId?: string
        message?: string
      }

      if (!taskId || !message) {
        return reply
          .status(400)
          .send({ error: 'taskId and message are required' })
      }

      const authorized = await validateMcpToken(
        request.headers.authorization as string | null,
        taskId
      )
      if (!authorized) {
        return reply.status(401).send({ error: 'Unauthorized' })
      }

      pushAgentEvent(taskId, { type: 'agent:progress', message })

      return reply.send({ ok: true })
    } catch (error) {
      console.error('[mcp-progress] Error:', error)
      return reply.status(500).send({ error: 'Internal server error' })
    }
  })
}
