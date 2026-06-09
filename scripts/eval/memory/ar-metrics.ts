/** Cosine similarity matching pgvector's `1 - (a <=> b)`: dot / (‖a‖‖b‖).
 * Returns 0 for a zero-magnitude vector (never NaN/throw). */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** One query's scored relationship to the pool, for the floor sweep. */
export interface FloorCase {
  /** Score of the labeled positive, or null for an ADD/no-positive case. */
  positiveScore: number | null
  /** Scores of every distractor pool member. */
  distractorScores: number[]
}

export interface FloorRow {
  floor: number
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}

/** Sweep candidate floors. A positive admitted (score ≥ floor) is a TP; any
 * distractor admitted is an FP; a positive not admitted is an FN. ADD cases
 * (positiveScore null) contribute only FPs (any admission is wrong). */
export function floorSweep(cases: FloorCase[], floors: number[]): FloorRow[] {
  return floors.map(floor => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const c of cases) {
      if (c.positiveScore !== null) {
        if (c.positiveScore >= floor) tp++
        else fn++
      }
      for (const d of c.distractorScores) if (d >= floor) fp++
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
    const f1 =
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall)
    return { floor, tp, fp, fn, precision, recall, f1 }
  })
}

/** Floor sweep + the row with the best F1 (ties → lowest floor, the more
 * permissive choice). */
export function floorSweepWithKnee(
  cases: FloorCase[],
  floors: number[]
): { rows: FloorRow[]; recommended: FloorRow } {
  const rows = floorSweep(cases, floors)
  const recommended = rows.reduce(
    (best, r) => (r.f1 > best.f1 ? r : best),
    rows[0]!
  )
  return { rows, recommended }
}

export interface ScoredItem {
  id: string
  score: number
  isPositive: boolean
}

/** Fraction of positive-bearing cases whose positive is within the top-k by
 * score. `ranked[i]` must be pre-sorted desc by score. Cases with no positive
 * member are skipped (they have nothing to recall). */
export function recallAtK(ranked: ScoredItem[][], k: number): number {
  let denom = 0
  let hit = 0
  for (const list of ranked) {
    if (!list.some(x => x.isPositive)) continue
    denom++
    if (list.slice(0, k).some(x => x.isPositive)) hit++
  }
  return denom === 0 ? 0 : hit / denom
}

export interface SeparationCase {
  positiveScore: number
  distractorScores: number[]
}

/** Distribution of (positive − best distractor) over positive-bearing cases. */
export function separation(cases: SeparationCase[]): {
  mean: number
  min: number
  margins: number[]
} {
  const margins = cases.map(
    c => c.positiveScore - Math.max(0, ...c.distractorScores)
  )
  const mean = margins.length
    ? margins.reduce((a, b) => a + b, 0) / margins.length
    : 0
  const min = margins.length ? Math.min(...margins) : 0
  return { mean, min, margins }
}
