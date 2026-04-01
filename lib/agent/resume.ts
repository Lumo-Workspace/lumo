import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from './state-machine'

export async function resumeAgent(
  taskId: string,
  projectId: string,
  sandboxId: string,
  reply: string
): Promise<void> {
  try {
    const sandbox = await Sandbox.connect(sandboxId)
    await sandbox.files.write('/tmp/clarify-reply.txt', reply)

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

    await transitionAgentStatus(taskId, projectId, 'WORKING', {
      currentStatus: 'INPUT_REQUIRED',
    })
  } catch {
    // Sandbox has expired — caller is responsible for restarting the agent
    throw new Error(
      `Sandbox ${sandboxId} has expired. Restart the agent with clarify context.`
    )
  }
}
