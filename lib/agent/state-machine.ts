import type { AgentStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'

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
  /** Skip reading current status — use this when you already know it */
  currentStatus?: AgentStatusValue | null | undefined
  /** Skip dispatching domain events (broadcast, notifications) */
  skipDispatch?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

/**
 * Transition a task's agentStatus with validation and domain event dispatch.
 * This is the single authoritative place for agentStatus writes.
 *
 * Returns emitted events so callers using skipDispatch can dispatch later.
 * Callers remain responsible for rich pushAgentEvent calls
 * (agent:done with prUrl, agent:clarify with question, etc.).
 */
export async function transitionAgentStatus(
  taskId: string,
  projectId: string,
  to: AgentStatusValue,
  opts?: TransitionOptions
): Promise<DomainEvent[]> {
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

  await prisma.task.update({ where: { id: taskId }, data })

  // Emit domain event
  const events: DomainEvent[] = [
    {
      type: 'agent:status_changed',
      taskId,
      projectId,
      from: current,
      to,
      fields: Object.keys(data),
      patch: { agentStatus: to },
    },
  ]

  if (!opts?.skipDispatch) {
    await dispatchEvents(events)
  }

  return events
}

// ── Clear helper (any → null) ───────────────────────────────────────────────

/**
 * Clear agentStatus entirely. Used when unassigning a task from an agent.
 * Returns emitted events for optional deferred dispatch.
 */
export async function clearAgentStatus(
  taskId: string,
  projectId: string,
  opts?: { skipDispatch?: boolean | undefined }
): Promise<DomainEvent[]> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { agentStatus: true },
  })

  await prisma.task.update({
    where: { id: taskId },
    data: { agentStatus: null, agentError: null, sandboxId: null },
  })

  const events: DomainEvent[] = [
    {
      type: 'agent:status_changed',
      taskId,
      projectId,
      from: task?.agentStatus ?? null,
      to: null,
      fields: ['agentStatus'],
      patch: { agentStatus: null },
    },
  ]

  if (!opts?.skipDispatch) {
    await dispatchEvents(events)
  }

  return events
}
