import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'

interface MonitorTask {
  id: string
  identifier: string
  reviewerId: string
}

export async function monitorForClarify(
  sandbox: Sandbox,
  task: MonitorTask,
  intervalMs = 5000
): Promise<void> {
  return new Promise(resolve => {
    const interval = setInterval(async () => {
      try {
        const questionFile = await sandbox.files
          .read('/tmp/clarify-question.txt')
          .catch(() => null)

        if (questionFile) {
          clearInterval(interval)

          const clarifyData = JSON.parse(questionFile)

          await prisma.agentClarify.create({
            data: {
              taskId: task.id,
              question: clarifyData.question,
              context: clarifyData.context ?? null,
            },
          })

          await prisma.task.update({
            where: { id: task.id },
            data: { agentStatus: 'PAUSED' },
          })

          resolve()
        }
      } catch {
        // File not present yet — keep polling
      }
    }, intervalMs)
  })
}
