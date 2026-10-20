import type { TaskStatus } from '@prisma/client'
import { isClosedTaskStatus } from '@/lib/task/status-semantics'

/** Current-membership task row — same basis every other Overview rollup uses. */
export interface TopologyTaskRow {
  id: string
  ref: string
  title: string
  status: TaskStatus
}

/**
 * Dependency edge, kind/status UNfiltered — the honesty filter lives in this
 * module (mirrors milestone-risk-queue). Blocked task ∈ milestone; blocking
 * task may live outside it, so its status rides on the row.
 */
export interface TopologyEdgeRow {
  blockedTaskId: string
  blockingTaskId: string
  kind: string // DependencyKind: BLOCKS | RELATES
  status: string // DependencyStatus: SUGGESTED | CONFIRMED | DISMISSED
  blockingStatus: TaskStatus
}

export interface MilestoneTopologyInput {
  tasks: TopologyTaskRow[]
  edges: TopologyEdgeRow[]
}

export interface TopologyPathNode {
  taskId: string
  ref: string
  title: string
  status: TaskStatus
}

export interface TopologyBatchItem extends TopologyPathNode {
  /** Direct in-milestone dependents still open — what finishing this releases. */
  unblocksCount: number
  onCriticalPath: boolean
}

export interface MilestoneTopology {
  /** CONFIRMED BLOCKS edges with both endpoints inside the milestone. */
  edgeCount: number
  /** Topological layers (refs) over edge-connected member tasks; cyclic nodes excluded. */
  levels: string[][]
  /** Longest dependency chain, unweighted; [] when no internal edges. */
  criticalPath: TopologyPathNode[]
  /** Refs on a dependency cycle — reported explicitly, never a crash. */
  cycleRefs: string[]
  /** Open tasks whose every confirmed blocker (in- or out-of-milestone) is DONE. */
  nextBatch: TopologyBatchItem[]
  /** Open member tasks still gated by ≥1 open confirmed blocker. */
  blockedOpenCount: number
}

