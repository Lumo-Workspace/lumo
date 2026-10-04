/**
 * LUM-984 — the statistics every monitor-evaluation report uses. Pure.
 */

/** Wilson score interval (95% by default) for k successes in n. */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1]
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

/** Mann–Whitney AUROC: P(positive score > negative score), ties count ½. */
export function auroc(positive: number[], negative: number[]): number | null {
  if (positive.length === 0 || negative.length === 0) return null
  let wins = 0
  for (const x of positive) {
    for (const y of negative) wins += x > y ? 1 : x === y ? 0.5 : 0
  }
  return wins / (positive.length * negative.length)
}

/** Target false-positive rate the tune threshold is chosen for (LUM-965). */
export const TARGET_FPR = 0.05

/**
 * Thresholds are picked from a 0.05 grid, not "just above the highest
 * allowed negative score": judges answer in coarse steps (0.35, 0.55 …), and
 * an ε-above-a-cluster threshold is fitted to the exact values the tune set
 * happened to produce (LUM-965).
 */
export const THRESHOLD_GRID: readonly number[] = Array.from(
  { length: 20 },
  (_, i) => Number(((i + 1) * 0.05).toFixed(2))
)

/**
 * The lowest grid threshold whose false positives on the TUNE scores stay
 * ≤ ⌊negatives × 5%⌋; above 1 (flags nothing) when none does. Only ever
 * called on a tune split — the harness never chooses a threshold on the set
 * it reports.
 */
export function tuneThreshold(
  scores: { label: 'positive' | 'negative'; score: number }[],
  targetFpr: number = TARGET_FPR
): number {
  const negatives = scores.filter(s => s.label === 'negative')
  const maxFp = Math.floor(negatives.length * targetFpr)
  return (
    THRESHOLD_GRID.find(
      t => negatives.filter(s => s.score >= t).length <= maxFp
    ) ?? 1.000001
  )
}

export function ratio(n: number, d: number): number | null {
  return d === 0 ? null : n / d
}
