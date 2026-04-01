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

interface ClarifyPayload {
  question: string
  context?: string | null
}

function parseClarifyFile(content: string): ClarifyPayload | null {
  try {
    const data = JSON.parse(content)
    if (typeof data.question === 'string') return data as ClarifyPayload
    return null
  } catch {
    return null
  }
}

/**
 * Create a DB record and transition status when a clarify question is detected.
 *
 * Works with both the legacy file-write protocol and the MCP `ask_user` tool —
 * both write to the same `/tmp/clarify-question.txt` path. In the MCP flow,
 * the agent stays alive (blocking on `ask_user`), so this just handles the
 * backend side: DB record, status transition, and user notification.
 */
async function recordClarifyRequest(
  task: MonitorTask,
  payload: ClarifyPayload
) {
  const clarify = await prisma.agentClarify.create({
    data: {
      taskId: task.id,
      question: payload.question,
      context: payload.context ?? null,
    },
  })
  await transitionAgentStatus(task.id, task.projectId, 'INPUT_REQUIRED', {
    inputReason: 'clarify',
  })
  await notifyAgentClarify(task.id, clarify.id)
}

/**
 * Poll the sandbox for `/tmp/clarify-question.txt` every `intervalMs` ms.
 * Returns a handle with a promise and a stop function for cleanup.
 *
 * In the MCP flow, this serves as a fallback detector — the MCP server's
 * HTTP callback is the primary notification path. If the callback fails
 * (e.g. network issue), this polling ensures the clarify is still detected.
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
        const content = await sandbox.files
          .read('/tmp/clarify-question.txt')
          .catch(() => null)

        if (!content || stopped) return
        const payload = parseClarifyFile(content)
        if (!payload) return

        stopped = true
        if (intervalHandle) clearInterval(intervalHandle)

        // Only record if not already recorded (e.g. by HTTP callback)
        const existing = await prisma.agentClarify.findFirst({
          where: { taskId: task.id, reply: null },
          orderBy: { createdAt: 'desc' },
        })
        if (!existing) {
          await recordClarifyRequest(task, payload)
        }

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
    const content = await sandbox.files
      .read('/tmp/clarify-question.txt')
      .catch(() => null)

    if (!content) return false
    const payload = parseClarifyFile(content)
    if (!payload) return false

    const existing = await prisma.agentClarify.findFirst({
      where: { taskId: task.id, reply: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!existing) {
      await recordClarifyRequest(task, payload)
    }

    return true
  } catch {
    return false
  }
}
