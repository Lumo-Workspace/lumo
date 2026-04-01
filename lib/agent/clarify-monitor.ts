import { Sandbox } from '@e2b/code-interpreter'
import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from './state-machine'
import { notifyAgentClarify } from '@/lib/notifications/notifyAgentActions'

interface MonitorTask {
  id: string
  identifier: string
  reviewerId: string
  projectId: string
}

interface ClarifyMonitorHandle {
  /** Resolves when /tmp/clarify-question.txt is detected */
  promise: Promise<void>
  /** Call to stop polling (e.g. when the agent command finishes first) */
  stop: () => void
}

/**
 * Poll the sandbox for `/tmp/clarify-question.txt` every `intervalMs` ms.
 * Returns a handle with a promise and a stop function for cleanup.
 */
export function monitorForClarify(
  sandbox: Sandbox,
  task: MonitorTask,
  intervalMs = 3000
): ClarifyMonitorHandle {
  let stopped = false
  let intervalHandle: ReturnType<typeof setInterval> | null = null

  const promise = new Promise<void>(resolve => {
    intervalHandle = setInterval(async () => {
      if (stopped) return
      try {
        const questionFile = await sandbox.files
          .read('/tmp/clarify-question.txt')
          .catch(() => null)

        if (!questionFile || stopped) return

        stopped = true
        if (intervalHandle) clearInterval(intervalHandle)

        const clarifyData = JSON.parse(questionFile)

        const clarify = await prisma.agentClarify.create({
          data: {
            taskId: task.id,
            question: clarifyData.question,
            context: clarifyData.context ?? null,
          },
        })

        await transitionAgentStatus(task.id, task.projectId, 'INPUT_REQUIRED', {
          inputReason: 'clarify',
        })
        await notifyAgentClarify(task.id, clarify.id)

        resolve()
      } catch {
        // File not present or parse error — keep polling
      }
    }, intervalMs)
  })

  return {
    promise,
    stop: () => {
      stopped = true
      if (intervalHandle) clearInterval(intervalHandle)
    },
  }
}

/**
 * One-shot check: read `/tmp/clarify-question.txt` from the sandbox.
 * Used as a fallback after the agent command exits, in case the monitor
 * didn't get a chance to poll before the race resolved.
 */
export async function checkForClarifyFile(
  sandbox: Sandbox,
  task: MonitorTask
): Promise<boolean> {
  try {
    const questionFile = await sandbox.files
      .read('/tmp/clarify-question.txt')
      .catch(() => null)

    if (!questionFile) return false

    const clarifyData = JSON.parse(questionFile)

    const clarify = await prisma.agentClarify.create({
      data: {
        taskId: task.id,
        question: clarifyData.question,
        context: clarifyData.context ?? null,
      },
    })

    await transitionAgentStatus(task.id, task.projectId, 'INPUT_REQUIRED', {
      inputReason: 'clarify',
    })
    await notifyAgentClarify(task.id, clarify.id)

    return true
  } catch {
    return false
  }
}
