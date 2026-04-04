import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validateServiceSecret } from '../auth/mcp-auth.js'
import { executeAgent } from '../agent/execute.js'
import { prisma } from '../db/prisma.js'

const bodySchema = z.object({
  taskId: z.string().min(1),
  actorClerkId: z.string().min(1),
  actorName: z.string().optional(),
  actorEmail: z.string().optional(),
  trigger: z.string().optional(),
})

export function registerExecuteRoute(app: FastifyInstance) {
  app.post('/api/agent/execute', async (request, reply) => {
    const auth = request.headers.authorization as string | undefined
    if (!validateServiceSecret(auth ?? null)) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: 'Invalid request', details: parsed.error.flatten() })
    }

    const { taskId } = parsed.data

    // Check repo exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        repositoryId: true,
        project: {
          select: {
            repositories: {
              where: { isDefault: true },
              select: { fullName: true },
              take: 1,
            },
          },
        },
      },
    })

    if (!task) {
      return reply.status(404).send({ error: 'Task not found' })
    }
    if (!task.repositoryId && task.project.repositories.length === 0) {
      return reply
        .status(422)
        .send({ error: 'No GitHub repo configured for this project' })
    }

    // Run agent in background — respond 202 immediately
    // The agent runs synchronously in the server process with real-time log streaming
    void executeAgent(parsed.data)
      .then(result => {
        console.log(
          `[agent/execute] Task ${taskId} completed: ${result.outcome}`
        )
      })
      .catch(err => {
        console.error(`[agent/execute] Task ${taskId} failed:`, err)
      })

    return reply.status(202).send({ status: 'started', taskId })
  })
}
