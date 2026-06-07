import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { processAgentCompletion } from '../agent/execute.js'

const bodySchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  exitCode: z.number(),
  timedOut: z.boolean(),
  stderr: z.string(),
  branchExistsOnRemote: z.boolean(),
  resultLine: z.string().optional(),
})

export function registerSandboxDoneRoute(app: FastifyInstance) {
  app.post('/api/agent/sandbox-done', async (request, reply) => {
    const authHeader = request.headers.authorization as string | undefined
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      console.error(
        '[agent/sandbox-done] Invalid payload:',
        parsed.error.issues
      )
      return reply.status(400).send({ error: 'Invalid payload' })
    }

    // Verify mcpToken matches the run
    const run = await prisma.agentRun.findUnique({
      where: { id: parsed.data.runId },
      select: { mcpToken: true, status: true },
    })
    if (!run || run.mcpToken !== token) {
      return reply.status(403).send({ error: 'Invalid token' })
    }

    if (run.status !== 'WORKING') {
      console.warn(
        `[agent/sandbox-done] Run ${parsed.data.runId} already in status ${run.status}, ignoring`
      )
      return reply.send({ status: 'already_finished' })
    }

    console.log(
      `[agent/sandbox-done] Processing callback for run ${parsed.data.runId} (exit=${parsed.data.exitCode}, timedOut=${parsed.data.timedOut})`
    )

    await processAgentCompletion(parsed.data)

    return reply.send({ status: 'ok' })
  })
}
