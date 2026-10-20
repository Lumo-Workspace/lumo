import type { TaskPriority, TopBlockers } from '@/types/summary'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

/**
 * How long a task can sit untouched before it counts as stalled, and how long
 * an open PR can wait for review before it counts as stale.
 *
 * These were workspace/project-configurable knobs while the risk-scoring engine
 * existed (LUM-709 removed it). Nothing tuned them in practice, so they are
 * fixed constants — the two numbers the blocker queries need, in one place.
 */
export const STALLED_DAYS = 7
export const STALE_PR_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

export function stalledCutoff(now: Date): Date {
  return new Date(now.getTime() - STALLED_DAYS * DAY_MS)
}

export function stalePrCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_PR_DAYS * DAY_MS)
}

export function collectTopBlockers(input: {
  tasks: Array<{
    id: string
    identifier: string
    title: string
    status: string
    priority: TaskPriority
    dueDate: Date | null
    updatedAt: Date
  }>
  agents: Array<{
    taskId: string
    identifier: string
    title: string
    agentStatus: string | null
  }>
  prs: Array<{ number: number; state: string; createdAt: Date; url: string }>
  now: Date
}): TopBlockers {
  const { tasks, agents, prs, now } = input
  const cap = <T>(arr: T[]) => arr.slice(0, 10)

  const stalledBefore = stalledCutoff(now)
  const stalePrBefore = stalePrCutoff(now)

  const overdueTaskIds = cap(
    tasks
      .filter(
        t =>
          t.dueDate !== null && t.dueDate < now && !isClosedTaskStatus(t.status)
      )
      .map(t => ({ id: t.id, identifier: t.identifier, title: t.title }))
  )

  const stalledTaskIds = cap(
    tasks
      .filter(t => !isClosedTaskStatus(t.status) && t.updatedAt < stalledBefore)
      .map(t => ({
        id: t.id,
        identifier: t.identifier,
        title: t.title,
        priority: t.priority,
        updatedAt: t.updatedAt.toISOString(),
      }))
  )

  const failingAgentTaskIds = cap(
    agents
      .filter(a => a.agentStatus === 'FAILED')
      .map(a => ({ id: a.taskId, identifier: a.identifier, title: a.title }))
  )

  const stalePrs = cap(
    prs.filter(p => p.state === 'open' && p.createdAt < stalePrBefore)
  )

  return {
    overdueTaskIds,
    stalledTaskIds,
    failingAgentTaskIds,
    // Bare numbers stay for published CLI versions; the richer list rides along.
    staleOpenPrNumbers: stalePrs.map(p => p.number),
    staleOpenPrs: stalePrs.map(p => ({
      number: p.number,
      openedAt: p.createdAt.toISOString(),
      url: p.url,
    })),
    // Filled in by the caller, which has the per-task session context that
    // decides which stalled tasks are expensive enough to promote.
    highStakesTaskIds: [],
  }
}

// Re-export for convenience at the call sites that render blockers.
export type { TopBlockers }