export function computeMilestoneTopology(
  input: MilestoneTopologyInput
): MilestoneTopology {
  const byId = new Map(input.tasks.map(t => [t.id, t]))

  // Honesty filter: only confirmed hard edges participate; dedupe defensively.
  const seenPair = new Set<string>()
  const confirmed = input.edges.filter(e => {
    if (e.kind !== 'BLOCKS' || e.status !== 'CONFIRMED') return false
    if (!byId.has(e.blockedTaskId)) return false
    const key = `${e.blockingTaskId}→${e.blockedTaskId}`
    if (seenPair.has(key)) return false
    seenPair.add(key)
    return true
  })
  const internal = confirmed.filter(e => byId.has(e.blockingTaskId))

  // Blocker liveness: internal blockers read the live task row; external ones
  // only exist on the edge.
  const blockerStatus = (e: TopologyEdgeRow): TaskStatus =>
    byId.get(e.blockingTaskId)?.status ?? e.blockingStatus

  // ── Kahn layering over edge-connected nodes ────────────────────────────
  const nodes = new Set<string>()
  for (const e of internal) {
    nodes.add(e.blockedTaskId)
    nodes.add(e.blockingTaskId)
  }
  const dependents = new Map<string, string[]>() // blocking → blocked[]
  const indegree = new Map<string, number>()
  for (const id of nodes) indegree.set(id, 0)
  for (const e of internal) {
    dependents.set(e.blockingTaskId, [
      ...(dependents.get(e.blockingTaskId) ?? []),
      e.blockedTaskId,
    ])
    indegree.set(e.blockedTaskId, (indegree.get(e.blockedTaskId) ?? 0) + 1)
  }

  const refOf = (id: string) => byId.get(id)?.ref ?? id
  const byRef = (a: string, b: string) => refOf(a).localeCompare(refOf(b))

  const level = new Map<string, number>()
  let frontier = [...nodes].filter(id => indegree.get(id) === 0).sort(byRef)
  frontier.forEach(id => level.set(id, 0))
  const emitted: string[] = []
  const remainingIndegree = new Map(indegree)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      emitted.push(id)
      for (const dep of dependents.get(id) ?? []) {
        const d = (remainingIndegree.get(dep) ?? 0) - 1
        remainingIndegree.set(dep, d)
        level.set(dep, Math.max(level.get(dep) ?? 0, (level.get(id) ?? 0) + 1))
        if (d === 0) next.push(dep)
      }
    }
    frontier = next.sort(byRef)
  }

  const levels: string[][] = []
  for (const id of emitted) {
    const l = level.get(id) ?? 0
    ;(levels[l] ??= []).push(refOf(id))
  }
  levels.forEach(refs => refs.sort((a, b) => a.localeCompare(b)))

  // ── Cycle report: unemitted nodes that can reach themselves ────────────
  const unemitted = [...nodes].filter(
    id => (remainingIndegree.get(id) ?? 0) > 0
  )
  const cycleRefs = unemitted
    .filter(id => reaches(id, id, dependents))
    .map(refOf)
    .sort((a, b) => a.localeCompare(b))

  // ── Critical path: longest chain over the acyclic emitted part ─────────
  const dist = new Map<string, number>()
  const pred = new Map<string, string | null>()
  for (const id of emitted) {
    dist.set(id, dist.get(id) ?? 0)
    pred.set(id, pred.get(id) ?? null)
    for (const dep of dependents.get(id) ?? []) {
      if (!emitted.includes(dep) && (remainingIndegree.get(dep) ?? 0) > 0)
        continue
      const cand = (dist.get(id) ?? 0) + 1
      const cur = dist.get(dep) ?? 0
      if (cand > cur || (cand === cur && byRef(id, pred.get(dep) ?? id) < 0)) {
        dist.set(dep, cand)
        pred.set(dep, id)
      }
    }
  }
  let endpoint: string | null = null
  for (const id of emitted) {
    if (
      endpoint === null ||
      (dist.get(id) ?? 0) > (dist.get(endpoint) ?? 0) ||
      ((dist.get(id) ?? 0) === (dist.get(endpoint) ?? 0) &&
        byRef(id, endpoint) < 0)
    ) {
      endpoint = id
    }
  }
  const criticalPath: TopologyPathNode[] = []
  for (let id = endpoint; id !== null; id = pred.get(id) ?? null) {
    const t = byId.get(id)
    if (!t) break
    criticalPath.unshift({
      taskId: t.id,
      ref: t.ref,
      title: t.title,
      status: t.status,
    })
  }
  const onPath = new Set(criticalPath.map(n => n.taskId))

  // ── Next batch: open tasks with every confirmed blocker closed ─────────
  // LUM-1282: closed = DONE or CANCELED — a canceled blocker no longer holds
  // anything back, and a canceled task is not "next".
  const blockersOf = new Map<string, TopologyEdgeRow[]>()
  for (const e of confirmed) {
    blockersOf.set(e.blockedTaskId, [
      ...(blockersOf.get(e.blockedTaskId) ?? []),
      e,
    ])
  }
  const openDependents = (id: string) =>
    (dependents.get(id) ?? []).filter(dep => {
      const status = byId.get(dep)?.status
      return status === undefined || !isClosedTaskStatus(status)
    }).length

  const open = input.tasks.filter(t => !isClosedTaskStatus(t.status))
  const isReady = (t: TopologyTaskRow) =>
    (blockersOf.get(t.id) ?? []).every(e =>
      isClosedTaskStatus(blockerStatus(e))
    )

  const nextBatch: TopologyBatchItem[] = open
    .filter(isReady)
    .map(t => ({
      taskId: t.id,
      ref: t.ref,
      title: t.title,
      status: t.status,
      unblocksCount: openDependents(t.id),
      onCriticalPath: onPath.has(t.id),
    }))
    .sort(
      (a, b) => b.unblocksCount - a.unblocksCount || a.ref.localeCompare(b.ref)
    )

  const blockedOpenCount = open.length - nextBatch.length

  return {
    edgeCount: internal.length,
    levels,
    criticalPath: internal.length === 0 ? [] : criticalPath,
    cycleRefs,
    nextBatch,
    blockedOpenCount,
  }
}

/** DFS: does `from` reach `target` through ≥1 edge? Small graphs — no memo. */
function reaches(
  from: string,
  target: string,
  dependents: Map<string, string[]>
): boolean {
  const stack = [...(dependents.get(from) ?? [])]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (id === target) return true
    if (visited.has(id)) continue
    visited.add(id)
    stack.push(...(dependents.get(id) ?? []))
  }
  return false
}
