/**
 * LUM-1007 — arms, threshold choice and read-out for regex vs classifier.
 *
 * Pure: no I/O. `run-classifier.ts` feeds it scored rows; the jest test feeds
 * it fixtures. An "arm" is one way of deciding flagged / not flagged:
 *
 *   regex            — production's detector alone (score.ts)
 *   classifier@t     — model probability ≥ t
 *   or@t             — regex OR (probability ≥ t): the classifier as a layer
 *                      behind the regex, the only shape production could add
 *
 * Thresholds are chosen on the TRAIN split only (split.ts), as the lowest grid
 * value whose train Lumo-benign FPR stays within the bound — recall can only
 * fall as t rises, so that is the highest-recall feasible point. HELD-OUT is
 * then measured with the chosen value, never tuned on.
 */
import { wilson, type Lang, type Rate } from './classify'
import type { Label } from './sources'
import type { Split } from './split'

export interface BenchRow {
  dataset: string
  ref: string
  label: Label
  lang: Lang
  split: Split
  /** Regex detector verdict (score.ts). */
  regex: boolean
  regexMs: number
  /** Classifier positive-class probability (max over chunks). */
  prob: number
  chunks: number
  clfMs: number
}

export type ArmKind = 'regex' | 'classifier' | 'or'

export interface Arm {
  id: string
  kind: ArmKind
  /** Classifier model id (classifier / or arms). */
  model?: string
  threshold?: number
  /** How the threshold was picked: fixed report value or train-chosen. */
  chosen?: 'fixed' | 'train'
}

export interface Pools {
  attacks: string[]
  publicBenign: string[]
  lumoBenign: string[]
}

export function armFlags(row: BenchRow, arm: Arm): boolean {
  if (arm.kind === 'regex') return row.regex
  if (arm.threshold === undefined)
    throw new Error(`arm ${arm.id} needs a threshold`)
  const clf = row.prob >= arm.threshold
  return arm.kind === 'classifier' ? clf : row.regex || clf
}

/** Per-sample latency of an arm: the OR arm runs both scorers in sequence. */
export function armMs(row: BenchRow, arm: Arm): number {
  if (arm.kind === 'regex') return row.regexMs
  if (arm.kind === 'classifier') return row.clfMs
  return row.regexMs + row.clfMs
}

export function armId(
  kind: ArmKind,
  model?: string,
  threshold?: number
): string {
  if (kind === 'regex') return 'regex'
  const base = kind === 'classifier' ? model : `regex OR ${model}`
  return `${base}@${threshold}`
}

function rateOf(rows: BenchRow[], arm: Arm): Rate {
  return wilson(rows.filter(r => armFlags(r, arm)).length, rows.length)
}

function inPool(rows: BenchRow[], ids: string[]): BenchRow[] {
  return rows.filter(r => ids.includes(r.dataset))
}

export interface ThresholdChoice {
  threshold: number | null
  trainRecall: Rate | null
  trainLumoFpr: Rate | null
}

/**
 * Lowest grid threshold (ascending grid) whose TRAIN Lumo-benign FPR is
 * ≤ `fprBound`. `null` when no grid value meets the bound (e.g. the regex
 * alone already exceeds it for an OR arm).
 */
export function chooseThreshold(
  rows: BenchRow[],
  kind: 'classifier' | 'or',
  model: string,
  pools: Pools,
  fprBound: number,
  grid: readonly number[]
): ThresholdChoice {
  const train = rows.filter(r => r.split === 'train')
  const benign = inPool(train, pools.lumoBenign)
  const attacks = inPool(train, pools.attacks)
  const sorted = [...grid].sort((a, b) => a - b)
  for (const t of sorted) {
    const arm: Arm = { id: armId(kind, model, t), kind, model, threshold: t }
    const fpr = rateOf(benign, arm)
    if (fpr.n > 0 && fpr.k / fpr.n <= fprBound)
      return {
        threshold: t,
        trainRecall: rateOf(attacks, arm),
        trainLumoFpr: fpr,
      }
  }
  return { threshold: null, trainRecall: null, trainLumoFpr: null }
}

export const LANGS: readonly Lang[] = ['en', 'zh', 'de', 'other']

export interface ArmReport {
  arm: Arm
  attacks: Rate
  attacksByDataset: Record<string, Rate>
  attacksByLanguage: Partial<Record<Lang, Rate>>
  lumoBenign: Rate
  lumoBenignByDataset: Record<string, Rate>
  lumoBenignByLanguage: Partial<Record<Lang, Rate>>
  /** Lumo-benign samples this arm flags that needed chunking (chunks > 1). */
  lumoBenignFlaggedChunked: number
  publicBenign: Rate
  /** True when the Lumo-benign FPR point estimate is within the bound. */
  withinFprBound: boolean
  latencyMs: { p50: number; p95: number }
}

