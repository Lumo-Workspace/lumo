import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from './state-machine'

/**
 * Resume an agent that is waiting for a clarification reply.
 *
 * With the MCP-based clarify flow, the agent process is still alive inside
 * the sandbox — the `ask_user` MCP tool is blocking, polling for
 * `/tmp/clarify-reply.txt`. Writing the reply file unblocks the tool
 * and the agent continues with its full context preserved.
 *
 * If the sandbox has expired (30 min timeout), this throws and the caller
 * falls back to `executeAgent({ trigger: 'clarify_reply' })`.
 */
export async function resumeAgent(
  taskId: string,
  projectId: string,
  sandboxId: string,
  reply: string
): Promise<void> {
  try {
    const sandbox = await Sandbox.connect(sandboxId)
    await sandbox.files.write('/tmp/clarify-reply.txt', reply)

    await updateClarifyRecord(taskId, reply)
    await transitionAgentStatus(taskId, projectId, 'WORKING', {
      currentStatus: 'INPUT_REQUIRED',
    })
  } catch {
    throw new Error(
      `Sandbox ${sandboxId} has expired. Restart the agent with clarify context.`
    )
  }
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
