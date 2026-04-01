import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from './state-machine'

/**
 * Resume an agent that is waiting for a clarification reply.
 *
 * With the HTTP-based MCP flow, the agent process is still alive inside
 * the sandbox — the `ask_user` MCP tool is blocking, polling
 * `GET /api/agent/mcp-clarify/:id` for a reply. Updating the DB record
 * with the reply is all that's needed; the MCP server's next poll will
 * pick it up and unblock the agent.
 *
 * No sandbox connection is required.
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
