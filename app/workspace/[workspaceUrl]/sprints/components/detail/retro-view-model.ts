/**
 * LUM-1281 — flat view models for the closed-sprint retro layout.
 *
 * Pure readers over what the server already stored: the retro summary's
 * `stats` (frozen at close, LUM-1280) and the attention DTO's `cost`
 * (LUM-1278). Option A (product ruling): nothing new is derived here — no
 * cycle time, no per-person waits; a missing field stays missing.
 */
import type {
  ProcessStage,
  ProcessStagesStats,
} from '@/lib/summaries/sprint-process-stages'
import type { SprintSpilloverItem } from '@/lib/api-client/sprints'

/**
 * Whether the stored stats could be read: `pending` = the retro is not
 * generated yet (404), `failed` = the read failed. Never shown as zeros.
 */
export type RetroStatsStatus = 'ready' | 'pending' | 'failed'

/** The subset of `SprintSummary.stats` the retro reads. */
export interface RetroStats {
  /** Null when the stored stats lack the field — shown as "—", never 0. */
  totalTasks: number | null
  spillover: number | null
  /** Absent on summaries written before LUM-1280. */
  verifiedCount: number | null
  /** Absent on summaries written before LUM-1280. */
  processStages: ProcessStagesStats | null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function isProcessStages(v: unknown): v is ProcessStagesStats {
  if (!v || typeof v !== 'object') return false
  const o = v as { tasks?: unknown; stages?: unknown }
  return (
    typeof o.tasks === 'number' && !!o.stages && typeof o.stages === 'object'
  )
}

/**
 * Read the stored stats JSON defensively: it is untyped JSON on the wire and
 * older rows lack the LUM-1280 fields. Null when there is no stats object.
 */
export function readRetroStats(stats: unknown): RetroStats | null {
  if (!stats || typeof stats !== 'object') return null
  const s = stats as Record<string, unknown>
  return {
    totalTasks: num(s.totalTasks),
    spillover: num(s.spillover),
    verifiedCount: num(s.verifiedCount),
    processStages: isProcessStages(s.processStages) ? s.processStages : null,
  }
}

// ─── Process stages table ───────────────────────────────────────────────────

/** Display order of the stage rows (the design's order, `other` last). */
export const PROCESS_STAGE_ROWS: ProcessStage[] = [
  'agent',
  'review',
  'ruling',
  'verification',
  'other',
]

export interface ProcessStageRow {
  stage: ProcessStage
  /** Tasks with time in this stage this sprint. */
  n: number
  medianMs: number | null
  /** Undefined when there is no comparison column at all. */
  previousMedianMs?: number | null
}

export interface ProcessStagesModel {
  rows: ProcessStageRow[]
  /** Previous sprint's name when it has stored stages; null hides the column. */
  previousName: string | null
}

/**
 * Rows for the "process stages" table. Null when this sprint has no stored
 * stages (closed before LUM-1280) — the card shows its empty state, never
 * zeros. The comparison column appears only when the previous sprint has
 * stored stages too.
 */
export function buildProcessStages(
  current: ProcessStagesStats | null,
  previous: { name: string; stages: ProcessStagesStats | null } | null
): ProcessStagesModel | null {
  if (!current) return null
  const prev = previous?.stages ? previous : null
  return {
    previousName: prev?.name ?? null,
    rows: PROCESS_STAGE_ROWS.map(stage => {
      const now = current.stages[stage]
      const row: ProcessStageRow = {
        stage,
        n: now?.n ?? 0,
        medianMs: now?.medianMs ?? null,
      }
      if (prev?.stages)
        row.previousMedianMs = prev.stages.stages[stage]?.medianMs ?? null
      return row
    }),
  }
}

// ─── Carried over ───────────────────────────────────────────────────────────

export interface CarriedOverRow {
  taskId: string
  identifier: string
  title: string
  /** Destination sprint name; null = back to the backlog. */
  destination: string | null
}

export interface CarriedOverDestination {
  /** Destination sprint name; null = back to the backlog. */
  sprintName: string | null
  count: number
}

/**
 * Table rows plus the outcome card's "N to Sprint X / M to backlog" counts —
 * a straight tally of the spillover read's rows: sprints by number, backlog
 * last.
 */
export function toCarriedOver(items: SprintSpilloverItem[]): {
  rows: CarriedOverRow[]
  destinations: CarriedOverDestination[]
} {
  const bySprint = new Map<number, CarriedOverDestination>()
  let backlog = 0
  for (const i of items) {
    if (!i.to) {
      backlog++
      continue
    }
    const d = bySprint.get(i.to.number)
    if (d) d.count++
    else bySprint.set(i.to.number, { sprintName: i.to.name, count: 1 })
  }
  const destinations = [...bySprint.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, d]) => d)
  if (backlog > 0) destinations.push({ sprintName: null, count: backlog })
  return {
    rows: items.map(i => ({
      taskId: i.taskId,
      identifier: i.identifier,
      title: i.title,
      destination: i.to?.name ?? null,
    })),
    destinations,
  }
}

// ─── Next sprint ────────────────────────────────────────────────────────────

/** The team's sprint numbered right after this one, if any. */
export function pickNextSprint<T extends { number: number }>(
  sprints: readonly T[] | undefined,
  number: number
): T | null {
  let next: T | null = null
  for (const s of sprints ?? [])
    if (s.number > number && (next === null || s.number < next.number)) next = s
  return next
}
