/**
 * LUM-1280 — process-stage dwell for the closed-sprint retro.
 *
 * Each task's window runs from its first IN_PROGRESS to the moment it became
 * verified (`./sprint-verified.ts`), or the sprint end when it never did, and
 * is clipped to the sprint window. Every instant of that window goes to
 * exactly one stage, by precedence:
 *
 *   ruling        a blocking crossing is open (detected, not dispositioned)
 *   agent         an agent run is active on the task
 *   review        a non-draft PR is open and unmerged
 *   verification  a PR has merged and the task is not yet verified
 *   other         anything else
 *
 * Per stage, the per-task totals are reduced to a median across tasks; tasks
 * that spent no time in a stage are excluded from that stage's sample, and
 * `n` reports the sample size. Calendar time, not working hours.
 *
 * Stage names are deliberately neutral (product ruling): never "waiting for
 * people". These stats are frozen at close and only shown on closed sprints.
 *
 * Pure — no prisma, repository or service imports.
 */
import type { ActiveInterval } from '@/lib/agent-run/active-time'

export const PROCESS_STAGES = [
  'ruling',
  'agent',
  'review',
  'verification',
  'other',
] as const

export type ProcessStage = (typeof PROCESS_STAGES)[number]

export interface StageCrossing {
  detectedAt: Date
  /** null while still open. */
  dispositionedAt: Date | null
  /** Advisory crossings never block DONE, so they never count as ruling. */
  advisory: boolean
  severity: string
}

export interface StagePullRequest {
  createdAt: Date
  mergedAt: Date | null
  closedAt: Date | null
  /** Current draft flag — draft toggles are not timestamped, so a PR that is
   *  a draft now is treated as a draft for its whole life. */
  isDraft: boolean
}

export interface StageTaskInput {
  taskId: string
  /** First transition into IN_PROGRESS; null = never started (excluded). */
  startedAt: Date | null
  /** When the task became verified; null = not verified by sprint end. */
  verifiedAt: Date | null
  crossings: StageCrossing[]
  /** Agent active spans, epoch ms `[start, end)`; may overlap. */
  agentIntervals: ActiveInterval[]
  pullRequests: StagePullRequest[]
}

export interface StageStat {
  /** Median ms across tasks with time in this stage; null when n = 0. */
  medianMs: number | null
  n: number
}

export interface ProcessStagesStats {
  /** Tasks with a non-empty window inside the sprint. */
  tasks: number
  stages: Record<ProcessStage, StageStat>
}

export interface StageWindow {
  start: Date
  end: Date
  /** The workspace crossing gate: when off, only HIGH crossings block. */
  crossingGateEnabled: boolean
}

type Span = [number, number]

function covers(spans: Span[], t: number): boolean {
  return spans.some(([a, b]) => a <= t && t < b)
}

/** Per-stage ms for one task, or null when its clipped window is empty. */
export function taskStageDurations(
  task: StageTaskInput,
  window: StageWindow
): Record<ProcessStage, number> | null {
  if (!task.startedAt) return null
  const winStart = window.start.getTime()
  const winEnd = window.end.getTime()
  const from = Math.max(task.startedAt.getTime(), winStart)
  const to = Math.min(task.verifiedAt?.getTime() ?? winEnd, winEnd)
  if (to <= from) return null

  const ruling: Span[] = task.crossings
    .filter(
      c => !c.advisory && (window.crossingGateEnabled || c.severity === 'HIGH')
    )
    .map(c => [c.detectedAt.getTime(), c.dispositionedAt?.getTime() ?? to])
  const agent: Span[] = task.agentIntervals.map(([a, b]) => [a, b])
  const review: Span[] = task.pullRequests
    .filter(pr => !pr.isDraft)
    .map(pr => [
      pr.createdAt.getTime(),
      (pr.mergedAt ?? pr.closedAt)?.getTime() ?? to,
    ])
  const mergedTimes = task.pullRequests
    .map(pr => pr.mergedAt?.getTime())
    .filter((t): t is number => t !== undefined)
  const verification: Span[] =
    mergedTimes.length > 0 ? [[Math.min(...mergedTimes), to]] : []

  const cuts = new Set<number>([from, to])
  for (const [a, b] of [...ruling, ...agent, ...review, ...verification]) {
    if (a > from && a < to) cuts.add(a)
    if (b > from && b < to) cuts.add(b)
  }
  const points = [...cuts].sort((a, b) => a - b)

  const out: Record<ProcessStage, number> = {
    ruling: 0,
    agent: 0,
    review: 0,
    verification: 0,
    other: 0,
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i] as number
    const b = points[i + 1] as number
    // Every boundary is a cut, so membership is constant on [a, b).
    const stage: ProcessStage = covers(ruling, a)
      ? 'ruling'
      : covers(agent, a)
        ? 'agent'
        : covers(review, a)
          ? 'review'
          : covers(verification, a)
            ? 'verification'
            : 'other'
    out[stage] += b - a
  }
  return out
}

/** Median of a non-empty sample; the mean of the two middles for even n. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

export function computeProcessStages(
  tasks: StageTaskInput[],
  window: StageWindow
): ProcessStagesStats {
  const samples: Record<ProcessStage, number[]> = {
    ruling: [],
    agent: [],
    review: [],
    verification: [],
    other: [],
  }
  let counted = 0
  for (const task of tasks) {
    const durations = taskStageDurations(task, window)
    if (!durations) continue
    counted++
    for (const stage of PROCESS_STAGES) {
      if (durations[stage] > 0) samples[stage].push(durations[stage])
    }
  }
  const stages = Object.fromEntries(
    PROCESS_STAGES.map(s => [
      s,
      { medianMs: median(samples[s]), n: samples[s].length },
    ])
  ) as Record<ProcessStage, StageStat>
  return { tasks: counted, stages }
}
