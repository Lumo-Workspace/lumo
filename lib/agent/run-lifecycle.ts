import { randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent, fireAgentEvent } from '@/lib/integrations/pusher'
import { userFriendlyError } from './errors'
import { transitionAgentStatus } from './state-machine'
import { notifyAgentFailed } from '@/lib/services/notification.service'
import { buildInitialSteps, runStepTimers } from './pipeline'

// ── Data access ───────────────────────────────────────────────────────────

export async function loadTask(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      repository: { select: { fullName: true } },
      branches: {
        select: { branchName: true },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
      pullRequests: {
        where: { state: 'open' },
        select: { headBranch: true, url: true, number: true },
        take: 1,
      },
      project: {
        select: {
          id: true,
          name: true,
          workspaceId: true,
          defaultReviewerId: true,
          repositories: {
            where: { isDefault: true },
            select: { fullName: true },
            take: 1,
          },
        },
      },
    },
  })
  if (!task) throw new Error(`Task ${taskId} not found`)
  return task
}

export async function nextRunNumber(taskId: string): Promise<number> {
  const last = await prisma.agentRun.findFirst({
    where: { taskId },
    orderBy: { runNumber: 'desc' },
    select: { runNumber: true },
  })
  return (last?.runNumber ?? 0) + 1
}

// ── AgentRun lifecycle ───────────────────────────────────────────────────

export async function createAgentRun(
  taskId: string,
  projectId: string,
  trigger: string
): Promise<{ id: string; mcpToken: string }> {
  const runNumber = await nextRunNumber(taskId)
  const mcpToken = randomBytes(32).toString('hex')
  const agentRun = await prisma.agentRun.create({
    data: {
      taskId,
      runNumber,
      status: 'WORKING',
      trigger,
      mcpToken,
      steps: buildInitialSteps() as unknown as Prisma.InputJsonValue,
    },
  })
  await transitionAgentStatus(taskId, projectId, 'WORKING', {
    agentError: null,
  })
  fireAgentEvent(taskId, {
    type: 'agent:started',
    runNumber,
    steps: buildInitialSteps(),
  })
  runStepTimers.set(agentRun.id, Date.now())
  return { id: agentRun.id, mcpToken }
}

export async function markRunCompleted(
  runId: string,
  data: {
    durationMs: number
    prNumber?: number | undefined
    prUrl?: string | undefined
    branchName?: string | undefined
    summary?: string | null | undefined
    changedFiles?: unknown
  }
) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: 'COMPLETED',
      summary: (data.summary as string) ?? null,
      changedFiles:
        (data.changedFiles as Prisma.InputJsonValue) ?? Prisma.DbNull,
      durationMs: data.durationMs,
      prNumber: data.prNumber ?? null,
      prUrl: data.prUrl ?? null,
      branchName: data.branchName ?? null,
      finishedAt: new Date(),
    },
  })
}

export async function updateFailedRun(
  agentRunId: string,
  code: string,
  detail: string
) {
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      status: 'FAILED',
      errorCode: code,
      errorMessage: detail,
      finishedAt: new Date(),
    },
  })
}

export async function markFailed(
  taskId: string,
  projectId: string,
  code: string,
  message: string,
  agentRunId?: string
) {
  const friendly = userFriendlyError(code)
  // Combine friendly message with actual detail for debugging
  const detail =
    message && message !== friendly
      ? `${friendly}\n\nDetail: ${message}`
      : friendly

  await transitionAgentStatus(taskId, projectId, 'FAILED', {
    agentError: code,
  })
  await pushAgentEvent(taskId, {
    type: 'agent:failed',
    error: detail,
  })
  await notifyAgentFailed(taskId)
  if (agentRunId) await updateFailedRun(agentRunId, code, detail)
  console.error(`[Agent] Task ${taskId} failed [${code}]: ${message}`)
}

export async function markRunCanceled(runId: string) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'CANCELED', finishedAt: new Date() },
  })
}
