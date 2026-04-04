import { prisma } from '../db/prisma.js'
import { transitionAgentStatus } from './state-machine.js'

/**
 * Resume an agent that is waiting for a clarification reply.
 * Updates the DB record with the reply — the MCP server's next poll will
 * pick it up and unblock the agent.
 */
export async function resumeAgent(
  taskId: string,
  projectId: string,
  reply: string
): Promise<void> {
  await updateClarifyRecord(taskId, reply)
  await transitionAgentStatus(taskId, projectId, 'WORKING', {
    currentStatus: 'INPUT_REQUIRED',
  })
}

async function updateClarifyRecord(taskId: string, reply: string) {
  const pendingClarify = await prisma.agentClarify.findFirst({
    where: { taskId, reply: null },
    orderBy: { createdAt: 'desc' },
  })
  if (pendingClarify) {
    await prisma.agentClarify.update({
      where: { id: pendingClarify.id },
      data: { reply, repliedAt: new Date() },
    })
  }
}
