/**
 * LUM-786 — merge the manual adjudication of the backtest's candidates back
 * into `results.json`, and compute the precision that follows from it.
 *
 * The backtest can count candidates; only a reader can say whether a candidate
 * is a real "the agent did this because the injected content said so". Those
 * judgements live in `adjudications.json` — one row per judged candidate, keyed
 * so a re-run of the backtest re-attaches them — and this script folds them in
 * and writes the summary. Splitting it out keeps `backtest.ts` a pure
 * measurement and makes the judging reviewable on its own.
 *
 *   npx tsx scripts/analysis/lum786-injection-action/adjudicate.ts
 *
 * One-off analysis CLI under scripts/analysis: console output is the product.
 */
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'scripts/analysis/lum786-injection-action'

export type Verdict = 'TRUE_POSITIVE' | 'FALSE_POSITIVE' | 'UNJUDGED'

export interface Adjudication {
  key: string
  verdict: Verdict
  /** Why — the FP cause class, or what makes it a real one. */
  reason: string
}

interface CandidateRow {
  tier: string
  source: string
  tool: string | null
  lagSeconds: number
  literal: { kind: string; value: string }
  adjudication?: string
  adjudicationReason?: string
  key?: string
}

/**
 * Stable across backtest re-runs: a candidate is the same candidate when the
 * same literal from the same source reappears in the same tool at the same lag.
 */
export function candidateKey(c: CandidateRow): string {
  return `${c.source}|${c.literal.kind}:${c.literal.value}|${c.tool ?? 'null'}|${c.lagSeconds}`
}

export interface Summary {
  judged: number
  truePositives: number
  falsePositives: number
  unjudged: number
  /** TP / judged. `null` when nothing was judged — never a fabricated 0. */
  precision: number | null
  byTier: Record<string, { judged: number; truePositives: number }>
  falsePositiveCauses: Record<string, number>
}

export function summarize(
  rows: CandidateRow[],
  byKey: Map<string, Adjudication>
): Summary {
  const summary: Summary = {
    judged: 0,
    truePositives: 0,
    falsePositives: 0,
    unjudged: 0,
    precision: null,
    byTier: {},
    falsePositiveCauses: {},
  }
  for (const row of rows) {
    const a = byKey.get(candidateKey(row))
    const verdict: Verdict = a?.verdict ?? 'UNJUDGED'
    const tier = (summary.byTier[row.tier] ??= { judged: 0, truePositives: 0 })
    if (verdict === 'UNJUDGED') {
      summary.unjudged += 1
      continue
    }
    summary.judged += 1
    tier.judged += 1
    if (verdict === 'TRUE_POSITIVE') {
      summary.truePositives += 1
      tier.truePositives += 1
    } else {
      summary.falsePositives += 1
      const cause = a?.reason ?? 'unspecified'
      summary.falsePositiveCauses[cause] =
        (summary.falsePositiveCauses[cause] ?? 0) + 1
    }
  }
  summary.precision =
    summary.judged === 0 ? null : summary.truePositives / summary.judged
  return summary
}

function main(): void {
  const resultsPath = join(DIR, 'results.json')
  const results = JSON.parse(readFileSync(resultsPath, 'utf8'))
  const adjudications: Adjudication[] = JSON.parse(
    readFileSync(join(DIR, 'adjudications.json'), 'utf8')
  )
  const byKey = new Map(adjudications.map(a => [a.key, a]))

  const rows: CandidateRow[] = [...results.escalated, ...results.samples]
  for (const row of rows) {
    const key = candidateKey(row)
    const a = byKey.get(key)
    row.key = key
    row.adjudication = a?.verdict ?? 'UNJUDGED'
    if (a) row.adjudicationReason = a.reason
  }

  results.adjudicationSummary = summarize(rows, byKey)
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`)

  const s = results.adjudicationSummary as Summary
  console.log(
    `adjudicated ${s.judged} candidates · true positives ${s.truePositives} · false positives ${s.falsePositives} · unjudged ${s.unjudged}`
  )
  console.log(
    `precision: ${s.precision === null ? 'n/a (nothing judged)' : `${(s.precision * 100).toFixed(1)}%`}`
  )
  console.log('by tier:', s.byTier)
  console.log('false-positive causes:', s.falsePositiveCauses)
}

if (require.main === module) main()
