import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validateServiceSecret } from '../auth/mcp-auth.js'
import { prisma } from '../db/prisma.js'
import { executeAgent } from '../agent/execute.js'

const bodySchema = z.object({
  taskId: z.string().min(1),
  actorClerkId: z.string().min(1),
})

export function registerRetryRoute(app: FastifyInstance) {
  app.post('/api/agent/retry', async (request, reply) => {
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

    const { taskId, actorClerkId } = parsed.data

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        agentStatus: true,
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

    if (task.agentStatus !== 'FAILED' && task.agentStatus !== 'CANCELED') {
      return reply
        .status(409)
        .send({ error: 'Can only retry failed or canceled tasks' })
    }

    if (!task.repositoryId && task.project.repositories.length === 0) {
      return reply
        .status(422)
        .send({ error: 'No GitHub repo configured for this project' })
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { agentError: null },
    })

    const result = await executeAgent({
      taskId,
      actorClerkId,
      trigger: 'retry',
    }).catch(err => {
      console.error(`[agent/retry] Task ${taskId} failed:`, err)
      return { outcome: 'failed' as const, error: String(err) }
    })

    return reply.status(202).send({ status: result.outcome, taskId })
  })
}
