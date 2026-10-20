import type { TaskStatus } from '@prisma/client'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

/** Current-membership task row — same basis every other Overview rollup uses. */
export interface RiskQueueTaskRow {
  id: string
  ref: string
  title: string
  status: TaskStatus
  createdAt: Date
}

/** BLOCKS edge, status UNfiltered — the honesty filter lives in this module. */
export interface RiskQueueEdgeRow {
  blockedTaskId: string
  status: string // DependencyStatus: SUGGESTED | CONFIRMED | DISMISSED
  blocking: { ref: string; title: string; status: TaskStatus }
}

export interface RiskQueueActivityRow {
  taskId: string
  payload: unknown
  createdAt: Date
}

/** Raw crossing row; a `null` collection means the read failed (→ unknown). */
export interface RiskQueueCrossingRow {
  taskId: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  disposition: string | null
  advisory: boolean
}

export interface MilestoneRiskQueueInput {
  milestoneCreatedAt: Date
  tasks: RiskQueueTaskRow[]
  edges: RiskQueueEdgeRow[]
  statusActivities: RiskQueueActivityRow[]
  crossings: RiskQueueCrossingRow[] | null
  now: Date
}

export interface MilestoneRiskQueue {
  blocked: Array<{
    taskId: string
    ref: string
    title: string
    blockingRef: string
    blockingStatus: TaskStatus
  }>
  awaitingVerdict: Array<{
    taskId: string
    ref: string
    title: string
    /** Seconds since the last replayed transition into IN_REVIEW; null = not replayable (unknown, stated as such). */
    agingSec: number | null
  }>
  crossings:
    | {
        known: true
        bySeverity: { high: number; medium: number; low: number }
        tasks: Array<{
          taskId: string
          ref: string
          title: string
          high: number
          medium: number
          low: number
        }>
      }
    | { known: false }
  /** Initial = tasks created before the milestone existed; membership changes have no activity trail, so creation time is the only mechanical division. */
  scopeBaseline: { initial: number; current: number; addedLater: number }
}

function parseStatusPayload(p: unknown): { to?: string } | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  return typeof o.to === 'string' ? { to: o.to } : {}
}

export function computeMilestoneRiskQueue(
  input: MilestoneRiskQueueInput
): MilestoneRiskQueue {
  const byId = new Map(input.tasks.map(t => [t.id, t]))

  const blocked = input.edges
    .filter(
      e => e.status === 'CONFIRMED' && !isClosedTaskStatus(e.blocking.status)
    )
    .flatMap(e => {
      const t = byId.get(e.blockedTaskId)
      if (!t) return []
      return [
        {
          taskId: t.id,
          ref: t.ref,
          title: t.title,
          blockingRef: e.blocking.ref,
          blockingStatus: e.blocking.status,
        },
      ]
    })
    .sort((a, b) => a.ref.localeCompare(b.ref))

  const awaitingVerdict = input.tasks
    .filter(t => t.status === 'IN_REVIEW')
    .map(t => {
      let since: Date | null = null
      for (const a of input.statusActivities) {
        if (a.taskId !== t.id) continue
        if (parseStatusPayload(a.payload)?.to !== 'IN_REVIEW') continue
        if (since === null || a.createdAt > since) since = a.createdAt
      }
      return {
        taskId: t.id,
        ref: t.ref,
        title: t.title,
        agingSec: since
          ? Math.max(
              0,
              Math.floor((input.now.getTime() - since.getTime()) / 1000)
            )
          : null,
      }
    })
    .sort((a, b) => (b.agingSec ?? -1) - (a.agingSec ?? -1))

  let crossings: MilestoneRiskQueue['crossings']
  if (input.crossings === null) {
    crossings = { known: false }
  } else {
    const open = input.crossings.filter(
      c => c.disposition === null && !c.advisory && byId.has(c.taskId)
    )
    const perTask = new Map<
      string,
      { high: number; medium: number; low: number }
    >()
    for (const c of open) {
      const n = perTask.get(c.taskId) ?? { high: 0, medium: 0, low: 0 }
      if (c.severity === 'HIGH') n.high += 1
      else if (c.severity === 'MEDIUM') n.medium += 1
      else n.low += 1
      perTask.set(c.taskId, n)
    }
    const tasks = [...perTask.entries()]
      .flatMap(([taskId, n]) => {
        const t = byId.get(taskId)
        return t ? [{ taskId, ref: t.ref, title: t.title, ...n }] : []
      })
      .sort((a, b) => a.ref.localeCompare(b.ref))
    crossings = {
      known: true,
      bySeverity: {
        high: tasks.reduce((s, t) => s + t.high, 0),
        medium: tasks.reduce((s, t) => s + t.medium, 0),
        low: tasks.reduce((s, t) => s + t.low, 0),
      },
      tasks,
    }
  }

  const initial = input.tasks.filter(
    t => t.createdAt <= input.milestoneCreatedAt
  ).length
  const current = input.tasks.length

  return {
    blocked,
    awaitingVerdict,
    crossings,
    scopeBaseline: { initial, current, addedLater: current - initial },
  }
}