/** Report one arm on one split (or on all rows when `split` is undefined). */
export function armReport(
  rows: BenchRow[],
  arm: Arm,
  pools: Pools,
  fprBound: number,
  split?: Split
): ArmReport {
  const mine = split ? rows.filter(r => r.split === split) : rows
  const attacks = inPool(mine, pools.attacks)
  const lumo = inPool(mine, pools.lumoBenign)
  const byDataset = (ids: string[]): Record<string, Rate> => {
    const out: Record<string, Rate> = {}
    for (const id of ids)
      out[id] = rateOf(
        mine.filter(r => r.dataset === id),
        arm
      )
    return out
  }
  const byLanguage = (pool: BenchRow[]): Partial<Record<Lang, Rate>> => {
    const out: Partial<Record<Lang, Rate>> = {}
    for (const lang of LANGS) {
      const sub = pool.filter(r => r.lang === lang)
      if (sub.length > 0) out[lang] = rateOf(sub, arm)
    }
    return out
  }
  const lumoRate = rateOf(lumo, arm)
  const ms = mine.map(r => armMs(r, arm))
  return {
    arm,
    attacks: rateOf(attacks, arm),
    attacksByDataset: byDataset(pools.attacks),
    attacksByLanguage: byLanguage(attacks),
    lumoBenign: lumoRate,
    lumoBenignByDataset: byDataset(pools.lumoBenign),
    lumoBenignByLanguage: byLanguage(lumo),
    lumoBenignFlaggedChunked: lumo.filter(r => r.chunks > 1 && armFlags(r, arm))
      .length,
    publicBenign: rateOf(inPool(mine, pools.publicBenign), arm),
    withinFprBound: lumoRate.n > 0 && lumoRate.k / lumoRate.n <= fprBound,
    latencyMs: { p50: percentile(ms, 50), p95: percentile(ms, 95) },
  }
}

/** Nearest-rank percentile; 0 for an empty list. Rounded to 0.001 ms. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil((p / 100) * sorted.length))
  )
  return Math.round((sorted[rank - 1] ?? 0) * 1000) / 1000
}

export interface ChunkCount {
  dataset: string
  n: number
  chunked: number
  maxChunks: number
}

/** How many samples per dataset exceeded the model window (chunks > 1). */
export function chunkCounts(
  rows: BenchRow[],
  datasetOrder: string[]
): ChunkCount[] {
  return datasetOrder.map(dataset => {
    const mine = rows.filter(r => r.dataset === dataset)
    return {
      dataset,
      n: mine.length,
      chunked: mine.filter(r => r.chunks > 1).length,
      maxChunks: mine.reduce((m, r) => Math.max(m, r.chunks), 0),
    }
  })
}

/**
 * The arm list for one model: classifier and OR at each fixed report
 * threshold, plus the train-chosen threshold for each (when one exists and
 * is not already a fixed value).
 */
export function armsFor(
  model: string,
  reportThresholds: readonly number[],
  chosen: { classifier: number | null; or: number | null }
): Arm[] {
  const arms: Arm[] = []
  for (const kind of ['classifier', 'or'] as const) {
    const pick = chosen[kind]
    const ts = [
      ...new Set([...reportThresholds, ...(pick === null ? [] : [pick])]),
    ].sort((a, b) => a - b)
    for (const t of ts)
      arms.push({
        id: armId(kind, model, t),
        kind,
        model,
        threshold: t,
        chosen: t === pick ? 'train' : 'fixed',
      })
  }
  return arms
}

export interface SliceReport {
  arm: Arm
  all: Rate
  byLanguage: Record<string, Rate>
  /** Per-sample verdicts for the small verbatim subset (e.g. LUM-999 payloads). */
  verbatim: Record<string, boolean>
}

/**
 * Recall of one arm on a stand-alone attack slice (all rows of `dataset`,
 * both splits — the slice is never used for threshold choice), grouped by the
 * slice's own authored language tag.
 */
export function sliceReport(
  rows: BenchRow[],
  arm: Arm,
  dataset: string,
  langOf: (ref: string) => string,
  verbatimRefs: readonly string[] = []
): SliceReport {
  const mine = rows.filter(r => r.dataset === dataset)
  const byLanguage: Record<string, Rate> = {}
  for (const lang of [...new Set(mine.map(r => langOf(r.ref)))].sort())
    byLanguage[lang] = rateOf(
      mine.filter(r => langOf(r.ref) === lang),
      arm
    )
  const verbatim: Record<string, boolean> = {}
  for (const ref of verbatimRefs) {
    const row = mine.find(r => r.ref === ref)
    if (row) verbatim[ref] = armFlags(row, arm)
  }
  return { arm, all: rateOf(mine, arm), byLanguage, verbatim }
}
