import type { TaskPriority, TaskStatus } from '@prisma/client'
import { PRIORITY_DISPLAY_ORDER } from '@/lib/task/priority'
import type { SprintMeta } from './sprint-coverage'
import { countsTowardCompletion } from '@/lib/task/status-semantics'

/** One member task as fetched for segmentation (pre-mapped by the service). */
export interface MilestoneSegmentTaskInput {
  id: string
  /** Human ref, e.g. "LUM-283" — the drill-down link target. */
  ref: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  sprintId: string | null
  tags: Array<{ id: string; name: string }>
}

/** The task row shared by every dimension (referenced via `taskIds`). */
export interface MilestoneSegmentTaskRow {
  taskId: string
  ref: string
  title: string
  status: TaskStatus
}

/** Bucket key for tasks with no sprint / no tag binding. Distinct arrays per
 * dimension, so the sentinel never collides with a cuid. */
export const SEGMENT_NONE_KEY = 'NONE'

export interface MilestoneSegment {
  /** sprintId · TaskPriority value · tagId · SEGMENT_NONE_KEY. */
  key: string
  /**
   * Sprint / tag display name. `null` for priority segments and NONE buckets
   * (the component labels those via i18n), and for a sprint the meta lookup
   * could not resolve.
   */
  label: string | null
  taskIds: string[]
  doneCount: number
}

export interface MilestoneSegments {
  tasks: MilestoneSegmentTaskRow[]
  sprint: MilestoneSegment[]
  priority: MilestoneSegment[]
  workstream: MilestoneSegment[]
}

const PRIORITY_ORDER: readonly TaskPriority[] = PRIORITY_DISPLAY_ORDER

function push(
  acc: Map<
    string,
    { label: string | null; taskIds: string[]; doneCount: number }
  >,
  key: string,
  label: string | null,
  task: MilestoneSegmentTaskInput
) {
  const entry = acc.get(key) ?? { label, taskIds: [], doneCount: 0 }
  entry.taskIds.push(task.id)
  if (task.status === 'DONE') entry.doneCount += 1
  acc.set(key, entry)
}

function toSegments(
  acc: Map<
    string,
    { label: string | null; taskIds: string[]; doneCount: number }
  >
): MilestoneSegment[] {
  return [...acc.entries()].map(([key, e]) => ({ key, ...e }))
}

/**
 * LUM-628 — group a milestone's member tasks along the three segmentation
 * dimensions (sprint / priority / workstream=tag). Pure and deterministic.
 * Honest bucketing: a task with no sprint (or no tag) lands in an explicit
 * NONE bucket rather than disappearing from the dimension, and a multi-tag
 * task appears under each of its tags. Empty segments are dropped; the NONE
 * bucket only appears when non-empty.
 */
export function computeMilestoneSegments(
  tasks: MilestoneSegmentTaskInput[],
  sprints: SprintMeta[]
): MilestoneSegments {
  const sprintMeta = new Map(sprints.map(s => [s.id, s]))
  const bySprint = new Map<
    string,
    { label: string | null; taskIds: string[]; doneCount: number }
  >()
  const byPriority = new Map<
    string,
    { label: string | null; taskIds: string[]; doneCount: number }
  >()
  const byTag = new Map<
    string,
    { label: string | null; taskIds: string[]; doneCount: number }
  >()

  for (const task of tasks) {
    // LUM-1282: a canceled task is outside every segment's progress.
    if (!countsTowardCompletion(task.status)) continue
    if (task.sprintId === null) {
      push(bySprint, SEGMENT_NONE_KEY, null, task)
    } else {
      push(
        bySprint,
        task.sprintId,
        sprintMeta.get(task.sprintId)?.name ?? null,
        task
      )
    }

    push(byPriority, task.priority, null, task)

    if (task.tags.length === 0) {
      push(byTag, SEGMENT_NONE_KEY, null, task)
    } else {
      for (const tag of task.tags) push(byTag, tag.id, tag.name, task)
    }
  }

  const noneLast = (a: MilestoneSegment, b: MilestoneSegment) =>
    Number(a.key === SEGMENT_NONE_KEY) - Number(b.key === SEGMENT_NONE_KEY)

  const sprint = toSegments(bySprint).sort(
    (a, b) =>
      noneLast(a, b) ||
      (sprintMeta.get(a.key)?.number ?? Number.MAX_SAFE_INTEGER) -
        (sprintMeta.get(b.key)?.number ?? Number.MAX_SAFE_INTEGER)
  )
  const priority = toSegments(byPriority).sort(
    (a, b) =>
      PRIORITY_ORDER.indexOf(a.key as TaskPriority) -
      PRIORITY_ORDER.indexOf(b.key as TaskPriority)
  )
  const workstream = toSegments(byTag).sort(
    (a, b) => noneLast(a, b) || (a.label ?? '').localeCompare(b.label ?? '')
  )

  return {
    tasks: tasks.map(t => ({
      taskId: t.id,
      ref: t.ref,
      title: t.title,
      status: t.status,
    })),
    sprint,
    priority,
    workstream,
  }
}
