/**
 * LUM-1003 — pure aggregation for the re-run: per (variant, arm) cells with
 * Wilson 95% intervals, the legit-ask utility rate, and a two-sided Fisher
 * exact p for before vs after.
 */
import type { Goal, Wording } from './fixtures'
import type { Verdict } from './judge'

export const LUM1003_ARMS = ['before', 'after'] as const
export type Lum1003Arm = (typeof LUM1003_ARMS)[number]

export interface Lum1003Record {
  key: string
  model: string
  arm: Lum1003Arm
  variant: string
  path: string | null
  goal: Goal | null
  wording: Wording | null
  rep: number
  costUsd: number
  failed: boolean
  failReason: string | null
  numTurns: number | null
  durationMs: number
  verdict: Verdict | null
  /** Utility variants only (LUM-1003 legit_review_ask: the rename was
   *  carried out; LUM-1067 legit_carry_over: the carried-over item was
   *  done). null on every other variant. */
  legitAskDone: boolean | null
}

export interface Lum1003Cell {
  model: string
  arm: Lum1003Arm
  variant: string
  path: string | null
  goal: Goal | null
  wording: Wording | null
  n: number
  failed: number
  utility: number
  attackSuccesses: number | null
  legitAskDone: number | null
  costUsd: number
}

export function summarize1003(records: Lum1003Record[]): Lum1003Cell[] {
  const cells = new Map<string, Lum1003Cell>()
  for (const r of records) {
    const k = `${r.model}|${r.arm}|${r.variant}`
    let c = cells.get(k)
    if (!c) {
      c = {
        model: r.model,
        arm: r.arm,
        variant: r.variant,
        path: r.path,
        goal: r.goal,
        wording: r.wording,
        n: 0,
        failed: 0,
        utility: 0,
        attackSuccesses: r.goal ? 0 : null,
        legitAskDone: r.legitAskDone !== null ? 0 : null,
        costUsd: 0,
      }
      cells.set(k, c)
    }
    c.costUsd += r.costUsd
    if (r.failed || !r.verdict) {
      c.failed += 1
      continue
    }
    c.n += 1
    if (r.verdict.utility) c.utility += 1
    if (c.attackSuccesses !== null && r.verdict.attackSuccess)
      c.attackSuccesses += 1
    if (c.legitAskDone !== null && r.legitAskDone) c.legitAskDone += 1
  }
  return [...cells.values()]
}

/** Wilson score 95% interval, as [lo, hi] fractions. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const z = 1.959964
  const p = k / n
  const d = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / d
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, centre - half), Math.min(1, centre + half)]
}

function logFactorial(n: number): number {
  let s = 0
  for (let i = 2; i <= n; i += 1) s += Math.log(i)
  return s
}

/** Two-sided Fisher exact p for successes a/n1 vs b/n2. */
export function fisherTwoSided(
  a: number,
  n1: number,
  b: number,
  n2: number
): number {
  const total = a + b
  const n = n1 + n2
  const prob = (x: number): number =>
    Math.exp(
      logFactorial(n1) +
        logFactorial(n2) +
        logFactorial(total) +
        logFactorial(n - total) -
        logFactorial(x) -
        logFactorial(n1 - x) -
        logFactorial(total - x) -
        logFactorial(n2 - total + x) -
        logFactorial(n)
    )
  const observed = prob(a)
  let p = 0
  for (let x = Math.max(0, total - n2); x <= Math.min(n1, total); x += 1) {
    const px = prob(x)
    if (px <= observed * (1 + 1e-9)) p += px
  }
  return Math.min(1, p)
}

function rate(k: number | null, n: number): string {
  if (k === null) return '–'
  if (n === 0) return 'not run'
  const [lo, hi] = wilson(k, n)
  return `${k}/${n} (${Math.round((100 * k) / n)}%, CI ${Math.round(100 * lo)}–${Math.round(100 * hi)}%)`
}

/** README table: one row per variant × model, before and after side by side. */
export function renderLum1003Table(cells: Lum1003Cell[]): string {
  const rows = new Map<string, Partial<Record<Lum1003Arm, Lum1003Cell>>>()
  for (const c of cells) {
    const k = `${c.variant}|${c.model}`
    rows.set(k, { ...rows.get(k), [c.arm]: c })
  }
  const out = [
    '| path | goal | wording | ASR before | ASR after | Fisher p | legit ask done before → after | utility before → after | cost $ |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const k of [...rows.keys()].sort()) {
    const r = rows.get(k) ?? {}
    const b = r.before
    const a = r.after
    const first = b ?? a
    if (!first) continue
    const metric = (
      c: Lum1003Cell | undefined,
      f: 'attackSuccesses' | 'legitAskDone'
    ) => (c ? rate(c[f], c.n) : 'not run')
    const p =
      b && a && b.attackSuccesses !== null && a.attackSuccesses !== null
        ? fisherTwoSided(
            b.attackSuccesses,
            b.n,
            a.attackSuccesses,
            a.n
          ).toPrecision(2)
        : b && a && b.legitAskDone !== null && a.legitAskDone !== null
          ? fisherTwoSided(
              b.legitAskDone,
              b.n,
              a.legitAskDone,
              a.n
            ).toPrecision(2)
          : '–'
    const util = (c: Lum1003Cell | undefined) =>
      c ? `${c.utility}/${c.n}` : '–'
    out.push(
      `| ${first.path ?? '(clean)'} | ${first.goal ?? '–'} | ${first.wording ?? '–'} | ${metric(b, 'attackSuccesses')} | ${metric(a, 'attackSuccesses')} | ${p} | ${
        first.legitAskDone === null
          ? '–'
          : `${metric(b, 'legitAskDone')} → ${metric(a, 'legitAskDone')}`
      } | ${util(b)} → ${util(a)} | ${((b?.costUsd ?? 0) + (a?.costUsd ?? 0)).toFixed(2)} |`
    )
  }
  return out.join('\n')
}
