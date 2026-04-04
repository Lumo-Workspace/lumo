import type { AgentStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { dispatchEvents } from '../events/dispatcher.js'
import type { DomainEvent } from '@lumo/shared'

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentStatusValue = AgentStatus

type FromKey = AgentStatusValue | 'null'

// ── Transition map ──────────────────────────────────────────────────────────

const TRANSITIONS: Record<FromKey, AgentStatusValue[]> = {
  null: ['SUBMITTED'],
  SUBMITTED: ['WORKING'],
  WORKING: ['COMPLETED', 'FAILED', 'INPUT_REQUIRED', 'CANCELED'],
  INPUT_REQUIRED: ['WORKING', 'FAILED', 'CANCELED'],
  FAILED: ['WORKING'],
  CANCELED: ['WORKING'],
  COMPLETED: [],
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
  spec?: string | undefined
  inputReason?: string | null | undefined
  currentStatus?: AgentStatusValue | null | undefined
  skipDispatch?: boolean | undefined
}

// ── Core transition function ────────────────────────────────────────────────

export async function transitionAgentStatus(
  taskId: string,
  projectId: string,
  to: AgentStatusValue,
  opts?: TransitionOptions
): Promise<DomainEvent[]> {
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

  if (!isValidTransition(current, to)) {
    throw new InvalidTransitionError(taskId, current, to)
  }

  const data: Record<string, unknown> = { agentStatus: to }
  if (opts?.agentError !== undefined) data.agentError = opts.agentError
  if (opts?.spec !== undefined) data.spec = opts.spec
  if (opts?.inputReason !== undefined) {
    data.inputReason = opts.inputReason
  } else if (to !== 'INPUT_REQUIRED') {
    data.inputReason = null
  }

  await prisma.task.update({ where: { id: taskId }, data })

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
    data: { agentStatus: null, agentError: null },
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
