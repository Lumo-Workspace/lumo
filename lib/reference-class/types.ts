/**
 * LUM-497 — reference-class anchor (outside view at criteria-drafting time).
 *
 * Shared types + tuning constants for the pure core. Nothing here touches IO:
 * the repository supplies rows, these functions decide and render.
 */

/**
 * Which layer the reference class was drawn from. The widest layer is TEAM,
 * not workspace: it is fed by `Task.teamId`, and in the schema a Workspace has
 * many Teams. Naming the class honestly is the first step of reference-class
 * forecasting, so the level name tracks the column actually queried.
 */
export type ClassLevel = 'MILESTONE' | 'PROJECT' | 'TEAM'

/** A layer qualifies only at this many delivered tasks. Below it we say so. */
export const MIN_CLASS_SIZE = 8

/** Per-layer cap — the most recent deliveries. Bounds the follow-up queries. */
export const MAX_CLASS_SIZE = 50

/** Signal lines report at most this many entries. */
export const TOP_N = 3

/** One delivered task (one TaskCriteriaSnapshot row, reduced). */
export interface DeliveredTask {
  taskId: string
  frozenAt: Date
}

/**
 * Candidate layers, narrowest first. `null` means "no rows to consider here" —
 * distinct from an empty array (a scope that exists and has no deliveries).
 *
 * Every layer is nullable because the caller reads them incrementally: a task
 * with no milestone has none to read, and a caller that already found a
 * qualifying narrow layer never reads the broader ones at all. `select` skips a
 * null layer, so a partially-populated set selects exactly as the full set
 * would have.
 */
export interface CandidateLayers {
  milestone: DeliveredTask[] | null
  project: DeliveredTask[] | null
  team: DeliveredTask[] | null
}

export type ReferenceClass =
  | { kind: 'INSUFFICIENT' }
  | { kind: 'SELECTED'; level: ClassLevel; taskIds: string[]; size: number }

/** One counted signal value, e.g. EVIDENCE_INSUFFICIENT × 5 tasks. */
export interface TallyEntry {
  key: string
  count: number
}

export interface AnchorData {
  level: ClassLevel
  /** Human name of the class scope (milestone/project/team name). */
  label: string
  size: number
  rejections: TallyEntry[]
  crossings: TallyEntry[]
  /** Tasks whose delivered contract was added/updated after work started. */
  postStartContractTasks: number
}

export type ReferenceClassAnchor =
  | { kind: 'INSUFFICIENT' }
  | ({ kind: 'READY' } & AnchorData)
