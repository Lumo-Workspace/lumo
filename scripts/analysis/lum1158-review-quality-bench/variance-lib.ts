/**
 * LUM-1197 — how much of a benchmark difference is run-to-run noise.
 *
 * Lumo's review is sampled: the same PRs reviewed twice give different
 * findings (shipped F1 43.0 vs 35.5 on the same 40 PRs in LUM-1158). The
 * model behind it ignores temperature / top-k / top-p, so the noise cannot be
 * switched off; it has to be measured. These are the pure pieces `compare.ts`
 * uses to compare two arms (several runs each) on the same PRs.
 *
 * An arm is `runs[run][pr]`: every run scored on the same PR list, in the
 * same order.
 */
import { pooled, type PrScore } from './bench-lib'

export type ArmRuns = ReadonlyArray<ReadonlyArray<PrScore>>

export interface ArmStats {
  /** Per run, pooled over its PRs, in percent. */
  f1: number[]
  precision: number[]
  recall: number[]
  noisePerPr: number[]
  /** Mean of the per-run F1. */
  mean: number
  /** Sample SD of the per-run F1 (0 for one run). */
  sd: number
  /** Max − min of the per-run F1. */
  spread: number
}

const mean = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

function sampleSd(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
}

/** Each run pooled over its PRs, then mean / SD / spread across runs. */
export function armStats(runs: ArmRuns): ArmStats {
  const p = runs.map(r => pooled(r))
  const f1 = p.map(x => 100 * x.f1)
  return {
    f1,
    precision: p.map(x => 100 * x.precision),
    recall: p.map(x => 100 * x.recall),
    noisePerPr: p.map(x => x.noisePerPr),
    mean: mean(f1),
    sd: sampleSd(f1),
    spread: f1.length ? Math.max(...f1) - Math.min(...f1) : 0,
  }
}

/** Fixes found by every run, out of fixes found by any run (PR-qualified). */
export function foundByEveryRun(runs: ArmRuns): { every: number; any: number } {
  let every = 0
  let any = 0
  const prs = runs[0]?.length ?? 0
  for (let i = 0; i < prs; i++) {
    const count = new Map<string, number>()
    for (const run of runs)
      for (const id of run[i]?.matchedFixIds ?? [])
        count.set(id, (count.get(id) ?? 0) + 1)
    any += count.size
    for (const c of count.values()) if (c === runs.length) every++
  }
  return { every, any }
}

function assertSamePrs(a: ArmRuns, b: ArmRuns): number {
  const lengths = new Set([...a, ...b].map(r => r.length))
  if (lengths.size !== 1 || a.length === 0 || b.length === 0)
    throw new Error('both arms must have runs scored on the same PRs')
  return [...lengths][0]!
}

function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round(q * (sorted.length - 1)))
  )
  return sorted[i]!
}

export interface F1Delta {
  /** Observed: mean F1 of the variant's runs − mean F1 of the base's. */
  delta: number
  /** 95% bootstrap interval of that difference. */
  lo: number
  hi: number
  /** Share of bootstrap draws in which the variant came out ahead. */
  pBetter: number
}

/**
 * Paired two-level bootstrap of the arm-mean F1 difference: resample the PRs
 * (both arms get the same draw), then for each arm rebuild as many runs as it
 * has by picking, per PR, one of that arm's runs at random. The interval
 * covers both which PRs are in the set and which sample each run happened to
 * draw, so a difference inside it is run noise, not a change.
 */
export function bootstrapF1Delta(
  base: ArmRuns,
  variant: ArmRuns,
  opts: { iterations: number; rand: () => number }
): F1Delta {
  const prs = assertSamePrs(base, variant)
  const { iterations, rand } = opts
  const pick = (n: number) => Math.floor(rand() * n)
  const armMean = (arm: ArmRuns, idx: readonly number[]) => {
    let sum = 0
    for (let r = 0; r < arm.length; r++)
      sum += 100 * pooled(idx.map(i => arm[pick(arm.length)]![i]!)).f1
    return sum / arm.length
  }
  const draws: number[] = []
  for (let it = 0; it < iterations; it++) {
    const idx = Array.from({ length: prs }, () => pick(prs))
    draws.push(armMean(variant, idx) - armMean(base, idx))
  }
  draws.sort((a, b) => a - b)
  return {
    delta: armStats(variant).mean - armStats(base).mean,
    lo: percentile(draws, 0.025),
    hi: percentile(draws, 0.975),
    pBetter: draws.filter(d => d > 0).length / Math.max(1, draws.length),
  }
}

function logFactorial(n: number): number {
  let s = 0
  for (let i = 2; i <= n; i++) s += Math.log(i)
  return s
}

const logChoose = (n: number, k: number): number =>
  logFactorial(n) - logFactorial(k) - logFactorial(n - k)

/**
 * One-sided Fisher exact test that the variant's hit rate is higher:
 * P(variant hits ≥ observed) given the pooled hits, under the hypergeometric.
 */
