/**
 * LUM-999 — pure aggregation of episode records into the README table.
 */
import type { ContextPath, Goal, Wording } from './fixtures'
import type { Verdict } from './judge'

export const ARMS = ['before', 'after', 'afterB'] as const
export type Arm = (typeof ARMS)[number]

export interface EpisodeRecord {
  key: string
  model: string
  arm: Arm
  variant: string
  path: ContextPath | null
  goal: Goal | null
  wording: Wording | null
  rep: number
  costUsd: number
  /** The run failed (API/budget/timeout) — excluded from the rates. */
  failed: boolean
  failReason: string | null
  numTurns: number | null
  durationMs: number
  verdict: Verdict | null
}

export interface CellSummary {
  model: string
  arm: Arm
  variant: string
  path: ContextPath | null
  goal: Goal | null
  wording: Wording | null
  n: number
  failed: number
  utility: number
  /** null for the clean baseline. */
  attackSuccesses: number | null
  readContext: number
  costUsd: number
}

export function episodeKey(
  model: string,
  arm: Arm,
  variant: string,
  rep: number
): string {
  return `${model}|${arm}|${variant}|${rep}`
}

export function summarize(records: EpisodeRecord[]): CellSummary[] {
  const cells = new Map<string, CellSummary>()
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
        readContext: 0,
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
    if (r.verdict.readContext) c.readContext += 1
    if (c.attackSuccesses !== null && r.verdict.attackSuccess) {
      c.attackSuccesses += 1
    }
  }
  return [...cells.values()]
}

export function totalCost(records: EpisodeRecord[]): number {
  return records.reduce((s, r) => s + r.costUsd, 0)
}

function pct(k: number, n: number): string {
  if (n === 0) return '–'
  return `${Math.round((100 * k) / n)}% (${k}/${n})`
}

/** Markdown table: path × goal × wording × arm × model. */
export function renderTable(cells: CellSummary[]): string {
  const rows = [...cells].sort((a, b) =>
    [a.path ?? '', a.goal ?? '', a.wording ?? '', a.model, a.arm]
      .join('|')
      .localeCompare(
        [b.path ?? '', b.goal ?? '', b.wording ?? '', b.model, b.arm].join('|')
      )
  )
  const out = [
    '| path | goal | wording | model | arm | N | utility | ASR | read ctx | failed | cost $ |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const c of rows) {
    out.push(
      `| ${c.path ?? '(clean baseline)'} | ${c.goal ?? '–'} | ${c.wording ?? '–'} | ${c.model} | ${c.arm} | ${c.n} | ${pct(c.utility, c.n)} | ${
        c.attackSuccesses === null ? '–' : pct(c.attackSuccesses, c.n)
      } | ${c.readContext}/${c.n} | ${c.failed} | ${c.costUsd.toFixed(2)} |`
    )
  }
  return out.join('\n')
}
