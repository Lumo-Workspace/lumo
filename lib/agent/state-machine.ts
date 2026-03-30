import type { AgentStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { pushProjectEvent } from '@/lib/pusher/server'

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusValue = AgentStatus

type FromKey = AgentStatusValue | 'null'

// ── Transition map ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<FromKey, AgentStatusValue[]> = {
  null: ['IDLE'],
  IDLE: ['RUNNING'],
  RUNNING: ['DONE', 'FAILED', 'PAUSED', 'SPEC_REVIEW', 'CANCELLED'],
  PAUSED: ['RUNNING', 'FAILED', 'CANCELLED'],
  SPEC_REVIEW: ['RUNNING'],
  FAILED: ['RUNNING'],
  ERROR: ['RUNNING'],
  CANCELLED: ['RUNNING'],
  DONE: [],
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isValidTransition(
  from: AgentStatusValue | null,
  to: AgentStatusValue
): boolean {
  const key: FromKey = from ?? 'null'
  return TRANSITIONS[key]?.includes(to) ?? false
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: AgentStatusValue | null,
    public readonly to: AgentStatusValue
  ) {
    super(
      `Invalid agent status transition: ${from ?? 'null'} → ${to} (task ${taskId})`
    )
    this.name = 'InvalidTransitionError'
  }
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface TransitionOptions {
  agentError?: string | null | undefined
  sandboxId?: string | null | undefined
  spec?: string | undefined
  /** Also update task-level status (e.g. 'IN_REVIEW' when agent completes) */
  status?: string | undefined
  /** Skip reading current status — use this when you already know it */
  currentStatus?: AgentStatusValue | null | undefined
  /** Skip the Pusher project broadcast */
  skipBroadcast?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

/**
 * Transition a task's agentStatus with validation and project-level broadcast.
 * This is the single authoritative place for agentStatus writes.
 *
 * Callers remain responsible for rich pushAgentEvent calls
 * (agent:done with prUrl, agent:clarify with question, etc.).
 */
export async function transitionAgentStatus(
  taskId: string,
  projectId: string,
  to: AgentStatusValue,
  opts?: TransitionOptions
): Promise<void> {
  // Determine current status
  let current: AgentStatusValue | null
  if (opts?.currentStatus !== undefined) {
    current = opts.currentStatus
  } else {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { agentStatus: true },
    })
    current = task?.agentStatus ?? null
  }

  // Validate
  if (!isValidTransition(current, to)) {
    throw new InvalidTransitionError(taskId, current, to)
  }

  // Build update data
  const data: Record<string, unknown> = { agentStatus: to }
  if (opts?.agentError !== undefined) data.agentError = opts.agentError
  if (opts?.sandboxId !== undefined) data.sandboxId = opts.sandboxId
  if (opts?.spec !== undefined) data.spec = opts.spec
  if (opts?.status !== undefined) data.status = opts.status

  await prisma.task.update({ where: { id: taskId }, data })

  // Broadcast project-level event
  if (!opts?.skipBroadcast) {
    const fields = Object.keys(data)
    const patch: Record<string, unknown> = { agentStatus: to }
    if (opts?.status !== undefined) patch.status = opts.status
    await pushProjectEvent(projectId, {
      type: 'task:updated',
      taskId,
      fields,
      patch,
    })
  }
}

// ── Clear helper (any → null) ───────────────────────────────────────────────

/**
 * Clear agentStatus entirely. Used when unassigning a task from an agent.
 */
export async function clearAgentStatus(
  taskId: string,
  projectId: string,
  opts?: { skipBroadcast?: boolean | undefined }
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: null, agentError: null, sandboxId: null },
  })

  if (!opts?.skipBroadcast) {
    await pushProjectEvent(projectId, {
      type: 'task:updated',
      taskId,
      fields: ['agentStatus'],
      patch: { agentStatus: null },
    })
  }
}