export function fisherOneSidedGreater(
  variantHits: number,
  variantMisses: number,
  baseHits: number,
  baseMisses: number
): number {
  const n = variantHits + variantMisses
  const hits = variantHits + baseHits
  const total = n + baseHits + baseMisses
  if (total === 0) return 1
  const denom = logChoose(total, n)
  let p = 0
  for (let x = variantHits; x <= Math.min(n, hits); x++)
    p += Math.exp(logChoose(hits, x) + logChoose(total - hits, n - x) - denom)
  return Math.min(1, p)
}

export interface TargetFix {
  prId: string
  fixId: string
}

/**
 * How many runs found each pre-registered target fix (the fixes a change is
 * meant to catch). Targets on PRs outside `prIds` are listed as missing.
 */
export function targetFixHits(
  runs: ArmRuns,
  prIds: readonly string[],
  targets: readonly TargetFix[]
): {
  hits: number
  trials: number
  perFix: Array<TargetFix & { hits: number }>
  missing: string[]
} {
  const perFix: Array<TargetFix & { hits: number }> = []
  const missing: string[] = []
  for (const t of targets) {
    const i = prIds.indexOf(t.prId)
    if (i < 0) {
      missing.push(`${t.prId}:${t.fixId}`)
      continue
    }
    const hits = runs.filter(r => r[i]?.matchedFixIds.includes(t.fixId)).length
    perFix.push({ ...t, hits })
  }
  const hits = perFix.reduce((a, f) => a + f.hits, 0)
  return { hits, trials: perFix.length * runs.length, perFix, missing }
}

/**
 * The smallest arm-mean F1 difference a comparison of `runsPerArm` runs per
 * arm detects reliably (95% two-sided, 80% power), given one run's F1 SD on
 * the PR set: 2.8 × sd × √(2 / n).
 */
export function detectableDelta(sdRun: number, runsPerArm: number): number {
  return 2.8 * sdRun * Math.sqrt(2 / runsPerArm)
}

/** Runs per arm below which `compare.ts` gives no verdict at all. */
export const MIN_RUNS_FOR_VERDICT = 2

/**
 * The verdict on an F1 difference. With a single run in either arm the
 * interval says nothing about run noise (a one-run arm resamples one sample),
 * so no verdict is given.
 */
export function deltaVerdict(
  d: Pick<F1Delta, 'lo' | 'hi'>,
  baseRuns: number,
  variantRuns: number
): string {
  if (Math.min(baseRuns, variantRuns) < MIN_RUNS_FOR_VERDICT)
    return 'insufficient runs (need ≥ 2 per arm, 3 recommended)'
  if (d.lo > 0) return 'better beyond run noise'
  if (d.hi < 0) return 'worse beyond run noise'
  return 'inside run noise'
}

/** Holm step-down adjustment of p-values, returned in the input order. */
export function holmAdjust(ps: readonly number[]): number[] {
  const m = ps.length
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const out = new Array<number>(m)
  let running = 0
  order.forEach(({ p, i }, k) => {
    running = Math.max(running, Math.min(1, (m - k) * p))
    out[i] = running
  })
  return out
}

/**
 * One test per target fix: its hits over the base's runs vs over the
 * variant's runs (one-sided Fisher — runs of one fix are independent
 * samples), Holm-adjusted across the fixes. Pooling fix × run trials would
 * treat the fixes of one run as independent, which they are not.
 */
export function targetFixTests(
  base: ArmRuns,
  variant: ArmRuns,
  prIds: readonly string[],
  targets: readonly TargetFix[]
): {
  perFix: Array<
    TargetFix & {
      baseHits: number
      variantHits: number
      p: number
      pHolm: number
    }
  >
  missing: string[]
} {
  const b = targetFixHits(base, prIds, targets)
  const v = targetFixHits(variant, prIds, targets)
  const raw = v.perFix.map((x, i) => {
    const baseHits = b.perFix[i]!.hits
    return {
      prId: x.prId,
      fixId: x.fixId,
      baseHits,
      variantHits: x.hits,
      p: fisherOneSidedGreater(
        x.hits,
        variant.length - x.hits,
        baseHits,
        base.length - baseHits
      ),
    }
  })
  const adj = holmAdjust(raw.map(r => r.p))
  return {
    perFix: raw.map((r, i) => ({ ...r, pHolm: adj[i]! })),
    missing: v.missing,
  }
}

/** A whole-number CLI option ≥ `min`; throws naming the flag otherwise. */
export function parseCount(name: string, value: string, min: number): number {
  const n = value.trim() === '' ? NaN : Number(value)
  if (!Number.isFinite(n))
    throw new Error(`--${name} must be a number, got "${value}"`)
  if (!Number.isInteger(n))
    throw new Error(`--${name} must be a whole number, got ${value}`)
  if (n < min) throw new Error(`--${name} must be ≥ ${min}, got ${value}`)
  return n
}
